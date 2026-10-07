#!/usr/bin/env python3
"""Empacota o complemento em dist/faixa-<versão>.xpi.

Uso:
  python3 tools/build.py
  python3 tools/build.py --update-url https://servidor/faixa/updates.json --xpi-url https://servidor/faixa/

Com --update-url, o manifest do pacote ganha browser_specific_settings.gecko.update_url
e é gerado dist/updates.json para hospedar junto do .xpi (atualização automática na frota).
"""
import argparse, hashlib, json, os, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE = ["manifest.json", "background.js", "lib", "ribbon", "experiments", "options", "icons", "_locales", "LICENSES"]

ap = argparse.ArgumentParser()
ap.add_argument("--update-url")
ap.add_argument("--xpi-url", help="pasta pública onde o .xpi ficará (para updates.json)")
args = ap.parse_args()

manifest = json.load(open(os.path.join(ROOT, "manifest.json"), encoding="utf-8"))
version = manifest["version"]
if args.update_url:
    manifest["browser_specific_settings"]["gecko"]["update_url"] = args.update_url

os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
out = os.path.join(ROOT, "dist", f"faixa-{version}.xpi")
files = []
for item in INCLUDE:
    path = os.path.join(ROOT, item)
    if os.path.isfile(path):
        files.append(item)
    else:
        for base, dirs, names in os.walk(path):
            dirs.sort()
            for n in sorted(names):
                rel = os.path.relpath(os.path.join(base, n), ROOT)
                files.append(rel.replace(os.sep, "/"))

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in files:
        info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        if rel == "manifest.json":
            data = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        else:
            data = open(os.path.join(ROOT, rel), "rb").read()
        z.writestr(info, data)

sha = hashlib.sha256(open(out, "rb").read()).hexdigest()
print(f"{out}  ({len(files)} arquivos, sha256 {sha})")

if args.update_url:
    link = (args.xpi_url or os.path.dirname(args.update_url)).rstrip("/") + f"/faixa-{version}.xpi"
    updates = {"addons": {manifest["browser_specific_settings"]["gecko"]["id"]: {"updates": [
        {"version": version, "update_link": link, "update_hash": "sha256:" + sha,
         "applications": {"gecko": {"strict_min_version": manifest["browser_specific_settings"]["gecko"]["strict_min_version"]}}}
    ]}}}
    json.dump(updates, open(os.path.join(ROOT, "dist", "updates.json"), "w"), indent=2)
    print("dist/updates.json gerado")
