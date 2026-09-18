"""Read-only project-key quota metadata; never sends a generation or stores credentials."""
import datetime,json,math,pathlib,re,subprocess,urllib.request,urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).resolve().parent
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): return None
values={}
for line in (ROOT/'.env').read_text().splitlines():
 line=line.strip()
 if line and not line.startswith('#') and '=' in line:
  name,value=line.split('=',1);values[name.strip()]=value.strip().strip('\"').strip("'")
key=values.get('OPENROUTER_API_KEY','')
result={'requirementIds':['W08'],'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'command':'python3 verification/v6/bounded-recovery/read-project-key.py','checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'endpoint':'GET https://openrouter.ai/api/v1/key','documentation':'https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key','credentialSource':'project .env, value omitted','generationRequests':0,'paidCostMicro':0,'authorizationGranted':False,'remainingUserApprovedAllowance':None,'scope':'Read-only current project-key metadata; provider key capacity does not grant user monetary authority.'}
try:
 if not re.fullmatch(r'sk-or-v1-[A-Za-z0-9_-]{20,}',key):raise ValueError('credential unavailable')
 request=urllib.request.Request('https://openrouter.ai/api/v1/key',headers={'Authorization':'Bearer '+key,'Accept':'application/json'},method='GET')
 with urllib.request.build_opener(NoRedirect()).open(request,timeout=15) as response:
  result['httpStatus']=response.status;raw=response.read(65537)
 if len(raw)>65536:raise ValueError('oversized metadata')
 data=json.loads(raw)['data'];filtered={}
 for name in ['limit','limit_remaining','usage','usage_daily','usage_monthly']:
  value=data.get(name)
  if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0):raise ValueError('invalid metadata')
  filtered[name]=value
 result['keyQuotaUSD']=filtered;result['status']='metadata_received';result['exitCode']=0
except urllib.error.HTTPError as error:
 result['httpStatus']=error.code;result['status']='metadata_unavailable';result['exitCode']=1
except Exception:
 result['status']='metadata_unavailable';result['exitCode']=1
path=OUT/'PROJECT_KEY_READINESS.json'
if path.exists():raise SystemExit('Refusing to overwrite key readiness evidence')
path.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));raise SystemExit(result['exitCode'])
