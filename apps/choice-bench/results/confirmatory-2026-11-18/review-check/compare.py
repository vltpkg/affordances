# python3 compare.py <dir holding runner/, ref1/ and ref2/>: runner is the runner's --fake output, ref1 and ref2 two runs of reference.ts
# the runner's per-trial records against c81eeeb1's own harness on the same specs, with the fake driver. Normalized:
# what the harness itself varies run to run (a fresh random account, so its project key and every revision digest over
# it; approval tokens; times, durations, load; the output directory). Everything else must be byte-equal
import json,re,sys,os,glob
R=sys.argv[1]
TIMING={'ms','durationMs','startedAt','load','at','expiresAt','raw'}
def norm(v,out):
  if isinstance(v,dict): return {k:norm(x,out) for k,x in v.items() if k not in TIMING}
  if isinstance(v,list): return [norm(x,out) for x in v]
  if isinstance(v,str):
    v=v.replace(out,'<OUT>')
    v=re.sub(r'proj_[0-9a-f]{32}','<PROJ>',v)
    v=re.sub(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z(~[A-Za-z0-9_-]+)+','<TOKEN>',v)
    v=re.sub(r'sha256-[A-Za-z0-9_-]{43}','<DIGEST>',v)
    v=re.sub(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z','<TIME>',v)
    return v
  return v
def canon(d,f): return [json.dumps(norm(json.loads(l),os.path.join(R,d)),sort_keys=True) for l in open(os.path.join(R,d,f))]
files=sorted(os.path.basename(f) for f in glob.glob(R+'/runner/*.jsonl'))
runner_vs_ref=[f for f in files if canon('runner',f)!=canon('ref1',f)]
ref_vs_ref=[f for f in files if canon('ref1',f)!=canon('ref2',f)]
print(json.dumps({'trials':len(files),'runnerVsReferenceUnequal':runner_vs_ref,'referenceVsItselfUnequal':ref_vs_ref,
  'lines':sum(len(canon('runner',f)) for f in files)}))
