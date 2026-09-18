"""Package terminal evidence without deleting failures or claiming semantic success."""
import datetime,gzip,hashlib,json,pathlib,re,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
required=['integration','integration-fixed','integration-final','extraction','verify','review','handoff','review-mutations','handoff-mutations']
receipts=[]
for name in required:
    path=OUT/(name+'.receipt.json')
    if not path.exists():raise SystemExit('Missing terminal receipt: '+name)
    receipt=json.loads(path.read_text());log=ROOT/receipt['artifact']
    raw=log.read_bytes() if log.exists() else gzip.decompress(pathlib.Path(str(log)+'.gz').read_bytes())
    if sha(raw)!=receipt['artifactSha256']:raise SystemExit('Changed command log: '+name)
    target=pathlib.Path(str(log)+'.gz');target.write_bytes(gzip.compress(raw,mtime=0))
    receipt['compressedArtifact']=str(target.relative_to(ROOT));receipt['compressedSha256']=sha(target.read_bytes());receipt['testSummary']=re.findall(r'(?:Test Files|Tests)\s+[^\n]+',raw.decode(errors='replace'))
    receipts.append(receipt)
source=next(r['commit'] for r in receipts if r['compressedArtifact'].endswith('/integration-final.log.gz'))
changed=subprocess.check_output(['git','diff','--name-only','3f22f5b3cd96b85fc78c1843fc9feb1bcb367562',source],cwd=ROOT,text=True).splitlines()
paths=[p for p in changed if p.startswith(('apps/','packages/'))]+['pnpm-lock.yaml','package.json','apps/backend/package.json','packages/research-core/package.json']
files=[]
for name in sorted(set(paths)):
    body=subprocess.check_output(['git','show',source+':'+name],cwd=ROOT)
    if (ROOT/name).read_bytes()!=body:raise SystemExit('Runtime/test file changed after terminal verification: '+name)
    files.append({'path':name,'sha256':sha(body)})
(OUT/'SOURCE_FILES.json').write_text(json.dumps({'commit':source,'files':files},indent=2)+'\n')
# Original raw traces stay intact until their lossless compressed copies are verified.
trace_files=[]
for directory in ['official-before','extraction-traces']:
    for path in sorted((OUT/directory).glob('*.json')):
        raw=path.read_bytes();target=pathlib.Path(str(path)+'.gz');target.write_bytes(gzip.compress(raw,mtime=0))
        if gzip.decompress(target.read_bytes())!=raw:raise SystemExit('Trace compression mismatch')
        trace_files.append({'path':str(target.relative_to(ROOT)),'uncompressedSha256':sha(raw),'sha256':sha(target.read_bytes()),'bytes':len(raw)})
journey=pathlib.Path('/tmp/deep-selection-journey-final.json')
if not journey.exists():raise SystemExit('Missing final corrected journey trace')
raw=journey.read_bytes();(OUT/'corrected-journey.json.gz').write_bytes(gzip.compress(raw,mtime=0));j=json.loads(raw)
summary={'evidenceClass':j['evidenceClass'],'sourceCommit':source,'original':j['original'],'revised':j['revised'],'reusedPassages':j['reusedPassages'],'selections':[{'id':s['id'],'runId':s['run_id'],'proofDigest':s['proof_digest'],'result':s['selection']} for s in j['selections']],'paidCostMicro':0,'semanticQuality':None,'fullTrace':'corrected-journey.json.gz','fullTraceSha256':sha((OUT/'corrected-journey.json.gz').read_bytes())}
(OUT/'JOURNEY_SUMMARY.json').write_text(json.dumps(summary,indent=2)+'\n')
diag=json.loads((OUT/'REFERENCE_DIAGNOSTIC.json').read_text())
result={'task':'V6 W01/W02/W03/W05/W06/W08/W09 ADR055 continuation','baseCommit':'3f22f5b3cd96b85fc78c1843fc9feb1bcb367562','implementationCommit':'9b0f9e7c86c4c7f6ebcf0082217c44d4516ae12d','repairCommit':'b5973e4700271aef1ca08895fed074a4318a2d00','verificationCommit':source,'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'milestoneComplete':False,'commands':receipts,'referenceDiagnostic':{'command':'python3 verification/v6/evidence-selection/diagnose.py','commit':source,'exitCode':diag['exitCode'],'environment':receipts[0]['environment'],'artifact':'REFERENCE_DIAGNOSTIC.json','extractionMissingReferences':diag['extractionMissingReferences'],'selectionMissingReferences':diag['selectionMissingReferences'],'scope':diag['evidenceClass']},'traces':trace_files,'intermediateEvidence':'INTERMEDIATE_LOGS.json','intermediateSourceLimitation':'Uncommitted development logs identify HEAD and scope; exact intermediate source snapshots were not retained. Committed full runs and final runtime/test hashes are separate.','paidSpendMicro':0,'currentPaidAuthorization':'not established; no paid calls performed','syntheticUnknownHolds':'Retained by isolated evaluation controls; not real provider spend.','nativeBuild':None,'hostedOrDeployment':None,'humanAdjudication':None,'semanticScore':None,'unresolved':['ESP32 reference spans are extracted but omitted by the bounded lexical selection (3/8 registered spans missing across the four attempted sources).','Official saved-document model transports are fabricated and produce no relevant assertions/no report; not a useful-answer pass.','Selection recall, cross-selection counterevidence and budget-bounded recovery when extraction finds no relevant assertion require further work before claiming the requested general research milestone.','Current paid authorization and independent adjudication, broader OCR/layout, and applicable W10 native/hosted/release gates remain separate.'],'nextTask':'Add a production regression for a material contradiction outside the selected context, then ensure substantive verification cannot ignore authorized inventory and improve bounded discovery of decisive omitted evidence without tuning production to exposed reference answers.','rollback':'Disable new selection scheduling/admissions if needed; retain admitted policy/proof/obligation readers, legacy logical request identities, publication omission vetoes, account/source deletion, fences, settlement and unknown holds. Never switch admitted policy or recreate missing proof to resend.'}
(OUT/'RESULTS.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'sourceCommit':source,'commandReceipts':len(receipts),'traceFiles':len(trace_files),'semanticDiagnosticExitCode':diag['exitCode'],'milestoneComplete':False}))
