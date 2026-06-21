## Review Findings

### Important: Installer does not emit the required bridge security notice
- `docs/superpowers/plans/2026-06-16-pi-personal-tools.md:20` requires a concise notice that the zero-argument `Host *` remote forward is loopback-bound but remote processes may request the current clipboard image.
- `packages/pi-image-bridge/src/install.ts:71` defaults installs to `Host *`, `packages/pi-image-bridge/src/install.ts:93` writes that managed block, and `packages/pi-image-bridge/src/install.ts:138` only logs that the bridge was installed and a new SSH connection is needed.
- Why it matters: the bridge serves clipboard images without authentication at `packages/pi-image-bridge/src/server.ts:19` and `packages/pi-image-bridge/src/server.ts:31`; even with loopback binding, any process on a connected remote host can call the forwarded endpoint.
- Suggested fix: add the required one-time install notice before/after writing the SSH config, and consider an opt-in token/header if it can be propagated through `ssh-copy` without breaking no-touch SSH usage.

### Important: Server startup errors are not represented in the API
- `packages/pi-image-bridge/src/server.ts:37` awaits a promise that only resolves from `server.listen(...)`; it does not attach an `error` listener or reject on bind failures such as `EADDRINUSE`.
- Why it matters: port conflicts are a normal integration failure for a resident helper service, but callers and tests cannot reliably handle startup failure through the `createBridgeServer` promise.
- Suggested fix: create the server promise with `once("listening")` and `once("error")`, remove the opposite listener when one fires, and reject with the listen error so CLI/status diagnostics can report a clear failure.

### Important: Platform service installation failures are ignored
- `packages/pi-image-bridge/src/install.ts:108` calls Windows `schtasks` without checking `status` or `error`.
- `packages/pi-image-bridge/src/install.ts:117` ignores the result of `launchctl bootstrap`.
- `packages/pi-image-bridge/src/install.ts:125` falls back when `systemctl --user enable --now` exits non-zero, but `packages/pi-image-bridge/src/install.ts:129` writes the XDG autostart fallback without checking whether that fallback is usable.
- `packages/pi-image-bridge/src/install.ts:138` still prints a successful install message after these paths.
- Why it matters: users can end up with SSH config forwarding to a local service that is not actually configured to start, which makes the bridge appear installed while `ssh-copy` later fails.
- Suggested fix: check `spawnSync` `error` and `status`, return a structured install result or throw on unsupported/failing service setup, and make fallback/partial-success messages explicit.

### Important: Uninstall only cleans up Windows service state
- `packages/pi-image-bridge/src/install.ts:141` starts uninstall, `packages/pi-image-bridge/src/install.ts:144` removes the SSH config block, and `packages/pi-image-bridge/src/install.ts:145` only deletes the Windows scheduled task.
- `docs/superpowers/plans/2026-06-16-pi-personal-tools.md:22` requires full uninstall for Windows scheduled task, macOS LaunchAgent, Linux systemd user service, and Linux XDG autostart fallback.
- Why it matters: macOS and Linux installs can leave resident bridge services running or configured after `pi-image-bridge uninstall`, creating confusing state and continuing clipboard exposure.
- Suggested fix: delete/unload `~/Library/LaunchAgents/com.pi.image-bridge.plist`, disable/remove `~/.config/systemd/user/pi-image-bridge.service`, remove `~/.config/autostart/pi-image-bridge.desktop`, and report cleanup failures.

### Important: CLI argument parsing accepts malformed advanced options silently
- `packages/pi-image-bridge/src/install.ts:66` to `packages/pi-image-bridge/src/install.ts:72` parses `--ssh-host` by checking only that the next token exists.
- `packages/pi-image-bridge/src/install.ts:74` to `packages/pi-image-bridge/src/install.ts:77` parses `--remote-bind` the same way.
- Why it matters: inputs such as `--ssh-host --remote-bind 0.0.0.0` can treat another flag as a host, and unknown or misspelled flags are ignored; this is especially risky around SSH forwarding scope.
- Suggested fix: replace ad-hoc parsing with a small validated parser that rejects missing values, flag-like values, unknown flags, invalid port values, and invalid bind addresses; add tests for malformed arguments.

### Important: Image tool parameter schema is wider than the request type sent to the API
- `packages/image-tool/src/index.ts:14` to `packages/image-tool/src/index.ts:16` narrows `responseFormat` and `outputFormat` in `BuildImageRequestInput`.
- `packages/image-tool/src/index.ts:304` and `packages/image-tool/src/index.ts:305` expose both parameters as arbitrary `Type.String(...)` values.
- `packages/image-tool/src/index.ts:335` and `packages/image-tool/src/index.ts:336` then cast runtime strings to the narrower TypeScript unions before sending them.
- Why it matters: TypeScript appears to constrain the API request, but Pi/runtime input can still send invalid provider options and fail only after an external API call.
- Suggested fix: model constrained fields with `Type.Union([Type.Literal(...)])`, add numeric bounds for `outputCompression`, and validate/normalize provider-specific options before `buildImageRequest`.

### Important: Base64 image saves can report success for corrupt payloads
- `packages/image-tool/src/index.ts:80` to `packages/image-tool/src/index.ts:82` accepts the first non-HTTP string under broad image-like keys as base64.
- `packages/image-tool/src/index.ts:184` to `packages/image-tool/src/index.ts:187` writes `Buffer.from(b64, "base64")` directly; Node's base64 decoder is permissive and does not guarantee the input was a valid image.
- Why it matters: a provider error string in an image-like field, a truncated payload, or malformed base64 can produce a corrupt file while the tool returns `Generated image saved...`.
- Suggested fix: validate base64 syntax/decoded length before writing and, ideally, verify the decoded bytes match the requested or inferred image format signature.

### Minor: macOS clipboard diagnostics are unconditional rather than capability-based
- `packages/pi-image-bridge/src/clipboard.ts:9` to `packages/pi-image-bridge/src/clipboard.ts:11` returns the macOS limitation hint solely from `process.platform`.
- `packages/pi-image-bridge/src/install.ts:160` to `packages/pi-image-bridge/src/install.ts:161` prints that hint during `doctor` without checking whether the optional native clipboard dependency can currently read an image.
- Why it matters: the diagnostic can say extraction is unavailable even on a macOS machine where the optional native dependency works, reducing trust in `doctor` output.
- Suggested fix: expose a capability probe that attempts the native reader for diagnostics, and print the limitation only when the probe fails or the optional dependency is unavailable.

### Minor: Bridge JSON contract is not exported as a typed integration boundary
- `packages/pi-image-bridge/src/server.ts:30` to `packages/pi-image-bridge/src/server.ts:31` defines the `/clipboard-image` response shape inline as `{ mimeType, base64 }`.
- `packages/pi-image-bridge/src/clipboard.ts:4` to `packages/pi-image-bridge/src/clipboard.ts:7` exports only the internal byte-oriented `ClipboardImage` type, not the HTTP JSON contract.
- Why it matters: bridge producers and consumers have no shared compile-time contract for the wire shape, so future changes can drift without TypeScript catching them.
- Suggested fix: export a `BridgeClipboardImageResponse` type and small encoder/decoder or schema from the bridge package, and use it in server tests and the SSH-copy consumer.

## Validation
- `C:\Users\Administrator\project\ts\pi-ext\plan.md` was requested but not present.
- `C:\Users\Administrator\project\ts\pi-ext\progress.md` was requested but not present.
- `npm test -- --run tests/pi-image-bridge tests/image-tool` passed: 4 test files, 19 tests.
- `npm run typecheck` passed.
- Pre-existing worktree state observed before writing this report: `package.json` modified; `cli-tools-cheatsheet.md` and `themes/` untracked.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed only packages/pi-image-bridge and packages/image-tool source plus directly relevant tests/docs; no project/source files were modified."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Findings include severity, file:line references, why each issue matters, and suggested fixes; validation commands and results are recorded."
    }
  ],
  "changedFiles": [
    "review/pi-image-design.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read C:\\Users\\Administrator\\project\\ts\\pi-ext\\plan.md",
      "result": "failed",
      "summary": "Requested context file was not present."
    },
    {
      "command": "read C:\\Users\\Administrator\\project\\ts\\pi-ext\\progress.md",
      "result": "failed",
      "summary": "Requested context file was not present."
    },
    {
      "command": "find packages/pi-image-bridge and packages/image-tool source files",
      "result": "passed",
      "summary": "Found pi-image-bridge src/cli.ts, src/clipboard.ts, src/install.ts, src/server.ts and image-tool src/index.ts."
    },
    {
      "command": "read reviewed source, tests, package.json, tsconfig, README, and plan excerpts",
      "result": "passed",
      "summary": "Inspected implementation, tests, package wiring, and documented requirements."
    },
    {
      "command": "git -C C:/Users/Administrator/project/ts/pi-ext status --short",
      "result": "passed",
      "summary": "Observed pre-existing modified package.json and untracked cli-tools-cheatsheet.md/themes before report creation."
    },
    {
      "command": "git -C C:/Users/Administrator/project/ts/pi-ext diff -- packages/pi-image-bridge packages/image-tool tests/pi-image-bridge tests/image-tool package.json tsconfig.build.json tsconfig.json",
      "result": "passed",
      "summary": "Confirmed no target-package diff; package.json had unrelated themes manifest change."
    },
    {
      "command": "npm test -- --run tests/pi-image-bridge tests/image-tool",
      "result": "passed",
      "summary": "Vitest passed: 4 files, 19 tests."
    },
    {
      "command": "npm run typecheck",
      "result": "passed",
      "summary": "TypeScript typecheck completed with no errors."
    }
  ],
  "validationOutput": [
    "Test Files 4 passed (4); Tests 19 passed (19).",
    "tsc --noEmit completed with no output/errors."
  ],
  "residualRisks": [
    "plan.md and progress.md were requested but absent, so review used available source, tests, README, and docs/superpowers plan evidence.",
    "No live bridge install/uninstall or platform service commands were executed; findings are based on source inspection and unit tests."
  ],
  "noStagedFiles": true,
  "notes": "Only the requested review report was written; pre-existing unstaged/untracked files were not modified."
}
```
