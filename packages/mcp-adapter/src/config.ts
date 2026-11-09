import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { LoadedMcpConfig, McpExposure, McpServerEntry, RegisteredMcpServer } from "@earendil-works/pi-coding-agent";
import { type AuthProvider, StdioTransport, StreamableHttpTransport } from "@earendil-works/pi-mcp";
import { Type } from "typebox";
import { Value } from "typebox/value";

const exposure = Type.Union(["direct", "codemode", "deferred", "hidden", "codemode-deferred"].map((value) => Type.Literal(value)));
const strings = Type.Record(Type.String(), Type.String());
const configSchema = Type.Object({
  type: Type.Optional(Type.Union([Type.Literal("stdio"), Type.Literal("http"), Type.Literal("streamable-http")])),
  command: Type.Optional(Type.String({ minLength: 1 })),
  args: Type.Optional(Type.Array(Type.String())),
  cwd: Type.Optional(Type.String()),
  env: Type.Optional(strings),
  url: Type.Optional(Type.String()),
  headers: Type.Optional(strings),
  enabled: Type.Optional(Type.Boolean()),
  timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  description: Type.Optional(Type.String()),
  exposure: Type.Optional(exposure),
  toolExposure: Type.Optional(Type.Record(Type.String(), exposure)),
  oauth: Type.Optional(Type.Object({
    clientId: Type.Optional(Type.String()), clientSecret: Type.Optional(Type.String()),
    callbackPort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
    callbackUrl: Type.Optional(Type.String()), scope: Type.Optional(Type.String()), clientName: Type.Optional(Type.String()),
    clientRegistration: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("dcr"), Type.Literal("cimd")])),
    authServerMetadataUrl: Type.Optional(Type.String()),
  }, { additionalProperties: false })),
  auth: Type.Optional(Type.Object({ provider: Type.String({ minLength: 1 }) })),
}, { additionalProperties: false });

async function readConfig(path: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
    if (!isRecord(value)) throw new Error("Expected an object");
    return value;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw new Error(`Cannot load ${path}: ${String(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const normalizeExposure = (value: string): McpExposure => value === "codemode-deferred" ? "codemode" : value as McpExposure;

/** Loads the standard MCP config files; trusted project overrides cannot redirect provider credentials. */
export async function loadConfig(agentDir: string, cwd: string, trusted: boolean, registered: RegisteredMcpServer[]): Promise<LoadedMcpConfig> {
  const servers = new Map<string, McpServerEntry>();
  const errors: string[] = [];
  let autoEnableCodemode = true;
  const files = [{ path: join(agentDir, "mcp.json"), scope: "global" as const },
    ...(trusted ? [{ path: join(cwd, ".pi", "mcp.json"), scope: "project" as const }] : [])];
  for (const file of files) {
    let data: Record<string, unknown>;
    try { data = await readConfig(file.path); } catch (error) { errors.push(String(error)); continue; }
    if (typeof data.autoEnableCodemode === "boolean") autoEnableCodemode = data.autoEnableCodemode;
    if (data.mcpServers === undefined) continue;
    if (!isRecord(data.mcpServers)) { errors.push(`${file.path}: mcpServers must be an object`); continue; }
    for (const [name, raw] of Object.entries(data.mcpServers)) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("Invalid server name");
        if (!Value.Check(configSchema, raw)) throw new Error("Invalid MCP server config");
        let config = raw as Record<string, unknown>;
        const previous = servers.get(name);
        const override = !config.command && !config.url && !config.type;
        if (override) {
          if (file.scope !== "project" || !previous) throw new Error("Server needs command or url");
          if (Object.keys(config).some((key) => !["enabled", "exposure", "toolExposure"].includes(key))) {
            throw new Error("Project override may only set enabled, exposure, toolExposure");
          }
          config = { ...previous.config, ...config };
        } else if (file.scope === "project" && (config.auth || (previous && "url" in previous.config && previous.config.auth))) {
          throw new Error("Project config cannot set or replace provider authentication");
        }
        if (config.command && config.url) throw new Error("Specify command or url, not both");
        if (typeof config.url === "string") {
          const url = new URL(config.url);
          if (!["http:", "https:"].includes(url.protocol) || (config.type && !["http", "streamable-http"].includes(String(config.type)))) throw new Error("Invalid HTTP transport");
          if (config.auth && url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Provider authentication requires https or loopback");
          config = { ...config, type: "http" };
        } else if (typeof config.command !== "string" || (config.type && config.type !== "stdio")) throw new Error("Invalid stdio transport");
        const other = [...servers.keys()].find((key) => key !== name && key.replaceAll("-", "_") === name.replaceAll("-", "_"));
        if (other) throw new Error(`Server name collides with ${other}`);
        if (config.exposure) config.exposure = normalizeExposure(String(config.exposure));
        if (isRecord(config.toolExposure)) config.toolExposure = Object.fromEntries(Object.entries(config.toolExposure).map(([key, value]) => [key, normalizeExposure(String(value))]));
        servers.set(name, { name, config: config as unknown as McpServerEntry["config"], source: file.path, scope: file.scope });
      } catch (error) { errors.push(`${file.path} [${name}]: ${String(error)}`); }
    }
  }
  for (const entry of registered) {
    if ([...servers.keys()].some((name) => name.replaceAll("-", "_") === entry.name.replaceAll("-", "_"))) continue;
    servers.set(entry.name, { name: entry.name, config: entry.config, source: entry.extensionPath, scope: "extension" });
  }
  return { servers: [...servers.values()], errors, autoEnableCodemode };
}

/** Resolves explicit MCP configuration values at connection time. */
export function resolveConfigValue(value: string): string {
  if (value.startsWith("!")) {
    return execFileSync(process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      process.platform === "win32" ? ["/d", "/s", "/c", value.slice(1)] : ["-c", value.slice(1)],
      { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  return value.replace(/\$\$|\$!|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced: string | undefined, bare: string | undefined) => {
    if (match === "$$") return "$";
    if (match === "$!") return "!";
    const name = braced ?? bare!;
    const resolved = process.env[name];
    if (resolved === undefined) throw new Error(`Missing environment variable: ${name}`);
    return resolved;
  });
}

function expandHome(value: string): string {
  return value === "~" ? homedir() : value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\")) ? join(homedir(), value.slice(2)) : value;
}

export function createTransport(entry: McpServerEntry, cwd: string, authProvider?: AuthProvider) {
  const config = entry.config;
  if ("url" in config) {
    const headers = Object.fromEntries(Object.entries(config.headers ?? {}).map(([key, value]) => [key, resolveConfigValue(value)]));
    return new StreamableHttpTransport({ url: config.url, headers, authProvider });
  }
  return new StdioTransport({
    command: expandHome(config.command), args: config.args?.map(expandHome),
    cwd: resolve(cwd, expandHome(config.cwd ?? ".")),
    env: Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, resolveConfigValue(value)])),
    stderr: "pipe",
  });
}

export function toolExposure(entry: McpServerEntry, tool: string): McpExposure {
  const overrides = entry.config.toolExposure ?? {};
  if (overrides[tool]) return overrides[tool];
  for (const [pattern, exposure] of Object.entries(overrides)) {
    if (matchesPattern(pattern, tool)) return exposure;
  }
  return entry.config.exposure ?? "codemode";
}

export function matchesPattern(pattern: string, value: string): boolean {
  return new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(value);
}
