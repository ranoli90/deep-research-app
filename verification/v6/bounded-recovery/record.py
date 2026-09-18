"""Package ADR057 terminal execution evidence without rewriting earlier failure packets."""
import datetime,gzip,hashlib,json,pathlib,re,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest();receipts=[]
for name in ['integration','extraction','verify','review','handoff','review-mutations','handoff-mutations']:
 p=OUT/(name+'.receipt.json')
 if not p.exists():raise SystemExit('Missing terminal receipt: '+name)
 r=json.loads(p.read_text());log=ROOT/r['artifact'];target=OUT/(name+'.terminal.log.gz')
 raw=log.read_bytes() if log.exists() else gzip.decompress(target.read_bytes())
 if sha(raw)!=r['artifactSha256']:raise SystemExit('Changed command log')
 target.write_bytes(gzip.compress(raw,mtime=0));r['compressedArtifact']=str(target.relative_to(ROOT));r['compressedSha256']=sha(target.read_bytes());r['testSummary']=re.findall(r'(?:Test Files|Tests)\s+[^\n]+',raw.decode(errors='replace'));receipts.append(r)
source=receipts[0]['commit'];paths=subprocess.check_output(['git','diff','--name-only','d1fc334',source],cwd=ROOT,text=True).splitlines();files=[]
for name in sorted(set(p for p in paths if p.startswith(('apps/','packages/')))|{'pnpm-lock.yaml'}):
 b=subprocess.check_output(['git','show',source+':'+name],cwd=ROOT)
 if (ROOT/name).read_bytes()!=b:raise SystemExit('Runtime/test changed after terminal verification: '+name)
 files.append({'path':name,'sha256':sha(b)})
(OUT/'SOURCE_FILES.json').write_text(json.dumps({'commit':source,'files':files},indent=2)+'\n')
traces=[]
for name,src in [('recovery-journey','/tmp/deep-recovery-journey-final.json'),('corrected-journey','/tmp/deep-recovery-correction-final.json'),('extraction-controls',str(OUT/'extraction-traces/controls.json'))]:
 path=pathlib.Path(src);target=OUT/(name+'.json.gz');raw=path.read_bytes() if path.exists() else gzip.decompress(target.read_bytes());target.write_bytes(gzip.compress(raw,mtime=0))
 if gzip.decompress(target.read_bytes())!=raw:raise SystemExit('Compression mismatch')
 traces.append({'path':str(target.relative_to(ROOT)),'sha256':sha(target.read_bytes()),'uncompressedSha256':sha(raw)})
recovery=json.loads(gzip.decompress((OUT/'recovery-journey.json.gz').read_bytes()));correction=json.loads(gzip.decompress((OUT/'corrected-journey.json.gz').read_bytes()))
(OUT/'JOURNEY_SUMMARY.json').write_text(json.dumps({'commit':source,'evidenceClass':recovery['evidenceClass'],'recovery':{'report':recovery['report'],'contexts':[{'operation':c['operation'],'selection':c['context'].get('evidenceSelection')} for c in recovery['contexts']],'supportDecisions':[c['decision'] for c in recovery['support']]},'correction':{'original':correction['original'],'revised':correction['revised'],'reusedPassages':correction['reusedPassages']},'semanticQuality':None,'paidCostMicro':0},indent=2)+'\n')
diag=json.loads((OUT/'REFERENCE_DIAGNOSTIC.json').read_text());quota=json.loads((OUT/'PROJECT_KEY_READINESS.json').read_text());legacy=json.loads((OUT/'PROJECT_LEGACY_EXPOSURE.json').read_text())
result={'task':'W02/W05/W06/W08/W09 ADR057 empty selection recovery','baseCommit':'d1fc334','sourceCommit':source,'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'milestoneComplete':False,'commands':receipts,'traces':traces,'developmentEvidence':'DEVELOPMENT_LOGS.json','referenceDiagnostic':{'command':diag['command'],'artifact':'REFERENCE_DIAGNOSTIC.json','exitCode':diag['exitCode'],'extractionMissingReferences':diag['extractionMissingReferences'],'inspectionMissingReferences':diag['inspectionMissingReferences'],'scope':diag['evidenceClass']},'paidSpendMicro':0,'readOnlyProviderQuota':{'artifact':'PROJECT_KEY_READINESS.json','checkedAt':quota['checkedAt'],'keyQuotaUSD':quota.get('keyQuotaUSD'),'authorizationGranted':False},'legacyLedger':{'artifact':'PROJECT_LEGACY_EXPOSURE.json','status':legacy['status'],'reason':legacy.get('reason'),'exposure':legacy.get('legacyUnattributedExposure'),'scope':'Legacy labels/estimates, not verified actual provider spend. Missing key/receipt provenance; no mutation or hold release.'},'currentUserApprovedAllowance':None,'nativeBuild':None,'hostedOrDeployment':None,'semanticScore':None,'humanAdjudication':None,'unresolved':['Useful real-model synthesis, correction/full-rerun factual agreement and paired quality/cost evidence are unproven.','Current monetary authority and legacy financial provenance are missing; a new database must not bypass existing unknown liabilities.','The reference spans are already exposed; complete context presence is not semantic understanding or fresh heldout success.','Broader OCR/layout and applicable physical/iOS/hosted identity/W10 release gates remain distinct.'],'rollback':'Default new admissions to none.v1 if necessary; preserve admitted recovery policies/readers, selection proof/obligations, inventory support veto, ownership/deletion/fences, provider action identities and unknown holds.'}
(OUT/'RESULTS.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'commit':source,'receipts':len(receipts),'inspectionMissingReferences':diag['inspectionMissingReferences'],'milestoneComplete':False}))
