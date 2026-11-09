import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { JsonRpcRequest } from "@earendil-works/pi-mcp";

/** A standard streamable HTTP MCP server with session-local observations and an empty resource list. */
export async function createMcpFixture(options: { subscribe?: boolean; earlyUpdate?: boolean } = {}) {
  const requests: { session: string; method: string; uri?: string }[] = [];
  const sessions = new Map<string, { uris: Set<string>; stream?: ServerResponse }>();
  let failSubscribe = false;
  let blockSubscribe = false;
  const pending: (() => void)[] = [];
  const server = createServer(async (req, res) => {
    const sessionId = String(req.headers["mcp-session-id"] ?? "");
    if (req.method === "DELETE") { sessions.get(sessionId)?.stream?.end(); sessions.delete(sessionId); res.writeHead(204).end(); return; }
    if (req.method === "GET") {
      const session = sessions.get(sessionId);
      if (!session) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders();
      session.stream = res;
      req.on("close", () => { if (session.stream === res) session.stream = undefined; });
      return;
    }
    let body = "";
    for await (const chunk of req) body += String(chunk);
    const message = JSON.parse(body) as JsonRpcRequest;
    if (message.method === "initialize") {
      const id = randomUUID(); sessions.set(id, { uris: new Set() });
      requests.push({ session: id, method: message.method });
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": id });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {
        protocolVersion: "2025-11-25", serverInfo: { name: "fixture", version: "1" },
        capabilities: { tools: {}, resources: { subscribe: options.subscribe ?? true } },
      } })); return;
    }
    const session = sessions.get(sessionId);
    if (!session) { res.writeHead(404).end(); return; }
    if (!("id" in message)) { res.writeHead(202).end(); return; }
    const params = message.params as Record<string, unknown> | undefined;
    const uri = typeof params?.uri === "string" ? params.uri : undefined;
    requests.push({ session: sessionId, method: message.method, uri });
    const reply = (result: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result })); };
    switch (message.method) {
      case "tools/list": reply({ tools: [{ name: "ping", description: "Check the shared connection", inputSchema: { type: "object", properties: {} } }] }); break;
      case "tools/call": reply({ content: [{ type: "text", text: sessionId }] }); break;
      case "resources/list": reply({ resources: [] }); break;
      case "resources/templates/list": reply({ resourceTemplates: [{ name: "run", uriTemplate: "run://{id}" }] }); break;
      case "resources/read": reply({ contents: [{ uri, text: JSON.stringify({ session: sessionId, observation: session.uris.has(uri!) ? "watching" : "none" }) }] }); break;
      case "resources/subscribe": {
        if (failSubscribe) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Cannot subscribe" } })); break; }
        session.uris.add(uri!);
        const finish = () => {
          if (options.earlyUpdate) {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri } })}\n\n`);
            res.end(`data: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })}\n\n`);
          } else reply({});
        };
        if (blockSubscribe) pending.push(finish); else finish();
        break;
      }
      case "resources/unsubscribe": session.uris.delete(uri!); reply({}); break;
      default: reply({});
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, requests, sessions,
    failSubscribe(value: boolean) { failSubscribe = value; },
    blockSubscribe(value: boolean) { blockSubscribe = value; },
    release() { for (const finish of pending.splice(0)) finish(); },
    update(uri: string) {
      for (const session of sessions.values()) session.stream?.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri } })}\n\n`);
    },
    expire() { for (const session of sessions.values()) session.stream?.end(); sessions.clear(); },
    async close() {
      for (const session of sessions.values()) session.stream?.end();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
