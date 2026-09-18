// Own-project synthetic setup only. Credentials remain in process memory and SecureStore; never print them.
const fs = require('node:fs'), crypto = require('node:crypto'), WebSocket = require('ws');
const base = 'http://127.0.0.1:8787';
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let token;
  async function request(path, method = 'GET', body, extra = {}) {
    const response = await fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...extra }, body });
    if (!response.ok) throw new Error(`Local setup ${method} ${path.split('/').slice(0,3).join('/')} status ${response.status}`);
    return response.json();
  }
  const session = await request('/v1/dev/session', 'POST', '{}'); token = session.token;
  const consent = await request('/v1/consent', 'POST', JSON.stringify({ grant: true }));
  const bytes = fs.readFileSync('apps/backend/test/fixtures/documents/digital-scoped.pdf');
  const upload = await request('/v1/attachments/bytes', 'POST', bytes, { 'content-type': 'application/octet-stream', 'x-document-mime': 'application/pdf', 'x-file-name': 'DraftRecoveryControl.pdf' });
  const question = 'What does the Ardent field note say about underwater recording?';
  const journal = {version:'admission.v1',key:crypto.randomUUID(),question,routeMode:'controlled-research',uploads:[{key:crypto.randomUUID(),filename:'DraftRecoveryControl.pdf',mime:'application/pdf',kind:'bytes',digest:crypto.createHash('sha256').update(bytes).digest('hex'),attachmentId:upload.attachmentId}]};
  const targets = await (await fetch('http://127.0.0.1:8081/json/list')).json();
  if (targets.length !== 1 || !targets[0].title.startsWith('host.exp.exponent')) throw new Error('Expected one own-project Expo target');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let id = 0;
  function evaluate(expression) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.off('message', handler); reject(new Error('Native setup response deadline')); }, 10000);
      function handler(buffer) { const r = JSON.parse(buffer); if (r.id !== requestId) return; clearTimeout(timer); ws.off('message', handler); if (r.result?.exceptionDetails) reject(new Error('Native setup expression failed')); else resolve(r.result?.result?.value); }
      ws.on('message', handler); ws.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
  }
  try {
    const expression = `(()=>{const find=n=>{const p=Array.from(__r.getModules().entries()).find(x=>x[1].verboseName===n);if(!p)throw Error('Project module absent');return __r(p[0]);};const storage=find('src/native-session.ts').sessionStorage;globalThis.__deepDraftSetup=null;const session=${JSON.stringify({ accountId: session.accountId, token })};const state=Object.assign(find('src/state.ts').emptyState(),${JSON.stringify({ signedIn: true, consentGranted: true, routeMode: 'controlled-research', status: 'empty', draft: question })});storage.activate(session).then(()=>storage.persist({token:session.token,state})).then(()=>storage.flush()).then(()=>storage.saveAdmission(session.token,${JSON.stringify(journal)})).then(()=>{globalThis.__deepDraftSetup={ready:true};},()=>{globalThis.__deepDraftSetup={ready:false};});return 'started';})()`;
    await evaluate(expression);
    let outcome;
    for (let i = 0; i < 100; i++) { outcome = await evaluate('globalThis.__deepDraftSetup'); if (outcome !== null && outcome !== undefined) break; await delay(100); }
    if (!outcome?.ready) throw new Error('Protected native setup did not complete');
    await evaluate('delete globalThis.__deepDraftSetup');
    console.log(JSON.stringify({ evidenceClass: 'programmatic_owned_session_upload_setup_for_native_admission_retry', accountId:session.accountId, admissionKey:journal.key, attachmentId:upload.attachmentId, inputBytes: bytes.length, inputSha256: crypto.createHash('sha256').update(bytes).digest('hex'), actualParser: false, modelTransport: 'fabricated', paidCalls: 0, nativeSignInAndUploadRepeated: false }, null, 2));
  } finally { ws.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
