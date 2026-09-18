// Read-only query-count/timing instrumentation for nonbillable tests; never records SQL values or text.
const { createRequire } = require('node:module');
const pg = createRequire(require('node:path').resolve(__dirname,'../../../apps/backend/package.json'))('pg');
const original=pg.Client.prototype.query;
const counts={all:0,policy:0};
pg.Client.prototype.query=function(...args){
 counts.all++;
 const text=typeof args[0]==='string'?args[0]:args[0]?.text;
 if(typeof text==='string'&&text.startsWith('SELECT model_policy_id FROM runs'))counts.policy++;
 return original.apply(this,args);
};
process.on('exit',()=>{if(counts.all)process.stderr.write(JSON.stringify({queryProfile:counts})+'\n');});
