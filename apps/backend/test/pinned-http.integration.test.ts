import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pinnedRequest } from "../src/platform/pinned-http.js";

let server: Server;
let port: number;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/large") { res.writeHead(200); res.write(Buffer.alloc(4096)); res.end(Buffer.alloc(4096)); }
    else if (req.url === "/slow") { res.writeHead(200); res.write("start"); }
    else { res.writeHead(404, { "content-type": "text/plain" }); res.end("missing"); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

describe("W02 bounded pinned transport, controlled local endpoint only", () => {
  // Direct transport test deliberately bypasses the public-URL policy for this owned server.
  // Production safeFetch never accepts this local destination or test port.
  const address = { address: "127.0.0.1", family: 4 };
  it("connects to the supplied address while preserving hostname and HTTP status", async () => {
    const result = await pinnedRequest(new URL(`http://unresolvable.invalid:${port}/missing`), address, AbortSignal.timeout(1000), 100);
    expect(result.status).toBe(404);
    expect(result.bytes.toString()).toBe("missing");
  });
  it("aborts oversized streamed bodies without a content-length header", async () => {
    await expect(pinnedRequest(new URL(`http://unresolvable.invalid:${port}/large`), address, AbortSignal.timeout(1000), 1024)).rejects.toThrow("response_too_large");
  });
  it("aborts a body which never finishes within the total deadline", async () => {
    await expect(pinnedRequest(new URL(`http://unresolvable.invalid:${port}/slow`), address, AbortSignal.timeout(50), 1024)).rejects.toMatchObject({ name: "AbortError" });
  });
});
