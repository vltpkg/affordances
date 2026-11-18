"""RFC 0005 §7's scoring (SCORING.md §4 to §6), applied mechanically. SPIKE: measurement code, not product code.

    python3 -I score.py <results-dir>

It reads <results-dir>/{example,hosting-lab}-{A,B}.json, which measure.ts writes, and the two references beside this
script. It writes <results-dir>/scores.json and prints a results table. No judgement: every rule is SCORING.md's.
"""

import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFERENCES = {
    "example": HERE / "example-reference.json",
    "hosting-lab": HERE / "hosting-lab-reference.json",
}
SCALAR = ["id", "kind", "input", "authorization", "confirmation", "target"]
BY_DESIGN = ["effects", "claims", "relations"]


def canonical(value):
    # RFC 8785 for this data: sorted keys, no whitespace; the values are JSON Schema and strings, no floats to format
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def empty_object(schema):
    return (
        isinstance(schema, dict)
        and schema.get("type") == "object"
        and not schema.get("properties")
        and not schema.get("required")
    )


def value(field, cap):
    """A capability's value for a scalar field, as SCORING.md §5 compares it, or None for no value."""
    v = cap.get(field)
    if field == "authorization":
        return v and v.get("principal")
    if field == "confirmation":
        return v is not None  # whether confirmation is required; a boolean is always a value
    return v


def matches(field, ref, ext):
    if field == "input":
        if ref is None:
            # v0 requires an input, so an absent reference input matches an empty object schema (SCORING.md §5)
            return empty_object(ext)
        return canonical(ref) == canonical(ext)
    return ref == ext


def ratio(tp, other):
    return None if tp + other == 0 else round(tp / (tp + other), 3)


def score(reference, extracted):
    key = lambda c: (c["binding"]["route"], c["binding"]["action"]) if c.get("binding") else None
    refs = {key(c): c for c in reference["capabilities"]}
    exts = {key(c): c for c in extracted["capabilities"] if key(c)}
    matched = [k for k in refs if k in exts]
    out, mismatches = {}, []

    # binding: over every capability, matched or not (§4)
    tp = len(matched)
    out["binding"] = {"tp": tp, "fp": len(exts) - tp, "fn": len(refs) - tp}

    for field in SCALAR:
        tp = fp = fn = 0
        for k in matched:
            r, e = value(field, refs[k]), value(field, exts[k])
            if field == "input" and r is None:
                # no reference input: an empty object schema matches (SCORING.md §5); anything else is an FP
                if empty_object(e):
                    tp += 1
                elif e is not None:
                    fp += 1
                    mismatches.append({"binding": list(k), "field": field, "reference": r, "extracted": e})
                continue
            if r is None and e is None:
                continue  # neither has a value: nothing to count
            if r is not None and e is not None and matches(field, r, e):
                tp += 1
                continue
            fp += e is not None
            fn += r is not None
            mismatches.append({"binding": list(k), "field": field, "reference": r, "extracted": e})
        out[field] = {"tp": tp, "fp": fp, "fn": fn}

    # preconditions: the reference's declarative ones, by id; extracted guards are opaque, counted, not scored
    tp = fp = fn = guards = 0
    for k in matched:
        ref_ids = {p["id"] for p in refs[k]["preconditions"] if p["declarative"]}
        ext_decl = {p["id"] for p in exts[k]["preconditions"] if p["declarative"]}
        guards += sum(1 for p in exts[k]["preconditions"] if not p["declarative"])
        tp += len(ref_ids & ext_decl)
        fp += len(ext_decl - ref_ids)
        fn += len(ref_ids - ext_decl)
    out["preconditions"] = {"tp": tp, "fp": fp, "fn": fn, "extractedGuards": guards}

    # effects, claims, relations: none extracted by design; recall counted, precision n/a when nothing's extracted
    for field in BY_DESIGN:
        ref_n = sum(len(refs[k][field]) for k in matched)
        ext_n = sum(len(exts[k][field]) for k in matched)
        out[field] = {"tp": 0, "fp": ext_n, "fn": ref_n}

    # resource types and keys: (id, key) pairs as sets; a key that matches under another id is reported, not counted
    ref_pairs = {(r["id"], r["key"]) for r in reference["resources"]}
    ext_pairs = {(r["id"], r["key"]) for r in extracted["resources"]}
    out["resources"] = {
        "tp": len(ref_pairs & ext_pairs),
        "fp": len(ext_pairs - ref_pairs),
        "fn": len(ref_pairs - ext_pairs),
        "keyOnlyMatches": sorted(
            [list(e) for e in ext_pairs - ref_pairs if any(e[1] == r[1] for r in ref_pairs - ext_pairs)]
        ),
    }

    for field, c in out.items():
        c["precision"] = ratio(c["tp"], c["fp"])
        c["recall"] = ratio(c["tp"], c["fn"])
    return {
        "fields": out,
        "mismatches": mismatches,
        "diagnostics": dict(sorted(Counter(d["code"] for d in extracted["diagnostics"]).items())),
        "confirmationSummaries": [
            {"binding": list(k), "reference": (refs[k]["confirmation"] or {}).get("summary"),
             "extracted": (exts[k]["confirmation"] or {}).get("summary")}
            for k in matched
            if refs[k]["confirmation"] or exts[k]["confirmation"]
        ],
    }


def main():
    results = Path(sys.argv[1])
    scores = {}
    for app, ref_path in REFERENCES.items():
        reference = json.loads(ref_path.read_text())
        for stage in ("A", "B"):
            extracted = json.loads((results / f"{app}-{stage}.json").read_text())
            scores[f"{app} {stage}"] = score(reference, extracted)
    (results / "scores.json").write_text(json.dumps(scores, indent=2, ensure_ascii=False) + "\n")
    fields = ["binding", *SCALAR, "preconditions", *BY_DESIGN, "resources"]
    fmt = lambda v: "n/a" if v is None else f"{v:.2f}"
    print("| field | " + " | ".join(f"{k} P / R" for k in scores) + " |")
    print("| --- |" + " --- |" * len(scores))
    for f in fields:
        cells = [f"{fmt(s['fields'][f]['precision'])} / {fmt(s['fields'][f]['recall'])}" for s in scores.values()]
        print(f"| {f} | " + " | ".join(cells) + " |")


if __name__ == "__main__":
    main()
