"""Post-freeze reference-span diagnostic, not semantic grading or a blind benchmark."""
import gzip,hashlib,json,pathlib,re,sys,unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(__file__).resolve().parent
trace_path=OUT/'extraction-traces'/'controls.json'
tasks_path=ROOT/'evals/matched-pipeline/tasks.json'
trace_bytes=trace_path.read_bytes() if trace_path.exists() else gzip.decompress(pathlib.Path(str(trace_path)+'.gz').read_bytes())
traces=json.loads(trace_bytes)['traces']
tasks=json.loads(tasks_path.read_text())['tasks']
def normalize(text):
    text=unicodedata.normalize('NFKC',text)
    text=re.sub(r'-\s+(?=[A-Za-z])','-',text).replace('\u00ad','')
    text=re.sub('[\u2010-\u2015\u2212]','-',text)
    return re.sub(r'\s+',' ',text).strip()
records=[]
for event in traces:
    if not event.get('kind','').startswith('official_') or 'receipt' not in event or 'sourceId' not in event: continue
    source_id=event['sourceId']; receipt=event['receipt']; trace=receipt['trace']
    ids={id for s in trace.get('selections',[]) for id in s['selection']['passageIds']}
    references=[]
    for task in tasks:
        for reference in task['references']:
            if reference['sourceId']!=source_id: continue
            page=re.match(r'PDFpage(\d+)\b',reference['publisherLocator'])
            matches=[p for p in trace['passages'] if normalize(reference['exactSpan']) in normalize(p['exact_text']) and (not page or p['locator'].get('block','').startswith('page:'+page[1]+'/'))]
            references.append({'taskId':task['id'],'split':task['split'],'reference':reference,'allPassageMatches':[p['id'] for p in matches],'selectedPassageMatches':[p['id'] for p in matches if p['id'] in ids],'matchingBlockPositions':[p['locator'].get('block') for p in matches]})
    records.append({'sourceId':source_id,'runId':receipt['runId'],'outcome':receipt['outcome'],'reportId':receipt['reportId'],'passages':len(trace['passages']),'selected':len(ids),'references':references,'unresolvedReasons':[e['payload'].get('reason') for e in trace['events'] if e['type']=='research_unresolved']})
extraction_missing=sum(not r['allPassageMatches'] for record in records for r in record['references'])
selection_missing=sum(not r['selectedPassageMatches'] for record in records for r in record['references'])
result={'version':'post-freeze-selection-diagnostic.v1','sourceCommit':json.loads((OUT/'extraction.receipt.json').read_text())['commit'],'policyCommit':'9b0f9e7c86c4c7f6ebcf0082217c44d4516ae12d','evidenceClass':'reference-span presence in actual saved-document extraction and selected inventory; fabricated model transport; not semantic support or independent human adjudication','developerExposure':'References inspected after source policy was committed. These inspected tasks cannot be treated as fresh blind held-out tasks for subsequent selection tuning.','normalization':'Existing corpus NFKC, physical hyphen linejoin, soft-hyphen removal, Unicode dash/minus canonicalization and whitespace; raw text unchanged. PDFpage references additionally require that exact block page.','traceSha256':hashlib.sha256(trace_bytes).hexdigest(),'tasksSha256':hashlib.sha256(tasks_path.read_bytes()).hexdigest(),'records':records,'extractionMissingReferences':extraction_missing,'selectionMissingReferences':selection_missing,'humanAdjudication':None,'semanticScore':None,'paidCostMicro':0,'exitCode':1 if selection_missing else 0}
(OUT/'REFERENCE_DIAGNOSTIC.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['sourceCommit','extractionMissingReferences','selectionMissingReferences','semanticScore','paidCostMicro','exitCode']},indent=2))
sys.exit(result['exitCode'])
