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
    size: "1024x1024",
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

export function mergePersonalSettings(globalSettings: unknown, projectSettings: unknown): PersonalPiToolsSettings {
  const globalPersonal = isRecord(globalSettings) ? globalSettings.personalPiTools : undefined;
  const projectPersonal = isRecord(projectSettings) ? projectSettings.personalPiTools : undefined;
  return deepMerge(
    deepMerge(defaults as unknown as Record<string, unknown>, globalPersonal),
    projectPersonal,
  ) as unknown as PersonalPiToolsSettings;
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
): PersonalPiToolsSettings {
  const globalSettings = readJsonIfExists(path.join(agentDir, "settings.json"));
  const projectSettings = projectTrusted ? readJsonIfExists(path.join(cwd, ".pi", "settings.json")) : {};
  return mergePersonalSettings(globalSettings, projectSettings);
}

export function resolveOutputPath(input: string, cwd: string): string {
  return resolvePath(input, cwd);
}
