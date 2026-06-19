# Pi Personal Tools

A personal Pi package with four extensions and one helper CLI.

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

### ssh-copy

Registers:

```txt
Alt+V
/paste-image
ssh_copy_image
```

In SSH sessions, `Alt+V` fetches the local clipboard image through `pi-image-bridge`, saves it on the remote machine, and inserts the remote path into the Pi editor.

Linux and Windows are the v1 clipboard targets. macOS autostart/status can be installed, but macOS clipboard extraction has no `pngpaste`, Swift, or AppleScript fallback in v1; it only works if the optional native clipboard dependency can read images.

Settings:

```json
{
  "@bingcoke/ext": {
    "sshCopy": {
      "enabled": true,
      "bridgeUrl": "http://127.0.0.1:38991",
      "remoteImageDir": ".pi/pasted-images",
      "shortcut": "alt+v",
      "insertMode": "path"
    }
  }
}
```

### processor

Registers background-process tools and `/processor`:

```txt
processor_start
processor_list
processor_output
processor_clean
/processor list
/processor compact
/processor output <id-or-name>
/processor clean [id-or-name]
```

Use it for Claude Code-style background tasks, for example starting a web server without blocking the agent turn:

```txt
processor_start({ "name": "web", "command": "npm run dev" })
```

Processes are kept for the current Pi session and stopped on session shutdown. Running processors are shown in a compact Pi UI widget; processors that exit on their own notify the agent with recent output and are removed from the active list. `processor_clean` stops and removes processors; `/processor list` focuses the same widget in a scrollable interactive list mode, and `/processor compact` returns it to compact mode.

## One-time local bridge setup

```bash
npm install
npm run bridge:install
npm run bridge:doctor
```

The installer configures local autostart and adds a managed SSH config block for zero-argument, no-touch usage:

```sshconfig
# >>> pi-image-bridge
Host *
  RemoteForward 127.0.0.1:38991 127.0.0.1:38991
  ExitOnForwardFailure no
# <<< pi-image-bridge
```

The managed block is idempotent. Re-running install updates the block instead of duplicating it. `pi-image-bridge uninstall` removes only the lines between the matching markers and leaves your other SSH config untouched.

`ProxyJump` and `ssh -J` work because the remote forward is carried inside the SSH connection. Manual nested SSH requires the second SSH hop to forward the bridge again, or replacing the nested hop with `ProxyJump`.

## Pi package install

```bash
pi install ./ --approve
```

For quick testing:

```bash
pi -e ./ --approve
```
