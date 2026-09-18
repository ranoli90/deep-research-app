"""Preserve terminal local receipts. Never infer success for a running command."""
import gzip
import hashlib
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(__file__).resolve().parent
base = '4d818feb1dcf8808b38c980ac2f2f204977e2d7b'
runtime_implementation = '643e20358c5d05a0480e701215f5f1df7963d68c'
implementation = '47c3c1a53e637cd83b08e04e1c8d756095dc48d4'
db = 'TEST_DATABASE_URL=postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_continuation_20260918'
extract = 'EXTRACTION_RUNTIME=/tmp/deep-v6-extraction-runtime'
artifacts = f'EVAL_RUNNER_ARTIFACT_DIR={out}'
commands = [
 ('baseline-verify','pnpm verify','deterministic_unit_and_structure','Exact start HEAD;157core/142backend/206mobile/6governance'),
 ('baseline-integration',f'{db} pnpm test:integration','deterministic_integration','Started before HTML edits and continued during development;423pass/1existing30s timeout; not an exact clean-baseline claim'),
 ('html-before','pnpm --filter @deep/backend test:unit test/html-upload.unit.test.ts','deterministic_unit','Before upload repair:2failed/4passed'),
 ('html-unit','pnpm --filter @deep/backend test:unit test/html-upload.unit.test.ts test/frozen-documents.unit.test.ts test/eval-live.unit.test.ts','deterministic_unit','Intermediate27passed'),
 ('html-unit-final','pnpm --filter @deep/backend test:unit test/html-upload.unit.test.ts test/frozen-documents.unit.test.ts test/eval-live.unit.test.ts','deterministic_unit','28passed including unsupportedXML controls'),
 ('types','pnpm --filter @deep/backend typecheck','static_types','Intermediate backend types'),
 ('final-verify','pnpm verify','deterministic_unit_and_structure','Pre-v4 intermediate157/149/206/6'),
 ('encoding-before',f"{extract} pnpm --filter @deep/backend test:extraction test/html.extraction.test.ts -t 'without a charset tag'",'actual_isolated_extraction','UTF8 corruption reproduced:1failed/3explicitly deselected'),
 ('encoding-after',f'{extract} pnpm --filter @deep/backend test:extraction test/html.extraction.test.ts test/html-lists.extraction.test.ts test/html-formatting.extraction.test.ts','actual_isolated_extraction','21passed; Unicode and declared legacy encoding'),
 ('eval-extraction',f'{db} {extract} {artifacts}/eval-traces pnpm --filter @deep/backend test:extraction test/eval-live.extraction.test.ts','actual_extraction_api_worker_fabricated_models','13passed beforev4; dedicated retained database'),
 ('focused-integration',f'{db} pnpm --filter @deep/backend test:integration test/html-upload.integration.test.ts test/passage-capacity.integration.test.ts','deterministic_integration','Unchanged capacity rerun plus new upload6/6; no timeout/assertion changes'),
 ('extraction',f'{db} {extract} {artifacts}/eval-traces-v4 pnpm --filter @deep/backend test:extraction','actual_extraction_api_worker_fabricated_models','51/51; v4; cachedv3 seed control was added while suite ran and is separately rerun'),
 ('cache-extraction',f"{db} {extract} {artifacts}/cache-traces pnpm --filter @deep/backend test:extraction test/eval-live.extraction.test.ts -t 'frozen html pairs'",'actual_extraction_api_worker_fabricated_models','1passed/12explicitly deselected; cachedv3 reparsed to v4, actual four-run journey'),
 ('verify-v4','pnpm verify','deterministic_unit_and_structure','Final implementation157core/149backend/206mobile/6governance/types/boundaries'),
 ('integration-final',f'{db} pnpm test:integration','deterministic_integration','Final unchanged-source full rerun, real local PostgreSQL'),
 ('numeric-id-before',f"{db} pnpm --filter @deep/backend test:integration test/model-gateway.integration.test.ts -t 'keeps supported synthesis'",'deterministic_integration','Forced valid UUID suffix999 reproduces false blanket assertion:1fail/135deselected'),
 ('numeric-id-after',f"{db} pnpm --filter @deep/backend test:integration test/model-gateway.integration.test.ts -t 'keeps supported synthesis'",'deterministic_integration','Exact four-block text/kind/identity projection and retained publication/caveat assertions;1pass/135deselected'),
 ('types-numeric','pnpm --filter @deep/backend typecheck','static_types','Includes actual test code after numeric regression repair'),
 ('integration-complete',f'{db} pnpm test:integration','deterministic_integration','Full425-case recheck after strengthened numeric output assertion; no production changes or timeout increases'),
 ('docs-complete','python3 scripts/validate_review.py','document_integrity','Registered source/evidence commands resolve after numeric regression repair'),
 ('handoff-review','python3 scripts/validate_review.py','document_integrity','Final synchronized status and handoff'),
 ('handoff-builder','python3 scripts/validate_builder_handoff.py','document_integrity','Final synchronized status and handoff'),
 ('docs-0','python3 scripts/validate_review.py','document_integrity','No application claims'),
 ('docs-1',"python3 -m unittest discover -s scripts -p 'test_review_validator.py' -v",'document_integrity','Validator mutation controls only'),
 ('docs-2','python3 scripts/validate_builder_handoff.py','document_integrity','No application claims'),
 ('docs-3',"python3 -m unittest discover -s scripts -p 'test_builder_handoff.py' -v",'document_integrity','Validator mutation controls only'),
 ('docs-final-review','python3 scripts/validate_review.py','document_integrity','After authority/registry updates'),
]
results=[]
for name,command,evidence,scope in commands:
 status=out/f'{name}.exit'
 record=dict(requirementIds=['W01','W02','W03','W04','W05','W06','W07','W08','W09'],commit=implementation if name in ['integration-complete','docs-complete','handoff-review','handoff-builder'] else runtime_implementation if name in ['numeric-id-before','numeric-id-after','types-numeric'] else base,implementationCommit=implementation,revisionNote='Commit is HEAD at command start; baseline-verify was clean, intermediate working trees are described in scope. Runtime implementation643e203 and subsequent test repair are preserved in history.',command=command,evidenceClass=evidence,scope=scope)
 if not status.exists():
  record.update(status='pending',exitCode=None)
 else:
  log=(out/f'{name}.log').read_bytes()
  target=out/f'{name}.log.gz';target.write_bytes(gzip.compress(log,mtime=0))
  record.update(status='terminal',exitCode=int(status.read_text()),artifact=target.name,sha256=hashlib.sha256(target.read_bytes()).hexdigest(),uncompressedSha256=hashlib.sha256(log).hexdigest())
 results.append(record)
for folder in ['eval-traces','eval-traces-v4','cache-traces']:
 source=out/folder/'controls.json'
 if source.exists(): (out/f'{folder}.json.gz').write_bytes(gzip.compress(source.read_bytes(),mtime=0))
matched=pathlib.Path('/tmp/deep-matched-pipeline-DzIddV/document-controls.json')
if matched.exists(): (out/'matched-pipeline.json.gz').write_bytes(gzip.compress(matched.read_bytes(),mtime=0))
paths=subprocess.check_output(['git','ls-tree','-r','--name-only',implementation],cwd=root,text=True).splitlines()
paths=[p for p in paths if p.startswith(('apps/backend/src/','apps/backend/extraction/','apps/backend/test/','packages/contracts/src/','packages/research-core/src/'))]
source_roots=['apps/backend/src','apps/backend/extraction','apps/backend/test','packages/contracts/src','packages/research-core/src']
subprocess.run(['git','diff','--quiet',implementation,'--',*source_roots],cwd=root,check=True)
if subprocess.check_output(['git','ls-files','--others','--exclude-standard','--',*source_roots],cwd=root,text=True).strip():
 raise RuntimeError('Unrecorded source files; refusing to bind evidence to a different tree')
files=[dict(path=p,sha256=hashlib.sha256((root/p).read_bytes()).hexdigest()) for p in paths]
(out/'SOURCE_FILES.json').write_text(json.dumps(dict(implementationCommit=implementation,files=files),indent=2)+'\n')
manifest=dict(task='V6-W01-W09-continuation',baseCommit=base,runtimeImplementationCommit=runtime_implementation,implementationCommit=implementation,environment=dict(node='20.20.2',pnpm='9.15.9',python='3.12.3',platform='Linux6.14.0-37-generic x86_64',postgres='local127.0.0.1:55432; retained isolated synthetic databases',extractionRuntime='/tmp/deep-v6-extraction-runtime'),paidCalls=0,actualSpendMicro=0,currentPaidAllowance='unknown; no current authorization',actualExternalUnknownOutcomes=0,syntheticUnknownHolds='Retained by injected failure tests; not actual external spend',semanticScores=None,humanAdjudication=None,milestoneComplete=False,results=results,unresolved=['Real-model usefulness/support/coverage/corrected-full agreement unproved','Official ESP32 exceeds current model context; no silent truncation','OCR and difficult layout remain partial/unavailable','Native HTML picker not implemented; no native run/build in this continuation','Broader native/accessibility and hosted identity/privacy/retention/release gates remain','First full PostgreSQL timeout retained; focused rerun passing is not a general performance fix'],rollback='Deny new HTML admission/evaluation; retain immutable v1-v4 readers and bytes, deletion, ownership/fences, publication gates, reconciliation and unknown holds')
(out/'RESULTS.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'terminal':sum(r['status']=='terminal' for r in results),'pending':[r['command'] for r in results if r['status']=='pending'],'implementationCommit':implementation}))
