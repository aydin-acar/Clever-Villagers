#!/usr/bin/env python3
# ============================================================
# check_undef.py — static sweep for UNDECLARED identifier usage
# (property-access prefixes only). Born from the v2.5.3 killer:
# engine.js called J.dispatch() without importing jobs.js; the
# ReferenceError was swallowed by a try/catch and the whole
# workforce dispatcher died silently. node --check and check_ns
# both pass on that bug; this checker catches it.
# ============================================================
import re, sys, pathlib

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "Clever Villagers/CleverVillagers_BP/scripts")

GLOBALS = set("""world system console Math JSON Object Array String Number Boolean Set Map WeakMap Date RegExp
Error TypeError Promise ItemStack BlockPermutation ItemStackComponents CustomCommandStatus CommandPermissionLevel
CommandParamType Symbol Proxy Reflect parseInt parseFloat isFinite isNaN undefined NaN Infinity Uint8Array
Int8Array Uint16Array Int16Array Uint32Array Int32Array Float32Array Float64Array ArrayBuffer DataView
MolangSystem MinecraftBlockTypes MinecraftItemTypes net http """.split())

IMPORT_RE = re.compile(r'import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(\*\s+as\s+([\w$]+))?\s*from', re.S)
IMPORT_BARE_NS = re.compile(r'import\s+\*\s+as\s+([\w$]+)\s+from')
IMPORT_DEFAULT = re.compile(r'import\s+([\w$]+)\s+from')
IMPORT_NAMED = re.compile(r'import\s+(?:type\s+)?\{([^}]*)\}', re.S)
DECL_RE = re.compile(r'\b(?:const|let|var|function|class)\s+([\w$]+)')
MULTI_DECL_RE = re.compile(r'\b(const|let|var)\b')
FOR_RE = re.compile(r'\bfor\s*\(\s*(?:const|let|var)?\s*([\w$]+)')
FOR_DESTRUCT = re.compile(r'\bfor\s*\(\s*(?:const|let|var)?\s*\[?\s*([\w$]+)\s*,?\s*([\w$]+)?\]?\s+(?:of|in)\b')
CATCH_RE = re.compile(r'catch\s*\(\s*([\w$]+)')
PARAM_RE = re.compile(r'(?:function\s*[\w$]*\s*|\)\s*=>|^)(\([^)]*\))\s*(?:=>|\{)', re.M)
ARROW_PARAMS = re.compile(r'(?<![.\w$])([\w$]+)\s*=>')
PREFIX_RE = re.compile(r'(?<![.\w$"\'`])([A-Za-z_$][\w$]*)\s*\.')
LABEL_RE = re.compile(r'^\s*(outer|inner)\s*:', re.M)


def scan_multi_decls(src):
    """Names from `const a = f(1,2), b = 3;` style statements (depth-aware)."""
    out = set()
    for m in MULTI_DECL_RE.finditer(src):
        i = m.end()
        expect_name = True
        depth = 0
        while i < len(src):
            ch = src[i]
            if ch in "([{":
                if expect_name and ch in "[{":
                    # destructuring: collect identifiers inside the brackets
                    d = 1
                    j = i + 1
                    blob_start = j
                    while j < len(src) and d > 0:
                        if src[j] in "([{":
                            d += 1
                        elif src[j] in ")]}":
                            d -= 1
                        j += 1
                    for nm in re.findall(r'[\w$]+', src[blob_start:j - 1]):
                        out.add(nm)
                    i = j
                    expect_name = False
                    continue
                depth += 1
            elif ch in ")]}":
                depth -= 1
            elif depth == 0 and ch == ",":
                expect_name = True
            elif depth == 0 and ch == ";":
                break
            elif depth == 0 and ch == "\n" and not expect_name:
                # ASI-style stop: next statement likely; be lenient and stop
                break
            elif expect_name and (ch.isalnum() or ch in "_$"):
                j = i
                while j < len(src) and (src[j].isalnum() or src[j] in "_$"):
                    j += 1
                out.add(src[i:j])
                i = j
                expect_name = False
                continue
            i += 1
    return out


def declared_names(src):
    names = set(GLOBALS)
    for m in IMPORT_BARE_NS.finditer(src):
        names.add(m.group(1))
    for m in IMPORT_DEFAULT.finditer(src):
        names.add(m.group(1))
    for m in IMPORT_NAMED.finditer(src):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            part = part.split(" as ")[-1].strip()
            names.add(part)
    for m in DECL_RE.finditer(src):
        names.add(m.group(1))
    for m in FOR_RE.finditer(src):
        names.add(m.group(1))
    for m in FOR_DESTRUCT.finditer(src):
        if m.group(1):
            names.add(m.group(1))
        if m.group(2):
            names.add(m.group(2))
    for m in CATCH_RE.finditer(src):
        names.add(m.group(1))
    # function params: grab every parenthesised list followed by => or {
    for m in re.finditer(r'\(([^()]*)\)\s*(?:=>|\{)', src):
        for part in m.group(1).split(","):
            part = part.strip().lstrip(".").split("=")[0].strip()
            part = part.strip("[]{}() ")
            for nm in re.findall(r'[\w$]+', part):
                names.add(nm)
    # single-param arrows:  x => ...
    for m in ARROW_PARAMS.finditer(src):
        names.add(m.group(1))
    # destructuring: const { a, b } = / const [a, b] =
    for m in re.finditer(r'(?:const|let|var)\s*(?:\{([^}]*)\}|\[([^\]]*)\])\s*=', src):
        blob = m.group(1) or m.group(2) or ""
        for part in blob.split(","):
            part = part.strip().split(":")[-1].split("=")[0].strip()
            if re.fullmatch(r'[\w$]+', part or ""):
                names.add(part)
    for m in LABEL_RE.finditer(src):
        names.add(m.group(1))
    names |= scan_multi_decls(src)
    return names


def main():
    bad = 0
    files = sorted(ROOT.rglob("*.js"))
    for f in files:
        src = f.read_text(encoding="utf-8")
        names = declared_names(src)
        # strip strings/templates/comments to avoid false hits
        clean = re.sub(r'//[^\n]*', '', src)
        clean = re.sub(r'/\*.*?\*/', '', clean, flags=re.S)
        clean = re.sub(r'`(?:[^`\\]|\\.)*`', '``', clean, flags=re.S)
        clean = re.sub(r'"(?:[^"\\\n]|\\.)*"', '""', clean)
        clean = re.sub(r"'(?:[^'\\\n]|\\.)*'", "''", clean)
        for m in PREFIX_RE.finditer(clean):
            ident = m.group(1)
            if ident in names:
                continue
            if ident in ("prototype", "constructor"):
                continue
            line = clean[:m.start()].count("\n") + 1
            print(f"UNDECLARED: {f.relative_to(ROOT)}:{line}  '{ident}.'")
            bad += 1
    print(f"{'FAIL' if bad else 'OK'}: {len(files)} files, {bad} undeclared prefix(es).")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
