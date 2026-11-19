#!/usr/bin/env bash
# intake's standing check (M8, 22:07Z), for every harness commit: at the given commit's tree, every committed M5 and
# M7f trace is scored again through that commit's code (src/rescore.ts) and must equal its committed metrics line byte
# for byte, and that commit's results/surfaces/analyze.py must reproduce M7f's confirmatory analysis.json byte for byte.
# Run from apps/choice-bench in a clean export of the commit, with its workspace installed and built:
#   scripts/standing-check.sh <work dir, outside the repo>
# The archives are read from the export's own results/, extracted under the work dir, and left there for the caller
# to delete. Exit 0 only if every trace is identical and the analysis reproduces
set -euo pipefail
work=$1
here=$(pwd)
mkdir -p "$work"
status=0
dirs=()
for tarball in $(find results -name traces.tar.gz | sort); do
  d="$work/$(echo "${tarball#results/}" | tr / _ | sed 's/\.tar\.gz$//')"
  rm -rf "$d"
  mkdir -p "$d"
  tar xzf "$tarball" -C "$d"
  dirs+=("$d")
done
node src/rescore.ts "${dirs[@]}" || status=1
(
  cd results/surfaces
  python3 -I -B analyze.py confirmatory "$work/surfaces_confirmatory-2026-11-18_traces" \
    pilot-2026-11-18/analysis.json >"$work/m7f-confirmatory-analysis.json"
)
if cmp -s "$work/m7f-confirmatory-analysis.json" results/surfaces/confirmatory-2026-11-18/analysis.json; then
  echo '{"analysis":"M7f confirmatory analysis.json reproduced byte for byte"}'
else
  echo '{"analysis":"M7f confirmatory analysis.json DIFFERS"}'
  status=1
fi
cd "$here"
exit $status
