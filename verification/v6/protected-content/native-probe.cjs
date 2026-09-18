const WebSocket=require('ws');
(async()=>{
 const targets=await(await fetch('http://127.0.0.1:8081/json/list')).json();
 if(targets.length!==1||!targets[0].title.startsWith('host.exp.exponent'))throw Error('Unexpected inspector target');
 const expression=process.argv[2];if(!expression)throw Error('Missing own-project inspection expression');
 const ws=new WebSocket(targets[0].webSocketDebuggerUrl);
 const timer=setTimeout(()=>{ws.close();process.exitCode=1;},10000);
 ws.on('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})));
 ws.on('message',buffer=>{const r=JSON.parse(buffer);if(r.id===1){console.log(JSON.stringify(r.result));if(r.result?.exceptionDetails)process.exitCode=1;clearTimeout(timer);ws.close();}});
})().catch(()=>{console.error('Own-project native inspection unavailable');process.exitCode=1;});
