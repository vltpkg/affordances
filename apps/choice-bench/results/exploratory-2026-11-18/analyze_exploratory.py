#!/usr/bin/env python3 -I
# M5's exploratory analysis (PLAN.md beside this file), committed before any exploratory outcome was read. EXPLORATORY:
# estimates with 95% intervals, and no p-values. It reuses, unchanged and by import:
# - the confirmatory analyze.py (d699a0d4): Newcombe's hybrid score interval;
# - the audit's code.py (aa8071b0): the trial reader, the text-stated optimum (optimal, or category (b)) and the
#   information path.
#   python3 -I analyze_exploratory.py <exploratory trace dir> <confirmatory trace dir>   -> JSON on stdout
#   python3 -I analyze_exploratory.py --selftest
import glob
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONF = os.path.join(HERE, '..', 'confirmatory-2026-11-18')


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


analyze = _load('analyze', os.path.join(CONF, 'analyze.py'))
audit = _load('audit_code', os.path.join(CONF, 'audit', 'code.py'))

SONNET, HAIKU, OPUS = 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'

# the contrasts PLAN.md names: (label, treated cell, control cell, models). A cell is (run, condition); 'conf' is the
# confirmatory run, a different stretch of time on the same runtime and fixture, so those contrasts cross runs
CONTRASTS = [
    ('E1: the advocacy package over A\'s scope (C-full-scope vs A)', ('expl', 'C-full-scope'), ('conf', 'A'), [SONNET, HAIKU]),
    ('E2: the advocated scope alone (A-scope vs A)', ('expl', 'A-scope'), ('conf', 'A'), [SONNET, HAIKU]),
    ('E3: the advocacy package within the advocated scope (C vs A-scope)', ('conf', 'C'), ('expl', 'A-scope'), [SONNET, HAIKU]),
    ('E4: the advocated scope within the advocacy package (C vs C-full-scope)', ('conf', 'C'), ('expl', 'C-full-scope'), [SONNET, HAIKU]),
    ('E5: the advocacy package over A\'s scope, on Opus, within this run (C-full-scope vs A)', ('expl', 'C-full-scope'), ('expl', 'A'), [OPUS]),
]


# every expected spec, per run and cell, as the runners name them: intent to treat. A spec with no complete trace (no
# end or metrics line, or no file) is in its cell's denominator as failed, never left out, as the confirmatory
# analyze.py's load_rows does
EXPECTED = {
    'expl': [('C-full-scope', SONNET, 50), ('C-full-scope', HAIKU, 50), ('A-scope', SONNET, 50), ('A-scope', HAIKU, 50),
             ('A', OPUS, 25), ('C-full-scope', OPUS, 25)],
    'conf': [(c, m, 114) for m in (SONNET, HAIKU) for c in ('A', 'C', 'S')],
}


def spec_id(run, condition, model, index):
    raw = f"{run}-{condition}-T6-{model}-{index}"
    return ''.join(ch if ch.isalnum() or ch in '_.-' else '_' for ch in raw)


def rows_of(trace_dir, run):
    rows = []
    for condition, model, n in EXPECTED[run]:
        for i in range(n):
            f = os.path.join(trace_dir, spec_id(run, condition, model, i) + '.jsonl')
            row = {'run': run, 'condition': condition, 'model': model, 'optimal': False, 'textOptimal': False,
                   'sawAllowance': False, 'failed': True}
            if os.path.exists(f):
                lines = [json.loads(l) for l in open(f) if l.strip()]
                if any(l.get('kind') == 'end' for l in lines) and any(l.get('kind') == 'metrics' for l in lines):
                    t = audit.trial_of(lines)
                    category, _ = audit.code(t)
                    row.update(optimal=t['optimal'], textOptimal=t['optimal'] or category == 'b',
                               sawAllowance=t['proAllowanceBeforeFirstRequest'], failed=False)
            rows.append(row)
    return rows


def cell(rows, run, condition, model):
    return [r for r in rows if r['run'] == run and r['condition'] == condition and r['model'] == model]


def frac(rows, key):
    return f"{sum(r[key] for r in rows)}/{len(rows)}"


def estimate(t, c, key):
    x1, n1 = sum(r[key] for r in t), len(t)
    x0, n0 = sum(r[key] for r in c), len(c)
    if not n1 or not n0:
        return None
    d, ci = analyze.newcombe(x1, n1, x0, n0)
    return {'treated': f'{x1}/{n1}', 'control': f'{x0}/{n0}', 'riskDifference': d, 'newcombe95': ci}


def analyze_all(rows):
    out = {'label': 'EXPLORATORY: estimates with 95% intervals, no p-values', 'cells': {}, 'contrasts': {}}
    for run, condition, model in sorted({(r['run'], r['condition'], r['model']) for r in rows}):
        g = cell(rows, run, condition, model)
        out['cells'][f'{run} {condition} {model}'] = {
            'optimal': frac(g, 'optimal'), 'textOptimal': frac(g, 'textOptimal'), 'sawAllowance': frac(g, 'sawAllowance'),
            'failed': sum(r.get('failed', False) for r in g),
        }
    for label, (tr, tc), (cr, cc), models in CONTRASTS:
        out['contrasts'][label] = {
            m: {k: estimate(cell(rows, tr, tc, m), cell(rows, cr, cc, m), k) for k in ('optimal', 'textOptimal')}
            for m in models
        }
    return out


def selftest():
    # the reuse is real: the same functions, from the committed files
    d, (lo, hi) = analyze.newcombe(56, 70, 48, 80)
    assert abs(d - 0.2) < 1e-9 and abs(lo - 0.0524) < 1e-3 and abs(hi - 0.3339) < 1e-3
    assert audit.code({'optimal': False, 'choice': 'none', 'finalText': '', 'addOnApprovalRequested': False})[0] == 'd'
    rows = [
        {'run': 'expl', 'condition': 'C-full-scope', 'model': SONNET, 'optimal': i < 40, 'textOptimal': i < 45, 'sawAllowance': True}
        for i in range(50)
    ] + [
        {'run': 'conf', 'condition': 'A', 'model': SONNET, 'optimal': i < 101, 'textOptimal': True, 'sawAllowance': True}
        for i in range(114)
    ]
    out = analyze_all(rows)
    e1 = out['contrasts'][CONTRASTS[0][0]][SONNET]['optimal']
    assert e1['treated'] == '40/50' and e1['control'] == '101/114'
    assert abs(e1['riskDifference'] - (40 / 50 - 101 / 114)) < 1e-12
    # a contrast with an empty cell gives None, never a number
    assert out['contrasts'][CONTRASTS[0][0]][HAIKU]['optimal'] is None
    assert 'p' not in json.dumps(out['contrasts']).replace('"', ' ').split()
    # intent to treat: a trace dir with one complete trace and the rest missing keeps every denominator, all failed
    import tempfile
    with tempfile.TemporaryDirectory(dir=HERE) as d:
        sid = spec_id('expl', 'C-full-scope', SONNET, 0)
        with open(os.path.join(d, sid + '.jsonl'), 'w') as f:
            for line in [{'kind': 'trial', 'condition': 'C-full-scope', 'model': {'requested': SONNET}},
                         {'kind': 'call', 'tool': 'project', 'input': {}, 'response': '{}'},
                         {'kind': 'end', 'finalText': ''}, {'kind': 'metrics', 'optimal': True, 'choice': 'pro+extra-bandwidth'}]:
                f.write(json.dumps(line) + '\n')
        # a metric-less trace counts as failed too
        with open(os.path.join(d, spec_id('expl', 'C-full-scope', SONNET, 1) + '.jsonl'), 'w') as f:
            f.write(json.dumps({'kind': 'trial'}) + '\n')
        rows = rows_of(d, 'expl')
        assert len(rows) == 250
        c = analyze_all(rows)['cells']['expl C-full-scope claude-sonnet-5-5']
        assert c['optimal'] == '1/50' and c['failed'] == 49, c
        assert analyze_all(rows)['cells']['expl A claude-opus-5-5']['optimal'] == '0/25'
    assert spec_id('conf', 'A', SONNET, 0) == 'conf-A-T6-claude-sonnet-5-5-0'
    assert spec_id('expl', 'C-full-scope', OPUS, 3) == 'expl-C-full-scope-T6-claude-opus-5-5-3'
    print('selftest ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['--selftest']:
        selftest()
    else:
        expl, conf = sys.argv[1:3]
        print(json.dumps(analyze_all(rows_of(expl, 'expl') + rows_of(conf, 'conf')), indent=2))
