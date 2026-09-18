// Own-project storage metadata only. Never returns credentials or saved content.
const WebSocket = require('ws');
const mode = process.argv[2];
if (!['observe', 'cleanup'].includes(mode)) throw new Error('Use observe or cleanup');
const expectedAccount = '1617411b-d6bd-4aeb-98b4-9f0ebb5197e3';
(async () => {
  const targets = await (await fetch('http://127.0.0.1:8081/json/list')).json();
  if (targets.length !== 1 || !targets[0].title.startsWith('host.exp.exponent')) throw new Error('Expected one own Expo runtime');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let id = 0;
  function evaluate(expression) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { ws.off('message', receive); reject(new Error('Native response deadline')); }, 10000);
      function receive(buffer) {
        const response = JSON.parse(buffer);
        if (response.id !== requestId) return;
        clearTimeout(timer); ws.off('message', receive);
        if (response.error || response.result?.exceptionDetails) reject(new Error('Own-project evaluation failed'));
        else resolve(response.result?.result?.value);
      }
      ws.on('message', receive);
      ws.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
  }
  try {
    // Hermes inspector expressions use Promise chains, never async function syntax.
    await evaluate(`(function(){
      var entries=Array.from(__r.getModules().entries());
      function find(name){var entry=entries.find(function(item){return item[1].verboseName===name;});if(!entry)throw Error('Project module absent');return __r(entry[0]);}
      if(find('src/api.ts').backendUrl!=='http://127.0.0.1:8787')throw Error('Wrong project backend');
      var storage=find('src/native-session.ts').sessionStorage;
      var attempted=false;
      function summary(value){var s=value.state;return {mode:${JSON.stringify(mode)},cleanupAttempted:attempted,accountId:value.accountId||null,hasToken:Boolean(value.token),hasAccount:Boolean(value.accountId),hasReport:Boolean(s.report),hasPreviousReport:Boolean(s.previousReport),hasRun:Boolean(s.run),hasPendingAdmission:Boolean(s.pendingAdmission),hasPendingVerification:Boolean(s.pendingVerification),hasPendingSourceDeletion:Boolean(s.pendingSourceDeletion),hasPendingContentInvalidation:Boolean(s.pendingContentInvalidation),hasDraft:Boolean(s.draft),hasCorrectionDraft:Boolean(s.correctionDraft)};}
      globalThis.__deepPhysicalStorageResult=null;
      Promise.resolve().then(function(){
        if(${JSON.stringify(mode)}!=='cleanup')return storage.hydrate();
        var entry=entries.find(function(item){return /expo-secure-store.*[\\/]build[\\/]SecureStore.js$/.test(item[1].verboseName||'');});
        if(!entry)throw Error('Secure storage module absent');
        var secure=__r(entry[0]);
        return secure.getItemAsync('deep.session.v2',{keychainService:'deep.research.session.v2',keychainAccessible:secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY}).then(function(raw){
          if(!raw||JSON.parse(raw).accountId!==${JSON.stringify(expectedAccount)})return storage.hydrate();
          attempted=true;
          return storage.clear().then(function(){return storage.hydrate();});
        });
      }).then(function(value){globalThis.__deepPhysicalStorageResult={ok:true,value:summary(value)};},function(){globalThis.__deepPhysicalStorageResult={ok:false,cleanupAttempted:attempted,cleanupConfirmed:false};});
      return 'started';
    })()`);
    let result;
    for (let i = 0; i < 100; i++) {
      result = await evaluate('globalThis.__deepPhysicalStorageResult');
      if (result) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!result) throw new Error('Native storage operation deadline');
    console.log(JSON.stringify(result, null, 2));
    await evaluate('delete globalThis.__deepPhysicalStorageResult');
    if (!result.ok) process.exitCode = 1;
  } finally { ws.close(); }
})().catch(() => { console.error('Own-project storage probe unavailable'); process.exitCode = 1; });
