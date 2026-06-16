import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

type Entry = { type?: string; message?: { role?: string; content?: unknown } };
type TextBlock = { type?: string; text?: string };

const SEPARATOR = "----";

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
  const limit = Math.max(1, count);
  return entries
    .filter((entry) => entry.type === "message" && entry.message?.role === "assistant")
    .map((entry) => contentToText(entry.message?.content).trim())
    .filter(Boolean)
    .slice(-limit);
}

export function buildLastAiDocument(messages: string[]): string {
  const sections = messages.map((message, index) => [`## AI Message ${index + 1}`, "", message].join("\n"));
  return ["# Last AI Messages", "", ...sections, "", SEPARATOR, "", ""].join("\n");
}

export function extractReplyBelowSeparator(markdown: string): string {
  const index = markdown.search(/\r?\n----\r?\n/);
  if (index === -1) return "";
  const separatorMatch = markdown.slice(index).match(/^\r?\n----\r?\n/);
  if (!separatorMatch) return "";
  return markdown.slice(index + separatorMatch[0].length).trim();
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
      try {
        await fs.writeFile(filePath, buildLastAiDocument(messages), "utf8");
        await openExternalEditor(filePath);
        const edited = await fs.readFile(filePath, "utf8");
        const reply = extractReplyBelowSeparator(edited);
        if (reply) {
          ctx.ui.setEditorText(reply);
        } else {
          ctx.ui.notify("No reply text found below ----", "warning");
        }
      } finally {
        await fs.rm(filePath, { force: true }).catch(() => {});
      }
    },
  });
}
