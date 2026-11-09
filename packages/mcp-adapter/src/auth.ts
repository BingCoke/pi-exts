import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionCommandContext, ExtensionContext, McpServerEntry } from "@earendil-works/pi-coding-agent";
import {
  adaptOAuthProvider, authorizeMcp, McpOAuthProvider, OAuthCallbackServer,
  type McpOAuthState, type McpOAuthStateStore,
} from "@earendil-works/pi-mcp/oauth";
import type { AuthProvider } from "@earendil-works/pi-mcp";
import lockfile from "proper-lockfile";
import { resolveConfigValue } from "./config.js";

/** Each server/URL has its own credential file and refresh lock, including across Pi processes. */
export class ServerAuth {
  private readonly path: string;
  private readonly directory: string;
  private readonly entry: McpServerEntry;
  private readonly store: McpOAuthStateStore;
  private callback: OAuthCallbackServer | undefined;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(agentDir: string, entry: McpServerEntry) {
    this.entry = entry;
    this.directory = join(agentDir, "mcp-adapter-auth");
    const url = "url" in entry.config ? new URL(entry.config.url).href : "";
    this.path = join(this.directory, `${createHash("sha256").update(`${entry.name}|${url}`).digest("hex")}.json`);
    this.store = {
      load: async () => {
        try { return JSON.parse(await readFile(this.path, "utf8")) as McpOAuthState; }
        catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
          throw error;
        }
      },
      save: async (state) => {
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
          await rename(temporary, this.path);
        } finally { await rm(temporary, { force: true }); }
      },
    };
  }

  private async locked<T>(run: () => Promise<T>): Promise<T> {
    const operation = this.withLock(run);
    this.pending.add(operation);
    try { return await operation; } finally { this.pending.delete(operation); }
  }

  private async withLock<T>(run: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.path, {
      realpath: false, stale: 20_000,
      retries: { retries: 250, minTimeout: 100, maxTimeout: 100, factor: 1 },
    });
    try { return await run(); } finally { await release(); }
  }

  private provider(redirectUrl: string, onRedirect: (url: URL) => void) {
    const config = this.entry.config;
    if (!("url" in config)) throw new Error("OAuth requires an HTTP server");
    const settings = config.oauth;
    return new McpOAuthProvider({
      serverUrl: config.url, redirectUrl, store: this.store,
      clientMetadata: { client_name: settings?.clientName ?? "pi-mcp-adapter" },
      clientId: settings?.clientId,
      clientSecret: settings?.clientSecret === undefined ? undefined : resolveConfigValue(settings.clientSecret),
      clientMetadataDocument: settings?.clientRegistration !== "dcr" && !settings?.clientId && !settings?.clientName ? (metadata) => {
        if (!metadata?.client_id_metadata_document_supported || !metadata.token_endpoint_auth_methods_supported?.includes("none")) {
          if (settings?.clientRegistration === "cimd") throw new Error("Authorization server does not support Client ID Metadata Documents");
          return undefined;
        }
        const redirect = new URL(redirectUrl);
        if (!["127.0.0.1", "localhost"].includes(redirect.hostname) || redirect.pathname !== "/callback") {
          if (settings?.clientRegistration === "cimd") throw new Error("cimd requires a default loopback /callback redirect");
          return undefined;
        }
        if (metadata.authorization_response_iss_parameter_supported) {
          return { url: "https://pi.dev/oauth/client.json", redirectUrl };
        }
        const serverUrl = new URL(config.url); serverUrl.hash = "";
        const id = createHash("sha256").update(serverUrl.href).digest().subarray(0, 9).toString("base64url");
        redirect.pathname = `/callback/${id}`;
        return { url: `https://pi.dev/oauth/${id}/client.json`, redirectUrl: redirect.href };
      } : undefined,
      onRedirect,
    });
  }

  private flowOptions() {
    const config = this.entry.config;
    if (!("url" in config)) throw new Error("OAuth requires HTTP");
    return {
      serverUrl: config.url,
      scope: config.oauth?.scope,
      authorizationServerMetadataUrl: config.oauth?.authServerMetadataUrl ? new URL(config.oauth.authServerMetadataUrl) : undefined,
      signal: AbortSignal.timeout(15_000),
    };
  }

  authProvider(ctx: ExtensionContext): AuthProvider | undefined {
    const config = this.entry.config;
    if (!("url" in config)) return undefined;
    if (Object.keys(config.headers ?? {}).some((key) => key.toLowerCase() === "authorization")) return undefined;
    if (config.auth) {
      const provider = config.auth.provider;
      return { token: () => ctx.modelRegistry.getApiKeyForProvider(provider) };
    }
    const provider = this.provider(config.oauth?.callbackUrl ?? "http://127.0.0.1/callback", () => {});
    const adapter = adaptOAuthProvider(provider);
    return {
      token: () => adapter.token(),
      onUnauthorized: (context) => this.locked(() => adapter.onUnauthorized!({
        ...context,
        fetch: (url, init) => context.fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }),
      })),
    };
  }

  async login(ctx: ExtensionCommandContext): Promise<void> {
    const config = this.entry.config;
    if (!("url" in config) || config.auth || Object.keys(config.headers ?? {}).some((key) => key.toLowerCase() === "authorization")) {
      throw new Error("This server does not use MCP OAuth; configure its header or use /login for its provider");
    }
    await this.locked(async () => {
      const requested = new URL(config.oauth?.callbackUrl ?? "http://127.0.0.1/callback");
      const host = requested.hostname.replace(/^\[|\]$/g, "");
      if (requested.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(host) || requested.search || requested.hash) {
        throw new Error("OAuth callback must be a loopback HTTP URL without query or fragment");
      }
      const port = requested.port ? Number(requested.port) : config.oauth?.callbackPort;
      const serverUrl = new URL(config.url); serverUrl.hash = "";
      const id = createHash("sha256").update(serverUrl.href).digest().subarray(0, 9).toString("base64url");
      const callback = await OAuthCallbackServer.listen({
        host: host === "localhost" ? "127.0.0.1" : host, redirectHost: host, port, path: requested.pathname,
        extraPaths: [`/callback/${id}`],
      });
      this.callback = callback;
      try {
        const provider = this.provider(callback.redirectUrl, (url) => {
          ctx.ui.notify(`Open this URL to sign in to ${this.entry.name}:\n${url.href}`, "info");
        });
        const result = await authorizeMcp(provider, this.flowOptions());
        if (result === "REDIRECT") {
          const response = await callback.waitForCallback(await provider.state());
          await authorizeMcp(provider, { ...this.flowOptions(), authorizationCode: response.code, iss: response.iss });
        }
      } finally { this.callback = undefined; await callback.close(); }
    });
  }

  async close(): Promise<void> {
    await this.callback?.close();
    await Promise.allSettled([...this.pending]);
  }

  async logout(): Promise<void> {
    await this.locked(async () => {
      const state = await this.store.load();
      if (state) await this.store.save({ serverUrl: state.serverUrl });
    });
  }
}
