"""Record ADR056 independently of the retained unsafe ADR055 baseline."""
import datetime,gzip,hashlib,json,pathlib,re,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
receipts=[]
for name in ['inventory-integration','inventory-extraction','inventory-verify','inventory-probe']:
 p=OUT/(name+'.receipt.json')
 if not p.exists():raise SystemExit('Missing terminal receipt: '+name)
 r=json.loads(p.read_text());log=ROOT/r['artifact'];raw=log.read_bytes() if log.exists() else gzip.decompress(pathlib.Path(str(log)+'.gz').read_bytes())
 if sha(raw)!=r['artifactSha256']:raise SystemExit('Log changed: '+name)
 target=pathlib.Path(str(log)+'.gz');target.write_bytes(gzip.compress(raw,mtime=0));r['compressedArtifact']=str(target.relative_to(ROOT));r['compressedSha256']=sha(target.read_bytes());r['testSummary']=re.findall(r'(?:Test Files|Tests)\s+[^\n]+',raw.decode(errors='replace'));receipts.append(r)
source=receipts[0]['commit']
if any(r['commit']!=source for r in receipts):raise SystemExit('Review different runtime commits before combining receipts')
files=[]
paths=subprocess.check_output(['git','diff','--name-only','d784c274217a218c0f73f00a4609090fa1b0d5d5',source],cwd=ROOT,text=True).splitlines()
for name in sorted(set(p for p in paths if p.startswith(('apps/','packages/')))):
 b=subprocess.check_output(['git','show',source+':'+name],cwd=ROOT)
 if (ROOT/name).read_bytes()!=b:raise SystemExit('Runtime changed after verification: '+name)
 files.append({'path':name,'sha256':sha(b)})
(OUT/'INVENTORY_SOURCE_FILES.json').write_text(json.dumps({'commit':source,'files':files},indent=2)+'\n')
traces=[]
trace_dir=OUT/'inventory-extraction-traces'
paths={pathlib.Path(str(p)[:-3]) for p in trace_dir.glob('*.json.gz')}|set(trace_dir.glob('*.json'))
for p in sorted(paths):
 target=pathlib.Path(str(p)+'.gz');raw=p.read_bytes() if p.exists() else gzip.decompress(target.read_bytes());target.write_bytes(gzip.compress(raw,mtime=0))
 if gzip.decompress(target.read_bytes())!=raw:raise SystemExit('Compression mismatch')
 traces.append({'path':str(target.relative_to(ROOT)),'sha256':sha(target.read_bytes()),'uncompressedSha256':sha(raw)})
raw=pathlib.Path('/tmp/deep-selection-journey-final.json').read_bytes();j=json.loads(raw)
(OUT/'inventory-corrected-journey.json.gz').write_bytes(gzip.compress(raw,mtime=0))
(OUT/'INVENTORY_JOURNEY_SUMMARY.json').write_text(json.dumps({'commit':source,'evidenceClass':j['evidenceClass'],'original':j['original'],'revised':j['revised'],'reusedPassages':j['reusedPassages'],'paidCostMicro':0,'semanticQuality':None,'trace':'inventory-corrected-journey.json.gz','traceSha256':sha((OUT/'inventory-corrected-journey.json.gz').read_bytes())},indent=2)+'\n')
probe=json.loads((OUT/'OMITTED_CONTRADICTION_AFTER.json').read_text())
result={'task':'W01/W03/W05/W06 ADR056 inventory support repair','sourceCommit':source,'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'milestoneComplete':False,'commands':receipts,'probe':{'before':'OMITTED_CONTRADICTION.json','beforeExitCode':1,'after':'OMITTED_CONTRADICTION_AFTER.json','afterExitCode':probe['exitCode'],'cases':[{'large':r['large'],'withheld':r['withheld'],'contradictionSelected':r['contradictionSelected'],'inventoryDecisions':[c['decision'] for c in r['inventoryChecks']]} for r in probe['results']]},'traces':traces,'paidSpendMicro':0,'currentPaidAuthorization':'unknown; not inferred from historical ledger or credentials','nativeBuild':None,'hostedOrDeployment':None,'humanAdjudication':None,'semanticScore':None,'unresolved':['The deterministic inventory guard detects known literal contradictions/qualifications; it is not full semantic comprehension.','Post-freeze diagnostic still misses three selected reference spans despite preserving their real extracted text.','Actual useful real-model synthesis, correction/full-rerun agreement and matched quality/cost comparison remain unproven; current monetary authorization is absent.','Broader OCR/layout and applicable native/hosted identity/release gates remain separate.'],'rollback':'Suspend admissions if necessary; retain the inventory guard for admitted selection-aware results, immutable selection proof/obligations, deletion, fences, provider identities and unknown holds.'}
(OUT/'INVENTORY_RESULTS.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'sourceCommit':source,'receipts':len(receipts),'probeExitCode':probe['exitCode'],'milestoneComplete':False}))
