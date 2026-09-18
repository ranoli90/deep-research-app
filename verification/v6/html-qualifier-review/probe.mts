import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {extractOffline} from '../../../apps/backend/src/adapters/extraction/offline.ts';
const background='<p>This operational guide describes storage coordination, deployment requirements and system availability. Readers must distinguish current capabilities from withdrawn historical claims.</p>'.repeat(3);
const cases=[['list','<ul><li><s>Distributed writes are supported.</s> Distributed writes are unavailable.</li></ul>'],['prose','<p><s>Distributed writes are supported.</s> Distributed writes are unavailable.</p>'],['table','<table><tr><th>Capability</th><th>Status</th></tr><tr><td>Distributed writes</td><td><s>Supported for all plans.</s> Unavailable on current plans.</td></tr></table>']];
const out=[];
for(const [name,content] of cases){const html=`<html><body><h1>Storage deployment</h1>${background}<h2>Current restrictions</h2><p>The following status replaces the previous claim.</p>${content}${background}</body></html>`;writeFileSync(new URL(`./${name}.html`,import.meta.url),html);const result=await extractOffline(Buffer.from(html),'text/html');out.push({case:name,inputSha256:createHash('sha256').update(html).digest('hex'),result});}
writeFileSync(new URL('./outputs.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out.map(x=>({case:x.case,status:x.result.status,version:x.result.version,matching:x.result.blocks.filter(b=>/Distributed writes|Supported for all plans/.test(b.text)).map(b=>({locator:b.locator,text:b.text,rows:b.rows}))})),null,2));
