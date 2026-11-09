import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, matchesPattern, resolveConfigValue } from "../../packages/mcp-adapter/src/config.js";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function setup(global: unknown, project: unknown) {
  const root = await mkdtemp(join(tmpdir(), "mcp-adapter-config-")); dirs.push(root);
  const cwd = join(root, "project"); const agentDir = join(root, "agent");
  await mkdir(join(cwd, ".pi"), { recursive: true }); await mkdir(agentDir);
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify(global));
  await writeFile(join(cwd, ".pi", "mcp.json"), JSON.stringify(project));
  return { cwd, agentDir };
}

describe("MCP adapter config", () => {
  it("only loads trusted project overrides and preserves global transport and credentials", async () => {
    const { agentDir, cwd } = await setup({ mcpServers: { a: { command: "server", env: { TOKEN: "value" } } } },
      { mcpServers: { a: { enabled: false, exposure: "direct" }, b: { url: "http://localhost:1234/mcp" } } });
    const untrusted = await loadConfig(agentDir, cwd, false, []);
    expect(untrusted.servers.map((entry) => entry.name)).toEqual(["a"]);
    expect(untrusted.servers[0].config.enabled).toBeUndefined();
    const trusted = await loadConfig(agentDir, cwd, true, []);
    expect(trusted.errors).toEqual([]);
    expect(trusted.servers[0].config).toEqual({ command: "server", env: { TOKEN: "value" }, enabled: false, exposure: "direct" });
    expect(trusted.servers.map((entry) => entry.name)).toEqual(["a", "b"]);
  });

  it("rejects project credential redirection while retaining the valid global entry", async () => {
    const { agentDir, cwd } = await setup({ mcpServers: { a: { url: "https://trusted.example/mcp", auth: { provider: "provider" } } } },
      { mcpServers: { a: { url: "https://other.example/mcp" }, b: { url: "https://other.example/mcp", auth: { provider: "provider" } } } });
    const loaded = await loadConfig(agentDir, cwd, true, []);
    expect(loaded.errors).toHaveLength(2);
    expect(loaded.servers).toHaveLength(1);
    expect(loaded.servers[0].config).toMatchObject({ url: "https://trusted.example/mcp" });
  });

  it("rejects invalid transport and normalized name collisions without hiding valid servers", async () => {
    const { agentDir, cwd } = await setup({ mcpServers: {
      "my-server": { command: "server" }, my_server: { command: "other" }, bad: { url: "file:///tmp/mcp" },
      wrong: { command: "server", type: "http" }, empty: { timeout: 30 },
    } }, {});
    const loaded = await loadConfig(agentDir, cwd, true, []);
    expect(loaded.errors).toHaveLength(4);
    expect(loaded.servers.map((entry) => entry.name)).toEqual(["my-server"]);
  });

  it("gives file configs precedence over extension registrations and permits exposure-only global overrides", async () => {
    const { agentDir, cwd } = await setup({ mcpServers: { a: { command: "server" } } }, { mcpServers: { a: { toolExposure: { "get_*": "direct" } } } });
    const loaded = await loadConfig(agentDir, cwd, true, [
      { name: "a", config: { command: "registered" }, extensionPath: "test" },
      { name: "b", config: { command: "other" }, extensionPath: "test" },
    ]);
    expect(loaded.servers.map((entry) => [entry.name, "command" in entry.config ? entry.config.command : ""])).toEqual([["a", "server"], ["b", "other"]]);
    expect(loaded.servers[0].config.toolExposure).toEqual({ "get_*": "direct" });
  });

  it("resolves literal escapes and environment references and treats only asterisks as wildcards", () => {
    expect(resolveConfigValue("$$HOME $!literal")).toBe("$HOME !literal");
    expect(() => resolveConfigValue("${PI_ADAPTER_MISSING_TEST_VAR}")).toThrow("Missing environment variable");
    expect(matchesPattern("get.*", "get.foo")).toBe(true);
    expect(matchesPattern("get.*", "getXfoo")).toBe(false);
  });
});
