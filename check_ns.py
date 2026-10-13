#!/usr/bin/env python3
# Static safety net: every `NS.member` access must exist as an export of the
# module bound to NS; every named import must exist; every import path must exist.
import os, re, sys

ROOT = os.path.join(os.environ.get("ARENA_WORKSPACE", "/home/user"), "Clever Villagers", "CleverVillagers_BP", "scripts")

IMPORT_STAR = re.compile(r'import\s+\*\s+as\s+(\w+)\s+from\s+"([^"]+)"')
IMPORT_NAMED = re.compile(r'import\s+\{([^}]+)\}\s+from\s+"([^"]+)"')
EXPORTS = [
    re.compile(r'export\s+function\s+(\w+)'),
    re.compile(r'export\s+const\s+(\w+)'),
    re.compile(r'export\s+let\s+(\w+)'),
    re.compile(r'export\s+class\s+(\w+)'),
]

def exports_of(path):
    try:
        src = open(path, encoding="utf-8").read()
    except OSError:
        return None
    out = set()
    for rx in EXPORTS:
        for m in rx.finditer(src):
            out.add(m.group(1))
    return out

def resolve(base, spec):
    if not spec.startswith("."):
        return None  # builtin / @minecraft/*
    p = os.path.normpath(os.path.join(os.path.dirname(base), spec))
    return p if os.path.isfile(p) else None

problems = []
files = []
for dirpath, _, names in os.walk(ROOT):
    for n in names:
        if n.endswith(".js"):
            files.append(os.path.join(dirpath, n))

cache = {}
for f in files:
    src = open(f, encoding="utf-8").read()
    binds = {}
    for m in IMPORT_STAR.finditer(src):
        ns, spec = m.group(1), m.group(2)
        tgt = resolve(f, spec)
        if tgt is None:
            if spec.startswith("."):
                problems.append(f"{os.path.relpath(f, ROOT)}: missing import path {spec}")
            continue
        binds[ns] = tgt
    for m in IMPORT_NAMED.finditer(src):
        names = [x.strip().split(" as ")[-1].strip() for x in m.group(1).split(",") if x.strip()]
        tgt = resolve(f, m.group(2))
        if tgt is None:
            if m.group(2).startswith("."):
                problems.append(f"{os.path.relpath(f, ROOT)}: missing import path {m.group(2)}")
            continue
        ex = cache.setdefault(tgt, exports_of(tgt))
        for nm in names:
            if ex is not None and nm not in ex:
                problems.append(f"{os.path.relpath(f, ROOT)}: named import '{nm}' not exported by {os.path.relpath(tgt, ROOT)}")
    # namespace member accesses
    for ns, tgt in binds.items():
        ex = cache.setdefault(tgt, exports_of(tgt))
        if ex is None:
            continue
        for m in re.finditer(r'\b' + re.escape(ns) + r'\.([A-Za-z_$][\w$]*)', src):
            member = m.group(1)
            if member not in ex:
                problems.append(f"{os.path.relpath(f, ROOT)}: {ns}.{member} NOT EXPORTED by {os.path.relpath(tgt, ROOT)}")

if problems:
    print("PROBLEMS:")
    for p in sorted(set(problems)):
        print("  -", p)
    sys.exit(1)
print(f"OK: {len(files)} files, all namespace members + named imports resolve.")
