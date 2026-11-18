#!/bin/bash
# the exploratory 250, invocation $1 (1 or 2; PLAN.md's operating rules allow at most two). It checks the pinned
# c81eeeb1 export, the committed runner and the committed patch byte for byte, waits for the rig's root-check lock to be
# free and the 1-minute load to be under 32 (as the confirmatory run's gate), then runs the runner detached. Its START
# and END lines (this script's stdout, the wrapper log) record the start and end load, and launch-<n>.json records the
# gate; the runner records load per trial. Run as: setsid nohup bash launch.sh <n> > wrapper-<n>.log
set -u
N=${1:?invocation number}
E=/home/jason/.cache/affordances-exports/build-backend-engineer/bench-c81eeeb1a61e
DIR=/home/jason/Developer/affordances/apps/choice-bench/results/exploratory-2026-11-18
RUNNER=$E.run-exploratory.ts
PATCH=$E.conditions.patch
WANT_SHA=$(grep -oE '^- \*\*The runner:\*\* .*sha256 `[0-9a-f]{64}`' "$DIR/PLAN.md" | grep -oE '[0-9a-f]{64}')
OUT=/home/jason/.cache/affordances-exports/build-backend-engineer/trials/exploratory-2026-11-18
LOG=/tmp/claude-1002/-home-jason-Developer-affordances/15e5f732-fb3e-40ed-b7a9-0882d464d5e4/scratchpad
[ "$(cat $E/.export-sha)" = c81eeeb1a61e0330be34ce170169c8d9a77292cc ] || { echo "REFUSED: export sha"; exit 2; }
cmp -s "$RUNNER" "$DIR/run-exploratory.ts" || { echo "REFUSED: the runner copy differs from the committed file"; exit 2; }
cmp -s "$PATCH" "$DIR/conditions.patch" || { echo "REFUSED: the patch copy differs from the committed file"; exit 2; }
[ -n "$WANT_SHA" ] && [ "$(sha256sum "$RUNNER" | cut -c1-64)" = "$WANT_SHA" ] || { echo "REFUSED: runner sha256 isn't PLAN.md's"; exit 2; }
waited=0
while true; do
  if flock -n /home/jason/.cache/affordances-exports/.root-check.lock true; then
    awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN{exit !(l<32)}' && break
  fi
  sleep 15; waited=$((waited+15))
done
echo "START invocation $N $(date -u +%FT%TZ) after ${waited}s, load $(cut -d' ' -f1-3 /proc/loadavg)"
mkdir -p "$OUT"
printf '{"invocation":%s,"gate":{"metric":"1-minute load average","under":32},"startLoad":[%s],"waitedSeconds":%s,"startedAt":"%s","runner":"%s","patch":"%s","export":"%s","launchScript":"%s"}\n' \
  "$N" "$(cut -d' ' -f1-3 /proc/loadavg | tr ' ' ',')" "$waited" "$(date -u +%FT%TZ)" "$WANT_SHA" "$(sha256sum "$PATCH" | cut -c1-64)" "$(cat $E/.export-sha)" "$(sha256sum "$0" | cut -c1-64)" > "$OUT/launch-$N.json"
unset HOSTING_LAB_INSPECTOR
cd /home/jason/.cache/affordances-exports/build-backend-engineer && node "$RUNNER" "$E" "$PATCH" "$OUT" "$WANT_SHA" 2> "$LOG/exploratory-progress-$N.log"
rc=$?
[ -f "$OUT/preflight.json" ] && cp "$OUT/preflight.json" "$OUT/preflight-$N.json"
[ -f "$OUT/report.json" ] && cp "$OUT/report.json" "$OUT/report-$N.json"
echo "END invocation $N $(date -u +%FT%TZ) exit $rc load $(cut -d' ' -f1-3 /proc/loadavg)"
