#!/bin/zsh
# Syntax-check every JS module and run the logic smoke tests (JavaScriptCore; no Node needed).
# Usage: tools/check.sh            (all files)
#        tools/check.sh js/pages/track.js ...
cd "${0:A:h}/.."
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
files=("$@")
[[ ${#files} -eq 0 ]] && files=(js/**/*.js sw.js(N))
fail=0
for f in $files; do
  out=$($JSC -e "try { checkModuleSyntax(read('$f')); } catch (e) { print('SYNTAX ' + e); }" 2>&1)
  if [[ -n "$out" ]]; then echo "✗ $f: $out"; fail=1; fi
done
# Every relative import must resolve to an existing file and exported name.
python3 tools/check_imports.py $files || fail=1
[[ $fail -eq 0 ]] && echo "✓ syntax + imports OK (${#files} files)"
exit $fail
