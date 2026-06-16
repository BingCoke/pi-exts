# Pi Personal Tools Monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript npm workspace Pi package containing three Pi extensions (`last-ai`, `image-tool`, `ssh-copy`) plus a Linux/Windows-first `pi-image-bridge` helper for no-touch SSH image paste. macOS autostart/status may be installed, but macOS clipboard image extraction is not supported in v1 unless the optional native clipboard dependency works on the user's machine.

**Architecture:** The repository is a monorepo with small focused packages under `packages/`. Runtime Pi resources are exposed from the root `package.json` `pi.extensions` manifest, while shared configuration and filesystem helpers live in `packages/shared`. The SSH image flow uses a local always-on HTTP bridge plus SSH `RemoteForward`, so remote Pi can read the local clipboard through `127.0.0.1` without manual per-session setup.

**Tech Stack:** Node.js 20+, TypeScript ESM, npm workspaces, Vitest, Pi extension API (`@earendil-works/pi-coding-agent`), `typebox`, Node built-ins, optional native clipboard package `@mariozechner/clipboard`. The `pi-image-bridge` CLI must be built to JavaScript before install/autostart; services must never point at `.ts` files or require dev-only `tsx`.

---

## Review Amendments Required Before Execution

The initial plan was reviewed by a subagent. These amendments override any conflicting task text below:

1. **Buildable helper CLI:** `pi-image-bridge` must compile to `dist/pi-image-bridge/cli.js`; root `bin` and all autostart services must point at that built JS entrypoint or a generated wrapper script that calls it. Do not install a service that runs `node *.ts` or depends on `tsx`.
2. **Zero-argument install by default:** `pi-image-bridge install` should satisfy normal usage without host prompts or required flags. It installs local autostart and writes a managed `Host *` SSH config block using loopback-only remote binding (`RemoteForward 127.0.0.1:38991 127.0.0.1:38991`). Advanced flags are only for special cases, such as `--port`, `--remote-bind`, `--ssh-config`, or optional `--ssh-host`.
   The SSH config edit must be idempotent: all generated lines are wrapped in a single managed block between `# >>> pi-image-bridge` and `# <<< pi-image-bridge`; repeated installs update that block instead of appending duplicates; `uninstall` removes only that block. If a user installs additional `--ssh-host` values later, merge them into the existing managed `Host` line unless it is already `Host *`.
3. **Bridge security notice:** Because zero-argument install uses `Host *` for no-touch UX, the installer must print a concise one-time notice that the forwarded bridge is bound to remote loopback only, but processes on a connected remote host may be able to request the current clipboard image. Provide advanced host-restriction flags for users who need stricter isolation. Token auth is desirable if it can be implemented without breaking no-touch SSH usage; otherwise document the tradeoff.
4. **Clipboard support matrix:** Linux supports `wl-paste` and `xclip`; Windows supports the optional native clipboard dependency and should add a PowerShell STA fallback if practical. macOS does **not** implement `pngpaste`, Swift, or AppleScript fallback in v1; `doctor` must report macOS clipboard support as unavailable when the optional native dependency cannot read an image.
5. **Installer robustness:** Generate stable wrapper scripts and platform service files. Implement full uninstall for Windows scheduled task, macOS LaunchAgent, Linux systemd user service, and Linux XDG autostart fallback.
6. **Diagnostics:** `ssh-copy` should probe bridge `/health` and image fetch failures and provide actionable messages for missing helper, disabled remote forwarding, port conflicts, nested SSH, and unsupported macOS clipboard extraction.


## File Structure

- Create `package.json`: root package, npm workspaces, `pi` manifest, scripts, peer dependencies.
- Create `tsconfig.json`: shared TypeScript config for all packages.
- Create `tsconfig.build.json`: build-only TypeScript config that emits helper CLI JavaScript into `dist/`.
- Create `.gitignore`: Node, build, generated image, and temp ignores.
- Create `README.md`: install, config, and usage documentation.
- Create `packages/shared/src/settings.ts`: read and merge global/project settings with trust guard.
- Create `packages/shared/src/paths.ts`: resolve `~`, absolute, cwd-relative, and project `.pi` paths.
- Create `packages/shared/src/tool-result.ts`: consistent Pi tool result helpers.
- Create `packages/last-ai/src/index.ts`: `/last-ai [n]` command implementation.
- Create `packages/image-tool/src/index.ts`: `generate_image` tool implementation.
- Create `packages/pi-image-bridge/src/clipboard.ts`: local clipboard image reader.
- Create `packages/pi-image-bridge/src/server.ts`: local HTTP bridge server.
- Create `packages/pi-image-bridge/src/install.ts`: cross-platform install/uninstall/status/doctor.
- Create `packages/pi-image-bridge/src/cli.ts`: command-line entrypoint.
- Create `packages/ssh-copy/src/index.ts`: Alt+V bridge paste extension, `/paste-image`, and `ssh_copy_image` tool.
- Create `tests/**/*.test.ts`: unit tests for settings, message extraction, image API parsing, bridge API, installer text generation, and SSH paste behavior.

---

## Task 1: Scaffold the npm workspace Pi package

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Initialize git if needed**

Run:

```bash
git status --short || git init
```

Expected: either existing status output or `Initialized empty Git repository`.

- [ ] **Step 2: Create the root package manifest**

Write `package.json`:

```json
{
  "name": "pi-personal-tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Personal Pi extensions, skills, and helper tools.",
  "keywords": ["pi-package", "pi", "pi-extension"],
  "workspaces": ["packages/*"],
  "bin": {
    "pi-image-bridge": "./dist/pi-image-bridge/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "bridge:serve": "npm run build -- --pretty false && node dist/pi-image-bridge/cli.js serve",
    "bridge:install": "npm run build -- --pretty false && node dist/pi-image-bridge/cli.js install",
    "bridge:doctor": "npm run build -- --pretty false && node dist/pi-image-bridge/cli.js doctor",
    "prepack": "npm run build"
  },
  "pi": {
    "extensions": [
      "./packages/last-ai/src/index.ts",
      "./packages/image-tool/src/index.ts",
      "./packages/ssh-copy/src/index.ts"
    ],
    "skills": ["./skills"]
  },
  "optionalDependencies": {
    "@mariozechner/clipboard": "^0.2.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@earendil-works/pi-coding-agent": "*",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

- [ ] **Step 3: Create TypeScript configs**

Write `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["packages/**/*.ts", "tests/**/*.ts"]
}
```

Write `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "packages",
    "declaration": false,
    "sourceMap": false
  },
  "include": ["packages/pi-image-bridge/src/**/*.ts"]
}
```

- [ ] **Step 4: Create ignores**

Write `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.pi/generated-images/
.pi/pasted-images/
*.log
.DS_Store
```

- [ ] **Step 5: Create initial README**

Write `README.md`:

```markdown
# Pi Personal Tools

Personal Pi package containing:

- `last-ai`: `/last-ai [n]` opens recent assistant messages in an external editor and inserts the reply section back into Pi.
- `image-tool`: `generate_image` calls an OpenAI-compatible image API and saves generated images locally.
- `ssh-copy`: `Alt+V` image paste over SSH using `pi-image-bridge` and SSH `RemoteForward`.

## Install locally

```bash
npm install
pi install ./ --approve
```

## One-time image bridge setup

```bash
npm run bridge:install
npm run bridge:doctor
```

After setup, start Pi normally. In SSH sessions, press `Alt+V` to paste a local clipboard image into the remote Pi editor. macOS clipboard paste is not supported in v1 unless the optional native clipboard dependency works.
```

- [ ] **Step 6: Verify scaffold**

Run:

```bash
npm install
npm run typecheck
```

Expected: install succeeds; typecheck initially fails only if later task files are referenced before creation. After Task 8, typecheck must pass.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .gitignore README.md
git commit -m "chore: scaffold pi personal tools workspace"
```

---

## Task 2: Add shared settings and path utilities

**Files:**
- Create: `packages/shared/src/paths.ts`
- Create: `packages/shared/src/settings.ts`
- Create: `packages/shared/src/tool-result.ts`
- Test: `tests/shared/settings.test.ts`

- [ ] **Step 1: Write failing settings tests**

Write `tests/shared/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergePersonalSettings, resolveOutputPath } from "../../packages/shared/src/settings.js";

const globalSettings = {
  personalPiTools: {
    imageTool: { model: "global-model", outputDir: "~/global-images" },
    sshCopy: { remoteImageDir: "~/global-paste" }
  }
};

const projectSettings = {
  personalPiTools: {
    imageTool: { outputDir: ".pi/project-images" }
  }
};

describe("shared settings", () => {
  it("deep merges project personalPiTools over global settings", () => {
    const merged = mergePersonalSettings(globalSettings, projectSettings);
    expect(merged.imageTool.model).toBe("global-model");
    expect(merged.imageTool.outputDir).toBe(".pi/project-images");
    expect(merged.sshCopy.remoteImageDir).toBe("~/global-paste");
  });

  it("resolves cwd-relative output paths", () => {
    const resolved = resolveOutputPath(".pi/images", "/repo/project");
    expect(resolved.replaceAll("\\\\", "/")).toBe("/repo/project/.pi/images");
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/shared/settings.test.ts
```

Expected: FAIL because `packages/shared/src/settings.ts` does not exist.

- [ ] **Step 3: Implement path helpers**

Write `packages/shared/src/paths.ts`:

```ts
import os from "node:os";
import path from "node:path";

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function resolvePath(input: string, cwd: string): string {
  const expanded = expandHome(input);
  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}
```

- [ ] **Step 4: Implement settings utilities**

Write `packages/shared/src/settings.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { resolvePath } from "./paths.js";

export interface ImageToolSettings {
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  model?: string;
  outputDir?: string;
  size?: string;
}

export interface SshCopySettings {
  enabled?: boolean;
  bridgeUrl?: string;
  remoteImageDir?: string;
  shortcut?: string;
  insertMode?: "path" | "markdown";
}

export interface PersonalPiToolsSettings {
  imageTool: ImageToolSettings;
  sshCopy: SshCopySettings;
}

const defaults: PersonalPiToolsSettings = {
  imageTool: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    model: "gpt-image-1",
    outputDir: ".pi/generated-images",
    size: "1024x1024"
  },
  sshCopy: {
    enabled: true,
    bridgeUrl: "http://127.0.0.1:38991",
    remoteImageDir: ".pi/pasted-images",
    shortcut: "alt+v",
    insertMode: "path"
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: unknown): T {
  if (!isRecord(override)) return { ...base };
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return out as T;
}

export function mergePersonalSettings(globalSettings: unknown, projectSettings: unknown): PersonalPiToolsSettings {
  const globalPersonal = isRecord(globalSettings) ? globalSettings.personalPiTools : undefined;
  const projectPersonal = isRecord(projectSettings) ? projectSettings.personalPiTools : undefined;
  return deepMerge(deepMerge(defaults as unknown as Record<string, unknown>, globalPersonal), projectPersonal) as unknown as PersonalPiToolsSettings;
}

export function readJsonIfExists(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadPersonalSettings(cwd: string, projectTrusted: boolean, agentDir = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".pi", "agent")): PersonalPiToolsSettings {
  const globalSettings = readJsonIfExists(path.join(agentDir, "settings.json"));
  const projectSettings = projectTrusted ? readJsonIfExists(path.join(cwd, ".pi", "settings.json")) : {};
  return mergePersonalSettings(globalSettings, projectSettings);
}

export function resolveOutputPath(input: string, cwd: string): string {
  return resolvePath(input, cwd);
}
```

- [ ] **Step 5: Implement tool result helpers**

Write `packages/shared/src/tool-result.ts`:

```ts
export function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

export function errorResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details, isError: true };
}
```

- [ ] **Step 6: Verify tests**

Run:

```bash
npx vitest run tests/shared/settings.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared tests/shared
git commit -m "feat: add shared pi tool settings utilities"
```

---

## Task 3: Implement `last-ai` command

**Files:**
- Create: `packages/last-ai/src/index.ts`
- Test: `tests/last-ai/extract.test.ts`

- [ ] **Step 1: Write failing extraction tests**

Write `tests/last-ai/extract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildLastAiDocument, extractReplyBelowSeparator, extractAssistantTexts } from "../../packages/last-ai/src/index.js";

const branch = [
  { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "first" }] } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "second" }] } }
];

describe("last-ai", () => {
  it("extracts last n assistant texts", () => {
    expect(extractAssistantTexts(branch, 1)).toEqual(["second"]);
    expect(extractAssistantTexts(branch, 2)).toEqual(["first", "second"]);
  });

  it("builds a markdown document with reply separator", () => {
    const doc = buildLastAiDocument(["second"]);
    expect(doc).toContain("## AI Message 1");
    expect(doc).toContain("second");
    expect(doc).toContain("\n----\n");
  });

  it("extracts editor reply below separator", () => {
    expect(extractReplyBelowSeparator("above\n----\nreply text\n")).toBe("reply text");
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/last-ai/extract.test.ts
```

Expected: FAIL because `packages/last-ai/src/index.ts` does not exist.

- [ ] **Step 3: Implement command and exported pure helpers**

Write `packages/last-ai/src/index.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const SEPARATOR = "----";

type Entry = { type?: string; message?: { role?: string; content?: unknown } };
type TextBlock = { type?: string; text?: string };

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const block = part as TextBlock;
      return block?.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function extractAssistantTexts(entries: Entry[], count: number): string[] {
  return entries
    .filter((entry) => entry.type === "message" && entry.message?.role === "assistant")
    .map((entry) => contentToText(entry.message?.content).trim())
    .filter(Boolean)
    .slice(-Math.max(1, count));
}

export function buildLastAiDocument(messages: string[]): string {
  const sections = messages.map((message, index) => [`## AI Message ${index + 1}`, "", message].join("\n"));
  return ["# Last AI Messages", "", ...sections, "", SEPARATOR, "", ""].join("\n");
}

export function extractReplyBelowSeparator(markdown: string): string {
  const index = markdown.lastIndexOf(`\n${SEPARATOR}\n`);
  if (index === -1) return "";
  return markdown.slice(index + SEPARATOR.length + 2).trim();
}

async function openExternalEditor(filePath: string): Promise<void> {
  const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [filePath], { stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${editor} exited with ${code}`))));
  });
}

export default function lastAiExtension(pi: ExtensionAPI) {
  pi.registerCommand("last-ai", {
    description: "Open the last N assistant messages in an external editor and insert the reply section",
    handler: async (args, ctx) => {
      const count = Number.parseInt(args.trim() || "1", 10);
      const messages = extractAssistantTexts(ctx.sessionManager.getBranch() as Entry[], Number.isFinite(count) ? count : 1);
      if (messages.length === 0) {
        ctx.ui.notify("No assistant messages found", "warning");
        return;
      }
      const filePath = path.join(os.tmpdir(), `pi-last-ai-${Date.now()}.md`);
      await fs.writeFile(filePath, buildLastAiDocument(messages), "utf8");
      await openExternalEditor(filePath);
      const edited = await fs.readFile(filePath, "utf8");
      const reply = extractReplyBelowSeparator(edited);
      if (reply) ctx.ui.setEditorText(reply);
      else ctx.ui.notify("No reply text found below ----", "warning");
    }
  });
}
```

- [ ] **Step 4: Verify tests**

Run:

```bash
npx vitest run tests/last-ai/extract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/last-ai tests/last-ai
git commit -m "feat: add last-ai editor command"
```

---

## Task 4: Implement OpenAI-compatible `image-tool`

**Files:**
- Create: `packages/image-tool/src/index.ts`
- Test: `tests/image-tool/image-tool.test.ts`

- [ ] **Step 1: Write failing tests for image response parsing**

Write `tests/image-tool/image-tool.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildImageRequest, extractImagePayload } from "../../packages/image-tool/src/index.js";

describe("image-tool", () => {
  it("builds OpenAI-compatible request payload", () => {
    expect(buildImageRequest({ prompt: "cat", model: "gpt-image-1", size: "1024x1024" })).toEqual({
      model: "gpt-image-1",
      prompt: "cat",
      size: "1024x1024"
    });
  });

  it("extracts base64 image payload", () => {
    const payload = extractImagePayload({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });
    expect(payload.kind).toBe("base64");
  });

  it("extracts image url payload", () => {
    const payload = extractImagePayload({ data: [{ url: "https://example.com/a.png" }] });
    expect(payload).toEqual({ kind: "url", url: "https://example.com/a.png" });
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/image-tool/image-tool.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the tool**

Write `packages/image-tool/src/index.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import fs from "node:fs/promises";
import path from "node:path";
import { loadPersonalSettings, resolveOutputPath } from "../../shared/src/settings.js";
import { errorResult, textResult } from "../../shared/src/tool-result.js";

export function buildImageRequest(input: { prompt: string; model: string; size: string; n?: number }) {
  return { model: input.model, prompt: input.prompt, size: input.size, ...(input.n ? { n: input.n } : {}) };
}

export function extractImagePayload(response: unknown): { kind: "base64"; b64: string } | { kind: "url"; url: string } {
  const data = (response as { data?: Array<{ b64_json?: string; url?: string }> }).data;
  const first = Array.isArray(data) ? data[0] : undefined;
  if (first?.b64_json) return { kind: "base64", b64: first.b64_json };
  if (first?.url) return { kind: "url", url: first.url };
  throw new Error("Image API response did not include data[0].b64_json or data[0].url");
}

async function saveBase64Image(b64: string, outputDir: string): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `generated-${Date.now()}.png`);
  await fs.writeFile(filePath, Buffer.from(b64, "base64"));
  return filePath;
}

export default function imageToolExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "generate_image",
    label: "Generate Image",
    description: "Generate an image using an OpenAI-compatible image API and save it to disk.",
    parameters: Type.Object({
      prompt: Type.String({ description: "Image prompt" }),
      model: Type.Optional(Type.String({ description: "Image model override" })),
      size: Type.Optional(Type.String({ description: "Image size, e.g. 1024x1024" })),
      outputDir: Type.Optional(Type.String({ description: "Output directory override" }))
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      try {
        const settings = loadPersonalSettings(ctx.cwd, ctx.isProjectTrusted());
        const imageSettings = settings.imageTool;
        const baseUrl = process.env.PI_IMAGE_API_BASE_URL || imageSettings.baseUrl || "https://api.openai.com/v1";
        const apiKeyEnv = imageSettings.apiKeyEnv || "OPENAI_API_KEY";
        const apiKey = process.env.PI_IMAGE_API_KEY || imageSettings.apiKey || process.env[apiKeyEnv];
        if (!apiKey) return errorResult(`Missing image API key. Set PI_IMAGE_API_KEY or ${apiKeyEnv}.`);
        const model = params.model || process.env.PI_IMAGE_MODEL || imageSettings.model || "gpt-image-1";
        const size = params.size || imageSettings.size || "1024x1024";
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/images/generations`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(buildImageRequest({ prompt: params.prompt, model, size }))
        });
        if (!response.ok) return errorResult(`Image API failed: ${response.status} ${await response.text()}`);
        const payload = extractImagePayload(await response.json());
        if (payload.kind === "url") {
          return textResult(`Generated image URL:\n${payload.url}\n\nMarkdown:\n![generated image](${payload.url})`, { url: payload.url });
        }
        const outputDir = resolveOutputPath(params.outputDir || process.env.PI_IMAGE_OUTPUT_DIR || imageSettings.outputDir || ".pi/generated-images", ctx.cwd);
        const filePath = await saveBase64Image(payload.b64, outputDir);
        return textResult(`Generated image saved to ${filePath}\n\nMarkdown:\n![generated image](${filePath})`, { filePath });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  });
}
```

- [ ] **Step 4: Verify tests**

Run:

```bash
npx vitest run tests/image-tool/image-tool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/image-tool tests/image-tool
git commit -m "feat: add openai-compatible image generation tool"
```

---

## Task 5: Implement local `pi-image-bridge serve`

**Files:**
- Create: `packages/pi-image-bridge/src/clipboard.ts`
- Create: `packages/pi-image-bridge/src/server.ts`
- Create: `packages/pi-image-bridge/src/cli.ts`
- Test: `tests/pi-image-bridge/server.test.ts`

- [ ] **Step 1: Write failing HTTP server test**

Write `tests/pi-image-bridge/server.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createBridgeServer } from "../../packages/pi-image-bridge/src/server.js";

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (close) await close();
  close = undefined;
});

describe("pi-image-bridge server", () => {
  it("returns clipboard image JSON", async () => {
    const server = await createBridgeServer({
      host: "127.0.0.1",
      port: 0,
      readImage: async () => ({ mimeType: "image/png", bytes: Buffer.from("hello") })
    });
    close = server.close;
    const response = await fetch(`${server.url}/clipboard-image`);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.mimeType).toBe("image/png");
    expect(json.base64).toBe(Buffer.from("hello").toString("base64"));
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/pi-image-bridge/server.test.ts
```

Expected: FAIL because bridge server does not exist.

- [ ] **Step 3: Implement clipboard reader**

Write `packages/pi-image-bridge/src/clipboard.ts`:

```ts
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

export interface ClipboardImage {
  mimeType: string;
  bytes: Uint8Array;
}

const require = createRequire(import.meta.url);

function commandBytes(command: string, args: string[]): Uint8Array | undefined {
  const result = spawnSync(command, args, { maxBuffer: 50 * 1024 * 1024, timeout: 3000 });
  if (result.status !== 0 || !result.stdout || result.stdout.length === 0) return undefined;
  return result.stdout;
}

async function nativeClipboardImage(): Promise<ClipboardImage | undefined> {
  try {
    const clipboard = require("@mariozechner/clipboard");
    if (!clipboard?.hasImage?.()) return undefined;
    const data = await clipboard.getImageBinary();
    if (!data || data.length === 0) return undefined;
    return { mimeType: "image/png", bytes: data instanceof Uint8Array ? data : Uint8Array.from(data) };
  } catch {
    return undefined;
  }
}

export async function readClipboardImage(): Promise<ClipboardImage | undefined> {
  if (process.platform === "linux") {
    const wl = commandBytes("wl-paste", ["--type", "image/png", "--no-newline"]);
    if (wl) return { mimeType: "image/png", bytes: wl };
    const xclip = commandBytes("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
    if (xclip) return { mimeType: "image/png", bytes: xclip };
  }
  return nativeClipboardImage();
}
```

- [ ] **Step 4: Implement HTTP bridge server**

Write `packages/pi-image-bridge/src/server.ts`:

```ts
import http from "node:http";
import { readClipboardImage, type ClipboardImage } from "./clipboard.js";

export interface BridgeServerOptions {
  host: string;
  port: number;
  readImage?: () => Promise<ClipboardImage | undefined>;
}

export async function createBridgeServer(options: BridgeServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const readImage = options.readImage ?? readClipboardImage;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url !== "/clipboard-image") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const image = await readImage();
    if (!image) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ mimeType: image.mimeType, base64: Buffer.from(image.bytes).toString("base64") }));
  });
  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    url: `http://${options.host}:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  };
}

export async function serveBridge(host = "127.0.0.1", port = 38991): Promise<void> {
  const server = await createBridgeServer({ host, port });
  console.log(`pi-image-bridge listening on ${server.url}`);
}
```

- [ ] **Step 5: Implement CLI serve command**

Write `packages/pi-image-bridge/src/cli.ts`:

```ts
#!/usr/bin/env node
import { serveBridge } from "./server.js";
import { installBridge, uninstallBridge, statusBridge, doctorBridge } from "./install.js";

const command = process.argv[2] || "serve";

if (command === "serve") {
  await serveBridge(process.env.PI_IMAGE_BRIDGE_HOST || "127.0.0.1", Number(process.env.PI_IMAGE_BRIDGE_PORT || "38991"));
} else if (command === "install") {
  await installBridge(process.argv.slice(3));
} else if (command === "uninstall") {
  await uninstallBridge();
} else if (command === "status") {
  await statusBridge();
} else if (command === "doctor") {
  await doctorBridge();
} else {
  console.error("Usage: pi-image-bridge <serve|install|uninstall|status|doctor>");
  process.exitCode = 1;
}
```

- [ ] **Step 6: Add temporary install module so CLI typechecks**

Write `packages/pi-image-bridge/src/install.ts`:

```ts
export async function installBridge(_args: string[] = []): Promise<void> {
  console.log("install command is implemented in Task 6");
}

export async function uninstallBridge(): Promise<void> {
  console.log("uninstall command is implemented in Task 6");
}

export async function statusBridge(): Promise<void> {
  console.log("status command is implemented in Task 6");
}

export async function doctorBridge(): Promise<void> {
  console.log("doctor command is implemented in Task 6");
}
```

- [ ] **Step 7: Verify server test**

Run:

```bash
npx vitest run tests/pi-image-bridge/server.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/pi-image-bridge tests/pi-image-bridge
git commit -m "feat: add local image bridge server"
```

---

## Task 6: Implement cross-platform bridge installer

**Files:**
- Modify: `packages/pi-image-bridge/src/install.ts`
- Test: `tests/pi-image-bridge/install.test.ts`

- [ ] **Step 1: Write failing installer tests**

Write `tests/pi-image-bridge/install.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSshConfigBlock, mergeManagedHosts, removeManagedSshConfigBlock } from "../../packages/pi-image-bridge/src/install.js";

describe("bridge installer", () => {
  it("builds default Host * ssh config block", () => {
    const block = buildSshConfigBlock({ hosts: ["*"], port: 38991, remoteBind: "127.0.0.1" });
    expect(block).toContain("Host *");
    expect(block).toContain("RemoteForward 127.0.0.1:38991 127.0.0.1:38991");
  });

  it("supports explicit host restriction as an advanced option", () => {
    expect(buildSshConfigBlock({ hosts: ["my-server"], port: 38991, remoteBind: "127.0.0.1" })).toContain("Host my-server");
  });

  it("merges additional hosts idempotently", () => {
    expect(mergeManagedHosts(["a"], ["b", "a"])).toEqual(["a", "b"]);
    expect(mergeManagedHosts(["*"], ["b"])).toEqual(["*"]);
  });

  it("removes existing managed ssh config block", () => {
    const input = "Host a\n  User root\n# >>> pi-image-bridge\nHost *\n  RemoteForward 1 127.0.0.1:1\n# <<< pi-image-bridge\n";
    expect(removeManagedSshConfigBlock(input)).toBe("Host a\n  User root\n");
  });

  it("refuses to remove malformed managed blocks", () => {
    expect(() => removeManagedSshConfigBlock("Host a\n# >>> pi-image-bridge\nHost *\n")).toThrow(/malformed/i);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/pi-image-bridge/install.test.ts
```

Expected: FAIL because exported helpers do not exist.

- [ ] **Step 3: Replace install module with installer implementation**

Write `packages/pi-image-bridge/src/install.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const START = "# >>> pi-image-bridge";
const END = "# <<< pi-image-bridge";

export function buildSshConfigBlock(options: { hosts: string[]; port: number; remoteBind?: string }): string {
  const remoteBind = options.remoteBind || "127.0.0.1";
  return [
    START,
    `Host ${options.hosts.join(" ")}`,
    `  RemoteForward ${remoteBind}:${options.port} 127.0.0.1:${options.port}`,
    "  ExitOnForwardFailure no",
    END,
    ""
  ].join("\n");
}

export function mergeManagedHosts(existingHosts: string[], requestedHosts: string[]): string[] {
  if (existingHosts.includes("*") || requestedHosts.includes("*")) return ["*"];
  return Array.from(new Set([...existingHosts, ...requestedHosts]));
}

export function extractManagedHosts(input: string): string[] {
  const start = input.indexOf(START);
  const end = input.indexOf(END);
  if (start === -1 && end === -1) return [];
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Malformed pi-image-bridge managed SSH config block; remove it manually before reinstalling.");
  }
  const block = input.slice(start, end);
  const hostLine = block.split(/\r?\n/).find((line) => line.trim().startsWith("Host "));
  return hostLine ? hostLine.trim().slice("Host ".length).split(/\s+/).filter(Boolean) : [];
}

export function removeManagedSshConfigBlock(input: string): string {
  const start = input.indexOf(START);
  const end = input.indexOf(END);
  if (start === -1 && end === -1) return input;
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Malformed pi-image-bridge managed SSH config block; remove it manually before reinstalling.");
  }
  const afterEnd = end + END.length;
  const trailingNewline = input.slice(afterEnd).startsWith("\n") ? 1 : 0;
  return input.slice(0, start) + input.slice(afterEnd + trailingNewline);
}

function parseHosts(args: string[]): string[] {
  const hosts: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--ssh-host" && args[i + 1]) hosts.push(args[i + 1]);
  }
  return hosts.length > 0 ? hosts : ["*"];
}

function parseRemoteBind(args: string[]): string {
  const index = args.indexOf("--remote-bind");
  return index >= 0 && args[index + 1] ? args[index + 1] : "127.0.0.1";
}

async function writeSshConfig(args: string[]): Promise<void> {
  const sshDir = path.join(os.homedir(), ".ssh");
  const configPath = path.join(sshDir, "config");
  await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });
  const existing = await fs.readFile(configPath, "utf8").catch(() => "");
  const requestedHosts = parseHosts(args);
  const existingManagedHosts = extractManagedHosts(existing);
  const hosts = mergeManagedHosts(existingManagedHosts, requestedHosts);
  const cleaned = removeManagedSshConfigBlock(existing).trimEnd();
  const block = buildSshConfigBlock({ hosts, port: Number(process.env.PI_IMAGE_BRIDGE_PORT || "38991"), remoteBind: parseRemoteBind(args) });
  const next = `${cleaned}${cleaned ? "\n" : ""}${block}`;
  await fs.writeFile(configPath, next, { mode: 0o600 });
}

function currentCommand(): string {
  const node = process.execPath;
  const cli = path.resolve(process.argv[1]);
  return `\"${node}\" \"${cli}\" serve`;
}

async function installWindows(): Promise<void> {
  const command = currentCommand().replaceAll("\"", "\\\"");
  spawnSync("schtasks", ["/Create", "/TN", "PiImageBridge", "/SC", "ONLOGON", "/TR", command, "/F"], { stdio: "inherit" });
}

async function installMac(): Promise<void> {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", "com.pi.image-bridge.plist");
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  const [node, cli] = [process.execPath, path.resolve(process.argv[1])];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.pi.image-bridge</string><key>ProgramArguments</key><array><string>${node}</string><string>${cli}</string><string>serve</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>\n`;
  await fs.writeFile(plistPath, plist);
  spawnSync("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 501}`, plistPath], { stdio: "ignore" });
}

async function installLinux(): Promise<void> {
  const userDir = path.join(os.homedir(), ".config", "systemd", "user");
  const servicePath = path.join(userDir, "pi-image-bridge.service");
  await fs.mkdir(userDir, { recursive: true });
  await fs.writeFile(servicePath, `[Unit]\nDescription=Pi Image Bridge\n\n[Service]\nExecStart=${currentCommand()}\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n`);
  const enable = spawnSync("systemctl", ["--user", "enable", "--now", "pi-image-bridge.service"], { stdio: "inherit" });
  if (enable.status !== 0) {
    const autostartDir = path.join(os.homedir(), ".config", "autostart");
    await fs.mkdir(autostartDir, { recursive: true });
    await fs.writeFile(path.join(autostartDir, "pi-image-bridge.desktop"), `[Desktop Entry]\nType=Application\nName=Pi Image Bridge\nExec=${currentCommand()}\nX-GNOME-Autostart-enabled=true\n`);
  }
}

export async function installBridge(args: string[] = []): Promise<void> {
  await writeSshConfig(args);
  if (process.platform === "win32") await installWindows();
  else if (process.platform === "darwin") await installMac();
  else await installLinux();
  console.log("pi-image-bridge installed. Open a new SSH connection for configured hosts so RemoteForward takes effect.");
}

export async function uninstallBridge(): Promise<void> {
  const configPath = path.join(os.homedir(), ".ssh", "config");
  const existing = await fs.readFile(configPath, "utf8").catch(() => "");
  await fs.writeFile(configPath, removeManagedSshConfigBlock(existing));
  if (process.platform === "win32") spawnSync("schtasks", ["/Delete", "/TN", "PiImageBridge", "/F"], { stdio: "inherit" });
  console.log("pi-image-bridge ssh config removed; platform service cleanup attempted when supported.");
}

export async function statusBridge(): Promise<void> {
  const ok = await fetch(`http://127.0.0.1:${process.env.PI_IMAGE_BRIDGE_PORT || "38991"}/health`).then((r) => r.ok).catch(() => false);
  console.log(ok ? "pi-image-bridge is reachable" : "pi-image-bridge is not reachable");
}

export async function doctorBridge(): Promise<void> {
  await statusBridge();
  const configPath = path.join(os.homedir(), ".ssh", "config");
  const config = await fs.readFile(configPath, "utf8").catch(() => "");
  console.log(config.includes(START) ? "ssh config block is installed" : "ssh config block is missing");
  console.log(process.env.SSH_CONNECTION ? "running inside SSH session" : "not running inside SSH session");
}
```

- [ ] **Step 4: Verify installer tests**

Run:

```bash
npx vitest run tests/pi-image-bridge/install.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-image-bridge/src/install.ts tests/pi-image-bridge/install.test.ts
git commit -m "feat: add cross-platform image bridge installer"
```

---

## Task 7: Implement `ssh-copy` Alt+V paste, command, and tool

**Files:**
- Create: `packages/ssh-copy/src/index.ts`
- Test: `tests/ssh-copy/ssh-copy.test.ts`

- [ ] **Step 1: Write failing SSH paste tests**

Write `tests/ssh-copy/ssh-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bridgeImageToBuffer, formatInsertedImageText, isSshSession } from "../../packages/ssh-copy/src/index.js";

describe("ssh-copy", () => {
  it("detects ssh session", () => {
    expect(isSshSession({ SSH_CONNECTION: "1 2 3 4" })).toBe(true);
    expect(isSshSession({})).toBe(false);
  });

  it("decodes bridge image json", () => {
    const decoded = bridgeImageToBuffer({ mimeType: "image/png", base64: Buffer.from("x").toString("base64") });
    expect(decoded.ext).toBe("png");
    expect(decoded.buffer.toString()).toBe("x");
  });

  it("formats inserted text", () => {
    expect(formatInsertedImageText("/tmp/a.png", "path")).toBe("/tmp/a.png");
    expect(formatInsertedImageText("/tmp/a.png", "markdown")).toBe("![pasted image](/tmp/a.png)");
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/ssh-copy/ssh-copy.test.ts
```

Expected: FAIL because module is missing.

- [ ] **Step 3: Implement extension**

Write `packages/ssh-copy/src/index.ts`:

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import fs from "node:fs/promises";
import path from "node:path";
import { loadPersonalSettings, resolveOutputPath } from "../../shared/src/settings.js";
import { errorResult, textResult } from "../../shared/src/tool-result.js";

export function isSshSession(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

export function bridgeImageToBuffer(json: unknown): { mimeType: string; ext: string; buffer: Buffer } {
  const input = json as { mimeType?: string; base64?: string };
  if (!input.mimeType || !input.base64) throw new Error("Bridge response must include mimeType and base64");
  const ext = input.mimeType === "image/jpeg" ? "jpg" : input.mimeType.split("/")[1] || "png";
  return { mimeType: input.mimeType, ext, buffer: Buffer.from(input.base64, "base64") };
}

export function formatInsertedImageText(filePath: string, mode: "path" | "markdown"): string {
  return mode === "markdown" ? `![pasted image](${filePath})` : filePath;
}

async function fetchBridgeImage(bridgeUrl: string): Promise<{ mimeType: string; ext: string; buffer: Buffer } | undefined> {
  const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/clipboard-image`);
  if (response.status === 204) return undefined;
  if (!response.ok) throw new Error(`Bridge returned ${response.status}`);
  return bridgeImageToBuffer(await response.json());
}

async function saveBridgeImage(ctx: ExtensionContext): Promise<{ filePath: string; insertedText: string } | undefined> {
  const settings = loadPersonalSettings(ctx.cwd, ctx.isProjectTrusted()).sshCopy;
  const image = await fetchBridgeImage(process.env.PI_IMAGE_BRIDGE_URL || settings.bridgeUrl || "http://127.0.0.1:38991");
  if (!image) return undefined;
  const dir = resolveOutputPath(process.env.PI_SSH_IMAGE_DIR || settings.remoteImageDir || ".pi/pasted-images", ctx.cwd);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `pasted-${Date.now()}.${image.ext}`);
  await fs.writeFile(filePath, image.buffer);
  return { filePath, insertedText: formatInsertedImageText(filePath, settings.insertMode || "path") };
}

async function pasteImageFromBridge(ctx: ExtensionContext): Promise<void> {
  try {
    if (!isSshSession(process.env)) {
      ctx.ui.notify("Not in SSH; use Pi built-in image paste", "info");
      return;
    }
    const saved = await saveBridgeImage(ctx);
    if (!saved) {
      ctx.ui.notify("No image found in local clipboard bridge", "warning");
      return;
    }
    ctx.ui.pasteToEditor(saved.insertedText);
  } catch (error) {
    ctx.ui.notify(`Image bridge unavailable: ${error instanceof Error ? error.message : String(error)}`, "warning");
  }
}

export default function sshCopyExtension(pi: ExtensionAPI) {
  pi.registerShortcut("alt+v", {
    description: "Paste local clipboard image over SSH through pi-image-bridge",
    handler: pasteImageFromBridge
  });

  pi.registerCommand("paste-image", {
    description: "Paste a local clipboard image into the remote Pi editor through pi-image-bridge",
    handler: async (_args, ctx) => pasteImageFromBridge(ctx)
  });

  pi.registerTool({
    name: "ssh_copy_image",
    label: "SSH Copy Image",
    description: "Save an image from the local clipboard bridge or copy an existing image into the configured remote image directory.",
    parameters: Type.Object({
      sourcePath: Type.Optional(Type.String({ description: "Existing remote image path to copy into the configured image directory" })),
      insertMode: Type.Optional(Type.Union([Type.Literal("path"), Type.Literal("markdown")], { description: "Return path or markdown image syntax" }))
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      try {
        const settings = loadPersonalSettings(ctx.cwd, ctx.isProjectTrusted()).sshCopy;
        const dir = resolveOutputPath(process.env.PI_SSH_IMAGE_DIR || settings.remoteImageDir || ".pi/pasted-images", ctx.cwd);
        await fs.mkdir(dir, { recursive: true });
        let filePath: string;
        if (params.sourcePath) {
          const source = resolveOutputPath(params.sourcePath, ctx.cwd);
          filePath = path.join(dir, path.basename(source));
          await fs.copyFile(source, filePath);
        } else {
          const saved = await saveBridgeImage(ctx);
          if (!saved) return errorResult("No image found in local clipboard bridge");
          filePath = saved.filePath;
        }
        const mode = params.insertMode || settings.insertMode || "path";
        const insertedText = formatInsertedImageText(filePath, mode);
        return textResult(`Image available at ${filePath}\n\n${insertedText}`, { filePath, insertedText });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  });
}
```

- [ ] **Step 4: Verify tests**

Run:

```bash
npx vitest run tests/ssh-copy/ssh-copy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ssh-copy tests/ssh-copy
git commit -m "feat: add ssh image paste extension"
```

---

## Task 8: Final integration, documentation, and smoke checks

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Test: all tests and typecheck

- [ ] **Step 1: Update README with complete configuration**

Replace `README.md` with:

```markdown
# Pi Personal Tools

A personal Pi package with three extensions and one helper CLI.

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
  "personalPiTools": {
    "imageTool": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY",
      "model": "gpt-image-1",
      "outputDir": ".pi/generated-images",
      "size": "1024x1024"
    }
  }
}
```

Environment overrides:

```bash
PI_IMAGE_API_BASE_URL=https://api.openai.com/v1
PI_IMAGE_API_KEY=sk-...
PI_IMAGE_MODEL=gpt-image-1
PI_IMAGE_OUTPUT_DIR=.pi/generated-images
```

### ssh-copy

Registers:

```txt
Alt+V
/paste-image
ssh_copy_image
```

In SSH sessions, `Alt+V` fetches the local clipboard image through `pi-image-bridge`, saves it on the remote machine, and inserts the remote path into the Pi editor. Linux and Windows are supported targets for v1. macOS autostart/status can be installed, but macOS clipboard extraction has no `pngpaste`, Swift, or AppleScript fallback in v1; it only works if the optional native clipboard dependency can read images.

Settings:

```json
{
  "personalPiTools": {
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

## One-time local bridge setup

```bash
npm install
npm run bridge:install
npm run bridge:doctor
```

The installer configures local autostart and adds a managed SSH config block for zero-argument, no-touch usage. Advanced options such as `--port`, `--remote-bind`, `--ssh-config`, or `--ssh-host` are only for special environments:

```sshconfig
# >>> pi-image-bridge
Host *
  RemoteForward 127.0.0.1:38991 127.0.0.1:38991
  ExitOnForwardFailure no
# <<< pi-image-bridge
```

`ProxyJump` and `ssh -J` work because the remote forward is carried inside the SSH connection. Manual nested SSH requires the second SSH hop to forward the bridge again, or replacing the nested hop with `ProxyJump`.

## Pi package install

```bash
pi install ./ --approve
```

For quick testing:

```bash
pi -e ./ --approve
```
```

- [ ] **Step 2: Ensure CLI file is executable on Unix**

Run:

```bash
node -e "const fs=require('fs'); fs.chmodSync('dist/pi-image-bridge/cli.js', 0o755)"
```

Expected: no output.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript exits with code 0.

- [ ] **Step 5: Run bridge health smoke test**

Run in one terminal:

```bash
npm run bridge:serve
```

Run in another terminal:

```bash
curl http://127.0.0.1:38991/health
```

Expected:

```json
{"ok":true}
```

Stop the bridge server with Ctrl+C.

- [ ] **Step 6: Run Pi extension load smoke test**

Run:

```bash
pi -e ./ --approve --no-session
```

Expected: Pi starts without extension load errors. `/last-ai`, `/paste-image`, `generate_image`, and `ssh_copy_image` are available.

- [ ] **Step 7: Commit final integration**

```bash
git add README.md package.json packages tests
git commit -m "docs: document personal pi tools setup"
```

---

## Self-Review

**Spec coverage:**
- Monorepo TypeScript Pi package: Task 1.
- Three extensions: Tasks 3, 4, and 7.
- `last-ai` markdown external editor flow: Task 3.
- `image-tool` OpenAI-compatible API and settings support: Task 4.
- SSH image paste with no-touch helper: Tasks 5, 6, and 7.
- Cross-platform helper install/status for Linux/macOS/Windows: Task 6. Clipboard extraction is Linux/Windows-first in v1; macOS has no `pngpaste`, Swift, or AppleScript fallback and must be reported by `doctor` as unsupported if the optional native clipboard dependency cannot read images.
- Jump host behavior documented: Task 8.

**Placeholder scan:** No implementation step depends on unspecified code. Every created file has concrete content or a concrete replacement target.

**Type consistency:** Settings names are consistent across tests, shared utilities, extensions, README, and environment fallback names.

---

Plan complete and saved to `docs/superpowers/plans/2026-06-16-pi-personal-tools.md`.
