import { expect,it } from "vitest";
import { extractOffline,ExtractedDocument } from "../src/adapters/extraction/offline.js";
const background=Array.from({length:2},(_,i)=>`<p>Section ${i} describes how processing is coordinated through shared memory, with persistent state transitions and careful synchronization between readers and writers. The deployment configuration must satisfy documented operational requirements.</p>`).join("");
function guide(list:string,extra=""){return Buffer.from(`<html><body><h1>Operational guide</h1>${extra}<p>Deployment restrictions apply to the following cases:</p>${list}<h2>Background</h2>${background}</body></html>`);}
for(const tag of ["ol","ul"])it(`W04 preserves generic ${tag} restrictions omitted by main-content heuristics`,async()=>{
 const result=await extractOffline(guide(`<${tag}><li>All nodes must share the same host; remote storage is unsupported.</li><li>Atomic changes apply within each database, not across databases.</li></${tag}>`),"text/html");
 const text=result.blocks.map(b=>b.text).join("\n");expect(text).toContain("remote storage is unsupported");expect(text).toContain("not across databases");
 expect(result.status).toBe("partial");expect(result.version).toBe("trafilatura-2.2.0/structure-v3");
 const list=result.blocks.find(b=>b.locator.startsWith("list:"));expect(list?.text).toContain("Deployment restrictions apply");
 expect(list!.text.indexOf("remote storage")).toBeLessThan(list!.text.indexOf("Atomic changes"));
});
it("W04 supplemental list excludes navigation/aside and retains nested order plus struck-through qualification",async()=>{
 const result=await extractOffline(guide('<ol start="3"><li>Rule before nesting<ul><li>Only for annual plans.</li></ul>Rule after nesting.</li><li><s>Old unavailable rule.</s> New availability starts in version 7.</li></ol>','<nav><ol><li>Navigation private diagnostic sentinel</li></ol></nav><aside><ul><li>Unrelated sidebar sentinel</li></ul></aside><div class="menu"><ul><li>Menu sentinel</li></ul></div>'),"text/html");
 const list=result.blocks.find(b=>b.locator.startsWith("list:"))!;expect(list.text).toContain("source start=3");expect(list.text).toContain("[struck-through: Old unavailable rule.]");
 expect(list.text.indexOf("Rule before nesting")).toBeLessThan(list.text.indexOf("Only for annual plans"));expect(list.text.indexOf("Only for annual plans")).toBeLessThan(list.text.indexOf("Rule after nesting"));
 expect(result.blocks.filter(b=>b.locator.startsWith("list:")).map(b=>b.text).join("\n")).not.toMatch(/Navigation private|Unrelated sidebar|Menu sentinel/);
});
it("W04 whole lists already retained by main extraction are not duplicated as supplements",async()=>{
 const bytes=Buffer.from('<html><body><h1>Operational guide</h1><p>This guide describes deployment limits and operational behavior for a general processing system.</p><ol><li>Restriction alpha applies only to local storage.</li><li>Restriction beta requires an annual plan.</li></ol></body></html>');
 const result=await extractOffline(bytes,"text/html");expect(result.blocks.map(b=>b.text).join("\n").match(/Restriction alpha/g)).toHaveLength(1);
});
it("W04 bounded list supplementation labels omissions and keeps old extractor versions readable",async()=>{
 const result=await extractOffline(guide(`<ol><li><s>Deprecated restriction.</s> Current replacement follows.</li>${Array.from({length:1100},(_,i)=>`<li>Distinct restriction ${i} must remain a scoped limitation.</li>`).join("")}</ol>`),"text/html");
 expect(result.status).toBe("partial");expect(result.warnings).toContain("supplemental_list_limit_reached");
 expect(result.blocks.filter(b=>b.locator.startsWith("list:")).map(b=>b.text).join("\n").length).toBeLessThanOrEqual(250000);
 for(const version of ["trafilatura-2.2.0/structure-v1","trafilatura-2.2.0/structure-v2"])expect(ExtractedDocument.safeParse({...result,version}).success).toBe(true);
});
