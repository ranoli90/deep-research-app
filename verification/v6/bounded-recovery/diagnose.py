"""Post-freeze exact reference-span coverage across executed inspection windows; not semantic grading."""
import gzip,hashlib,json,pathlib,re,sys,unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).resolve().parent
path=OUT/'extraction-traces/controls.json';raw=path.read_bytes() if path.exists() else gzip.decompress((OUT/'extraction-controls.json.gz').read_bytes())
traces=json.loads(raw)['traces'];tasks_raw=(ROOT/'evals/matched-pipeline/tasks.json').read_bytes();tasks=json.loads(tasks_raw)['tasks']
def normalize(s):
 s=unicodedata.normalize('NFKC',s);s=re.sub(r'-\s+(?=[A-Za-z])','-',s).replace('\u00ad','');s=re.sub('[\u2010-\u2015\u2212]','-',s)
 return re.sub(r'\s+',' ',s).strip()
records=[]
for event in traces:
 if not event.get('kind','').startswith('official_') or 'receipt' not in event or 'sourceId' not in event:continue
 receipt=event['receipt'];trace=receipt['trace'];operations=[o for o in trace['operations'] if o['operation']=='extract_assertions']
 inspected={p['id'] for o in operations for p in o['input_manifest']['passages']}
 references=[]
 for task in tasks:
  for r in task['references']:
   if r['sourceId']!=event['sourceId']:continue
   page=re.match(r'PDFpage(\d+)\b',r['publisherLocator'])
   matches=[p for p in trace['passages'] if normalize(r['exactSpan']) in normalize(p['exact_text']) and(not page or p['locator'].get('block','').startswith('page:'+page[1]+'/'))]
   references.append({'taskId':task['id'],'reference':r,'allPassageMatches':[p['id'] for p in matches],'executedContextMatches':[p['id'] for p in matches if p['id'] in inspected]})
 records.append({'sourceId':event['sourceId'],'runId':receipt['runId'],'outcome':receipt['outcome'],'reportId':receipt['reportId'],'passages':len(trace['passages']),'executedContexts':len(operations),'inspected':len(inspected),'references':references,'unresolvedReasons':[e['payload'].get('reason') for e in trace['events'] if e['type']=='research_unresolved']})
missing=sum(not r['executedContextMatches'] for record in records for r in record['references']);extraction_missing=sum(not r['allPassageMatches'] for record in records for r in record['references'])
x={'commit':json.loads((OUT/'extraction.receipt.json').read_text())['commit'],'command':'python3 verification/v6/bounded-recovery/diagnose.py','evidenceClass':'actual saved extraction and executed model-context presence under fabricated transport; not claim support, semantic success or independent adjudication','developerExposure':'The earlier reference spans were already exposed. The recovery policy uses no reference/gold data; these tasks are not fresh blind heldout evidence.','traceSha256':hashlib.sha256(raw).hexdigest(),'tasksSha256':hashlib.sha256(tasks_raw).hexdigest(),'records':records,'extractionMissingReferences':extraction_missing,'inspectionMissingReferences':missing,'semanticScore':None,'humanAdjudication':None,'paidCostMicro':0,'exitCode':1 if missing or not records else 0}
(OUT/'REFERENCE_DIAGNOSTIC.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps({k:x[k] for k in ['commit','extractionMissingReferences','inspectionMissingReferences','semanticScore','exitCode']},indent=2));sys.exit(x['exitCode'])
