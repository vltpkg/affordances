#!/bin/bash
# a build writes only build output: git status is the same after `vlt run build` as before it (the planner and review,
# 2026-11-18, after a declaration build wrote packages/ir/src/schema.d.ts). Compared before against after, so it holds
# in a working tree with other changes in it too. Run from the repo root
set -u
before=$(mktemp -p "${TMPDIR:-$HOME/.cache}")
after=$(mktemp -p "${TMPDIR:-$HOME/.cache}")
trap 'rm -f "$before" "$after"' EXIT
git status --porcelain --untracked-files=all > "$before"
vlt run build > /dev/null 2>&1 || { echo "the build failed"; exit 2; }
git status --porcelain --untracked-files=all > "$after"
if ! diff -u "$before" "$after"; then
  echo "the build changed git status: it wrote outside its build output"
  exit 1
fi
echo "git status unchanged by the build"
