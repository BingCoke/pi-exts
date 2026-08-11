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
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  api?: Api;
  headers?: Record<string, string>;
  authHeader?: boolean;
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

export function buildInheritedModels(
  sourceModels: readonly CatalogModel[],
  apiOverride?: Api,
): ProviderModelConfig[] {
  return sourceModels.map((model) => ({
    id: model.id,
    name: model.name,
    api: apiOverride ?? model.api,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap,
    input: [...model.input],
    cost: { ...model.cost },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    headers: model.headers,
    compat: model.compat,
  }));
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
    if (!sourceId || !relay.baseUrl) continue;
    if (!builtinProviderIds.has(sourceId)) {
      throw new Error(`Unknown source provider "${sourceId}" for "${relayProviderId}".`);
    }

    pi.registerProvider(relayProviderId, {
      name: relay.name ?? relayProviderId,
      baseUrl: relay.baseUrl,
      apiKey: relay.apiKey,
      api: relay.api,
      headers: relay.headers,
      authHeader: relay.authHeader,
      models: buildInheritedModels(catalog.models(sourceId), relay.api),
    });
  }
}

export default async function providerRelaysExtension(pi: ExtensionAPI): Promise<void> {
  const config = await readModelsConfig();
  const catalog = await loadBuiltinCatalog();
  registerRelayProviders(pi, config, catalog);
}
