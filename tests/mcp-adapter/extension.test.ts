import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, type JsonObject } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  createMcpExtension, createCodemodeExtension,
  type AgentSession, type AgentSessionEvent, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import adapter from "../../packages/mcp-adapter/src/index.js";
import { createMcpFixture } from "./fixture.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

async function setup(exposure = "direct", fromFile = false) {
  const fixture = await createMcpFixture();
  cleanups.push(() => fixture.close());
  const directory = await mkdtemp(join(tmpdir(), "pi-adapter-sdk-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  await writeFile(join(directory, "mcp.json"), JSON.stringify({ mcpServers: { runs: { url: fixture.url, exposure } } }));
  const faux = fauxProvider();
  const runtime = await ModelRuntime.create({ modelsPath: null, authPath: join(directory, "auth.json"), refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  await runtime.setRuntimeApiKey(faux.provider.id, "faux-key");
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  let api: ExtensionAPI;
  const loader = new DefaultResourceLoader({
    cwd: directory, agentDir: directory, settingsManager: settings,
    noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    additionalExtensionPaths: fromFile ? [fileURLToPath(new URL("../../packages/mcp-adapter/src/index.ts", import.meta.url))] : [],
    extensionFactories: [
      { name: "mcp", builtin: true, replaceable: true, factory: createMcpExtension() },
      createCodemodeExtension(),
      (pi) => { api = pi; if (!fromFile) adapter(pi); },
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: directory, agentDir: directory, resourceLoader: loader, settingsManager: settings,
    modelRuntime: runtime, model: faux.getModel(), sessionManager: SessionManager.inMemory(directory),
  });
  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  cleanups.push(async () => {
    await session.abort();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  });
  await session.bindExtensions({ onError: (error) => { throw new Error(error.error); } });
  return { fixture, faux, session, events, api: api!, directory };
}

function toolData(session: AgentSession, name: string) {
  const message = [...session.messages].reverse().find((message) => message.role === "toolResult" && message.toolName === name);
  if (!message || message.role !== "toolResult") throw new Error(`No result for ${name}`);
  if (message.isError) throw new Error(JSON.stringify(message.content));
  return message.details as Record<string, unknown>;
}

function call(name: string, args: JsonObject) {
  return fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
}

describe("MCP adapter in real Pi SDK sessions", () => {
  it("replaces builtin MCP and uses one connection for tools, subscription, read and cancellation", async () => {
    const { fixture, faux, session, api } = await setup("direct", true);
    api.setActiveTools(["mcp__runs__ping", "subscribe_mcp_resource", "read_mcp_resource", "unsubscribe_mcp_resource"]);
    faux.setResponses([
      call("mcp__runs__ping", {}), call("subscribe_mcp_resource", { server: "runs", uri: "run://42" }),
      call("read_mcp_resource", { server: "runs", uri: "run://42" }),
      call("unsubscribe_mcp_resource", { server: "runs", uri: "run://42" }), fauxAssistantMessage("done"),
    ]);
    await session.prompt("observe the run");
    expect(toolData(session, "subscribe_mcp_resource")).toMatchObject({ subscribed: true, generation: expect.any(String) });
    const contents = toolData(session, "read_mcp_resource").contents as { text: string }[];
    expect(JSON.parse(contents[0].text)).toMatchObject({ observation: "watching" });
    expect(toolData(session, "unsubscribe_mcp_resource")).toMatchObject({ subscribed: false });
    expect(fixture.requests.filter((request) => request.method === "initialize")).toHaveLength(1);
    expect(fixture.sessions.size).toBe(1);
  });

  it("starts an agent turn for an idle update and queues a follow-up while busy", async () => {
    const { fixture, faux, session, events, api } = await setup();
    api.setActiveTools(["subscribe_mcp_resource", "read_mcp_resource"]);
    faux.setResponses([call("subscribe_mcp_resource", { server: "runs", uri: "run://42" }), fauxAssistantMessage("watching")]);
    await session.prompt("watch");
    await vi.waitFor(() => expect([...fixture.sessions.values()].some((session) => session.stream)).toBe(true));
    faux.setResponses([call("read_mcp_resource", { server: "runs", uri: "run://42" }), fauxAssistantMessage("idle update read")]);
    fixture.update("run://42");
    await vi.waitFor(() => expect(session.getLastAssistantText()).toBe("idle update read"));
    await session.waitForIdle();
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    faux.setResponses([
      async () => { entered(); await gate; return fauxAssistantMessage("current work done"); },
      fauxAssistantMessage("busy follow-up done"),
    ]);
    cleanups.push(async () => { release(); });
    const busy = session.prompt("do other work");
    await ready;
    try {
      fixture.update("run://42");
      await vi.waitFor(() => expect(session.agent.peekQueuedMessages().some((message) => message.role === "custom")).toBe(true));
      expect(session.getLastAssistantText()).toBe("idle update read");
    } finally { release(); }
    await busy;
    await session.waitForIdle();
    expect(session.getLastAssistantText()).toBe("busy follow-up done");
    const updates = session.messages.filter((message) => message.role === "custom" && message.customType === "mcp-resource-update");
    expect(updates).toHaveLength(2);
    expect(events.some((event) => event.type === "agent_start")).toBe(true);
  });

  it("cleans subscriptions on reload and starts a fresh session without replaying them", async () => {
    const { fixture, faux, session, api } = await setup();
    api.setActiveTools(["subscribe_mcp_resource", "read_mcp_resource"]);
    faux.setResponses([call("subscribe_mcp_resource", { server: "runs", uri: "run://42" }), fauxAssistantMessage("watching")]);
    await session.prompt("watch");
    const first = toolData(session, "subscribe_mcp_resource").generation;
    await session.reload();
    expect(fixture.sessions.size).toBe(1);
    expect(fixture.requests.filter((request) => request.method === "initialize")).toHaveLength(2);
    expect(fixture.requests.filter((request) => request.method === "resources/subscribe")).toHaveLength(1);
    faux.setResponses([call("read_mcp_resource", { server: "runs", uri: "run://42" }), fauxAssistantMessage("read fresh")]);
    await session.prompt("read after reload");
    const read = toolData(session, "read_mcp_resource");
    expect(read.generation).not.toBe(first);
    expect(JSON.parse((read.contents as { text: string }[])[0].text)).toMatchObject({ observation: "none" });
  });

  it("keeps different servers isolated and closes a server when its registration is removed", async () => {
    const { fixture, faux, session, api } = await setup();
    const other = await createMcpFixture();
    cleanups.push(() => other.close());
    api.registerMcpServer("other", { url: other.url, exposure: "direct" });
    await vi.waitFor(() => expect(other.sessions.size).toBe(1));
    api.setActiveTools(["subscribe_mcp_resource", "read_mcp_resource"]);
    faux.setResponses([
      call("subscribe_mcp_resource", { server: "runs", uri: "run://42" }),
      call("read_mcp_resource", { server: "other", uri: "run://42" }), fauxAssistantMessage("isolated"),
    ]);
    await session.prompt("watch only runs");
    expect(JSON.parse((toolData(session, "read_mcp_resource").contents as { text: string }[])[0].text)).toMatchObject({ observation: "none" });
    api.unregisterMcpServer("other");
    await vi.waitFor(() => expect(other.sessions.size).toBe(0));
    expect(fixture.sessions.size).toBe(1);
    expect(other.requests.some((request) => request.method === "resources/subscribe")).toBe(false);
  });

  it("makes server tools callable through Pi codemode", async () => {
    const { faux, session, api } = await setup("codemode");
    api.setActiveTools(["codemode"]);
    faux.setResponses([
      call("codemode", { code: 'const r = await tools.mcp__runs__ping({}); return r.content[0].text;' }),
      fauxAssistantMessage("done"),
    ]);
    await session.prompt("ping with codemode");
    expect(toolData(session, "codemode")).toBeTruthy();
  });
});
