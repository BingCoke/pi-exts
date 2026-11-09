import { afterEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { StreamableHttpTransport, StdioTransport } from "@earendil-works/pi-mcp";
import { ServerConnection, type ResourceEvent } from "../../packages/mcp-adapter/src/runtime.js";
import { createMcpFixture } from "./fixture.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup(options: Parameters<typeof createMcpFixture>[0] = {}) {
  const fixture = await createMcpFixture(options);
  cleanups.push(() => fixture.close());
  const events: ResourceEvent[] = [];
  const connection = new ServerConnection({
    entry: { name: "runs", config: { url: fixture.url, timeout: 1 }, source: "test" }, cwd: process.cwd(),
    createTransport: () => new StreamableHttpTransport({ url: fixture.url }),
    onTools: () => {}, onEvent: (event) => events.push(event),
  });
  cleanups.push(() => connection.close());
  return { fixture, events, connection };
}

async function read(connection: ServerConnection, uri = "run://42") {
  const result = await connection.request((client, options) => client.readResource(uri, options));
  const content = result.contents[0];
  if (!("text" in content)) throw new Error("Expected text");
  return JSON.parse(content.text);
}

describe("MCP resource subscriptions over streamable HTTP", () => {
  it("supports subscriptions on the shared stdio session", async () => {
    const events: ResourceEvent[] = [];
    const transport = new StdioTransport({ command: process.execPath, args: [fileURLToPath(new URL("./stdio-server.mjs", import.meta.url))] });
    const connection = new ServerConnection({
      entry: { name: "stdio", config: { command: process.execPath }, source: "test" }, cwd: process.cwd(),
      createTransport: () => transport, onTools: () => {}, onEvent: (event) => events.push(event),
    });
    cleanups.push(() => connection.close());
    await connection.subscribe("run://42");
    expect(events).toEqual([{ type: "updated", server: "stdio", uri: "run://42", generation: connection.generation }]);
    const read = await connection.request((client) => client.readResource("run://42"));
    expect(read.contents[0]).toMatchObject({ text: "watching" });
    await connection.unsubscribe("run://42");
    expect(connection.connected).toBe(true);
    await connection.close();
    expect(connection.connected).toBe(false);
  });

  it("uses the tool session to subscribe and read a URI absent from resources/list", async () => {
    const { fixture, connection } = await setup();
    const list = await connection.request((client) => client.listResources());
    expect(list).toEqual([]);
    const tool = await connection.request((client) => client.callTool("ping"));
    expect(await read(connection)).toMatchObject({ observation: "none" });
    await connection.subscribe("run://42");
    const observation = await read(connection);
    expect(observation).toEqual({ session: tool.content![0].type === "text" ? tool.content![0].text : "", observation: "watching" });
    expect(fixture.requests.filter((request) => request.method === "initialize")).toHaveLength(1);
  });

  it("delivers an update received before the subscribe response and keeps later updates", async () => {
    const { connection, fixture, events } = await setup({ earlyUpdate: true });
    const result = await connection.subscribe("run://42");
    expect(events).toEqual([{ type: "updated", server: "runs", uri: "run://42", generation: result.generation }]);
    await vi.waitFor(() => expect([...fixture.sessions.values()].some((session) => session.stream)).toBe(true));
    fixture.update("run://42");
    await vi.waitFor(() => expect(events).toHaveLength(2));
  });

  it("serializes concurrent subscriptions and cancellation without closing the shared session", async () => {
    const { connection, fixture } = await setup();
    await Promise.all([connection.subscribe("run://42"), connection.subscribe("run://42"), connection.unsubscribe("run://42")]);
    expect(fixture.requests.filter((request) => request.method.startsWith("resources/")).map((request) => request.method))
      .toEqual(["resources/subscribe", "resources/subscribe", "resources/unsubscribe"]);
    expect(connection.subscribedUris).toEqual([]);
    expect(await read(connection)).toMatchObject({ observation: "none" });
    await connection.request((client) => client.callTool("ping"));
    expect(fixture.requests.filter((request) => request.method === "initialize")).toHaveLength(1);
    await connection.unsubscribe("run://42");
  });

  it("preserves a successful subscription when a later subscribe fails", async () => {
    const { connection, fixture } = await setup();
    await connection.subscribe("run://42");
    fixture.failSubscribe(true);
    await expect(connection.subscribe("run://42")).rejects.toThrow("Cannot subscribe");
    expect(connection.subscribedUris).toEqual(["run://42"]);
    await expect(connection.subscribe("run://other")).rejects.toThrow();
    expect(connection.subscribedUris).toEqual(["run://42"]);
  });

  it("rejects unsupported subscriptions without sending the method", async () => {
    const { connection, fixture } = await setup({ subscribe: false });
    await expect(connection.subscribe("run://42")).rejects.toThrow("does not support");
    expect(fixture.requests.some((request) => request.method === "resources/subscribe")).toBe(false);
  });

  it("reports lost subscriptions and never replays them into a replacement session", async () => {
    const { connection, fixture, events } = await setup();
    const subscribed = await connection.subscribe("run://42");
    fixture.expire();
    await expect(read(connection)).rejects.toThrow();
    expect(events).toEqual([{ type: "subscriptions_lost", server: "runs", generation: subscribed.generation, uris: ["run://42"] }]);
    expect(await read(connection)).toMatchObject({ observation: "none" });
    expect(fixture.requests.filter((request) => request.method === "resources/subscribe")).toHaveLength(1);
    await connection.subscribe("run://42");
    expect(connection.generation).not.toBe(subscribed.generation);
    expect(await read(connection)).toMatchObject({ observation: "watching" });
  });

  it("cancels one request while sibling resources stay readable", async () => {
    const { connection, fixture } = await setup();
    fixture.blockSubscribe(true);
    const controller = new AbortController();
    const pending = connection.subscribe("run://42", controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(fixture.requests.some((request) => request.method === "resources/subscribe")).toBe(true));
    controller.abort();
    await rejected;
    expect(await read(connection, "run://other")).toMatchObject({ observation: "none" });
    fixture.release();
    await connection.unsubscribe("run://42");
    expect(connection.connected).toBe(true);
  });
});
