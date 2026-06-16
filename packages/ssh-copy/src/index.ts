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

async function fetchBridgeHealth(bridgeUrl: string): Promise<boolean> {
  return fetch(`${bridgeUrl.replace(/\/$/, "")}/health`).then((response) => response.ok).catch(() => false);
}

async function fetchBridgeImage(bridgeUrl: string): Promise<{ mimeType: string; ext: string; buffer: Buffer } | undefined> {
  const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/clipboard-image`);
  if (response.status === 204) return undefined;
  if (!response.ok) throw new Error(`Bridge returned ${response.status}`);
  return bridgeImageToBuffer(await response.json());
}

async function saveBridgeImage(ctx: ExtensionContext): Promise<{ filePath: string; insertedText: string } | undefined> {
  const settings = loadPersonalSettings(ctx.cwd, ctx.isProjectTrusted()).sshCopy;
  const bridgeUrl = process.env.PI_IMAGE_BRIDGE_URL || settings.bridgeUrl || "http://127.0.0.1:38991";
  const healthy = await fetchBridgeHealth(bridgeUrl);
  if (!healthy) throw new Error("bridge health check failed; ensure pi-image-bridge is running and SSH RemoteForward is active");
  const image = await fetchBridgeImage(bridgeUrl);
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
    handler: pasteImageFromBridge,
  });

  pi.registerCommand("paste-image", {
    description: "Paste a local clipboard image into the remote Pi editor through pi-image-bridge",
    handler: async (_args, ctx) => pasteImageFromBridge(ctx),
  });

  pi.registerTool({
    name: "ssh_copy_image",
    label: "SSH Copy Image",
    description: "Save an image from the local clipboard bridge or copy an existing image into the configured remote image directory.",
    parameters: Type.Object({
      sourcePath: Type.Optional(Type.String({ description: "Existing remote image path to copy into the configured image directory" })),
      insertMode: Type.Optional(Type.Union([Type.Literal("path"), Type.Literal("markdown")], { description: "Return path or markdown image syntax" })),
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
    },
  });
}
