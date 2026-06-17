import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

export interface ClipboardImage {
  mimeType: string;
  bytes: Uint8Array;
}

export function getClipboardUnavailableHint(platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== "darwin") return undefined;
  return "macOS clipboard image extraction is unavailable when the optional native clipboard dependency cannot read images; v1 has no pngpaste, Swift, or AppleScript fallback.";
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
