import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export type PinnedResponse = { status: number; headers: Record<string, string>; bytes: Buffer };

/** Internal transport. Only ssrf.ts may supply public, policy-validated destinations. */
export function pinnedRequest(url: URL, address: { address: string; family: number }, signal: AbortSignal, maxBytes: number): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, {
      method: "GET", agent: false, signal, maxHeaderSize: 16_384, family: address.family,
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
      headers: { Accept: "text/html,text/plain,application/pdf", "Accept-Encoding": "identity" },
    }, (res) => {
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("response_incomplete")));
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(", ") : value;
      const chunks: Buffer[] = [];
      let size = 0;
      const fail = (message: string) => { const error = new Error(message); reject(error); res.destroy(error); req.destroy(error); };
      const remote = res.socket.remoteAddress?.replace(/^::ffff:/, "");
      if (remote !== address.address.replace(/^::ffff:/, "")) { fail("destination_mismatch"); return; }
      if (headers["content-encoding"] && headers["content-encoding"] !== "identity") { fail("unsupported_content_encoding"); return; }
      if (Number(headers["content-length"] ?? 0) > maxBytes) { fail("response_too_large"); return; }
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { fail("response_too_large"); return; }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers, bytes: Buffer.concat(chunks, size) }));
    });
    req.on("error", reject);
    req.end();
  });
}
