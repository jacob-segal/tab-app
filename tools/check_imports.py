"""Static check: relative imports resolve to real files and exported names exist."""
import re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMPORT_RE = re.compile(r"import\s*\{([^}]*)\}\s*from\s*['\"](\.[^'\"]+)['\"]", re.S)
DYN_RE = re.compile(r"import\(\s*['\"](\.[^'\"]+)['\"]\s*\)")
EXPORT_RES = [
    re.compile(r"export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)"),
    re.compile(r"export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)"),
]
EXPORT_LIST_RE = re.compile(r"export\s*\{([^}]*)\}(?:\s*from\s*['\"][^'\"]+['\"])?", re.S)

def exports_of(path, seen=None):
    src = open(path, encoding='utf-8').read()
    names = set()
    for rx in EXPORT_RES:
        names.update(rx.findall(src))
    for block in EXPORT_LIST_RE.findall(src):
        for part in block.split(','):
            part = part.strip()
            if not part: continue
            names.add(part.split(' as ')[-1].strip())
    # export const { a, b } = ... (destructuring) — rare; skip
    return names

def main(files):
    bad = 0
    for f in files:
        if not f.endswith('.js'): continue
        path = os.path.join(ROOT, f)
        src = open(path, encoding='utf-8').read()
        src = re.sub(r"^\s*//.*$", "", src, flags=re.M)          # line comments
        src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)           # block comments
        base = os.path.dirname(path)
        for names, rel in IMPORT_RE.findall(src):
            target = os.path.normpath(os.path.join(base, rel))
            if not os.path.exists(target):
                print(f"✗ {f}: import '{rel}' → missing file"); bad = 1; continue
            exp = exports_of(target)
            for n in names.split(','):
                n = n.strip()
                if not n: continue
                n = n.split(' as ')[0].strip()
                if n not in exp:
                    print(f"✗ {f}: '{n}' is not exported by {rel}"); bad = 1
        for rel in DYN_RE.findall(src):
            target = os.path.normpath(os.path.join(base, rel))
            if not os.path.exists(target):
                print(f"✗ {f}: dynamic import '{rel}' → missing file"); bad = 1
    return bad

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
