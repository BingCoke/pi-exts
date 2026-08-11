# Pi Personal Tools

A personal Pi package with five extensions.

## Extensions

### last-ai

```txt
/last-ai [n]
```

Opens the last `n` assistant messages in an external editor. Text below `----` is inserted back into the Pi editor.

### image-tool

Registers the `generate_image` tool. It calls an OpenAI-compatible image API.

Settings:

```json
{
  "@bingcoke/ext": {
    "imageTool": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY",
      "model": "gpt-image-1",
      "taskPollPath": "/tasks/{task_id}",
      "taskInitialDelayMs": 5000,
      "taskPollIntervalMs": 3000,
      "taskTimeoutMs": 180000
    }
  }
}
```

Environment overrides:

```bash
PI_IMAGE_API_BASE_URL=https://api.openai.com/v1
PI_IMAGE_API_KEY=sk-...
PI_IMAGE_MODEL=gpt-image-1
PI_IMAGE_TASK_POLL_PATH=/tasks/{task_id}
PI_IMAGE_TASK_INITIAL_DELAY_MS=5000
PI_IMAGE_TASK_POLL_INTERVAL_MS=3000
PI_IMAGE_TASK_TIMEOUT_MS=180000
```

The `generate_image` tool requires `size` and `output` values chosen by the agent. Relative output paths are resolved from the current project, parent directories are created automatically, and `output` must be an image file path such as `.pi/generated-images/cat.png`.

Standard OpenAI image responses are handled directly from `data[].b64_json` or `data[].url`. OpenAI-compatible providers that return an async `task_id` are also supported: the tool first uses a returned `poll_url` if present, otherwise it polls `taskPollPath` relative to `baseUrl`. The default `/tasks/{task_id}` works for providers such as Apimart.

Example tool input:

```json
{ "prompt": "a watercolor cat", "size": "1024x1024", "output": ".pi/generated-images/cat.png" }
```

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

Appends a compact coding discipline section to Pi's system prompt each turn. It emphasizes thinking before coding, simplicity, surgical edits, proactive subagent delegation, avoiding duplicate main-agent work, verification honesty, and dirty-worktree safety.

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
      "api": "openai-completions"
    }
  }
}
```

The inherited model ids and names stay unchanged. Choose models with `/model source@relay/model-id`; run `/reload` after changing `models.json`.

## Pi package install

```bash
pi install ./ --approve
```

For quick testing:

```bash
pi -e ./ --approve
```
