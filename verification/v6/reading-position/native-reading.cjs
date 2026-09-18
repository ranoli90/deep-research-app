// Offline native cache control only: synthetic non-credential session, no API account or provider.
const WebSocket=require('ws');
(async()=>{
 const targets=await(await fetch('http://127.0.0.1:8081/json/list')).json();
 if(targets.length!==1||!targets[0].title.startsWith('host.exp.exponent'))throw Error('Expected own Expo target');
 const ws=new WebSocket(targets[0].webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.once('open',ok);ws.once('error',no)});let id=0;
 function evaluate(expression){return new Promise((ok,no)=>{const n=++id,t=setTimeout(()=>{ws.off('message',read);no(Error('Native deadline'))},10000);function read(b){const r=JSON.parse(b);if(r.id!==n)return;clearTimeout(t);ws.off('message',read);if(r.result?.exceptionDetails)no(Error('Native expression failed'));else ok(r.result?.result?.value)}ws.on('message',read);ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,returnByValue:true}}))})}
 try{
 const find="const find=n=>{const m=Array.from(__r.getModules().entries()).find(x=>x[1].verboseName===n);if(!m)throw Error('Module absent');return __r(m[0]);};const storage=find('src/native-session.ts').sessionStorage;";
 let action;
 if(process.argv[2]==='seed')action=`const session={accountId:'offline-reading-control',token:'synthetic-not-an-api-credential'};const state=find('src/state.ts').emptyState();state.signedIn=true;state.status='completed';state.report={reportId:'offline-reading-version-1',labeledDemo:true,limitations:['Synthetic cached reader control. No research was executed.'],blocks:Array.from({length:12},(_,i)=>({id:'section-'+i,kind:'answer',text:'READING SECTION '+i+'\\n'+('Synthetic paragraph '+i+' tests saved reading continuity. ').repeat(8),claimIds:[],citationIds:[]}))};state.readingAnchor={reportId:state.report.reportId,blockId:'section-6',offset:20};storage.activate(session).then(()=>storage.persist({token:session.token,state})).then(()=>storage.flush()).then(()=>({seeded:true,blocks:12,anchor:state.readingAnchor}));`;
 else if(process.argv[2]==='observe')action="storage.flush().then(()=>storage.hydrate()).then(s=>({hasSession:Boolean(s.token),reportId:s.state.report?.reportId??null,anchor:s.state.readingAnchor,draftLength:s.state.draft.length}));";
 else if(process.argv[2]==='cleanup')action="storage.clear().then(()=>storage.hydrate()).then(s=>({hasSession:Boolean(s.token),hasReport:Boolean(s.state.report),hasPending:Boolean(s.state.pendingAdmission),draftLength:s.state.draft.length}));";
 else throw Error('Use seed, observe or cleanup');
 const split=action.indexOf('storage.'); // Wrap final promise chain while keeping setup declarations.
 const prefix=action.slice(0,split),promise=action.slice(split).replace(/;$/,'');
 await evaluate(`(()=>{${find}globalThis.__deepReadingResult=null;${prefix}${promise}.then(v=>globalThis.__deepReadingResult={ok:true,value:v},()=>globalThis.__deepReadingResult={ok:false});return 'started';})()`);
 let result;for(let n=0;n<100;n++){result=await evaluate('globalThis.__deepReadingResult');if(result)break;await new Promise(r=>setTimeout(r,100))}
 if(!result?.ok)throw Error('Native storage operation failed');console.log(JSON.stringify(result.value,null,2));await evaluate('delete globalThis.__deepReadingResult');
 }finally{ws.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
