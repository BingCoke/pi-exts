import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ProviderConfig,
  type ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

type Api = NonNullable<ProviderModelConfig["api"]>;

export type RelayConfig = {
  [key: string]: unknown;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  api?: Api;
  headers?: Record<string, string>;
  authHeader?: boolean;
  modelOverrides?: Record<string, Record<string, unknown>>;
};

export type ModelsConfig = {
  providers?: Record<string, RelayConfig>;
};

export type CatalogModel = ProviderModelConfig & {
  provider: string;
  baseUrl?: string;
};

type CatalogModule = {
  getBuiltinProviders?: () => string[];
  getBuiltinModels?: (provider: string) => readonly CatalogModel[];
  getProviders?: () => string[];
  getModels?: (provider: string) => readonly CatalogModel[];
};

export type BuiltinCatalog = {
  providers: () => string[];
  models: (provider: string) => readonly CatalogModel[];
};

type ProviderRegistrar = {
  registerProvider(name: string, config: ProviderConfig): void;
};

const MODERN_CATALOG_MODULE = "@earendil-works/pi-ai/providers/all";
const LEGACY_CATALOG_MODULE = "@earendil-works/pi-ai";

export function sourceProviderId(relayProviderId: string): string | undefined {
  const separator = relayProviderId.indexOf("@");
  if (separator <= 0 || separator === relayProviderId.length - 1) return undefined;
  return relayProviderId.slice(0, separator);
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeConfig(
  base: Record<string, unknown>,
  override?: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base };
  if (!override) return merged;

  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] = isConfigObject(baseValue) && isConfigObject(value)
      ? mergeConfig(baseValue, value)
      : value;
  }
  return merged;
}

export function buildInheritedModels(
  sourceModels: readonly CatalogModel[],
  apiOverride?: Api,
  modelOverrides: Record<string, Record<string, unknown>> = {},
): ProviderModelConfig[] {
  return sourceModels.map((model) => {
    const { provider: _provider, baseUrl: _baseUrl, ...sourceConfig } = model;
    const override = modelOverrides[model.id];
    const merged = mergeConfig(sourceConfig, override);
    const { provider: _overrideProvider, ...modelConfig } = merged;

    return {
      ...modelConfig,
      id: model.id,
      api: override && "api" in override
        ? (modelConfig.api as Api)
        : apiOverride ?? (modelConfig.api as Api),
      input: Array.isArray(modelConfig.input) ? [...modelConfig.input] : modelConfig.input,
      cost: isConfigObject(modelConfig.cost) ? { ...modelConfig.cost } : modelConfig.cost,
    } as ProviderModelConfig;
  });
}

async function loadBuiltinCatalog(): Promise<BuiltinCatalog> {
  try {
    const modern = (await import(MODERN_CATALOG_MODULE)) as CatalogModule;
    if (modern.getBuiltinProviders && modern.getBuiltinModels) {
      return {
        providers: modern.getBuiltinProviders,
        models: modern.getBuiltinModels,
      };
    }
  } catch {
    // Older pi-ai versions expose the generated catalog from the package root.
  }

  const legacy = (await import(LEGACY_CATALOG_MODULE)) as CatalogModule;
  if (legacy.getProviders && legacy.getModels) {
    return {
      providers: legacy.getProviders,
      models: legacy.getModels,
    };
  }

  throw new Error("This pi-ai version does not expose a built-in model catalog.");
}

async function readModelsConfig(): Promise<ModelsConfig> {
  const modelsPath = join(getAgentDir(), "models.json");
  try {
    const text = await readFile(modelsPath, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, "")) as ModelsConfig;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw new Error(
      `Failed to read ${modelsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function registerRelayProviders(
  pi: ProviderRegistrar,
  config: ModelsConfig,
  catalog: BuiltinCatalog,
): void {
  const providers = config.providers ?? {};
  const builtinProviderIds = new Set(catalog.providers());

  for (const [relayProviderId, relay] of Object.entries(providers)) {
    const sourceId = sourceProviderId(relayProviderId);
    if (!sourceId) continue;
    if (!builtinProviderIds.has(sourceId)) {
      throw new Error(`Unknown source provider "${sourceId}" for "${relayProviderId}".`);
    }

    const effectiveRelay = mergeConfig(providers[sourceId] ?? {}, relay) as RelayConfig;
    if (!effectiveRelay.baseUrl) continue;

    const { modelOverrides, models: _models, ...providerConfig } = effectiveRelay;
    pi.registerProvider(relayProviderId, {
      ...providerConfig,
      name: effectiveRelay.name ?? relayProviderId,
      models: buildInheritedModels(
        catalog.models(sourceId),
        effectiveRelay.api,
        modelOverrides,
      ),
    } as ProviderConfig);
  }
}

export default async function providerRelaysExtension(pi: ExtensionAPI): Promise<void> {
  const config = await readModelsConfig();
  const catalog = await loadBuiltinCatalog();
  registerRelayProviders(pi, config, catalog);
}
