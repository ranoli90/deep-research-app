import {expect,it} from "vitest";
import {MAX_FETCH_BYTES} from "@deep/contracts";
import {validateAttachmentBytes} from "../src/modules/attachments.js";

it("accepts saved UTF-8 HTML as bytes, without declaring extraction success",()=>{
 const bytes=Buffer.from('<!doctype html><html><body><p>Only on firmware 4.2.</p></body></html>');
 expect(()=>validateAttachmentBytes(bytes,"text/html","saved.html")).not.toThrow();
});
it("keeps saved HTML within the existing parser byte boundary",()=>{
 expect(()=>validateAttachmentBytes(Buffer.alloc(MAX_FETCH_BYTES,32),"text/html","saved.html")).not.toThrow();
 expect(()=>validateAttachmentBytes(Buffer.alloc(MAX_FETCH_BYTES+1,32),"text/html","saved.html")).toThrow("invalid_attachment_size");
});
it.each([Buffer.from([0xff]),Buffer.from("%PDF-1.4"),Buffer.from("<html>\u0000</html>")])("rejects non-UTF8, binary and PDF bytes labeled HTML",bytes=>{
 expect(()=>validateAttachmentBytes(bytes,"text/html","saved.html")).toThrow();
});
it("continues rejecting unsupported executable and XML document classes",()=>{
 for(const mime of ["application/javascript","application/xml","application/xhtml+xml"])
  expect(()=>validateAttachmentBytes(Buffer.from("<html/>"),mime,"saved.html")).toThrow("unsupported_attachment_mime");
});
