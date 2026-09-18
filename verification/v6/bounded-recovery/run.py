"""Registered nonbillable verification; one terminal receipt per actual command."""
import datetime, hashlib, json, os, pathlib, platform, re, subprocess, sys, time
ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = pathlib.Path(__file__).resolve().parent
DATABASE = "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_continuation_20260918"
CHOICES = {
    "integration": (["pnpm", "test:integration"], {"TEST_DATABASE_URL": DATABASE, "EVIDENCE_SELECTION_TRACE_PATH": "/tmp/deep-recovery-correction-final.json", "EMPTY_RECOVERY_TRACE_PATH":"/tmp/deep-recovery-journey-final.json"}),
    "extraction": (["pnpm", "--filter", "@deep/backend", "test:extraction"], {"TEST_DATABASE_URL": DATABASE.replace("deep_research_continuation_20260918", "deep_research_selection_extraction_20260918"), "EXTRACTION_RUNTIME": "/tmp/deep-v6-extraction-runtime", "EVAL_RUNNER_ARTIFACT_DIR": str(OUT / "extraction-traces")}),
    "verify": (["pnpm", "verify"], {}),
    "review": (["python3", "scripts/validate_review.py"], {}),
    "handoff": (["python3", "scripts/validate_builder_handoff.py"], {}),
    "review-mutations": (["python3", "-m", "unittest", "discover", "-s", "scripts", "-p", "test_review_validator.py", "-v"], {}),
    "handoff-mutations": (["python3", "-m", "unittest", "discover", "-s", "scripts", "-p", "test_builder_handoff.py", "-v"], {}),
}
name=sys.argv[1]
command, settings=CHOICES[name]
label=sys.argv[2] if len(sys.argv)>2 else name
if not re.fullmatch(r"[a-z0-9-]+",label): raise SystemExit("Invalid artifact label")
if name=="extraction" and label!=name: settings={**settings,"EVAL_RUNNER_ARTIFACT_DIR":str(OUT / (label+"-traces"))}
receipt=OUT / (label+".receipt.json")
if receipt.exists(): raise SystemExit("Refusing to overwrite an existing receipt")
if subprocess.run(["git", "diff", "--quiet", "HEAD", "--", "apps", "packages"],cwd=ROOT).returncode: raise SystemExit("Commit runtime/test changes before recording final evidence")
revision=subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()
start=datetime.datetime.now(datetime.timezone.utc).isoformat(); t=time.monotonic()
log=OUT / (label+".log")
with log.open("xb") as output:
    result=subprocess.run(command,cwd=ROOT,env={**os.environ,**settings},stdout=output,stderr=subprocess.STDOUT)
record={"requirementIds":["W01","W02","W03","W04","W05","W06","W08","W09"],"commit":revision,"command":command,"environmentOverrides":settings,"environment":{"platform":platform.platform(),"python":platform.python_version(),"node":subprocess.check_output(["node","--version"],text=True).strip(),"pnpm":subprocess.check_output(["pnpm","--version"],text=True).strip()},"startedAt":start,"finishedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"elapsedSeconds":round(time.monotonic()-t,3),"exitCode":result.returncode,"artifact":str(log.relative_to(ROOT)),"artifactSha256":hashlib.sha256(log.read_bytes()).hexdigest(),"paidCostMicro":0,"scope":"nonbillable local execution; model transports fabricated where used; native/hosted/live semantic evidence excluded"}
receipt.write_text(json.dumps(record,indent=2)+"\n")
print(json.dumps(record,indent=2));raise SystemExit(result.returncode)
