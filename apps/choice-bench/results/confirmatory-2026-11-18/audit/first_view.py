#!/usr/bin/env python3 -I
# M5 audit (3), POST HOC: A's and C's first view for one seed (index 0, Sonnet), compared offer by offer, with each
# trial's random project key replaced by proj_X.
#   python3 -I first_view.py <trace dir>     -> JSON on stdout
import json
import os
import re
import sys


def first_view(trace_dir, condition):
    f = os.path.join(trace_dir, f'conf-{condition}-T6-claude-sonnet-5-5-0.jsonl')
    lines = [json.loads(l) for l in open(f)]
    call = next(l for l in lines if l['kind'] == 'call' and l['tool'] == 'project')
    return json.loads(re.sub(r'proj_[0-9a-f]{32}', 'proj_X', call['response']))


def offers(view):
    return {o['id']: o for k in ('offers', 'choiceSets') for o in (view.get(k) or [])}


def compare(a, c):
    oa, oc = offers(a), offers(c)
    shared = [i for i in oa if i in oc]
    return {
        'label': 'POST HOC, DESCRIPTIVE',
        'orderA': list(oa),
        'orderC': list(oc),
        'onlyInA': [i for i in oa if i not in oc],
        'onlyInC': [i for i in oc if i not in oa],
        # per shared offer, the fields that differ other than claims
        'sharedOfferFieldsDiffering': sorted(
            {k for i in shared for k in set(oa[i]) | set(oc[i]) if k != 'claims' and oa[i].get(k) != oc[i].get(k)}
        ),
        'claimsA': sorted({x['id'] for i in shared for x in oa[i].get('claims') or []}),
        'claimsC': sorted({x['id'] for i in shared for x in oc[i].get('claims') or []}),
        'topLevelDiffering': {
            k: {'A': a.get(k), 'C': c.get(k)}
            for k in sorted(set(a) | set(c))
            if k not in ('offers', 'choiceSets', 'revision') and a.get(k) != c.get(k)
        },
        'omittedOffersInA': [o for i, o in oa.items() if i not in oc],
    }


if __name__ == '__main__':
    print(json.dumps(compare(first_view(sys.argv[1], 'A'), first_view(sys.argv[1], 'C')), indent=2))
