"""One-use launch of the already-authorized $0.40 registered comparison; no retries."""
import hashlib,json,os,pathlib,subprocess,datetime
root=pathlib.Path(__file__).resolve().parents[3];out=pathlib.Path(__file__).resolve().parent
if subprocess.check_output(['git','status','--porcelain','--','apps/backend/src','apps/backend/migrations','packages'],cwd=root,text=True).strip():raise SystemExit('Commit runtime before paid evaluation')
raw=(out/'AUTHORIZATION.json').read_bytes();grant=json.loads(raw)
if grant['budgetMicro']!=400000 or grant['taskIds']!=['MC-D03'] or grant['sourceMode']!='frozen_supplied_document':raise SystemExit('Unexpected registered scope')
env=os.environ.copy();env.update(json.loads(pathlib.Path('/tmp/deep-paid-evaluation-env.json').read_text()))
command=['pnpm','eval:live','--execute','--operator-confirms-user-approval','--authorization',str(out/'AUTHORIZATION.json'),'--sha256',hashlib.sha256(raw).hexdigest(),'--approval-id',grant['approvalId'],'--output',str(out/'live')]
receipt={'command':command,'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Real OpenRouter model, frozen public Python documentation bytes, production API/worker/parser/checker/writer; $0.40 aggregate allowance including all previous confirmed spend and unknown reserves','environment':{'node':subprocess.check_output(['node','--version'],text=True).strip(),'pnpm':subprocess.check_output(['pnpm','--version'],text=True).strip(),'platform':'Linux local PostgreSQL'}}
with (out/'paid-launch.txt').open('x') as log:
 result=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
receipt.update(exitCode=result.returncode,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
(out/'EXECUTION.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2));raise SystemExit(result.returncode)
