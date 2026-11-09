# Pi Personal Tools

A personal Pi package with five extensions. Image generation uses Pi's built-in tools.

## Extensions

### last-ai

```txt
/last-ai [n]
```

Opens the last `n` assistant messages in an external editor. Text below `----` is inserted back into the Pi editor.

### processor

Registers background-process tools and `/processor`:

```txt
processor_start
processor_list
processor_output
processor_clean
/processor list
/processor output <id-or-name>
/processor clean [id-or-name]
```

Use it for Claude Code-style background tasks, for example starting a web server without blocking the agent turn:

```txt
processor_start({ "name": "web", "command": "npm run dev" })
```

Processes are kept for the current Pi session and stopped on session shutdown. Running processors are shown in a compact Pi UI widget; processors that exit on their own notify the agent with recent output and are removed from the active list. `processor_clean` stops and removes processors; `/processor list` focuses the same widget in a scrollable interactive list mode.

### coding-guardrails

Appends a coding discipline section to Pi's system prompt each turn. It emphasizes root-cause and owner-level repairs, architecture design and explicit approval gates, scoped cleanup of superseded workarounds, context-calibrated robustness, disciplined delegation, verification honesty, and dirty-worktree safety.

### provider-relays

Creates relay providers without duplicating model definitions. A provider id in the form `<source-provider>@<relay-name>` inherits the source provider's built-in model catalog while using the relay's endpoint and credentials from `~/.pi/agent/models.json`.

Example:

```json
{
  "providers": {
    "anthropic@backup": {
      "name": "Anthropic backup",
      "baseUrl": "https://relay.example.com",
      "apiKey": "$RELAY_API_KEY",
      "api": "anthropic-messages"
    },
    "openai@primary": {
      "baseUrl": "https://openai-relay.example.com/v1",
      "apiKey": "$OPENAI_RELAY_KEY",
      "api": "openai-completions",
      "modelOverrides": {
        "gpt-4o": {
          "contextWindow": 200000
        }
      }
    }
  }
}
```

A relay starts with the source provider's configuration and model catalog; fields declared on the relay override the inherited values. Model-level overrides use `modelOverrides` and are merged by model id, so fields added by newer Pi versions continue to pass through. The inherited model ids and names stay unchanged. Choose models with `/model source@relay/model-id`; run `/reload` after changing `models.json`.

### mcp-adapter

An MCP adapter for Pi 1.5.0, with explicit resource subscriptions. It registers `/mcp`, so Pi loads it in place of built-in MCP for the session. Tool calls, resource reads, and subscriptions use one `McpClient` per server. It uses the official Pi MCP client's stdio and streamable HTTP transports, including SSE resumption.

The adapter reads `~/.pi/agent/mcp.json` and trusted projects' `.pi/mcp.json`. Project overrides can change `enabled`, `exposure`, and `toolExposure`; extension server registrations are also supported. Tools retain the `mcp__<server>__<tool>` naming and `direct`, `codemode`, `deferred`, and `hidden` exposures. The resource tools are declared directly. Startup waits for the configured servers to finish connecting or fail within their request timeouts.

Resource tools:

```txt
list_mcp_resources({ server?, cursor? })
list_mcp_resource_templates({ server?, cursor? })
read_mcp_resource({ server, uri })
subscribe_mcp_resource({ server, uri })
unsubscribe_mcp_resource({ server, uri })
```

A URI returned by a tool or instantiated from a resource template can be used directly, even if `resources/list` is empty. To follow a run:

1. Explicitly subscribe to the returned URI.
2. Read it once immediately to obtain its current state, including an already completed result.
3. When `mcp-resource-update` arrives, explicitly read again. An update only means the URI changed; it does not establish success.
4. Explicitly unsubscribe when follow-up is complete. Cancellation releases observation and keeps the shared connection open.

Notifications are custom messages. They trigger an agent run when idle and queue a follow-up when busy. Tool results and notifications include an opaque `generation` identifying their logical MCP connection. A lost session emits `subscriptions_lost` with the affected URIs. A later request may establish a new session, but business requests and subscriptions are not automatically replayed. Ordinary SSE resumption remains the MCP transport's responsibility. Reload and session shutdown close the connections and discard subscriptions.

`/mcp` shows status. `/mcp reconnect <server>` explicitly replaces its session. `/mcp login <server>` displays an OAuth authorization URL to open in a browser; `/mcp logout <server>` clears that server's adapter credentials. OAuth credentials are stored separately under `~/.pi/agent/mcp-adapter-auth/`, keyed by server name and URL, so sign in again when switching from built-in MCP. Configured bearer headers and provider authentication (`auth.provider`) are supported. The command provides text status and authentication, rather than the built-in interactive configuration manager; edit `mcp.json` and run `/reload` for configuration changes.

Load just this extension for one invocation:

```bash
pi -e ./packages/mcp-adapter/src/index.ts
```

The root package manifest also includes it. Disable this extension in `pi config` and reload to restore built-in MCP. Loading the source above does not modify the Pi installation or global settings.

Verification uses real HTTP and stdio MCP fixtures and Pi SDK sessions with the local faux model provider. Actual Wings/Core subscription acceptance remains pending Wings 07-A.

## Pi package install

```bash
pi install ./ --approve
```

For quick testing:

```bash
pi -e ./ --approve
```
