#!/usr/bin/env python3
import os, zipfile, json, sys

WS = os.environ.get("ARENA_WORKSPACE", "/home/user")
ROOT = os.path.join(WS, "Clever Villagers")
BP = os.path.join(ROOT, "CleverVillagers_BP")
RP = os.path.join(ROOT, "CleverVillagers_RP")

EXCLUDE_DIRS = {"__pycache__", "node_modules", ".git"}

def add_pack(zf, pack_dir, arc_prefix):
    n = 0
    for dirpath, dirnames, filenames in os.walk(pack_dir):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, pack_dir).replace(os.sep, "/")
            zf.write(full, arc_prefix + "/" + rel)
            n += 1
    return n

out_addon = os.path.join(WS, "Clever Villagers.mcaddon")
out_bp = os.path.join(WS, "CleverVillagers_BP.mcpack")
out_rp = os.path.join(WS, "CleverVillagers_RP.mcpack")

with zipfile.ZipFile(out_addon, "w", zipfile.ZIP_DEFLATED) as z:
    n1 = add_pack(z, BP, "CleverVillagers_BP")
    n2 = add_pack(z, RP, "CleverVillagers_RP")
    print("mcaddon entries:", n1 + n2)
with zipfile.ZipFile(out_bp, "w", zipfile.ZIP_DEFLATED) as z:
    print("bp entries:", add_pack(z, BP, "CleverVillagers_BP"))
with zipfile.ZipFile(out_rp, "w", zipfile.ZIP_DEFLATED) as z:
    print("rp entries:", add_pack(z, RP, "CleverVillagers_RP"))

for p in (out_addon, out_bp, out_rp):
    with zipfile.ZipFile(p) as z:
        bad = z.testzip()
        names = z.namelist()
        assert bad is None, p
        # mcaddon root must contain ONLY the two pack folders
        tops = sorted({n.split("/")[0] for n in names})
        print(os.path.basename(p), "OK", len(names), "files, roots:", tops)
        for mf in [n for n in names if n.endswith("manifest.json")]:
            with z.open(mf) as fh:
                m = json.load(fh)
            print("   ", mf, m["header"]["version"])
