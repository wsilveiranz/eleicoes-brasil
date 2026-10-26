"""Aggregate public TSE age/turnout counts, never voter identities or preferences.

Run: python scripts\\refresh-age-turnout.py [--archive path-to-reviewed-download.zip]
No dependencies beyond Python's standard library. Raw files stay out of Pages.
"""

import argparse
import codecs
from concurrent.futures import ThreadPoolExecutor, as_completed
import copy
import csv
from datetime import datetime, timezone, timedelta
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "data" / "2026" / "age-turnout.json"
CACHE = ROOT / ".tse-import-cache" / "age-turnout-2026.zip"
SOURCE = "https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_comparecimento_abstencao/perfil_comparecimento_abstencao_2026.zip"
STATES = set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO ZZ".split())
REQUIRED = {
    "DT_GERACAO", "HH_GERACAO", "ANO_ELEICAO", "NR_TURNO", "SG_UF",
    "CD_FAIXA_ETARIA", "DS_FAIXA_ETARIA", "QT_APTOS", "QT_COMPARECIMENTO", "QT_ABSTENCAO",
}
MAX_SAFE = 9007199254740991


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def empty_data():
    return {
        "schemaVersion": 1, "year": 2026, "checkedAt": now(),
        "lastSuccessAt": None, "dataUpdatedAt": None,
        "refresh": "error", "error": "A fonte ainda não foi verificada.",
        "source": SOURCE, "etag": None, "lastModified": None, "sha256": None,
        "first": {"status": "incomplete", "sourceGeneratedAt": None, "states": [], "bands": []},
        "second": {"status": "incomplete", "sourceGeneratedAt": None, "states": [], "bands": []},
    }


def checked_count(value):
    if not re.fullmatch(r"\d+", value):
        raise ValueError("Contagem etária ausente, negativa ou inválida.")
    number = int(value)
    if number > MAX_SAFE:
        raise ValueError("Contagem etária fora do intervalo seguro.")
    return number


def aggregate(archive_path):
    generated_cache = {}
    rounds = {
        turn: {"states": set(), "bands": {}, "generated": set()}
        for turn in ("1", "2")
    }
    with zipfile.ZipFile(archive_path) as archive:
        members = {}
        for name in archive.namelist():
            match = re.fullmatch(r"perfil_comparecimento_abstencao_2026_([A-Z]{2})\.csv", name)
            if match:
                state = match.group(1)
                if state not in STATES or state in members:
                    raise ValueError("UF desconhecida ou duplicada no arquivo etário.")
                members[state] = name
        if set(members) != STATES:
            raise ValueError("Inventário etário incompleto: necessárias 27 UFs e exterior.")
        # BRASIL.csv repeats the UF records; never aggregate both.
        for state, name in sorted(members.items()):
            with archive.open(name) as raw:
                sample = raw.read(65536)
            try:
                codecs.getincrementaldecoder("utf-8")().decode(sample, final=False)
                encoding = "utf-8-sig"
            except UnicodeDecodeError:
                encoding = "cp1252"
            rows = 0
            with archive.open(name) as raw, io.TextIOWrapper(raw, encoding=encoding, newline="") as stream:
                reader = csv.DictReader(stream, delimiter=";")
                if not reader.fieldnames or not REQUIRED.issubset(reader.fieldnames):
                    raise ValueError("Colunas obrigatórias ausentes no perfil etário.")
                for row in reader:
                    rows += 1
                    if row["ANO_ELEICAO"] != "2026" or row["SG_UF"] != state or row["NR_TURNO"] not in rounds:
                        raise ValueError("Identidade da eleição, UF ou turno etário inválida.")
                    group = rounds[row["NR_TURNO"]]
                    eligible, attended, abstained = (
                        checked_count(row[key]) for key in ("QT_APTOS", "QT_COMPARECIMENTO", "QT_ABSTENCAO")
                    )
                    if attended + abstained != eligible:
                        raise ValueError("Comparecimento e abstenção não reconciliam por idade.")
                    code, label = row["CD_FAIXA_ETARIA"], row["DS_FAIXA_ETARIA"].strip()
                    if not re.fullmatch(r"-?\d+", code) or not label:
                        raise ValueError("Faixa etária sem identidade ou rótulo.")
                    band = group["bands"].setdefault(code, {
                        "code": code, "label": label, "eligible": 0, "attended": 0, "abstained": 0,
                    })
                    if band["label"] != label:
                        raise ValueError("Rótulos divergentes para a mesma faixa etária.")
                    for key, value in [("eligible", eligible), ("attended", attended), ("abstained", abstained)]:
                        band[key] += value
                        if band[key] > MAX_SAFE:
                            raise ValueError("Soma etária fora do intervalo seguro.")
                    date_key = row["DT_GERACAO"] + " " + row["HH_GERACAO"]
                    if date_key not in generated_cache:
                        generated_cache[date_key] = datetime.strptime(
                            date_key, "%d/%m/%Y %H:%M:%S",
                        ).replace(tzinfo=timezone(timedelta(hours=-3))).astimezone(timezone.utc)
                    generated = generated_cache[date_key]
                    election_date = datetime(2026, 10, 4 if row["NR_TURNO"] == "1" else 25, tzinfo=timezone.utc)
                    if generated < election_date:
                        raise ValueError("Perfil etário gerado antes da votação do turno.")
                    group["generated"].add(generated.isoformat().replace("+00:00", "Z"))
                    group["states"].add(state)
            if rows == 0:
                raise ValueError("Arquivo de UF etário vazio.")
            print(f"Aggregated {state}: {rows} records", flush=True)
    result = {}
    for turn, key in [("1", "first"), ("2", "second")]:
        group = rounds[turn]
        complete = group["states"] == STATES
        result[key] = {
            "status": "available" if complete else "incomplete" if group["states"] else "not-published",
            "sourceGeneratedAt": max(group["generated"]) if group["generated"] else None,
            "states": sorted(group["states"]),
            "bands": sorted(group["bands"].values(), key=lambda band: int(band["code"])) if complete else [],
        }
    if result["first"]["status"] != "available":
        raise ValueError("O perfil do primeiro turno, já publicado, não pode ser removido ou incompleto.")
    return result


def save(data, output=OUTPUT):
    temporary = output.with_suffix(".pending")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(output)


def refresh(previous, archive_path=None):
    result = copy.deepcopy(previous)
    checked_at = now()
    if archive_path is None:
        request = urllib.request.Request(SOURCE, method="HEAD")
        with urllib.request.urlopen(request, timeout=60) as response:
            etag = response.headers.get("ETag")
            modified = response.headers.get("Last-Modified")
            size = int(response.headers["Content-Length"])
            ranged = response.headers.get("Accept-Ranges") == "bytes"
        if previous.get("sha256") and etag and etag == previous.get("etag") and modified == previous.get("lastModified"):
            result.update(checkedAt=checked_at, lastSuccessAt=checked_at, refresh="ok", error=None)
            return result
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        temporary = CACHE.with_suffix(".pending")
        if size <= 0 or size > 1024 * 1024 * 1024:
            raise ValueError("Tamanho do arquivo etário inválido ou maior que 1 GB.")
        if ranged and etag and not etag.startswith("W/"):
            # Small validated ranges avoid restarting a large archive on a slow CDN stream.
            def fetch_range(start):
                end = min(size - 1, start + 1024 * 1024 - 1)
                request = urllib.request.Request(SOURCE, headers={
                    "Range": f"bytes={start}-{end}", "If-Match": etag,
                })
                with urllib.request.urlopen(request, timeout=90) as response:
                    if response.status != 206 or response.headers.get("Content-Range") != f"bytes {start}-{end}/{size}":
                        raise ValueError("A fonte não respeitou o intervalo solicitado.")
                    if response.headers.get("ETag") != etag:
                        raise ValueError("O arquivo etário mudou durante a transferência.")
                    chunk = response.read(end - start + 2)
                    if len(chunk) != end - start + 1:
                        raise ValueError("Intervalo etário incompleto.")
                    return start, chunk
            with ThreadPoolExecutor(max_workers=4) as pool, temporary.open("wb") as output:
                output.truncate(size)
                futures = [pool.submit(fetch_range, start) for start in range(0, size, 1024 * 1024)]
                for future in as_completed(futures):
                    start, chunk = future.result()
                    output.seek(start)
                    output.write(chunk)
        else:
            with urllib.request.urlopen(SOURCE, timeout=120) as response, temporary.open("wb") as output:
                if response.headers.get("ETag") != etag:
                    raise ValueError("O arquivo etário mudou durante a transferência.")
                received = 0
                while chunk := response.read(1024 * 1024):
                    received += len(chunk)
                    if received > size:
                        raise ValueError("Tamanho recebido difere do anunciado pela fonte.")
                    output.write(chunk)
                if received != size:
                    raise ValueError("Arquivo etário incompleto.")
        temporary.replace(CACHE)
        archive_path = CACHE
        digest = hashlib.sha256()
        with CACHE.open("rb") as source:
            while chunk := source.read(8 * 1024 * 1024):
                digest.update(chunk)
        checksum = digest.hexdigest()
    else:
        etag, modified = None, None
        digest = hashlib.sha256()
        with Path(archive_path).open("rb") as source:
            while chunk := source.read(8 * 1024 * 1024):
                digest.update(chunk)
        checksum = digest.hexdigest()
    latest = aggregate(archive_path)
    for key in ("first", "second"):
        if previous[key]["status"] == "available" and latest[key]["status"] != "available":
            raise ValueError("A fonte regrediu para cobertura incompleta; preservando os dados válidos anteriores.")
    result.update(
        **latest, checkedAt=checked_at, lastSuccessAt=checked_at, dataUpdatedAt=now(),
        refresh="ok", error=None, etag=etag, lastModified=modified, sha256=checksum,
    )
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    previous = json.loads(OUTPUT.read_text("utf-8")) if OUTPUT.exists() else empty_data()
    try:
        data = refresh(previous, args.archive)
        save(data)
        print(json.dumps({key: data[key]["status"] for key in ("first", "second")}))
    except (OSError, ValueError, csv.Error, zipfile.BadZipFile, UnicodeError, KeyError) as error:
        previous.update(checkedAt=now(), refresh="error", error=f"Falha ao verificar a fonte TSE: {error}")
        save(previous)
        print(previous["error"], file=sys.stderr)
        sys.exit(1)
