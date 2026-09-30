#!/bin/zsh
# Run logic tests in JavaScriptCore (no Node needed).
cd "${0:A:h}/.."
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/logic.mjs
