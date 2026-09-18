import {expect,it} from "vitest";
import {extractOffline,ExtractedDocument} from "../src/adapters/extraction/offline.js";
const background='<p>This operational guide describes storage coordination, deployment requirements and system availability. Readers must distinguish current capabilities from withdrawn historical claims.</p>'.repeat(3);
for(const tag of ["s","del","strike"])for(const location of ["prose","list","table"])it(`W04 preserves ${tag} qualification in every emitted ${location} copy`,async()=>{
 const old="Distributed writes are supported.",current="Distributed writes are unavailable.";
 const inline=`<${tag}>${old}</${tag}> ${current}`;
 const content=location==="prose"?`<p>${inline}</p>`:location==="list"?`<ul><li>${inline}</li></ul>`:`<table><tr><th>Capability</th><th>Status</th></tr><tr><td>Distributed writes</td><td>${inline}</td></tr></table>`;
 const html=`<html><body><h1>Storage deployment</h1>${background}<h2>Current restrictions</h2><p>The following status replaces the previous claim.</p>${content}${background}</body></html>`;
 const result=await extractOffline(Buffer.from(html),"text/html");
 const matches=result.blocks.filter(b=>b.text.includes(old));expect(matches.length).toBeGreaterThan(0);
 for(const block of matches){expect(block.text).toContain(`[struck-through: ${old}]`);expect(block.text).toContain(current);expect(block.text.indexOf(old)).toBeLessThan(block.text.indexOf(current));}
 if(location==="table"){const table=matches.find(b=>b.kind==="table");expect(table).toBeDefined();expect(table!.rows.flat().find(c=>c.text.includes(old))!.text).toContain(`[struck-through: ${old}]`);}
 else expect(matches.some(b=>b.locator.startsWith("block:"))).toBe(true);
 expect(result.status).toBe("partial");expect(result.version).toBe("trafilatura-2.2.0/structure-v4");
 for(const version of ["trafilatura-2.2.0/structure-v1","trafilatura-2.2.0/structure-v2"])expect(ExtractedDocument.safeParse({...result,version}).success).toBe(true);
});

it("W04 marker-aware table normalization does not promote source comments",async()=>{
 const result=await extractOffline(Buffer.from(`<html><body>${background}<table><tr><td>Before<!-- Internal non-documentary sentinel --><s>Old value</s>After</td></tr></table></body></html>`),"text/html");
 const table=result.blocks.find(b=>b.kind==="table")!;expect(table).toBeDefined();expect(table.text).toContain("Before [struck-through: Old value] After");expect(table.text).not.toContain("Internal non-documentary sentinel");
});
it("W04 supplemental list omits comment content while retaining its following text",async()=>{
 const result=await extractOffline(Buffer.from(`<html><body>${background}<p>Current restrictions:</p><ul><li>Before<!-- Internal list-only sentinel -->After <s>Old rule</s> Current rule.</li></ul></body></html>`),"text/html");
 const list=result.blocks.find(b=>b.locator.startsWith("list:"))!;expect(list).toBeDefined();expect(list.text).not.toContain("Internal list-only sentinel");expect(list.text).toContain("BeforeAfter");expect(list.text).toContain("[struck-through: Old rule]");expect(list.text).toContain("Current rule.");
});
