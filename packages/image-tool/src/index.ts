import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import fs from "node:fs/promises";
import path from "node:path";
import { loadPersonalSettings, resolveOutputPath } from "../../shared/src/settings.js";
import { errorResult, textResult } from "../../shared/src/tool-result.js";

interface BuildImageRequestInput {
  prompt: string;
  model: string;
  size: string;
  n?: number;
}

export function buildImageRequest(input: BuildImageRequestInput) {
  return {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    ...(input.n ? { n: input.n } : {}),
  };
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
      outputDir: Type.Optional(Type.String({ description: "Output directory override" })),
    }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
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
          body: JSON.stringify(buildImageRequest({ prompt: params.prompt, model, size })),
          signal,
        });
        if (!response.ok) return errorResult(`Image API failed: ${response.status} ${await response.text()}`);
        const payload = extractImagePayload(await response.json());
        if (payload.kind === "url") {
          return textResult(`Generated image URL:\n${payload.url}\n\nMarkdown:\n![generated image](${payload.url})`, { url: payload.url });
        }
        const outputDir = resolveOutputPath(
          params.outputDir || process.env.PI_IMAGE_OUTPUT_DIR || imageSettings.outputDir || ".pi/generated-images",
          ctx.cwd,
        );
        const filePath = await saveBase64Image(payload.b64, outputDir);
        return textResult(`Generated image saved to ${filePath}\n\nMarkdown:\n![generated image](${filePath})`, { filePath });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
