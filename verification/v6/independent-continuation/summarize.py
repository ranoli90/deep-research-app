"""Summarize durable public evaluation receipts; never computes semantic scores or changes a run."""
import json,pathlib,hashlib
out=pathlib.Path(__file__).resolve().parent
records=[json.loads(line) for line in (out/'live/receipts.jsonl').read_text().splitlines()]
results=[]
for event in records:
 if event.get('event')!='result':continue
 receipt=event['receipt'];trace=receipt['trace'];report=trace.get('report')
 results.append({'stepId':event['stepId'],'runId':receipt['runId'],'outcome':receipt['outcome'],'reportId':receipt['reportId'],'wallMs':event['wallMs'],'cost':receipt['cost'],'passageCount':len(trace.get('passages',[])),'sourceVersions':sorted(set(p['source_version_id'] for p in trace.get('passages',[]))),'supportDecisions':[s.get('decision') for s in trace.get('support',[])],'reuseMembershipCount':len(trace.get('reuse',[])),'report':report,'extraction':[{'sourceVersionId':e['source_version_id'],'sourceDigest':e['source_digest'],'transport':e['transport'],'version':e.get('extraction',{}).get('version'),'status':e.get('extraction',{}).get('status'),'warnings':e.get('extraction',{}).get('warnings',[])} for e in trace.get('extraction',[])]})
summary={'evidenceClass':'real_model_frozen_public_document_production_api_worker','environment':next((r for r in records if r.get('event')=='environment'),None),'plan':next((r for r in records if r.get('event')=='registered_scope'),None),'finished':next((r for r in records if r.get('event')=='finished'),None),'results':results,'unrun':[r for r in records if r.get('event')=='unrun'],'failures':[r for r in records if r.get('event') in ('fatal','failed')],'journalSha256':hashlib.sha256((out/'live/receipts.jsonl').read_bytes()).hexdigest(),'humanAdjudication':None,'semanticScores':None,'liveDiscoveryProven':False,'priorUnknownSettled':False}
(out/'SUMMARY.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({'finished':summary['finished'],'results':[{k:v for k,v in r.items() if k in ['stepId','outcome','reportId','cost','passageCount','wallMs']} for r in results],'unrun':summary['unrun'],'failures':summary['failures']},indent=2))
