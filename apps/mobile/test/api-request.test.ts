import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { api } from "../src/api";
const token="synthetic-api-header-control";
beforeEach(()=>api.activateSession(token));
afterEach(()=>{vi.unstubAllGlobals();api.activateSession(null);});
it("sends authenticated bodyless DELETE without advertising empty JSON",async()=>{
 const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const headers=new Headers(init?.headers);
  if(init?.body==null&&headers.get("content-type")==="application/json")return new Response(JSON.stringify({message:"Body cannot be empty when content-type is set to application/json"}),{status:400});
  return new Response(JSON.stringify({deleted:true}),{status:200});
 });vi.stubGlobal("fetch",transport);
 await expect(api.deleteSource(token,"owned-source")).resolves.toEqual({deleted:true});
 const [url,init]=transport.mock.calls[0]!;expect(String(url)).toMatch(/\/v1\/sources\/owned-source$/);expect(init?.method).toBe("DELETE");expect(init?.body).toBeUndefined();expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);expect(new Headers(init?.headers).has("content-type")).toBe(false);
});
it("bodyless authenticated reads omit JSON headers while JSON POST bodies retain them",async()=>{
 const transport=vi.fn(async(_url:unknown,_init?:RequestInit)=>new Response("{}",{status:200}));vi.stubGlobal("fetch",transport);
 await api.settings(token);await api.consent(token,true);await api.deleteAccount(token);
 const calls=transport.mock.calls.map(c=>c[1]!);
 expect(new Headers(calls[0]!.headers).has("content-type")).toBe(false);
 expect(calls[1]!.body).toBe(JSON.stringify({grant:true}));expect(calls[2]!.body).toBe("{}");
 for(const init of calls.slice(1)){expect(init.method).toBe("POST");expect(new Headers(init.headers).get("content-type")).toBe("application/json");expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);}
});
it("binary uploads preserve bytes, explicit content type and idempotency identity",async()=>{
 const transport=vi.fn(async(_url:unknown,_init?:RequestInit)=>new Response("{}",{status:200}));vi.stubGlobal("fetch",transport);
 await api.attachBytes(token,"synthetic.pdf","application/pdf",new Uint8Array([0,128,255]),"upload-key");
 const init=transport.mock.calls[0]![1]!,headers=new Headers(init.headers);expect(headers.get("content-type")).toBe("application/octet-stream");expect(headers.get("authorization")).toBe(`Bearer ${token}`);expect(headers.get("idempotency-key")).toBe("upload-key");expect([...new Uint8Array(init.body as ArrayBuffer)]).toEqual([0,128,255]);
});
