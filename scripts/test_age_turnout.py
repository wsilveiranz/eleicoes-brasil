import copy
import csv
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("age_turnout", Path(__file__).with_name("refresh-age-turnout.py"))
age = importlib.util.module_from_spec(spec)
spec.loader.exec_module(age)

FIELDS = [
    "DT_GERACAO", "HH_GERACAO", "ANO_ELEICAO", "NR_TURNO", "SG_UF",
    "CD_FAIXA_ETARIA", "DS_FAIXA_ETARIA", "QT_APTOS", "QT_COMPARECIMENTO", "QT_ABSTENCAO",
]


def make_archive(path, turns=("1",), missing=None, invalid=None):
    with zipfile.ZipFile(path, "w") as archive:
        for state in sorted(age.STATES - set(missing or [])):
            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=FIELDS, delimiter=";")
            writer.writeheader()
            for turn in turns:
                record = dict(zip(FIELDS, [
                    "26/10/2026", "10:00:00", "2026", turn, state, "1617", "16 a 17 anos", "10", "8", "2",
                ]))
                if invalid:
                    invalid(record)
                writer.writerow(record)
            archive.writestr(f"perfil_comparecimento_abstencao_2026_{state}.csv", output.getvalue().encode("utf-8"))
        archive.writestr("perfil_comparecimento_abstencao_2026_BRASIL.csv", "must not be counted twice")


class AgeTurnoutTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.archive = Path(self.directory.name) / "source.zip"
        self.silence = patch("builtins.print")
        self.silence.start()
        self.addCleanup(self.silence.stop)

    def test_first_round_only_is_not_fabricated_as_second(self):
        make_archive(self.archive)
        data = age.aggregate(self.archive)
        self.assertEqual(data["first"]["status"], "available")
        self.assertEqual(data["first"]["bands"][0]["eligible"], 280)
        self.assertEqual(data["first"]["bands"][0]["attended"], 224)
        self.assertEqual(data["second"], {
            "status": "not-published", "sourceGeneratedAt": None, "states": [], "bands": [],
        })

    def test_second_round_becomes_available_automatically(self):
        make_archive(self.archive, turns=("1", "2"))
        data = age.refresh(age.empty_data(), self.archive)
        self.assertEqual(data["second"]["status"], "available")
        self.assertEqual(data["refresh"], "ok")
        self.assertIsNotNone(data["sha256"])
        self.assertEqual(len(data["second"]["states"]), 28)

    def test_partial_second_round_does_not_expose_partial_counts(self):
        make_archive(self.archive, turns=("1", "2"), invalid=lambda row: row.update(
            NR_TURNO="1" if row["SG_UF"] == "ZZ" else row["NR_TURNO"],
        ))
        data = age.aggregate(self.archive)
        self.assertEqual(data["second"]["status"], "incomplete")
        self.assertEqual(data["second"]["bands"], [])
        self.assertEqual(len(data["second"]["states"]), 27)

    def test_bad_year_negative_counts_and_unreconciled_rows_fail(self):
        for changes in [{"ANO_ELEICAO": "2022"}, {"QT_APTOS": "-1"}, {"QT_COMPARECIMENTO": "9"}, {"NR_TURNO": "3"}]:
            with self.subTest(changes=changes):
                make_archive(self.archive, invalid=lambda row: row.update(changes))
                with self.assertRaises(ValueError):
                    age.aggregate(self.archive)

    def test_missing_uf_fails_instead_of_using_partial_totals(self):
        make_archive(self.archive, missing=["AC"])
        with self.assertRaisesRegex(ValueError, "Inventário"):
            age.aggregate(self.archive)

    def test_unchanged_remote_source_updates_check_time_without_download(self):
        previous = age.empty_data()
        previous.update(sha256="a" * 64, etag='"same"', lastModified="unchanged")
        class Response:
            headers = {"ETag": '"same"', "Last-Modified": "unchanged", "Content-Length": "100"}
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                return False
        with patch("urllib.request.urlopen", return_value=Response()) as request:
            data = age.refresh(previous)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(data["sha256"], previous["sha256"])
        self.assertEqual(data["refresh"], "ok")
        self.assertIsNotNone(data["lastSuccessAt"])

    def test_source_regression_preserves_previous_data(self):
        make_archive(self.archive, turns=("1", "2"))
        previous = age.refresh(age.empty_data(), self.archive)
        original = copy.deepcopy(previous)
        make_archive(self.archive)
        with self.assertRaisesRegex(ValueError, "regrediu"):
            age.refresh(previous, self.archive)
        self.assertEqual(previous, original)

    def test_download_validates_ranges_and_never_publishes_mixed_archive_bytes(self):
        make_archive(self.archive)
        raw = self.archive.read_bytes()
        calls = []
        class Response(io.BytesIO):
            def __init__(self, body, headers, status):
                super().__init__(body)
                self.headers = headers
                self.status = status
        def request(req, timeout):
            calls.append(req)
            headers = {"ETag": '"archive"', "Last-Modified": "yesterday", "Content-Length": str(len(raw)), "Accept-Ranges": "bytes"}
            if req.get_method() == "HEAD":
                return Response(b"", headers, 200)
            self.assertEqual(req.get_header("If-match"), '"archive"')
            self.assertEqual(req.get_header("Range"), f"bytes=0-{len(raw) - 1}")
            return Response(raw, {**headers, "Content-Range": f"bytes 0-{len(raw) - 1}/{len(raw)}"}, 206)
        with patch("urllib.request.urlopen", side_effect=request), patch.object(age, "CACHE", Path(self.directory.name) / "cache.zip"):
            result = age.refresh(age.empty_data())
        self.assertEqual(len(calls), 2)
        self.assertEqual(result["first"]["status"], "available")
        self.assertEqual(result["etag"], '"archive"')
        self.assertEqual(result["sha256"], age.hashlib.sha256(raw).hexdigest())

    def test_atomic_save_preserves_only_public_aggregate_fields(self):
        output = Path(self.directory.name) / "age-turnout.json"
        data = age.empty_data()
        age.save(data, output)
        self.assertEqual(json.loads(output.read_text("utf-8")), data)
        self.assertFalse(output.with_suffix(".pending").exists())


if __name__ == "__main__":
    unittest.main()
