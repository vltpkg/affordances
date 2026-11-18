#!/usr/bin/env bash
# a pinned, git-free export of a reviewed commit, for a benchmark run (intake, 2026-11-18): the commit's tree, its sha
# in .export-sha, installed and built, outside the repo. A run from it can't see the repo's git, CLAUDE.md or AGENTS.md,
# and records exactly the sha that ran. Usage: scripts/export.sh <commit>
set -euo pipefail
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
sha=$(git -C "$repo" rev-parse --verify "$1^{commit}")
dest="$HOME/.cache/affordances-exports/build-backend-engineer/bench-${sha:0:12}"
if [ -e "$dest" ]; then echo "$dest exists: remove it first, or run from it" >&2; exit 1; fi
mkdir -p "$dest"
git -C "$repo" archive "$sha" | tar -x -C "$dest"
echo "$sha" > "$dest/.export-sha"
cd "$dest"
vlt install > "$dest.install.log" 2>&1
# next 16.4's upgrade nudge stops the first build in a directory; the same command again there continues
vlt run build > "$dest.build.log" 2>&1 || vlt run build > "$dest.build.log" 2>&1
echo "$dest"
