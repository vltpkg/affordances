#!/usr/bin/env python3 -I
# M7f's analysis (PLAN.md §5), fixed before any trial, standard library only.
#   python3 -I analyze.py pilot <trace dir>                     -> the pilot's JSON on stdout
#   python3 -I analyze.py confirmatory <trace dir> <pilot.json> -> the confirmatory run's JSON on stdout
#   python3 -I analyze.py readme <analysis.json>                -> the head of the results README, on stdout
#   python3 -I analyze.py --selftest                            -> checks against known values
# Estimation only, with no p-values (intake, 09:20Z). For each of the three contrasts: the Mantel-Haenszel risk
# difference across the two models with its 95% interval (Sato's variance), per-model risk differences with Newcombe's
# intervals, and the models' heterogeneity as the difference of their risk differences, with a bootstrap percentile
# interval. The cost side: medians of tokens (cache reads excluded), tool calls and wall time, with bootstrap
# intervals, and the consequential-error rate with Wilson's. The estimators are M5's own, loaded from its script, not
# copied (confirmatory-2026-11-18/analyze.py, whose selftest checks them against published values).
# The input is the harness's trace directory: each scored trial is a top-level <id>.jsonl, whose 'trial' line names
# its surface and model and whose 'metrics' line holds its outcomes; a harness fault is set aside under interrupted/,
# with its <id>.fault.json, and is counted per cell, never scored (§5).
import glob
import importlib.util
import json
import os
import random
from fractions import Fraction
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    'm5_analysis', os.path.join(HERE, '..', 'confirmatory-2026-11-18', 'analyze.py'))
m5 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m5)

MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5']
CONFIRMATORY = ['full', 'progressive', 'v0', 'browser']
PILOT = CONFIRMATORY + ['mcp', 'webmcp']
PER_CELL = {'pilot': 5, 'confirmatory': 50}
# (treated, control): the risk difference is treated minus control (§5)
CONTRASTS = [('full', 'v0'), ('full', 'browser'), ('progressive', 'full')]
RESAMPLES = 10_000
SEED = 20261118
# the two pilot rules' thresholds, compared exactly: as floats, 7/10 - 3/10 is 0.3999…, which would miss 0.40
FALLBACK_THRESHOLD = Fraction(2, 5)  # the unconfirmed-request rate's difference, browser against full (§5)
BROWSING_THRESHOLD = Fraction(1, 5)  # the share of the browser's pilot trials with a browsing load (§5)
# intake's sentence (14:24Z), which every results README carries, verbatim
APPROVAL_SENTENCE = ("In the benchmark, token-passing stands in for the person's approval, as v0's confirm resend and "
                     "the browser's click do; the product toolset never gives a model a token (RFC 0004 §4, §5).")


def load(trace_dir):
    rows, faults = [], []
    for f in sorted(glob.glob(os.path.join(trace_dir, '*.jsonl'))):
        lines = [json.loads(l) for l in open(f) if l.strip()]
        trial = next((l for l in lines if l.get('kind') == 'trial'), None)
        met = next((l for l in lines if l.get('kind') == 'metrics'), None)
        end = next((l for l in lines if l.get('kind') == 'end'), None)
        if not trial or not trial.get('surface'):
            continue
        model = trial['model']['requested'] if isinstance(trial.get('model'), dict) else trial.get('model')
        rows.append({
            'id': trial.get('id'), 'surface': trial['surface'], 'model': model,
            'end': end['end'] if end else 'failed',
            # a trial that capped or failed isn't optimal (intent to treat, as in M5): metrics.optimal says so already
            'optimal': bool(met and met.get('optimal')),
            'completedOptimal': bool(met and met.get('endOptimal')),
            # a request event without a completed purchase (§5's fallback check)
            'unconfirmed': bool(met and not met.get('choseNone') and not met.get('completed')),
            'tokens': met.get('tokens') if met else None,
            'calls': met.get('calls') if met else None,
            'durationMs': met.get('durationMs') if met else None,
            'consequentialError': bool(met and met.get('consequentialError')),
            # §5's information path: Pro's allowance seen before the first request event, as the parity oracle's
            # matcher finds it (backend, 14:57Z). None where the trace doesn't record it, never read as False
            'proAllowanceSeen': met.get('proAllowanceSeen') if met else None,
            # the browser's, from the harness when it records them (§5's browsing rule); None where it doesn't
            'browsingLoad': met.get('browsingLoad') if met else None,
            'optimalConfirmLoad': met.get('optimalConfirmLoad') if met else None,
        })
    for f in sorted(glob.glob(os.path.join(trace_dir, 'interrupted', '*', '*.fault.json'))):
        fault = json.load(open(f))
        spec = fault.get('spec', {})
        faults.append({'kind': fault.get('kind'), 'surface': spec.get('surface'), 'model': spec.get('model')})
    return rows, faults


def cell(rows, surface, model=None):
    return [r for r in rows if r['surface'] == surface and (model is None or r['model'] == model)]


def rate(rows, key):
    x, n = sum(bool(r[key]) for r in rows), len(rows)
    return {'x': x, 'n': n, 'rate': x / n if n else None, 'wilson95': m5.wilson(x, n) if n else None}


def percentile(sorted_values, q):
    # the nearest-rank percentile of a sorted list
    k = max(0, min(len(sorted_values) - 1, int(round(q * (len(sorted_values) - 1)))))
    return sorted_values[k]


def median_ci(values, rnd):
    values = [v for v in values if v is not None]
    if not values:
        return None
    meds = sorted(statistics.median(rnd.choices(values, k=len(values))) for _ in range(RESAMPLES))
    return {'median': statistics.median(values), 'bootstrap95': (percentile(meds, 0.025), percentile(meds, 0.975)),
            'n': len(values)}


def strata(rows, treated, control, key):
    return [(sum(bool(r[key]) for r in cell(rows, treated, m)), len(cell(rows, treated, m)),
             sum(bool(r[key]) for r in cell(rows, control, m)), len(cell(rows, control, m))) for m in MODELS]


def heterogeneity(rows, treated, control, key, rnd):
    # the difference of the two models' risk differences, with a bootstrap percentile interval: each of the four cells
    # resampled with replacement, within itself
    groups = {(s, m): [bool(r[key]) for r in cell(rows, s, m)] for s in (treated, control) for m in MODELS}
    if any(not g for g in groups.values()):
        return None

    def per_model(g):
        return [sum(g[(treated, m)]) / len(g[(treated, m)]) - sum(g[(control, m)]) / len(g[(control, m)])
                for m in MODELS]

    observed = per_model(groups)
    draws = []
    for _ in range(RESAMPLES):
        g = {k: rnd.choices(v, k=len(v)) for k, v in groups.items()}
        a, b = per_model(g)
        draws.append(a - b)
    draws.sort()
    return {'difference': observed[0] - observed[1], 'of': f'{MODELS[0]} minus {MODELS[1]}',
            'bootstrap95': (percentile(draws, 0.025), percentile(draws, 0.975))}


def contrast(rows, treated, control, key, rnd):
    s = strata(rows, treated, control, key)
    if any(n1 == 0 or n0 == 0 for _, n1, _, n0 in s):
        return {'treated': treated, 'control': control, 'outcome': key, 'estimable': False}
    rd, ci = m5.mh_rd(s)
    per_model = {}
    for model, (x1, n1, x0, n0) in zip(MODELS, s):
        d, nci = m5.newcombe(x1, n1, x0, n0)
        per_model[model] = {treated: f'{x1}/{n1}', control: f'{x0}/{n0}', 'riskDifference': d, 'newcombe95': nci}
    return {'treated': treated, 'control': control, 'outcome': key, 'estimable': True,
            'mhRiskDifference': rd, 'mhRiskDifference95': ci, 'perModel': per_model,
            'heterogeneity': heterogeneity(rows, treated, control, key, rnd)}


def per_cell(rows, surfaces, rnd):
    out = {}
    for s in surfaces:
        for m in MODELS:
            c = cell(rows, s, m)
            out[f'{s} {m}'] = {
                'n': len(c),
                'intendedOptimal': rate(c, 'optimal'),
                'completedOptimal': rate(c, 'completedOptimal'),
                'consequentialError': rate(c, 'consequentialError'),
                'proAllowanceSeen': rate([r for r in c if r['proAllowanceSeen'] is not None], 'proAllowanceSeen'),
                'tokens': median_ci([r['tokens'] for r in c], rnd),
                'calls': median_ci([r['calls'] for r in c], rnd),
                'durationMs': median_ci([r['durationMs'] for r in c], rnd),
                'ends': {e: sum(r['end'] == e for r in c) for e in sorted({r['end'] for r in c})},
            }
    return out


def faults_by_cell(faults):
    out = {}
    for f in faults:
        k = f'{f["surface"]} {f["model"]}'
        out[k] = out.get(k, 0) + 1
    return out


def missing(rows, surfaces, per):
    # a spec with no scored trace, after reruns, is reported per cell, never imputed
    return {f'{s} {m}': per - len(cell(rows, s, m)) for s in surfaces for m in MODELS if len(cell(rows, s, m)) < per}


def decisions(rows):
    # the two rules the pilot fixes for the confirmatory run (§5), mechanically
    browser, full = cell(rows, 'browser'), cell(rows, 'full')
    unconfirmed = {
        'browser': rate(browser, 'unconfirmed'), 'full': rate(full, 'unconfirmed'),
    }
    exact = (Fraction(unconfirmed['browser']['x'], len(browser)) - Fraction(unconfirmed['full']['x'], len(full))
             if browser and full else None)
    flagged = [r['browsingLoad'] for r in browser]
    share = (None if not browser or any(v is None for v in flagged)
             else Fraction(sum(bool(v) for v in flagged), len(browser)))
    return {
        # a difference either way: the check looks for the review page distorting the browser arm (§5)
        'fallback': {'unconfirmedRate': unconfirmed, 'difference': None if exact is None else float(exact),
                     'threshold': float(FALLBACK_THRESHOLD),
                     # None when it can't be computed: the confirmatory run then refuses to start (below)
                     'applies': None if exact is None else abs(exact) >= FALLBACK_THRESHOLD},
        'browsing': {'share': None if share is None else float(share), 'threshold': float(BROWSING_THRESHOLD),
                     'confirmClickRule': None if share is None else share >= BROWSING_THRESHOLD},
    }


def pilot(rows, faults):
    rnd = random.Random(SEED)
    return {'kind': 'pilot', 'seed': SEED, 'resamples': RESAMPLES,
            'cells': per_cell(rows, PILOT, rnd),
            'faults': {'total': len(faults), 'byCell': faults_by_cell(faults)},
            'missing': missing(rows, PILOT, PER_CELL['pilot']),
            'decisions': decisions(rows),
            'descriptiveOnly': ['mcp', 'webmcp']}


def confirmatory(rows, faults, pilot_out):
    d = pilot_out['decisions']
    if d['fallback']['applies'] is None or d['browsing']['confirmClickRule'] is None:
        raise SystemExit('the pilot fixed neither rule (§5): no confirmatory analysis without them')
    rnd = random.Random(SEED)
    browser_key = 'optimalConfirmLoad' if d['browsing']['confirmClickRule'] else 'optimal'
    out = {'kind': 'confirmatory', 'seed': SEED, 'resamples': RESAMPLES,
           'fromPilot': {'fallback': d['fallback']['applies'], 'confirmClickRule': d['browsing']['confirmClickRule']},
           'contrasts': {}}
    for treated, control in CONTRASTS:
        # the primary: intended optimal; under the fallback, completed for full against browser only (§5)
        if d['fallback']['applies'] and (treated, control) == ('full', 'browser'):
            key = 'completedOptimal'
            data = rows
        elif 'browser' in (treated, control) and browser_key != 'optimal':
            key = 'optimal'
            data = [dict(r, optimal=r[browser_key]) if r['surface'] == 'browser' else r for r in rows]
        else:
            key, data = 'optimal', rows
        name = f'{treated} vs {control}'
        out['contrasts'][name] = {'primary': contrast(data, treated, control, key, rnd),
                                  'completed': contrast(rows, treated, control, 'completedOptimal', rnd)}
    out['cells'] = per_cell(rows, CONFIRMATORY, rnd)
    out['faults'] = {'total': len(faults), 'byCell': faults_by_cell(faults)}
    out['missing'] = missing(rows, CONFIRMATORY, PER_CELL['confirmatory'])
    return out


def pct(v):
    return 'n/a' if v is None else f'{100 * v:.1f}'


def readme(out):
    # the head of a results README: intake's sentence first, then the numbers the analysis computed
    lines = [f'# M7f, the {out["kind"]} run', '', APPROVAL_SENTENCE, '']
    if out['kind'] == 'confirmatory':
        lines += ['| contrast | primary | MH risk difference (95%) |', '| --- | --- | --- |']
        for name, c in out['contrasts'].items():
            p = c['primary']
            ci = p.get('mhRiskDifference95')
            lines.append(f'| {name} | {p["outcome"]} | ' + (
                f'{pct(p["mhRiskDifference"])} ({pct(ci[0])}, {pct(ci[1])})' if p['estimable'] else 'not estimable') + ' |')
        lines.append('')
    lines += ['| cell | n | intended optimal | completed optimal | median tokens |', '| --- | --- | --- | --- | --- |']
    for name, c in out['cells'].items():
        t = c['tokens']
        lines.append(f'| {name} | {c["n"]} | {pct(c["intendedOptimal"]["rate"])} | '
                     f'{pct(c["completedOptimal"]["rate"])} | {t["median"] if t else "n/a"} |')
    lines += ['', f'Harness faults, excluded and rerun: {out["faults"]["total"]}.']
    return '\n'.join(lines) + '\n'


def selftest():
    close = lambda a, b, t=1e-9: abs(a - b) < t
    # M5's estimators, loaded from its script, still pass their own checks
    m5.selftest()
    # the nearest-rank percentile
    assert percentile([1, 2, 3, 4, 5], 0.5) == 3 and percentile([1, 2, 3, 4, 5], 0.0) == 1

    def row(surface, model, optimal, **kw):
        base = {'id': None, 'surface': surface, 'model': model, 'end': 'final', 'optimal': optimal,
                'completedOptimal': optimal, 'unconfirmed': False, 'tokens': 1000, 'calls': 5, 'durationMs': 60000,
                'consequentialError': False, 'proAllowanceSeen': True, 'browsingLoad': False,
                'optimalConfirmLoad': optimal}
        base.update(kw)
        return base

    # the contrast's direction: treated minus control, and one balanced stratum per model gives Wald's interval
    rows = [row('full', m, i < 30) for m in MODELS for i in range(50)] + \
           [row('v0', m, i < 20) for m in MODELS for i in range(50)]
    c = contrast(rows, 'full', 'v0', 'optimal', random.Random(SEED))
    assert close(c['mhRiskDifference'], 0.2, 1e-12), c['mhRiskDifference']
    assert close(c['perModel'][MODELS[0]]['riskDifference'], 0.2, 1e-12)
    # identical models: the heterogeneity is 0, and its interval contains 0
    h = c['heterogeneity']
    assert close(h['difference'], 0.0) and h['bootstrap95'][0] <= 0 <= h['bootstrap95'][1], h
    # the bootstrap is fixed by its seed: the same interval twice
    assert median_ci([1, 5, 9, 2, 7], random.Random(SEED)) == median_ci([1, 5, 9, 2, 7], random.Random(SEED))
    # a cell without trials isn't estimable, and is never imputed
    assert contrast(rows, 'full', 'browser', 'optimal', random.Random(SEED))['estimable'] is False
    assert missing(rows, ['full', 'browser'], 50) == {f'browser {m}': 50 for m in MODELS}

    # the fallback: a 0.40 difference triggers it, 0.30 doesn't; 10 trials per arm, pooled over the models
    def pilot_rows(browser_unconfirmed, browsing=0):
        out = []
        for m in MODELS:
            for i in range(5):
                out.append(row('full', m, True))
                out.append(row('browser', m, True, unconfirmed=(i + (5 if m == MODELS[1] else 0)) < browser_unconfirmed,
                               browsingLoad=(i + (5 if m == MODELS[1] else 0)) < browsing))
        return out

    assert decisions(pilot_rows(4))['fallback']['applies'] is True
    assert decisions(pilot_rows(3))['fallback']['applies'] is False
    # exactly 0.40 as 7/10 against 3/10, which floats get wrong (0.7 - 0.3 < 0.4)
    assert 0.7 - 0.3 < 0.4
    seven_three = pilot_rows(7)
    for r in [r for r in seven_three if r['surface'] == 'full'][:3]:
        r['unconfirmed'] = True
    assert decisions(seven_three)['fallback']['applies'] is True
    # the browsing rule: 2 of 10 is 0.20, which triggers it; 1 of 10 doesn't
    assert decisions(pilot_rows(0, browsing=2))['browsing']['confirmClickRule'] is True
    assert decisions(pilot_rows(0, browsing=1))['browsing']['confirmClickRule'] is False
    # unrecorded browsing loads fix no rule, and the confirmatory run refuses to start without both rules
    unknown = [dict(r, browsingLoad=None) for r in pilot_rows(0)]
    assert decisions(unknown)['browsing']['confirmClickRule'] is None
    try:
        confirmatory([], [], {'decisions': decisions(unknown)})
        raise AssertionError('a confirmatory analysis ran without the browsing rule')
    except SystemExit:
        pass

    # under the fallback, full vs browser's primary is completed, and the others' stays intended
    rnd = random.Random(7)
    conf = [row(s, m, rnd.random() < 0.5, completedOptimal=rnd.random() < 0.4)
            for s in CONFIRMATORY for m in MODELS for _ in range(50)]
    p = {'decisions': decisions(pilot_rows(4))}
    out = confirmatory(conf, [], p)
    assert out['contrasts']['full vs browser']['primary']['outcome'] == 'completedOptimal'
    assert out['contrasts']['full vs v0']['primary']['outcome'] == 'optimal'
    assert out['contrasts']['progressive vs full']['primary']['outcome'] == 'optimal'
    assert out['missing'] == {} and len(out['cells']) == 8
    # under the confirm-click rule, the browser's intended outcome is optimalConfirmLoad
    conf2 = [dict(r, optimalConfirmLoad=(r['surface'] == 'browser')) for r in conf]
    out2 = confirmatory(conf2, [], {'decisions': decisions(pilot_rows(0, browsing=2))})
    pm = out2['contrasts']['full vs browser']['primary']['perModel'][MODELS[0]]
    assert pm['browser'] == '50/50', pm

    # faults are counted per cell, never scored
    faults = [{'kind': 'cross-check', 'surface': 'browser', 'model': MODELS[0]}] * 2
    out3 = pilot(pilot_rows(0), faults)
    assert out3['faults'] == {'total': 2, 'byCell': {f'browser {MODELS[0]}': 2}}

    # every README carries intake's sentence, verbatim, on its own line
    for o in (out, out3):
        assert APPROVAL_SENTENCE in readme(o).split('\n'), readme(o)[:200]

    # the loader: a trace directory as the harness writes it, a scored trial and a set-aside fault
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, 't1.jsonl'), 'w') as f:
            for l in ({'kind': 'trial', 'id': 't1', 'surface': 'full', 'model': {'requested': MODELS[0]}},
                      {'kind': 'end', 'end': 'final'},
                      {'kind': 'metrics', 'optimal': True, 'endOptimal': False, 'choseNone': False,
                       'completed': False, 'tokens': 1234, 'calls': 7, 'durationMs': 5000,
                       'consequentialError': False, 'proAllowanceSeen': True}):
                f.write(json.dumps(l) + '\n')
        os.makedirs(os.path.join(d, 'interrupted', 'x'))
        with open(os.path.join(d, 'interrupted', 'x', 't2.fault.json'), 'w') as f:
            json.dump({'kind': 'cross-check', 'detail': '', 'spec': {'surface': 'v0', 'model': MODELS[1]}}, f)
        rows, faults = load(d)
        assert len(rows) == 1 and rows[0]['optimal'] and not rows[0]['completedOptimal'] and rows[0]['unconfirmed']
        assert rows[0]['proAllowanceSeen'] is True
        assert rows[0]['browsingLoad'] is None and faults == [{'kind': 'cross-check', 'surface': 'v0',
                                                               'model': MODELS[1]}]
    print('selftest ok')


if __name__ == '__main__':
    a = sys.argv[1:]
    if a == ['--selftest']:
        selftest()
    elif a[:1] == ['pilot'] and len(a) == 2:
        print(json.dumps(pilot(*load(a[1])), indent=2))
    elif a[:1] == ['confirmatory'] and len(a) == 3:
        print(json.dumps(confirmatory(*load(a[1]), json.load(open(a[2]))), indent=2))
    elif a[:1] == ['readme'] and len(a) == 2:
        sys.stdout.write(readme(json.load(open(a[1]))))
    else:
        raise SystemExit(__doc__ or 'usage: analyze.py pilot|confirmatory|readme ... | --selftest')
