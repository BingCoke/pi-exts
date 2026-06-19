import fs from "node:fs";
import path from "node:path";
import { resolvePath } from "./paths.js";

export interface ImageToolSettings {
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  model?: string;
  taskPollPath?: string;
  taskInitialDelayMs?: number;
  taskPollIntervalMs?: number;
  taskTimeoutMs?: number;
}

export interface SshCopySettings {
  enabled?: boolean;
  bridgeUrl?: string;
  remoteImageDir?: string;
  shortcut?: string;
  insertMode?: "path" | "markdown";
}

export interface BingcokeExtSettings {
  imageTool: ImageToolSettings;
  sshCopy: SshCopySettings;
}

const defaults: BingcokeExtSettings = {
  imageTool: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    model: "gpt-image-1",
  },
  sshCopy: {
    enabled: true,
    bridgeUrl: "http://127.0.0.1:38991",
    remoteImageDir: ".pi/pasted-images",
    shortcut: "alt+v",
    insertMode: "path",
  },
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

export function mergePersonalSettings(globalSettings: unknown, projectSettings: unknown): BingcokeExtSettings {
  const globalExt = isRecord(globalSettings) ? globalSettings["@bingcoke/ext"] : undefined;
  const projectExt = isRecord(projectSettings) ? projectSettings["@bingcoke/ext"] : undefined;
  return deepMerge(
    deepMerge(defaults as unknown as Record<string, unknown>, globalExt),
    projectExt,
  ) as unknown as BingcokeExtSettings;
}

export function readJsonIfExists(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read JSON settings at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function loadPersonalSettings(
  cwd: string,
  projectTrusted: boolean,
  agentDir = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".pi", "agent"),
): BingcokeExtSettings {
  const globalSettings = readJsonIfExists(path.join(agentDir, "settings.json"));
  const projectSettings = projectTrusted ? readJsonIfExists(path.join(cwd, ".pi", "settings.json")) : {};
  return mergePersonalSettings(globalSettings, projectSettings);
}

export function resolveOutputPath(input: string, cwd: string): string {
  return resolvePath(input, cwd);
}
