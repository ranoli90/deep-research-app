import{createRequire}from'node:module';
const{Pool}=createRequire(process.cwd()+'/apps/backend/package.json')('pg');
const p=new Pool({connectionString:'postgres://deep:deep_local_dev_only@127.0.0.1:55432/postgres'});
const name='deep_research_continuation_20260918';
try{if((await p.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)throw Error('Expected a new database; refusing reuse');await p.query('CREATE DATABASE '+name);console.log(JSON.stringify({created:name,retained:true,standardAndNativeDatabasesUntouched:true}));}finally{await p.end()}
