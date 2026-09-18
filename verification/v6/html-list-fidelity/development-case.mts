import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [clone,output]=process.argv.slice(2);
const {extractOffline}=await import(pathToFileURL(`${clone}/apps/backend/src/adapters/extraction/offline.ts`).href);
const path='/home/oranolio/Desktop/Deep/verification/v6/matched-corpus/raw/sqlite-wal.html',bytes=await readFile(path);
const result=await extractOffline(bytes,'text/html'),text=result.blocks.map((b:{text:string})=>b.text).join('\n');
const receipt={case:'MC-D01 development only',rawSha256:createHash('sha256').update(bytes).digest('hex'),version:result.version,status:result.status,warnings:result.warnings,blockCount:result.blocks.length,decisiveRestrictionPreserved:text.includes('WAL does not work over a network filesystem.'),singleWriterPreserved:text.includes('there can only be one writer at a time.'),restrictionLocators:result.blocks.filter((b:{text:string})=>b.text.includes('WAL does not work over a network filesystem.')).map((b:{locator:string})=>b.locator),scope:'Actual isolated parser on frozen development bytes. No heldout/model/DB/network. Frozen gold and historical failure untouched.'};
await writeFile(output,JSON.stringify({receipt,result},null,2)+'\n');console.log(JSON.stringify(receipt));
