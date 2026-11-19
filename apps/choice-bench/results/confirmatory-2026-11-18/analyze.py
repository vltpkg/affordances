#!/usr/bin/env python3 -I
# The confirmatory run's pre-registered analysis (PLAN.md, 06e6368f and 1e55d366), standard library only.
#   python3 -I analyze.py <trace dir>     -> JSON on stdout
#   python3 -I analyze.py --selftest      -> checks against known values
# Primary, for H1 (S vs A) and H2 (C vs A): the Cochran-Mantel-Haenszel test of the optimal rate, stratified by model,
# two-sided, WITH the continuity correction (the uncorrected statistic is reported beside it), Holm across the two at a
# family-wise 0.05, intent to treat (a capped or failed spec isn't optimal). The headline effect: the Mantel-Haenszel
# risk difference with its 95% CI, from Sato's (1989) variance. Both rules are PLAN.md's addendum, fixed before any
# outcome was read. Secondary: per model, Fisher's
# exact test and the risk difference with Newcombe's hybrid score interval; Breslow-Day (with Tarone's correction) on
# the odds ratios across models; the capped-excluded analysis; the optimal rate by load tercile.
import glob
import json
import math
import os
import sys

MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5']
CONDITIONS = ['A', 'C', 'S']
PER_CELL = 114
Z = 1.959963984540054


def chi2_1_p(x):
    return math.erfc(math.sqrt(max(x, 0) / 2))


def cmh(strata, correct):
    # strata: [(x1, n1, x0, n0)], treated first. The MH chi-square, 1 df
    num, var = 0.0, 0.0
    for x1, n1, x0, n0 in strata:
        N, m = n1 + n0, x1 + x0
        num += x1 - n1 * m / N
        var += n1 * n0 * m * (N - m) / (N * N * (N - 1))
    stat = (max(abs(num) - (0.5 if correct else 0), 0)) ** 2 / var if var else 0.0
    return stat, chi2_1_p(stat)


def mh_rd(strata):
    # the Mantel-Haenszel risk difference, with Sato's (1989) variance
    W = P = Q = num = 0.0
    for x1, n1, x0, n0 in strata:
        N = n1 + n0
        w = n1 * n0 / N
        num += (x1 * n0 - x0 * n1) / N
        W += w
        P += (n1 * n1 * x0 - n0 * n0 * x1 + n1 * n0 * (n0 - n1) / 2) / (N * N)
        Q += (x1 * (n0 - x0) + x0 * (n1 - x1)) / (2 * N)
    rd = num / W
    se = math.sqrt(max(rd * P + Q, 0)) / W
    return rd, (rd - Z * se, rd + Z * se)


def wilson(x, n):
    p = x / n
    d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d
    h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return c - h, c + h


def newcombe(x1, n1, x0, n0):
    # Newcombe's (1998) hybrid score interval, method 10
    p1, p0 = x1 / n1, x0 / n0
    l1, u1 = wilson(x1, n1)
    l0, u0 = wilson(x0, n0)
    d = p1 - p0
    return d, (d - math.sqrt((p1 - l1) ** 2 + (u0 - p0) ** 2), d + math.sqrt((u1 - p1) ** 2 + (p0 - l0) ** 2))


def fisher(x1, n1, x0, n0):
    # two-sided: the sum of every table's probability no larger than the observed one's
    m, N = x1 + x0, n1 + n0
    def pr(a):
        return math.comb(m, a) * math.comb(N - m, n1 - a) / math.comb(N, n1)
    obs = pr(x1)
    lo, hi = max(0, m - n0), min(m, n1)
    return min(1.0, sum(p for p in (pr(a) for a in range(lo, hi + 1)) if p <= obs * (1 + 1e-7)))


def breslow_day(strata):
    # homogeneity of the odds ratios, against the MH odds ratio, with Tarone's correction; K-1 df
    R = S = 0.0
    for x1, n1, x0, n0 in strata:
        N = n1 + n0
        R += x1 * (n0 - x0) / N
        S += x0 * (n1 - x1) / N
    if R == 0 or S == 0:
        return None
    psi = R / S
    stat = tdev = tvar = 0.0
    for x1, n1, x0, n0 in strata:
        m = x1 + x0
        lo, hi = max(0, m - n0), min(m, n1)
        # solve a(n0 - m + a) = psi (n1 - a)(m - a) for a in [lo, hi]
        f = lambda a: a * (n0 - m + a) - psi * (n1 - a) * (m - a)
        a, b = float(lo), float(hi)
        for _ in range(200):
            mid = (a + b) / 2
            if f(a) * f(mid) <= 0:
                b = mid
            else:
                a = mid
        e = (a + b) / 2
        cells = [e, n1 - e, m - e, n0 - m + e]
        if min(cells) <= 0:
            return None
        v = 1 / sum(1 / c for c in cells)
        stat += (x1 - e) ** 2 / v
        tdev += x1 - e
        tvar += v
    stat -= tdev * tdev / tvar
    df = len(strata) - 1
    return stat, chi2_1_p(stat) if df == 1 else None


def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    adj, running = [0.0] * len(ps), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, ps[i] * (len(ps) - rank)))
        adj[i] = running
    return adj


def contrast(rows, treated, outcome, keep=lambda r: True):
    strata = []
    for model in MODELS:
        t = [r for r in rows if r['model'] == model and r['condition'] == treated and keep(r)]
        c = [r for r in rows if r['model'] == model and r['condition'] == 'A' and keep(r)]
        strata.append((sum(outcome(r) for r in t), len(t), sum(outcome(r) for r in c), len(c)))
    return strata


def analyze(rows):
    itt = lambda r: r['optimal']
    out = {'hypotheses': {}}
    primary_p = {}
    for h, treated in (('H1', 'S'), ('H2', 'C')):
        s = contrast(rows, treated, itt)
        cstat, cp = cmh(s, correct=True)
        stat, p = cmh(s, correct=False)
        rd, ci = mh_rd(s)
        per_model = {}
        for model, (x1, n1, x0, n0) in zip(MODELS, s):
            d, nci = newcombe(x1, n1, x0, n0)
            per_model[model] = {
                treated: f'{x1}/{n1}', 'A': f'{x0}/{n0}', 'riskDifference': d,
                'newcombe95': nci, 'fisherP': fisher(x1, n1, x0, n0),
            }
        bd = breslow_day(s)
        # capped-excluded: uncapped, run specs, and their optimalChoice
        sx = contrast(rows, treated, lambda r: r['optimalChoice'], keep=lambda r: r['end'] == 'final')
        out['hypotheses'][h] = {
            'contrast': f'{treated} vs A',
            'strata': {m: {'treated': f'{a}/{b}', 'A': f'{c}/{d}'} for m, (a, b, c, d) in zip(MODELS, s)},
            'cmh': {'chi2': cstat, 'p': cp, 'continuityCorrected': True},
            'cmhUncorrected': {'chi2': stat, 'p': p},
            'mhRiskDifference': rd, 'mhRiskDifference95': ci,
            'perModel': per_model,
            'breslowDay': None if bd is None else {'chi2': bd[0], 'p': bd[1]},
            'cappedExcluded': {
                'strata': {m: {'treated': f'{a}/{b}', 'A': f'{c}/{d}'} for m, (a, b, c, d) in zip(MODELS, sx)},
                'cmh': dict(zip(('chi2', 'p'), cmh(sx, correct=True))),
                'cmhUncorrected': dict(zip(('chi2', 'p'), cmh(sx, correct=False))),
                'mhRiskDifference': mh_rd(sx)[0], 'mhRiskDifference95': mh_rd(sx)[1],
            },
        }
        primary_p[h] = cp
    adj = holm([primary_p['H1'], primary_p['H2']])
    for h, a in zip(('H1', 'H2'), adj):
        out['hypotheses'][h]['holmP'] = a
        out['hypotheses'][h]['rejectedAtFamilywise05'] = a < 0.05
    # by load tercile, over the run trials' start loads: descriptive, secondary
    loads = sorted(r['load'] for r in rows if r['load'] is not None)
    if loads:
        cut = [loads[len(loads) // 3], loads[2 * len(loads) // 3]]
        tercile = lambda l: 0 if l < cut[0] else 1 if l < cut[1] else 2
        out['byLoadTercile'] = {'cuts': cut, 'rates': {}}
        for t, name in enumerate(('low', 'middle', 'high')):
            out['byLoadTercile']['rates'][name] = {
                c: (lambda g: f'{sum(r["optimal"] for r in g)}/{len(g)}')(
                    [r for r in rows if r['condition'] == c and r['load'] is not None and tercile(r['load']) == t])
                for c in CONDITIONS
            }
    out['counts'] = {
        'specs': len(rows),
        'failed': sum(r['end'] == 'failed' for r in rows),
        'capped': sum(r['end'] == 'capped' for r in rows),
        'aborted': sum(r['end'] == 'aborted' for r in rows),
    }
    return out


def load_rows(trace_dir):
    rows = []
    for model in MODELS:
        for c in CONDITIONS:
            for i in range(PER_CELL):
                # the runner's spec id, with its replace(/[^\w.-]/g, '_')
                sid = ''.join(ch if ch.isalnum() or ch in '_.-' else '_' for ch in f'conf-{c}-T6-{model}-{i}')
                f = os.path.join(trace_dir, sid + '.jsonl')
                row = {'model': model, 'condition': c, 'index': i, 'optimal': False, 'optimalChoice': False,
                       'end': 'failed', 'load': None}
                if os.path.exists(f):
                    lines = [json.loads(l) for l in open(f) if l.strip()]
                    end = next((l for l in lines if l.get('kind') == 'end'), None)
                    met = next((l for l in lines if l.get('kind') == 'metrics'), None)
                    if end and met:
                        row.update(optimal=bool(met['optimal']), optimalChoice=bool(met['optimalChoice']),
                                   end=end['end'], load=end['load']['start'][0])
                rows.append(row)
    return rows


def selftest():
    close = lambda a, b, t=1e-3: abs(a - b) < t
    # Fisher, the tea-tasting table: two-sided 0.4857
    assert close(fisher(3, 4, 1, 4), 0.4857), fisher(3, 4, 1, 4)
    # Newcombe (1998), example (a): 56/70 vs 48/80 -> 0.2000 (0.0524, 0.3339)
    d, (lo, hi) = newcombe(56, 70, 48, 80)
    assert close(d, 0.2) and close(lo, 0.0524) and close(hi, 0.3339), (d, lo, hi)
    # one stratum: MH chi-square = Pearson x (N-1)/N; 30/50 vs 20/50: Pearson 4.0
    stat, _ = cmh([(30, 50, 20, 50)], correct=False)
    assert close(stat, 4.0 * 99 / 100), stat
    # and corrected: (|30 - 25| - 0.5)^2 / (50 * 50 * 50 * 50 / (100 * 100 * 99)) = 20.25 / 6.3131 = 3.2076
    stat, _ = cmh([(30, 50, 20, 50)], correct=True)
    assert close(stat, 20.25 / (50 * 50 * 50 * 50 / (100 * 100 * 99))), stat
    # one balanced stratum: Sato's variance is Wald's
    rd, (lo, hi) = mh_rd([(30, 50, 20, 50)])
    se = math.sqrt(0.6 * 0.4 / 50 + 0.4 * 0.6 / 50)
    assert close(rd, 0.2) and close(lo, 0.2 - Z * se, 1e-9), (rd, lo)
    # chi-square tail: 3.841 at 0.05
    assert close(chi2_1_p(3.841459), 0.05, 1e-6)
    # Breslow-Day: identical strata are perfectly homogeneous
    bd = breslow_day([(30, 50, 20, 50), (30, 50, 20, 50)])
    assert close(bd[0], 0.0, 1e-6), bd
    # Holm: (0.01, 0.04) -> (0.02, 0.04); (0.03, 0.04) -> (0.06, 0.06)
    assert holm([0.01, 0.04]) == [0.02, 0.04] and holm([0.04, 0.03]) == [0.06, 0.06]
    # a synthetic run end to end: shapes only
    import random
    rnd = random.Random(7)
    rows = [{'model': m, 'condition': c, 'index': i, 'optimal': rnd.random() < {'A': .5, 'C': .55, 'S': .7}[c],
             'optimalChoice': True, 'end': 'final', 'load': rnd.uniform(20, 60)}
            for m in MODELS for c in CONDITIONS for i in range(PER_CELL)]
    out = analyze(rows)
    assert set(out['hypotheses']) == {'H1', 'H2'} and out['counts']['specs'] == 684
    # Holm runs on the corrected primary
    h = out['hypotheses']
    assert holm([h['H1']['cmh']['p'], h['H2']['cmh']['p']]) == [h['H1']['holmP'], h['H2']['holmP']]
    assert all(v['cmh']['p'] >= v['cmhUncorrected']['p'] for v in h.values())
    print('selftest ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['--selftest']:
        selftest()
    else:
        print(json.dumps(analyze(load_rows(sys.argv[1])), indent=2))
