"""Rebuild the TSE-code -> country mapping from captured public TRE-DF workbooks.

Run: python scripts\\generate-country-map.py
No inferred countries, external geocoder, voter records, or third-party data.
"""

import hashlib
import io
import json
import pathlib
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
OUTPUT = ROOT / "src" / "data" / "geography"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
# Explicit textual variants between the two official lists, not country guesses.
CITY_ALIASES = {
    "99473": "Bahrein",
    "29521": "Chuí",
    "99430": "Kingston",
    "30104": "Cidade do México",
    "99333": "Saint Georges de Loyapock",
    "30783": "Washington DC",
}


def normalize(value):
    ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub("[^A-Z0-9]", "", ascii_text.upper())


def workbook_rows(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        name = next(n for n in archive.namelist() if n.endswith(".xlsx"))
        with zipfile.ZipFile(io.BytesIO(archive.read(name))) as workbook:
            strings = [
                "".join(t.itertext())
                for t in ET.fromstring(workbook.read("xl/sharedStrings.xml")).findall("m:si", NS)
            ]
            sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
            for row in sheet.findall(".//m:row", NS):
                cells = {}
                for cell in row:
                    value = cell.findtext("m:v", "", NS)
                    if cell.attrib.get("t") == "s":
                        value = strings[int(value)]
                    cells[re.sub("[0-9]", "", cell.attrib["r"])] = value
                if cells.get("A") and cells.get("B") and cells["A"] != "País":
                    yield name, int(row.attrib["r"]), cells["A"], cells["B"]


def build():
    sources = json.loads((FIXTURES / "tre-df-sources.json").read_text("utf-8"))
    by_city = {}
    for source in sources["sources"]:
        raw = (FIXTURES / source["file"]).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == source["sha256"], source["file"]
        for workbook, row, country, city in workbook_rows(raw):
            key = normalize(city)
            record = {
                "countryName": country,
                "sourceCity": city,
                "source": source["url"],
                "workbook": workbook,
                "sheet": "sheet1",
                "row": row,
            }
            if key in by_city:
                assert by_city[key]["countryName"] == country, f"Ambiguous city: {city}"
            else:
                by_city[key] = record
    fixture_sources = json.loads((FIXTURES / "official-sources.json").read_text("utf-8"))
    metadata_source = next(s for s in fixture_sources["sources"] if s["name"] == "municipalities")
    metadata_raw = (FIXTURES / "municipalities.json").read_bytes()
    metadata_jws = (FIXTURES / "municipalities.jws").read_bytes()
    assert hashlib.sha256(metadata_raw).hexdigest() == metadata_source["payloadSha256"]
    assert hashlib.sha256(metadata_jws).hexdigest() == metadata_source["sha256"]
    metadata = json.loads(metadata_raw)
    localities = next(a["mu"] for a in metadata["abr"] if a["cd"] == "zz")
    codes = [city["cd"] for city in localities]
    assert len(codes) == len(set(codes)) == 186
    records = []
    missing = []
    for city in sorted(localities, key=lambda c: c["cd"]):
        name = CITY_ALIASES.get(city["cd"], city["nm"])
        evidence = by_city.get(normalize(name))
        if not evidence:
            missing.append(city)
            continue
        records.append({
            "code": city["cd"],
            "name": city["nm"],
            "countryId": normalize(evidence["countryName"]).lower(),
            **evidence,
            "match": "documented-name-alias" if city["cd"] in CITY_ALIASES else "normalized-name",
        })
    assert not missing, f"Unmapped localities: {missing}"
    assert len(records) == len(codes)
    country_names = {record["countryId"]: record["countryName"] for record in records}
    countries = [
        {
            "id": key,
            "name": country_names[key],
            "localityCodes": [r["code"] for r in records if r["countryId"] == key],
        }
        for key in sorted(country_names)
    ]
    result = {
        "schemaVersion": 1,
        "election": "6258",
        "cycle": "ele2026",
        "metadataSource": "https://resultados.tse.jus.br/oficial/ele2026/6258/config/mun-e006258-cm.jws",
        "metadataPayloadSha256": metadata_source["payloadSha256"],
        "metadataJwsSha256": metadata_source["sha256"],
        "sourcePage": "https://www.tre-df.jus.br/eleicoes/mesas-receptoras-de-votos-no-exterior-2026",
        "sourceMetadata": "tests/fixtures/tre-df-sources.json",
        "coverage": {"expected": 186, "mapped": len(records), "unique": len(set(codes))},
        "classificationNote": (
            "Country names are the explicit TRE-DF País labels, not inferred ISO/sovereignty codes. "
            "In particular Caiena is labelled Guiana Francesa and Saint Georges de Loyapock is "
            "labelled França by the published workbooks. These official classifications are retained "
            "verbatim; the mapping is voting-locality geography, never voter residence or citizenship."
        ),
        "countries": countries,
        "localities": records,
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    target = OUTPUT / "countries.json"
    if "--check" in sys.argv:
        assert target.read_text("utf-8") == serialized, "Country mapping is not reproducible."
    else:
        target.write_text(serialized, encoding="utf-8")
    print(f"Verified {len(records)}/186 unique locality codes; {len(countries)} official country labels.")


if __name__ == "__main__":
    build()
