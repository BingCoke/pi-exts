import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  McpClient,
  McpSessionExpiredError,
  type McpRequestOptions,
  type McpTransport,
  type Tool,
} from "@earendil-works/pi-mcp";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

export type ResourceEvent = {
  server: string;
  generation: string;
} & ({ type: "updated"; uri: string } | { type: "subscriptions_lost"; uris: string[] });

type Subscription = { pending: boolean; updated: boolean };

/** Owns one server's client and its session-scoped resource subscriptions. */
export class ServerConnection {
  readonly entry: McpServerEntry;
  generation = "";
  tools: Tool[] = [];
  instructions: string | undefined;
  error: string | undefined;
  private client: McpClient | undefined;
  private opening: Promise<McpClient> | undefined;
  private closed = false;
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly options;

  constructor(options: {
    entry: McpServerEntry;
    cwd: string;
    createTransport: () => McpTransport;
    onEvent: (event: ResourceEvent) => void;
    onTools: (connection: ServerConnection) => void;
  }) {
    this.options = options;
    this.entry = options.entry;
  }

  get timeoutMs(): number {
    return (this.entry.config.timeout ?? 60) * 1000;
  }

  get connected(): boolean {
    return this.client?.connectionState === "connected";
  }

  get subscribedUris(): string[] {
    return [...this.subscriptions.keys()];
  }

  getClient(): Promise<McpClient> {
    if (this.closed) return Promise.reject(new Error(`MCP server "${this.entry.name}" is closed`));
    if (this.client?.connectionState === "connected") return Promise.resolve(this.client);
    this.opening ??= this.open().finally(() => { this.opening = undefined; });
    return this.opening;
  }

  private async open(): Promise<McpClient> {
    const client = new McpClient({
      name: "pi-mcp-adapter",
      version: "0.1.0",
      requestTimeoutMs: this.timeoutMs,
      roots: [{ uri: pathToFileURL(this.options.cwd).href }],
    });
    this.client = client;
    this.generation = randomUUID();
    client.onNotification("notifications/resources/updated", (params) => {
      if (this.client !== client || this.closed) return;
      if (!params || typeof params !== "object" || !("uri" in params) || typeof params.uri !== "string") return;
      const subscription = this.subscriptions.get(params.uri);
      if (!subscription) return;
      if (subscription.pending) subscription.updated = true;
      else this.options.onEvent({ type: "updated", server: this.entry.name, generation: this.generation, uri: params.uri });
    });
    client.onClose(() => this.detach(client));
    client.onNotification("notifications/tools/list_changed", () => {
      void client.listTools().then((tools) => {
        if (this.client !== client || this.closed) return;
        this.tools = tools;
        this.options.onTools(this);
      }).catch((error: unknown) => { this.error = String(error); });
    });
    try {
      await client.connect(this.options.createTransport());
      this.tools = client.serverCapabilities?.tools ? await client.listTools() : [];
      if (this.closed || this.client !== client || client.connectionState !== "connected") {
        throw new Error(`MCP server "${this.entry.name}" closed during connection`);
      }
      this.instructions = client.instructions;
      this.error = undefined;
      this.options.onTools(this);
      return client;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      await client.close();
      throw error;
    }
  }

  private detach(client: McpClient): void {
    if (this.client !== client) return;
    const uris = this.subscribedUris;
    this.client = undefined;
    this.subscriptions.clear();
    if (!this.closed && uris.length > 0) {
      this.options.onEvent({ type: "subscriptions_lost", server: this.entry.name, generation: this.generation, uris });
    }
  }

  /** Requests are never replayed after an ambiguous failure or a new logical session. */
  async request<T>(run: (client: McpClient, options: McpRequestOptions) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const client = await this.getClient();
    signal?.throwIfAborted();
    try {
      return await run(client, { signal, timeoutMs: this.timeoutMs });
    } catch (error) {
      if (error instanceof McpSessionExpiredError) {
        this.detach(client);
        await client.close();
      }
      throw error;
    }
  }

  async subscribe(uri: string, signal?: AbortSignal): Promise<{ server: string; uri: string; subscribed: true; generation: string }> {
    return this.serialize(uri, signal, async () => {
      return this.request(async (client, options) => {
        if (!client.serverCapabilities?.resources?.subscribe) {
          throw new Error(`MCP server "${this.entry.name}" does not support resource subscriptions`);
        }
        const previous = this.subscriptions.get(uri);
        const subscription: Subscription = { pending: true, updated: false };
        this.subscriptions.set(uri, subscription);
        try {
          await client.request("resources/subscribe", { uri }, options);
          if (this.client !== client || this.closed) throw new Error("MCP session ended while subscribing");
          subscription.pending = false;
          if (subscription.updated) {
            this.options.onEvent({ type: "updated", server: this.entry.name, generation: this.generation, uri });
          }
          return { server: this.entry.name, uri, subscribed: true, generation: this.generation };
        } catch (error) {
          if (this.client === client) {
            if (previous) {
              this.subscriptions.set(uri, previous);
              if (subscription.updated) this.options.onEvent({ type: "updated", server: this.entry.name, generation: this.generation, uri });
            } else this.subscriptions.delete(uri);
          }
          throw error;
        }
      }, signal);
    });
  }

  async unsubscribe(uri: string, signal?: AbortSignal): Promise<{ server: string; uri: string; subscribed: false; generation: string }> {
    return this.serialize(uri, signal, () => this.request(async (client, options) => {
      if (!client.serverCapabilities?.resources?.subscribe) {
        throw new Error(`MCP server "${this.entry.name}" does not support resource subscriptions`);
      }
      await client.request("resources/unsubscribe", { uri }, options);
      this.subscriptions.delete(uri);
      return { server: this.entry.name, uri, subscribed: false, generation: this.generation };
    }, signal));
  }

  private async serialize<T>(uri: string, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(uri) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(() => {
      signal?.throwIfAborted();
      return run();
    });
    this.operations.set(uri, operation);
    try {
      return await operation;
    } finally {
      if (this.operations.get(uri) === operation) this.operations.delete(uri);
    }
  }

  async reconnect(): Promise<void> {
    await this.opening?.catch(() => {});
    const client = this.client;
    if (client) {
      this.detach(client);
      await client.close();
    }
    await this.getClient();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.subscriptions.clear();
    await this.client?.close();
    await this.opening?.catch(() => {});
  }
}
