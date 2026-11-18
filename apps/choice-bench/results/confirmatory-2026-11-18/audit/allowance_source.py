#!/usr/bin/env python3 -I
# M5 audit (2), POST HOC: for trials that saw Pro's allowance before their first approval request, the call that first
# carried it (code.py's rule), counted per arm and model.
#   python3 -I allowance_source.py <trace dir>     -> JSON on stdout
import collections
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from code import pro_allowance_in  # noqa: E402

counts = collections.defaultdict(collections.Counter)
for f in sorted(glob.glob(os.path.join(sys.argv[1], 'conf-*.jsonl'))):
    lines = [json.loads(l) for l in open(f) if l.strip()]
    t = lines[0]
    calls = [l for l in lines if l['kind'] == 'call']
    for c in calls:
        if '"confirmation_required"' in (c.get('response') or ''):
            break
        if pro_allowance_in(c.get('response')):
            offer = (c.get('input') or {}).get('offer', '')
            counts[f"{t['condition']} {t['model']['requested']}"][f"{c['tool']} {offer.split('@')[0]}"] += 1
            break
print(json.dumps({'label': 'POST HOC, DESCRIPTIVE', 'firstCarrier': counts}, indent=2))
