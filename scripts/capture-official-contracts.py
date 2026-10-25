"""Capture public TSE JWS samples and provenance without changing payload bytes."""

import base64
import datetime
import hashlib
import json
import pathlib
import urllib.request


BASE = "https://resultados.tse.jus.br/oficial/"
FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures"
SOURCES = {
    "elections": "comum/config/ele-c.jws",
    "municipalities": "ele2026/6258/config/mun-e006258-cm.jws",
    "overall": "ele2026/6258/dados/br/br-c0001-e006258-u.jws",
    "overseas": "ele2026/6258/dados/zz/zz-c0001-e006258-u.jws",
    "state-sp": "ele2026/6258/dados/sp/sp-c0001-e006258-u.jws",
    "municipality-sp71072": "ele2026/6258/dados/sp/sp71072-c0001-e006258-u.jws",
    "locality-zz29513": "ele2026/6258/dados/zz/zz29513-c0001-e006258-u.jws",
}


def main():
    FIXTURES.mkdir(parents=True, exist_ok=True)
    entries = []
    for name, path in SOURCES.items():
        url = BASE + path
        request = urllib.request.Request(url, headers={"Origin": "http://localhost:5173"})
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            headers = dict(response.headers)
        parts = raw.decode("ascii").strip().split(".")
        payload = base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4))
        # Decoding here creates fixtures only. Runtime consumers MUST verify JWS.
        (FIXTURES / f"{name}.jws").write_bytes(raw)
        (FIXTURES / f"{name}.json").write_bytes(payload)
        entries.append({
            "name": name,
            "url": url,
            "retrievedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "payloadSha256": hashlib.sha256(payload).hexdigest(),
            "protectedHeader": json.loads(base64.urlsafe_b64decode(parts[0] + "==")),
            "headers": headers,
            "notes": "Unmodified public official payload; decoded JSON is test data, not a trust bypass.",
        })
        print(name, len(raw), entries[-1]["protectedHeader"])
    (FIXTURES / "official-sources.json").write_text(
        json.dumps({"sources": entries}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
