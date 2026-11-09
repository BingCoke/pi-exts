import { createHash } from "node:crypto";
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type McpServerEntry, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { McpError, JSON_RPC_ERROR_CODES, type Tool } from "@earendil-works/pi-mcp";
import { Type, type TSchema } from "typebox";
import { ServerAuth } from "./auth.js";
import { createTransport, loadConfig, toolExposure } from "./config.js";
import { result, DATA_SCHEMA } from "./results.js";
import { ServerConnection, type ResourceEvent } from "./runtime.js";

const URI_PARAMS = Type.Object({
  server: Type.String({ minLength: 1, description: "MCP server name as configured." }),
  uri: Type.String({ minLength: 1, description: "Known resource URI from a tool result, resource template, or listing. Listing is not required." }),
}, { additionalProperties: false });
const LIST_PARAMS = Type.Object({ server: Type.Optional(Type.String()), cursor: Type.Optional(Type.String()) }, { additionalProperties: false });

/** A single MCP owner for tools, resources, subscriptions, and agent notifications. */
export default function mcpAdapter(pi: ExtensionAPI): void {
  let connections = new Map<string, ServerConnection>();
  let auth = new Map<string, ServerAuth>();
  let definitions = new Map<string, ToolDefinition>();
  let registered = new Map<string, Set<string>>();
  let configured: McpServerEntry[] = [];
  let active = false;
  let lifecycle = 0;
  let autoEnableCodemode = true;
  let changes: Promise<void> = Promise.resolve();

  const onResourceEvent = (event: ResourceEvent) => {
    if (!active) return;
    const entry = connections.get(event.server)?.entry;
    if (!entry || entry.config.exposure === "hidden") return;
    pi.sendMessage({
      customType: "mcp-resource-update", display: true, details: event,
      content: event.type === "updated"
        ? `MCP resource updated: ${JSON.stringify(event)}. This notification only indicates a resource change. Explicitly read_mcp_resource with this server and URI to obtain the current result. Cancel the subscription when follow-up is complete.`
        : `MCP resource subscriptions lost: ${JSON.stringify(event)}. The logical MCP session ended. Reading does not restore these subscriptions. Explicitly decide whether to subscribe again.`,
    }, { triggerTurn: true, deliverAs: "followUp" });
  };

  const enableDiscovery = () => {
    const enabled = [...connections.values()].filter((connection) => connection.entry.config.enabled !== false);
    const exposures = enabled.flatMap((connection) => [connection.entry.config.exposure ?? "codemode", ...Object.values(connection.entry.config.toolExposure ?? {})]);
    const tools = pi.getAllTools();
    const activeNames = pi.getActiveTools();
    const additions = [
      ...(autoEnableCodemode && exposures.includes("codemode") ? ["codemode"] : []),
      ...(exposures.includes("deferred") ? ["tool_search"] : []),
    ].filter((name) => !activeNames.includes(name) && tools.some((tool) => tool.name === name && tool.reachesTools));
    if (additions.length) pi.setActiveTools([...activeNames, ...additions]);
  };

  const hideTools = (name: string) => {
    for (const toolName of registered.get(name) ?? []) {
      const definition = definitions.get(toolName);
      if (definition) pi.registerTool({ ...definition, exposure: "hidden" });
    }
    registered.delete(name);
  };

  const registerTools = (connection: ServerConnection) => {
    if (!active || connections.get(connection.entry.name) !== connection) return;
    const entry = connection.entry;
    const namespace = `mcp__${entry.name.replaceAll("-", "_")}`;
    const baseName = (tool: Tool) => `${namespace}__${tool.name.replace(/[^A-Za-z0-9_]/g, "_")}`;
    const names = connection.tools.map(baseName);
    const current = new Set<string>();
    for (const tool of connection.tools) {
      const base = baseName(tool);
      const suffix = createHash("sha256").update(`${entry.name}\0${tool.name}`).digest("hex").slice(0, 8);
      const name = base.length > 64 || names.indexOf(base) !== names.lastIndexOf(base) ? `${base.slice(0, 55)}_${suffix}` : base;
      current.add(name);
      const definition: ToolDefinition = {
        name, label: `${entry.name}/${tool.name}`, description: tool.description ?? tool.title ?? tool.name,
        parameters: tool.inputSchema as TSchema,
        // Scripts get the complete CallToolResult, including isError and structuredContent.
        outputSchema: DATA_SCHEMA as TSchema,
        exposure: toolExposure(entry, tool.name), annotations: tool.annotations,
        namespace: { name: namespace, aliases: [entry.name], description: entry.config.description, instructions: connection.instructions },
        async execute(_id, params, signal) {
          const currentConnection = connections.get(entry.name);
          if (!currentConnection || toolExposure(currentConnection.entry, tool.name) === "hidden") throw new Error(`MCP tool ${name} is unavailable`);
          const response = await currentConnection.request((client, options) => client.callTool(tool.name, params as Record<string, unknown>, options), signal);
          return result(response as unknown as Record<string, unknown>, response.content, response.isError);
        },
      };
      definitions.set(name, definition);
      pi.registerTool(definition);
    }
    for (const old of registered.get(entry.name) ?? []) {
      if (!current.has(old)) {
        const definition = definitions.get(old);
        if (definition) pi.registerTool({ ...definition, exposure: "hidden" });
      }
    }
    registered.set(entry.name, current);
    enableDiscovery();
  };

  const makeConnection = (entry: McpServerEntry, ctx: ExtensionContext) => {
    const serverAuth = new ServerAuth(getAgentDir(), entry);
    auth.set(entry.name, serverAuth);
    return new ServerConnection({
      entry, cwd: ctx.cwd,
      createTransport: () => createTransport(entry, ctx.cwd, serverAuth.authProvider(ctx)),
      onEvent: onResourceEvent, onTools: registerTools,
    });
  };

  const visible = () => [...connections.values()].filter((connection) => connection.entry.config.exposure !== "hidden");
  const find = (server: string) => {
    const connection = connections.get(server);
    if (!connection || connection.entry.config.exposure === "hidden") throw new Error(`MCP server "${server}" is unavailable`);
    return connection;
  };

  for (const operation of ["subscribe", "unsubscribe", "read"] as const) {
    const name = `${operation}_mcp_resource`;
    pi.registerTool({
      name, label: name, parameters: URI_PARAMS, outputSchema: DATA_SCHEMA as TSchema,
      description: operation === "subscribe"
        ? "Explicitly subscribe to updates for a known MCP resource URI. Shares the session with MCP tools and reads. After subscribing, read_mcp_resource once for the current state. Updates follow up with the agent; explicitly unsubscribe when done."
        : operation === "unsubscribe" ? "Cancel the MCP resource subscription, releasing observation without stopping business operations or closing the shared connection."
        : "Read a known MCP resource URI. Does not subscribe or restore subscriptions. A URI from a tool result or resource template is valid even when resources/list is empty.",
      annotations: { readOnlyHint: operation === "read", destructiveHint: false },
      async execute(_id, params, signal) {
        const connection = find(params.server);
        if (operation === "subscribe") return result(await connection.subscribe(params.uri, signal));
        if (operation === "unsubscribe") return result(await connection.unsubscribe(params.uri, signal));
        const read = await connection.request(async (client, options) => {
          const generation = connection.generation;
          return { generation, response: await client.readResource(params.uri, options) };
        }, signal);
        return result({ server: params.server, uri: params.uri, generation: read.generation, contents: read.response.contents }, read.response.contents.map((resource) => ({ type: "resource", resource })));
      },
    });
  }

  for (const templates of [false, true]) {
    const name = templates ? "list_mcp_resource_templates" : "list_mcp_resources";
    const key = templates ? "resourceTemplates" : "resources";
    pi.registerTool({
      name, label: name, parameters: LIST_PARAMS, outputSchema: DATA_SCHEMA as TSchema,
      description: templates ? "List MCP resource URI templates. Instantiate a template to read or explicitly subscribe to a dynamic resource." : "List MCP resources. Empty listings are valid; known resource URIs can still be read or explicitly subscribed to.",
      annotations: { readOnlyHint: true },
      async execute(_id, params, signal) {
        if (params.cursor && !params.server) throw new Error("cursor requires server");
        const list = async (connection: ServerConnection) => connection.request(async (client, options): Promise<{ items: object[]; nextCursor?: string }> => {
          if (!client.serverCapabilities?.resources) return { items: [] };
          try {
            if (params.server) {
              if (templates) {
                const page = await client.listResourceTemplatesPage(params.cursor, options);
                return { items: page.resourceTemplates.map((item) => ({ ...item, server: connection.entry.name })), nextCursor: page.nextCursor };
              }
              const page = await client.listResourcesPage(params.cursor, options);
              return { items: page.resources.map((item) => ({ ...item, server: connection.entry.name })), nextCursor: page.nextCursor };
            }
            const items = templates ? await client.listResourceTemplates(options) : await client.listResources(options);
            return { items: items.map((item) => ({ ...item, server: connection.entry.name })) };
          } catch (error) {
            if (templates && error instanceof McpError && error.code === JSON_RPC_ERROR_CODES.methodNotFound) return { items: [] };
            throw error;
          }
        }, signal);
        if (params.server) {
          const page = await list(find(params.server));
          return result({ server: params.server, [key]: page.items, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) });
        }
        const candidates = visible();
        const pages = await Promise.allSettled(candidates.map(list));
        const items: unknown[] = [];
        const errors: { server: string; error: string }[] = [];
        pages.forEach((page, i) => {
          if (page.status === "fulfilled") items.push(...page.value.items);
          else errors.push({ server: candidates[i].entry.name, error: String(page.reason) });
        });
        return result({ [key]: items, ...(errors.length ? { errors } : {}) });
      },
    });
  }

  pi.registerCommand("mcp", {
    description: "MCP adapter status; /mcp reconnect|login|logout <server>",
    handler: async (args, ctx) => {
      const [operation, name] = args.trim().split(/\s+/);
      if (operation) {
        if (!name || !["reconnect", "login", "logout"].includes(operation)) throw new Error("Usage: /mcp [reconnect|login|logout <server>]");
        const connection = connections.get(name);
        if (!connection) throw new Error(`Unknown MCP server: ${name}`);
        if (operation === "login") { await auth.get(name)!.login(ctx); await connection.reconnect(); }
        else if (operation === "logout") {
          await connection.close(); await auth.get(name)!.logout(); hideTools(name);
          connections.set(name, makeConnection(connection.entry, ctx));
        } else await connection.reconnect();
      }
      const lines = configured.map((entry) => {
        const connection = connections.get(entry.name);
        return `${entry.name}: ${entry.config.enabled === false ? "disabled" : connection?.connected ? "connected" : "disconnected"} · ${connection?.tools.length ?? 0} tools · ${connection?.subscribedUris.length ?? 0} subscriptions${connection?.error ? ` · ${connection.error}` : ""}`;
      });
      pi.sendMessage({ customType: "mcp-adapter-status", content: lines.join("\n") || "No MCP servers configured.", display: true }, { triggerTurn: false });
    },
  });

  const reloadServers = async (ctx: ExtensionContext, token: number) => {
    const loaded = await loadConfig(getAgentDir(), ctx.cwd, ctx.isProjectTrusted(), pi.getMcpServers());
    if (!active || token !== lifecycle) return;
    autoEnableCodemode = loaded.autoEnableCodemode !== false;
    configured = loaded.servers;
    if (loaded.errors.length) ctx.ui.notify(loaded.errors.join("\n"), "error");
    const next = new Map(loaded.servers.filter((entry) => entry.config.enabled !== false).map((entry) => [entry.name, entry]));
    for (const [name, connection] of connections) {
      if (JSON.stringify(next.get(name)?.config) === JSON.stringify(connection.entry.config)) continue;
      hideTools(name);
      await connection.close();
      await auth.get(name)?.close();
      connections.delete(name);
      auth.delete(name);
    }
    if (!active || token !== lifecycle) return;
    for (const [name, entry] of next) {
      if (!connections.has(name)) connections.set(name, makeConnection(entry, ctx));
    }
    enableDiscovery();
    await Promise.allSettled([...connections.values()].map(async (connection) => {
      try { await connection.getClient(); }
      catch (error) { if (active && token === lifecycle) ctx.ui.notify(`MCP ${connection.entry.name}: ${String(error)}`, "warning"); }
    }));
  };

  pi.on("session_start", async (_event, ctx) => {
    active = true;
    const token = ++lifecycle;
    changes = reloadServers(ctx, token);
    await changes;
  });
  pi.on("mcp_servers_change", async (_event, ctx) => {
    const token = lifecycle;
    changes = changes.catch(() => {}).then(() => reloadServers(ctx, token));
    await changes;
  });
  pi.on("before_agent_start", (event) => {
    const sections = event.systemPromptOptions.sections;
    sections.mcp_servers = [...connections.values()].filter((connection) => connection.entry.config.exposure !== "hidden").map((connection) => {
      return `- mcp__${connection.entry.name.replaceAll("-", "_")} (${connection.entry.config.exposure ?? "codemode"}): ${connection.entry.config.description ?? "MCP tools and resources"}`;
    }).join("\n");
  });
  pi.on("session_shutdown", async () => {
    active = false; lifecycle++;
    await Promise.allSettled([...connections.values()].map((connection) => connection.close()));
    await Promise.allSettled([...auth.values()].map((serverAuth) => serverAuth.close()));
    await changes.catch(() => {});
    connections = new Map(); auth = new Map(); definitions = new Map(); registered = new Map();
  });
}
