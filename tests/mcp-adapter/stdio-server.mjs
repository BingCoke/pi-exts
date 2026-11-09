import { createInterface } from "node:readline";

const subscriptions = new Set();
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.id === undefined) continue;
  const uri = message.params?.uri;
  let result;
  switch (message.method) {
    case "initialize": result = { protocolVersion: "2025-11-25", serverInfo: { name: "stdio-fixture", version: "1" }, capabilities: { resources: { subscribe: true } } }; break;
    case "resources/subscribe":
      subscriptions.add(uri);
      send({ method: "notifications/resources/updated", params: { uri } });
      result = {}; break;
    case "resources/unsubscribe": subscriptions.delete(uri); result = {}; break;
    case "resources/read": result = { contents: [{ uri, text: subscriptions.has(uri) ? "watching" : "none" }] }; break;
    default: result = {};
  }
  send({ id: message.id, result });
}
