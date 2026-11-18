#!/usr/bin/env python3 -I
# M8e's analysis for T8 (PLAN.md §5, §6), fixed before any trial, standard library only. It's M7f's analysis
# (../surfaces/analyze.py, loaded from its file, not copied, so M7f's records still reproduce from it unchanged), with
# only what this plan changes:
#   - the task: every scored trace must be T8's, and any other refuses the analysis;
#   - regionSeen: whether the deciding fact was seen before the first request event, per cell, descriptive only;
#   - the fallback is directional: it applies only when browser − full ≥ 2/5 on the unconfirmed-request rate;
#   - the headroom gate, in its own mode, which prints the two models' pooled rates and pass or fail, and nothing else.
#
#   python3 -I -B analyze.py headroom <trace dir>                    -> the gate, on stdout, blind to the contrasts
#   python3 -I -B analyze.py pilot <trace dir>                       -> the pilot's JSON on stdout
#   python3 -I -B analyze.py confirmatory <trace dir> <pilot.json>   -> the confirmatory run's JSON on stdout
#   python3 -I -B analyze.py readme <analysis.json>                  -> the head of the results README, on stdout
#   python3 -I -B analyze.py --selftest                              -> checks against known values
import glob
import importlib.util
import json
import os
import random
import sys
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('m7f_analysis', os.path.join(HERE, '..', 'surfaces', 'analyze.py'))
m7f = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m7f)

TASK = 'T8'
MODELS = m7f.MODELS
SURFACES = m7f.CONFIRMATORY  # full, progressive, v0, browser: T8 has no pilot-only surfaces (§5)
FALLBACK_THRESHOLD = m7f.FALLBACK_THRESHOLD  # 2/5, as M7f's, now in one direction
HEADROOM = (Fraction(1, 10), Fraction(9, 10))  # the pooled optimal rate per model, inclusive, compared exactly (§6)


def load(trace_dir):
    # M7f's rows, plus each trace's task and regionSeen, read from the same files
    rows, faults = m7f.load(trace_dir)
    extra = {}
    for f in sorted(glob.glob(os.path.join(trace_dir, '*.jsonl'))):
        lines = [json.loads(l) for l in open(f) if l.strip()]
        trial = next((l for l in lines if l.get('kind') == 'trial'), None)
        met = next((l for l in lines if l.get('kind') == 'metrics'), None)
        if trial and trial.get('surface'):
            # None where the trace doesn't record it, never read as False
            extra[trial.get('id')] = {'task': trial.get('task'), 'regionSeen': met.get('regionSeen') if met else None}
    for r in rows:
        r.update(extra.get(r['id'], {'task': None, 'regionSeen': None}))
    wrong = sorted({str(r['task']) for r in rows if r['task'] != TASK})
    if wrong:
        raise SystemExit(f'every scored trace must be {TASK}\'s; found task(s) {", ".join(wrong)}')
    return rows, faults


def headroom(rows):
    # §6's gate: each model's optimal rate (intended), pooled over all four surfaces, within [1/10, 9/10]. It reads no
    # surface, and returns nothing per surface, so running it reveals no contrast
    lo, hi = HEADROOM
    models = {}
    for m in MODELS:
        pooled = [r for r in rows if r['model'] == m and r['surface'] in SURFACES]
        x, n = sum(bool(r['optimal']) for r in pooled), len(pooled)
        models[m] = {'optimal': x, 'of': n, 'within': n > 0 and lo <= Fraction(x, n) <= hi}
    return {'kind': 'headroom', 'task': TASK, 'bounds': [str(lo), str(hi)], 'models': models,
            'passes': all(v['within'] for v in models.values())}


def decisions(rows):
    # M7f's two pilot rules, with the fallback directional: it looks for the review page distorting the browser arm,
    # so only the browser's unconfirmed-request rate exceeding full's by 2/5 or more applies it (§5). The other
    # direction never does
    out = M7F_DECISIONS(rows)
    browser, full = m7f.cell(rows, 'browser'), m7f.cell(rows, 'full')
    if browser and full:
        exact = (Fraction(sum(bool(r['unconfirmed']) for r in browser), len(browser))
                 - Fraction(sum(bool(r['unconfirmed']) for r in full), len(full)))
        out['fallback']['difference'] = float(exact)
        out['fallback']['direction'] = 'browser minus full'
        out['fallback']['applies'] = exact >= FALLBACK_THRESHOLD
    return out


def per_cell(rows, surfaces, rnd):
    # M7f's cells, with regionSeen beside proAllowanceSeen
    out = M7F_PER_CELL(rows, surfaces, rnd)
    for s in surfaces:
        for m in MODELS:
            c = [r for r in m7f.cell(rows, s, m) if r['regionSeen'] is not None]
            out[f'{s} {m}']['regionSeen'] = m7f.rate(c, 'regionSeen')
    return out


# M7f's analysis calls these by name, so T8's take their place in the loaded copy only; the file on disk is unchanged
M7F_DECISIONS, M7F_PER_CELL, M7F_PILOT = m7f.decisions, m7f.per_cell, m7f.PILOT
m7f.decisions, m7f.per_cell, m7f.PILOT = decisions, per_cell, SURFACES


def pilot(rows, faults):
    out = m7f.pilot(rows, faults)
    out['task'] = TASK
    out.pop('descriptiveOnly', None)
    return out


def confirmatory(rows, faults, pilot_out):
    if pilot_out.get('task') != TASK:
        raise SystemExit(f'the pilot record isn\'t {TASK}\'s: no confirmatory analysis without its rules')
    out = m7f.confirmatory(rows, faults, pilot_out)
    out['task'] = TASK
    return out


def readme(out):
    head = m7f.readme(out)
    return head.replace('# M7f, the ', '# M8e (T8), the ', 1)


def selftest():
    # M7f's own checks, against its own rules: its fallback is either-way, so they run with M7f's functions in place
    patched = m7f.decisions, m7f.per_cell, m7f.PILOT
    m7f.decisions, m7f.per_cell, m7f.PILOT = M7F_DECISIONS, M7F_PER_CELL, M7F_PILOT
    try:
        m7f.selftest()
    finally:
        m7f.decisions, m7f.per_cell, m7f.PILOT = patched

    def row(surface, model, optimal, **kw):
        base = {'id': None, 'surface': surface, 'model': model, 'end': 'final', 'optimal': optimal,
                'completedOptimal': optimal, 'unconfirmed': False, 'tokens': 1000, 'calls': 5, 'durationMs': 60000,
                'consequentialError': False, 'proAllowanceSeen': True, 'browsingLoad': False,
                'optimalConfirmLoad': optimal, 'task': TASK, 'regionSeen': None}
        base.update(kw)
        return base

    # the headroom gate, at its edges: 5 per surface, so 20 per model; 2 and 18 of 20 pass, 1 and 19 don't
    def gate(sonnet, haiku):
        rows = []
        for m, k in ((MODELS[0], sonnet), (MODELS[1], haiku)):
            flags = [i < k for i in range(20)]
            rows += [row(SURFACES[i % 4], m, flags[i]) for i in range(20)]
        return headroom(rows)

    assert gate(2, 18)['passes'] is True
    assert gate(10, 10)['passes'] is True
    assert gate(1, 10)['passes'] is False and gate(10, 19)['passes'] is False
    assert gate(0, 20)['passes'] is False
    # it says nothing per surface: only the two models, their counts, and the verdict
    g = gate(2, 18)
    assert set(g) == {'kind', 'task', 'bounds', 'models', 'passes'}, g
    assert all(set(v) == {'optimal', 'of', 'within'} for v in g['models'].values())

    # the directional fallback, at exactly the threshold: 10 per arm, pooled over the models
    def arms(browser_unconfirmed, full_unconfirmed):
        rows = []
        for m in MODELS:
            for i in range(5):
                rows.append(row('browser', m, False, unconfirmed=(MODELS.index(m) * 5 + i) < browser_unconfirmed))
                rows.append(row('full', m, False, unconfirmed=(MODELS.index(m) * 5 + i) < full_unconfirmed))
        return decisions(rows)['fallback']

    assert arms(4, 0)['applies'] is True  # browser − full = 4/10 = 2/5: exactly the threshold applies it
    assert arms(7, 3)['applies'] is True  # 7/10 − 3/10, exact as a fraction, which a float would miss
    assert arms(3, 0)['applies'] is False  # 3/10
    assert arms(0, 4)['applies'] is False  # full − browser = 2/5: the other direction never applies it
    assert arms(0, 5)['applies'] is False

    # regionSeen per cell: None where the trace doesn't record it, never read as False
    rows = [row(s, m, True, regionSeen=(i % 2 == 0) if s != 'v0' else None) for s in SURFACES for m in MODELS
            for i in range(4)]
    cells = per_cell(rows, SURFACES, random.Random(m7f.SEED))
    assert cells[f'full {MODELS[0]}']['regionSeen']['x'] == 2 and cells[f'full {MODELS[0]}']['regionSeen']['n'] == 4
    assert cells[f'v0 {MODELS[0]}']['regionSeen']['n'] == 0

    # another task's trace refuses the analysis
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, 'a.jsonl'), 'w') as f:
            f.write(json.dumps({'kind': 'trial', 'id': 'a', 'surface': 'full', 'task': 'T6',
                                'model': {'requested': MODELS[0]}}) + '\n')
            f.write(json.dumps({'kind': 'metrics', 'optimal': True}) + '\n')
        try:
            load(d)
            raise AssertionError('a T6 trace was accepted')
        except SystemExit as e:
            assert 'T6' in str(e), e
    print('selftest ok')


if __name__ == '__main__':
    a = sys.argv[1:]
    if a == ['--selftest']:
        selftest()
    elif a[:1] == ['headroom'] and len(a) == 2:
        print(json.dumps(headroom(load(a[1])[0]), indent=2))
    elif a[:1] == ['pilot'] and len(a) == 2:
        print(json.dumps(pilot(*load(a[1])), indent=2))
    elif a[:1] == ['confirmatory'] and len(a) == 3:
        print(json.dumps(confirmatory(*load(a[1]), json.load(open(a[2]))), indent=2))
    elif a[:1] == ['readme'] and len(a) == 2:
        sys.stdout.write(readme(json.load(open(a[1]))))
    else:
        raise SystemExit('usage: analyze.py headroom|pilot|confirmatory|readme ... | --selftest')
