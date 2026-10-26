"""Generate small SVG paths from the pinned public IBGE 2024 UF shapefile.

Run: python scripts\\generate-state-map.py <path-to-BR_UF_2024.zip>
Uses only the Python standard library; downloads are explicit, never part of builds.
"""

import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import zipfile


SOURCE = (
    "https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/"
    "malhas_municipais/municipio_2024/Brasil/BR_UF_2024.zip"
)
SHA256 = "be61a1e11bf86b265098b5a0b02eb836237421ad73354b1f0892fb6be4598866"
UF_CODES = {
    "11": "ro", "12": "ac", "13": "am", "14": "rr", "15": "pa", "16": "ap", "17": "to",
    "21": "ma", "22": "pi", "23": "ce", "24": "rn", "25": "pb", "26": "pe", "27": "al",
    "28": "se", "29": "ba", "31": "mg", "32": "es", "33": "rj", "35": "sp", "41": "pr",
    "42": "sc", "43": "rs", "50": "ms", "51": "mt", "52": "go", "53": "df",
}
LABEL_OFFSETS = {
    "df": (28, -18), "rn": (15, -13), "pb": (24, 0), "pe": (14, 7),
    "al": (22, 9), "se": (17, 15), "rj": (9, 14), "es": (18, 1),
}


def simplify(points, tolerance=0.3):
    """Ramer-Douglas-Peucker in display pixels, including closed rings."""
    keep = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    while pending:
        start, end = pending.pop()
        ax, ay = points[start]
        bx, by = points[end]
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        best, distance = None, tolerance * tolerance
        for i in range(start + 1, end):
            x, y = points[i]
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / length)) if length else 0
            squared = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
            if squared > distance:
                best, distance = i, squared
        if best is not None:
            keep.add(best)
            pending.extend([(start, best), (best, end)])
    return [points[i] for i in sorted(keep)]


def area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def build(archive_path):
    raw = Path(archive_path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != SHA256:
        raise ValueError("IBGE archive hash differs from the reviewed source")
    with zipfile.ZipFile(archive_path) as archive:
        dbf = archive.read("BR_UF_2024.dbf")
        shp = archive.read("BR_UF_2024.shp")
        projection = archive.read("BR_UF_2024.prj").decode()
    if 'GCS_SIRGAS_2000' not in projection or struct.unpack_from("<i", shp, 32)[0] != 5:
        raise ValueError("Unexpected IBGE projection or shape type")
    count, header, size = struct.unpack_from("<IHH", dbf, 4)
    fields = []
    for offset in range(32, header - 1, 32):
        fields.append((dbf[offset:offset + 11].split(b"\0")[0].decode(), dbf[offset + 16]))
    records = []
    for i in range(count):
        row = dbf[header + i * size:header + (i + 1) * size]
        if row[0:1] != b" ":
            raise ValueError("Unexpected deleted IBGE attribute record")
        values, offset = {}, 1
        for name, length in fields:
            values[name] = row[offset:offset + length].decode("utf-8").strip()
            offset += length
        records.append(values)
    states, offset = [], 100
    for record in records:
        _, words = struct.unpack_from(">ii", shp, offset)
        offset += 8
        shape = shp[offset:offset + words * 2]
        offset += words * 2
        if struct.unpack_from("<i", shape)[0] != 5:
            raise ValueError("Non-polygon state geometry")
        parts, points = struct.unpack_from("<ii", shape, 36)
        starts = list(struct.unpack_from(f"<{parts}i", shape, 44)) + [points]
        coordinates = [
            (12 + (lon + 74) * 13 * math.cos(math.radians(15)), 12 + (6 - lat) * 13)
            for lon, lat in struct.iter_unpack("<dd", shape[44 + parts * 4:])
        ]
        rings = [coordinates[a:b] for a, b in zip(starts, starts[1:])]
        largest = max(rings, key=lambda ring: abs(area(ring)))
        polygon_area = area(largest)
        center = [
            sum((a[axis] + b[axis]) * (a[0] * b[1] - b[0] * a[1])
                for a, b in zip(largest, largest[1:])) / (6 * polygon_area)
            for axis in (0, 1)
        ]
        paths = []
        for ring in rings:
            if abs(area(ring)) < 0.3:
                continue
            simple = simplify(ring)
            if len(simple) < 4:
                continue
            paths.append("M" + "L".join(f"{x:.2f},{y:.2f}" for x, y in simple[:-1]) + "Z")
        code = UF_CODES[record["CD_UF"]]
        if code != record["SIGLA_UF"].lower() or not paths:
            raise ValueError("UF identity/geometry mismatch")
        dx, dy = LABEL_OFFSETS.get(code, (0, 0))
        states.append({
            "code": code, "ibgeCode": record["CD_UF"], "name": record["NM_UF"],
            "path": "".join(paths),
            "center": [round(v, 2) for v in center],
            "label": [round(center[0] + dx, 2), round(center[1] + dy, 2)],
        })
    if len(states) != 27 or {s["code"] for s in states} != set(UF_CODES.values()) or offset != len(shp):
        raise ValueError("Incomplete or duplicate UF inventory")
    return {
        "source": SOURCE, "sha256": SHA256, "edition": 2024,
        "projection": "SIRGAS 2000; equirectangular display, standard parallel 15 S",
        "simplification": "0.3 display-pixel RDP; rings smaller than 0.3 square display pixels omitted",
        "viewBox": "0 0 540 550",
        "states": sorted(states, key=lambda state: state["code"]),
    }


if __name__ == "__main__":
    result = build(sys.argv[1])
    output = Path(__file__).resolve().parents[1] / "src" / "data" / "geography" / "brazil-states.json"
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Generated {len(result['states'])} state paths, {output.stat().st_size} bytes")
