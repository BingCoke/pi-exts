import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ServerAuth } from "../../packages/mcp-adapter/src/auth.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  let origin = ""; let issued = 0; let challenge = "";
  const grants: string[] = [];
  const json = (res: ServerResponse, data: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, origin);
    let body = ""; for await (const chunk of req) body += String(chunk);
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") { json(res, { resource: `${origin}/mcp`, authorization_servers: [origin] }); return; }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      json(res, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] }); return;
    }
    if (url.pathname === "/register") { json(res, { ...JSON.parse(body), client_id: "fixture-client" }, 201); return; }
    if (url.pathname === "/authorize") {
      challenge = url.searchParams.get("code_challenge")!;
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", "fixture-code"); redirect.searchParams.set("state", url.searchParams.get("state")!);
      res.writeHead(302, { location: redirect.href }).end(); return;
    }
    if (url.pathname === "/token") {
      const params = new URLSearchParams(body); const grant = params.get("grant_type")!; grants.push(grant);
      if (grant === "authorization_code" && createHash("sha256").update(params.get("code_verifier")!).digest("base64url") !== challenge) { json(res, { error: "invalid_grant" }, 400); return; }
      issued++;
      json(res, { access_token: `access-${issued}`, refresh_token: `refresh-${issued}`, token_type: "Bearer", expires_in: 3600 }); return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No TCP address");
  origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const directory = await mkdtemp(join(tmpdir(), "pi-adapter-oauth-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const entry = { name: "test", config: { url: `${origin}/mcp` }, source: "test" };
  const auth = new ServerAuth(directory, entry);
  cleanups.push(() => auth.close());
  return { auth, directory, entry, origin, grants };
}

describe("MCP adapter OAuth", () => {
  it("performs DCR/PKCE sign-in, persists tokens, and serializes refreshes across auth instances", async () => {
    const { auth, directory, entry, origin, grants } = await fixture();
    let authorization!: (url: string) => void;
    const url = new Promise<string>((resolve) => { authorization = resolve; });
    // The UI is the human boundary; all protocol and storage behavior below is real.
    const ctx = { ui: { notify: (message: string) => authorization(message.split("\n")[1]) } } as ExtensionCommandContext;
    const login = auth.login(ctx);
    const authorizationUrl = await url;
    const browser = await fetch(authorizationUrl);
    expect(browser.ok).toBe(true);
    await login;
    const provider = auth.authProvider({} as ExtensionContext)!;
    expect(await provider.token()).toBe("access-1");
    const second = new ServerAuth(directory, entry);
    cleanups.push(() => second.close());
    const secondProvider = second.authProvider({} as ExtensionContext)!;
    const rejected = { response: new Response(null, { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` } }), serverUrl: new URL(entry.config.url), fetch: globalThis.fetch, token: "access-1" };
    await Promise.all([provider.onUnauthorized!(rejected), secondProvider.onUnauthorized!(rejected)]);
    expect(grants).toEqual(["authorization_code", "refresh_token"]);
    expect(await secondProvider.token()).toBe("access-2");
    const files = await readdir(join(directory, "mcp-adapter-auth"));
    expect(files).toHaveLength(1);
    if (process.platform !== "win32") expect((await stat(join(directory, "mcp-adapter-auth", files[0]))).mode & 0o777).toBe(0o600);
    await auth.logout();
    expect(await secondProvider.token()).toBeUndefined();
  });
});
