#!/usr/bin/env python3 -I
# M5's post-hoc audit of the confirmatory traces (intake, 2026-11-18 07:35Z): POST HOC and DESCRIPTIVE; it changes no
# pre-registered number. This file is the coding rule, committed before it was applied to any trace. Text and calls
# only, no model judge, and the same rule in A, C and S. CODING.md states it in prose.
#   python3 -I code.py <trace dir>     -> JSON on stdout: every trial's codes, and the tables
#   python3 -I code.py --selftest      -> the rule's checks, on synthetic strings
import glob
import json
import os
import re
import sys

MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5']
CONDITIONS = ['A', 'C', 'S']

# (a) the final text says Pro's bandwidth is unknown, or that what Pro has is enough
UNKNOWN = re.compile(
    r"(bandwidth|allowance|transfer|traffic limit)[^.\n]{0,100}?"
    r"(unknown|unclear|unconfirmed|not (?:listed|shown|stated|specified|available|visible|given|published|confirmed|clear)"
    r"|isn'?t (?:listed|shown|stated|specified|available|visible|given|published|confirmed|clear)"
    r"|(?:couldn'?t|could not|can'?t|cannot|wasn'?t able to|was unable to|unable to) (?:find|see|confirm|verify|determine|tell)"
    r"|(?:doesn'?t|does not|didn'?t|did not) (?:say|list|show|state|specify|include|mention))"
    r"|(?:couldn'?t|could not|can'?t|cannot|wasn'?t able to|was unable to|unable to) (?:find|see|confirm|verify|determine|tell)"
    r"[^.\n]{0,60}?(bandwidth|allowance)"
    r"|(?:no|without) (?:bandwidth|allowance) (?:figure|number|limit|information|info|details?)",
    re.I,
)
ENOUGH = re.compile(
    r"(pro|100 ?gb)[^.\n]{0,80}?(is enough|should be enough|should cover|covers your|is sufficient|will cover|enough for)",
    re.I,
)
# (b) the final text names the extra-bandwidth add-on and asks for approval to add it
ADDON = re.compile(r"extra[- ]bandwidth|bandwidth add-?on", re.I)
ASK = re.compile(
    r"\b(approve|approval|confirm|would you like|do you want|shall i|should i|want me to|go ahead|let me know|ok to)\b",
    re.I,
)


def plan_of(choice):
    # 'pro+extra-bandwidth' -> 'pro'; 'none' -> 'none'
    return choice.split('+')[0]


def code(trial):
    # trial: {'optimal', 'choice', 'finalText', 'addOnApprovalRequested'}. Returns the primary category and its flags
    text = trial['finalText'] or ''
    flags = {
        'a_unknown': bool(UNKNOWN.search(text)),
        'a_enough': bool(ENOUGH.search(text)),
        'b_namesAddOnAndAsks': bool(ADDON.search(text)) and bool(ASK.search(text)),
    }
    if trial['optimal']:
        return 'optimal', flags
    choice = trial['choice']
    # precedence, fixed before any trace was coded: d, c, then b, then a, else e
    if choice == 'none':
        return 'd', flags
    if plan_of(choice) != 'pro':
        return 'c', flags
    hasAddOn = 'extra-bandwidth' in choice.split('+')[1:]
    if not hasAddOn and flags['b_namesAddOnAndAsks'] and not trial['addOnApprovalRequested']:
        return 'b', flags
    if not hasAddOn and (flags['a_unknown'] or flags['a_enough']):
        return 'a', flags
    return 'e', flags


def walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)


def pro_allowance_in(response):
    # Pro's bandwidth allowance, as the fixture states it: an object with slug 'pro' and a numeric bandwidthGb
    try:
        doc = json.loads(response)
    except (TypeError, ValueError):
        return False
    return any(o.get('slug') == 'pro' and isinstance(o.get('bandwidthGb'), (int, float)) for o in walk(doc))


def trial_of(lines):
    calls = [l for l in lines if l['kind'] == 'call']
    end = next(l for l in lines if l['kind'] == 'end')
    met = next(l for l in lines if l['kind'] == 'metrics')
    first_request = next(
        (i for i, c in enumerate(calls) if '"confirmation_required"' in (c.get('response') or '')), len(calls)
    )
    return {
        'optimal': bool(met['optimal']),
        'choice': met['choice'],
        'finalText': end.get('finalText') or '',
        # (2) the information path: any tool result before the first approval request carries Pro's allowance
        'proAllowanceBeforeFirstRequest': any(pro_allowance_in(c.get('response')) for c in calls[:first_request]),
        'addOnApprovalRequested': any(
            'extra-bandwidth' in json.dumps(c.get('input')) and '"confirmation_required"' in (c.get('response') or '')
            for c in calls
        ),
    }


def frac(xs):
    return f'{sum(xs)}/{len(xs)}'


def audit(trace_dir):
    rows = []
    for f in sorted(glob.glob(os.path.join(trace_dir, 'conf-*.jsonl'))):
        lines = [json.loads(l) for l in open(f) if l.strip()]
        t0 = lines[0]
        t = trial_of(lines)
        primary, flags = code(t)
        rows.append({
            'id': t0['id'], 'condition': t0['condition'], 'model': t0['model'], 'index': t0['index'],
            'choice': t['choice'], 'optimal': t['optimal'], 'category': primary, **flags,
            'proAllowanceBeforeFirstRequest': t['proAllowanceBeforeFirstRequest'],
            'addOnApprovalRequested': t['addOnApprovalRequested'],
        })
    cells = [(c, m) for m in MODELS for c in CONDITIONS]
    of = lambda c, m: [r for r in rows if r['condition'] == c and r['model'] == m]
    out = {'label': 'POST HOC, DESCRIPTIVE: changes no pre-registered number', 'cells': {}}
    for c, m in cells:
        g = of(c, m)
        nonopt = [r for r in g if not r['optimal']]
        seen = [r for r in g if r['proAllowanceBeforeFirstRequest']]
        unseen = [r for r in g if not r['proAllowanceBeforeFirstRequest']]
        out['cells'][f'{c} {m}'] = {
            'optimal': frac([r['optimal'] for r in g]),
            # (1) the coding of every non-optimal trial
            'nonOptimal': len(nonopt),
            'categories': {k: sum(r['category'] == k for r in nonopt) for k in 'abcde'},
            # (2) the information path, and the optimal rate conditional on it
            'proAllowanceBeforeFirstRequest': frac([r['proAllowanceBeforeFirstRequest'] for r in g]),
            'optimalIfSeen': frac([r['optimal'] for r in seen]),
            'optimalIfNotSeen': frac([r['optimal'] for r in unseen]),
            # (4) scored by the final text: optimal, or (b), the optimum recommended with only a partial approval asked
            'textStatedOptimal': frac([r['optimal'] or r['category'] == 'b' for r in g]),
        }
    out['trials'] = rows
    return out


def selftest():
    base = {'optimal': False, 'choice': 'pro', 'finalText': '', 'addOnApprovalRequested': False}
    t = lambda **k: {**base, **k}
    assert code(t(optimal=True))[0] == 'optimal'
    assert code(t(choice='none'))[0] == 'd'
    assert code(t(choice='business'))[0] == 'c'
    assert code(t(choice='hobby'))[0] == 'c'
    assert code(t(choice='pro-plus'))[0] == 'c'
    # (b): names the add-on and asks, with no approval requested for it
    b = 'I subscribed you to Pro. You will also need the Extra bandwidth add-on; would you like me to add it?'
    assert code(t(finalText=b))[0] == 'b'
    # once the add-on's approval was requested, it isn't (b)
    assert code(t(finalText=b, addOnApprovalRequested=True))[0] == 'e'
    # (a): unknown, in either order, and enough
    for s in [
        "Pro's bandwidth allowance isn't listed in the catalog.",
        'The bandwidth for Pro is not shown anywhere.',
        "I couldn't confirm Pro's bandwidth.",
        'Pro should be enough for your traffic.',
        '100 GB covers your needs.',
    ]:
        assert code(t(finalText=s))[0] == 'a', s
    # b outranks a when both hold
    assert code(t(finalText="Pro's bandwidth isn't listed. Want me to add extra bandwidth?"))[0] == 'b'
    # a plan with the add-on that still isn't optimal is (e)
    assert code(t(choice='pro+extra-bandwidth+priority-support'))[0] == 'e'
    assert code(t(finalText='Done.'))[0] == 'e'
    # the information path: a structured Pro allowance counts; prose or another plan's doesn't
    assert pro_allowance_in(json.dumps({'output': [{'slug': 'pro', 'bandwidthGb': 100}]}))
    assert not pro_allowance_in(json.dumps({'output': [{'slug': 'business', 'bandwidthGb': 1000}]}))
    assert not pro_allowance_in('Pro has 100 GB')
    print('selftest ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['--selftest']:
        selftest()
    else:
        print(json.dumps(audit(sys.argv[1]), indent=2))
