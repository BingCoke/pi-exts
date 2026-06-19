import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import fs from "node:fs/promises";
import path from "node:path";
import { loadPersonalSettings, resolveOutputPath } from "../../shared/src/settings.js";
import { errorResult, textResult } from "../../shared/src/tool-result.js";

interface BuildImageRequestInput {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
  quality?: string;
  responseFormat?: "url" | "b64_json";
  outputFormat?: "png" | "jpeg" | "webp";
  outputCompression?: number;
  background?: string;
  moderation?: string;
  style?: string;
  user?: string;
}

export function buildImageRequest(input: BuildImageRequestInput) {
  const request: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    n: input.n,
    quality: input.quality,
    response_format: input.responseFormat,
    output_format: input.outputFormat,
    output_compression: input.outputCompression,
    background: input.background,
    moderation: input.moderation,
    style: input.style,
    user: input.user,
  };

  for (const key of Object.keys(request)) {
    if (request[key] === undefined || request[key] === "") delete request[key];
  }

  return request;
}

type ImagePayload = { kind: "base64"; b64: string } | { kind: "url"; url: string };

export interface ImageTask {
  taskId: string;
  status?: string;
  pollUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBase64(value: string): string {
  return value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  if (isRecord(value)) {
    for (const key of ["url", "b64_json", "base64", "value"] as const) {
      const found = firstString(value[key]);
      if (found) return found;
    }
  }
  return undefined;
}

function payloadFromRecord(record: Record<string, unknown>): ImagePayload | undefined {
  for (const key of ["b64_json", "base64_json", "base64", "b64", "image_base64", "image"] as const) {
    const value = firstString(record[key]);
    if (value && !/^https?:\/\//i.test(value)) return { kind: "base64", b64: normalizeBase64(value) };
  }
  for (const key of ["url", "image_url"] as const) {
    const value = firstString(record[key]);
    if (value && /^https?:\/\//i.test(value)) return { kind: "url", url: value };
  }
  if (typeof record.result === "string" && record.result.trim()) {
    return /^https?:\/\//i.test(record.result) ? { kind: "url", url: record.result } : { kind: "base64", b64: normalizeBase64(record.result) };
  }
  return undefined;
}

function findImagePayload(value: unknown): ImagePayload | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const payload = findImagePayload(item);
      if (payload) return payload;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const direct = payloadFromRecord(value);
  if (direct) return direct;
  for (const key of ["data", "result", "results", "images", "generated_images", "output", "image", "artifact", "artifacts"] as const) {
    const payload = findImagePayload(value[key]);
    if (payload) return payload;
  }
  return undefined;
}

function taskFromRecord(record: Record<string, unknown>): ImageTask | undefined {
  const status = firstString(record.status);
  const taskId = firstString(record.task_id) ?? firstString(record.taskId) ?? (
    status && firstString(record.id)?.startsWith("task_") ? firstString(record.id) : undefined
  );
  if (!taskId) return undefined;
  const pollUrl = firstString(record.poll_url) ?? firstString(record.pollUrl) ?? firstString(record.status_url) ?? firstString(record.statusUrl);
  return { taskId, status, pollUrl };
}

function findImageTask(value: unknown): ImageTask | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const task = findImageTask(item);
      if (task) return task;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const direct = taskFromRecord(value);
  if (direct) return direct;
  for (const key of ["data", "task", "tasks", "result", "output"] as const) {
    const task = findImageTask(value[key]);
    if (task) return task;
  }
  return undefined;
}

function summarizeResponseShape(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, nestedValue) => {
      if (typeof nestedValue === "string" && nestedValue.length > 200) return `${nestedValue.slice(0, 200)}…`;
      return nestedValue;
    }).slice(0, 1000);
  } catch {
    return String(value);
  }
}

export function extractImagePayload(response: unknown): ImagePayload {
  const payload = findImagePayload(response);
  if (payload) return payload;
  throw new Error(`Image API response did not include a recognized image payload. Response shape: ${summarizeResponseShape(response)}`);
}

export function extractImageTask(response: unknown): ImageTask | undefined {
  return findImageTask(response);
}

export function buildTaskPollUrl(baseUrl: string, task: ImageTask, taskPollPath = "/tasks/{task_id}"): string {
  const trimmedBase = baseUrl.replace(/\/$/, "");
  if (task.pollUrl) {
    if (/^https?:\/\//i.test(task.pollUrl)) return task.pollUrl;
    return new URL(task.pollUrl, `${trimmedBase}/`).toString();
  }

  const pathTemplate = taskPollPath || "/tasks/{task_id}";
  const taskPath = pathTemplate
    .replaceAll("{task_id}", encodeURIComponent(task.taskId))
    .replaceAll("{taskId}", encodeURIComponent(task.taskId));
  if (/^https?:\/\//i.test(taskPath)) return taskPath;
  return `${trimmedBase}${taskPath.startsWith("/") ? "" : "/"}${taskPath}`;
}

function assertImageOutputPath(outputPath: string): void {
  const extension = path.extname(outputPath).toLowerCase();
  if (!extension) throw new Error("Image output must be a file path with an image extension, e.g. .pi/generated-images/cat.png");
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) {
    throw new Error(`Unsupported image output extension: ${extension}`);
  }
}

async function saveBase64Image(b64: string, outputPath: string): Promise<string> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, Buffer.from(b64, "base64"));
  return outputPath;
}

async function downloadImage(url: string, outputPath: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Image download failed: ${response.status} ${await truncatedResponseText(response)}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Image download returned non-image content-type: ${contentType || "unknown"}`);
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return outputPath;
}

async function truncatedResponseText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

function isSuccessfulTaskStatus(status: string | undefined): boolean {
  return Boolean(status && ["completed", "succeeded", "success", "done", "finished"].includes(status.toLowerCase()));
}

function isFailedTaskStatus(status: string | undefined): boolean {
  return Boolean(status && ["failed", "error", "canceled", "cancelled", "expired"].includes(status.toLowerCase()));
}

async function pollImageTask(options: {
  baseUrl: string;
  apiKey: string;
  task: ImageTask;
  taskPollPath?: string;
  initialDelayMs: number;
  intervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ImagePayload> {
  const deadline = Date.now() + options.timeoutMs;
  let waitMs = options.initialDelayMs;

  while (Date.now() <= deadline) {
    await delay(waitMs, options.signal);
    waitMs = options.intervalMs;

    const pollUrl = buildTaskPollUrl(options.baseUrl, options.task, options.taskPollPath);
    const response = await fetch(pollUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${options.apiKey}` },
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`Image task polling failed: ${response.status} ${await truncatedResponseText(response)}`);

    const json = await response.json();
    const payload = findImagePayload(json);
    if (payload) return payload;

    const taskUpdate = extractImageTask(json);
    const status = taskUpdate?.status;
    if (isFailedTaskStatus(status)) throw new Error(`Image task ${options.task.taskId} failed. Response shape: ${summarizeResponseShape(json)}`);
    if (isSuccessfulTaskStatus(status)) throw new Error(`Image task ${options.task.taskId} completed but did not include a recognized image payload. Response shape: ${summarizeResponseShape(json)}`);
  }

  throw new Error(`Image task ${options.task.taskId} did not complete within ${Math.round(options.timeoutMs / 1000)}s.`);
}

async function resolveImagePayload(responseJson: unknown, options: {
  baseUrl: string;
  apiKey: string;
  taskPollPath?: string;
  initialDelayMs: number;
  intervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ImagePayload> {
  const payload = findImagePayload(responseJson);
  if (payload) return payload;

  const task = extractImageTask(responseJson);
  if (task) {
    return pollImageTask({ ...options, task });
  }

  throw new Error(`Image API response did not include a recognized image payload or async task. Response shape: ${summarizeResponseShape(responseJson)}`);
}

export default function imageToolExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "generate_image",
    label: "Generate Image",
    description: "Generate an image using an OpenAI-compatible image API. Supports standard OpenAI image responses and common async task polling extensions.",
    parameters: Type.Object({
      prompt: Type.String({ description: "Image prompt" }),
      model: Type.Optional(Type.String({ description: "Image model override" })),
      size: Type.String({ description: "Image size. OpenAI uses values like 1024x1024; some compatible providers use ratios like 1:1 or 16:9." }),
      output: Type.String({ description: "Local image file path to save. Relative paths are resolved from the current project." }),
      n: Type.Optional(Type.Number({ description: "Number of images to generate" })),
      quality: Type.Optional(Type.String({ description: "Image quality, e.g. low, medium, high, auto, standard, hd" })),
      responseFormat: Type.Optional(Type.String({ description: "OpenAI DALL-E response format: url or b64_json" })),
      outputFormat: Type.Optional(Type.String({ description: "GPT image output format: png, jpeg, or webp" })),
      outputCompression: Type.Optional(Type.Number({ description: "Compression level for jpeg/webp outputs, 0-100" })),
      background: Type.Optional(Type.String({ description: "GPT image background: transparent, opaque, or auto" })),
      moderation: Type.Optional(Type.String({ description: "Moderation level, if supported by the provider" })),
      style: Type.Optional(Type.String({ description: "DALL-E style, e.g. vivid or natural" })),
      user: Type.Optional(Type.String({ description: "End-user identifier for abuse monitoring" })),
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
        const taskPollPath = process.env.PI_IMAGE_TASK_POLL_PATH || imageSettings.taskPollPath;
        const initialDelayMs = envNumber("PI_IMAGE_TASK_INITIAL_DELAY_MS", imageSettings.taskInitialDelayMs ?? 5000);
        const intervalMs = envNumber("PI_IMAGE_TASK_POLL_INTERVAL_MS", imageSettings.taskPollIntervalMs ?? 3000);
        const timeoutMs = envNumber("PI_IMAGE_TASK_TIMEOUT_MS", imageSettings.taskTimeoutMs ?? 180000);

        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/images/generations`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(buildImageRequest({
            prompt: params.prompt,
            model,
            size: params.size,
            n: params.n,
            quality: params.quality,
            responseFormat: params.responseFormat as "url" | "b64_json" | undefined,
            outputFormat: params.outputFormat as "png" | "jpeg" | "webp" | undefined,
            outputCompression: params.outputCompression,
            background: params.background,
            moderation: params.moderation,
            style: params.style,
            user: params.user,
          })),
          signal,
        });
        if (!response.ok) return errorResult(`Image API failed: ${response.status} ${await truncatedResponseText(response)}`);

        const payload = await resolveImagePayload(await response.json(), {
          baseUrl,
          apiKey,
          taskPollPath,
          initialDelayMs,
          intervalMs,
          timeoutMs,
          signal,
        });
        const outputPath = resolveOutputPath(params.output, ctx.cwd);
        assertImageOutputPath(outputPath);
        const filePath = payload.kind === "url"
          ? await downloadImage(payload.url, outputPath, signal)
          : await saveBase64Image(payload.b64, outputPath);
        return textResult(`Generated image saved to ${filePath}\n\nMarkdown:\n![generated image](${filePath})`, {
          filePath,
          sourceUrl: payload.kind === "url" ? payload.url : undefined,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
