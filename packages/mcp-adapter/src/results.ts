import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { JsonValue, ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ContentBlock } from "@earendil-works/pi-mcp";

export const DATA_SCHEMA = { type: "object", additionalProperties: true };

/** Model output is bounded; scripts receive complete structured data. */
export async function result(data: Record<string, unknown>, blocks?: ContentBlock[], isError?: boolean): Promise<AgentToolResult<unknown>> {
  const content: (TextContent | ImageContent)[] = [];
  const append = async (text: string) => {
    const truncated = truncateHead(text, { maxBytes: 20_000, maxLines: 500 });
    if (!truncated.truncated) { content.push({ type: "text", text }); return; }
    const path = join(await mkdtemp(join(tmpdir(), "pi-mcp-output-")), "result.txt");
    await writeFile(path, text, { mode: 0o600 });
    content.push({ type: "text", text: `${truncated.content}\nFull output: ${path}` });
  };
  if (!blocks) await append(JSON.stringify(data));
  else {
    let budget = 20_000;
    for (const block of blocks) {
      if (block.type === "image") { content.push({ type: "image", data: block.data, mimeType: block.mimeType }); continue; }
      if (block.type === "resource" && "blob" in block.resource) {
        const resource = block.resource;
        if (resource.mimeType?.startsWith("image/")) {
          content.push({ type: "image", data: resource.blob, mimeType: resource.mimeType });
        } else {
          const extension = extname(new URL(resource.uri).pathname).replace(/[^.a-zA-Z0-9]/g, "").slice(0, 12) || ".bin";
          const path = join(await mkdtemp(join(tmpdir(), "pi-mcp-resource-")), `resource${extension}`);
          await writeFile(path, Buffer.from(resource.blob, "base64"), { mode: 0o600 });
          content.push({ type: "text", text: `${resource.uri}: ${path}` });
        }
        continue;
      }
      const text = block.type === "text" ? block.text : block.type === "resource" && "text" in block.resource ? `${block.resource.uri}:\n${block.resource.text}` : JSON.stringify(block);
      if (text.length > budget) {
        const path = join(await mkdtemp(join(tmpdir(), "pi-mcp-output-")), "result.json");
        await writeFile(path, JSON.stringify(blocks), { mode: 0o600 });
        content.push({ type: "text", text: `${text.slice(0, budget)}\nFull content: ${path}` });
        break;
      }
      budget -= text.length;
      await append(text);
    }
    if (content.length === 0) await append(JSON.stringify(data));
  }
  return { content, details: data, structuredContent: data as JsonValue, ...(isError ? { isError: true } : {}) };
}
