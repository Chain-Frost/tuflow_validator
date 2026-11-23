import json,os,pathlib,csv,hashlib,math
b=pathlib.Path(os.environ['TEMP'])/'tpv-acceptance-20261123';e=b/'evidence'
rows=[];summaries=[]
for p in sorted(e.glob('core-*.json')):
 d=json.loads(p.read_text()); name=p.stem.removeprefix('core-')
 for scenario,result in d['results'].items():
  summary=result.get('summary',{'samples':1,'medianMs':result.get('elapsedMs'),'p95Ms':None})
  summaries.append({'build_storage':name,'scenario':scenario,**summary})
  for i,trial in enumerate(result.get('trials',[result])):
   rows.append({'build_storage':name,'scenario':scenario,'sample':i+1,**{k:v for k,v in trial.items() if not isinstance(v,(dict,list))}})
for name,data in [('core-trials.csv',rows),('core-summary.csv',summaries)]:
 keys=list(dict.fromkeys(k for row in data for k in row))
 with (e/name).open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=keys);w.writeheader();w.writerows(data)
print('Exported',len(rows),'raw trials and',len(summaries),'summary rows')
