import { describe, expect, it } from "vitest";
import {
  buildInheritedModels,
  registerRelayProviders,
  sourceProviderId,
} from "../../packages/provider-relays/src/index.js";

describe("provider-relays", () => {
  it("derives the source provider from an inherited provider id", () => {
    expect(sourceProviderId("anthropic@backup")).toBe("anthropic");
    expect(sourceProviderId("openai-codex@primary")).toBe("openai-codex");
    expect(sourceProviderId("anthropic")).toBeUndefined();
  });

  it("keeps model identity and capabilities while removing the source endpoint", () => {
    const sourceModels = [
      {
        id: "same-model",
        name: "Same Model",
        api: "openai-completions",
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        reasoning: true,
        input: ["text"],
        cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
        contextWindow: 128000,
        maxTokens: 8192,
        compat: { supportsDeveloperRole: false },
      },
    ] as Parameters<typeof buildInheritedModels>[0];

    const models = buildInheritedModels(sourceModels);
    expect(models[0]).toMatchObject({
      id: "same-model",
      name: "Same Model",
      api: "openai-completions",
      reasoning: true,
      contextWindow: 128000,
      maxTokens: 8192,
      compat: { supportsDeveloperRole: false },
    });
    expect(models[0]).not.toHaveProperty("provider");
    expect(models[0]).not.toHaveProperty("baseUrl");
  });

  it("can override the transport API without renaming models", () => {
    const sourceModels = [
      {
        id: "same-model",
        name: "Same Model",
        api: "openai-responses",
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ] as Parameters<typeof buildInheritedModels>[0];

    expect(buildInheritedModels(sourceModels, "openai-completions")[0]).toMatchObject({
      id: "same-model",
      name: "Same Model",
      api: "openai-completions",
    });
  });

  it("merges model overrides without dropping newer source fields", () => {
    const sourceModels = [
      {
        id: "same-model",
        name: "Same Model",
        api: "openai-responses",
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
        contextWindow: 128000,
        maxTokens: 16384,
        futureConfig: { sourceValue: true },
      },
    ] as unknown as Parameters<typeof buildInheritedModels>[0];

    expect(buildInheritedModels(sourceModels, undefined, {
      "same-model": {
        contextWindow: 256000,
        cost: { output: 9 },
        futureConfig: { relayValue: true },
      },
    })[0]).toMatchObject({
      contextWindow: 256000,
      maxTokens: 16384,
      cost: { input: 1, output: 9, cacheRead: 3, cacheWrite: 4 },
      futureConfig: { sourceValue: true, relayValue: true },
    });
  });

  it("registers identical model ids under different relay providers", () => {
    const registrations: Array<{ name: string; config: { models?: Array<{ id: string; name: string }> } }> = [];

    registerRelayProviders(
      {
        registerProvider(name, config) {
          registrations.push({ name, config });
        },
      },
      {
        providers: {
          openai: {
            api: "openai-completions",
            modelOverrides: { "same-model": { contextWindow: 65536 } },
          },
          "openai@one": {
            baseUrl: "https://one.example/v1",
            apiKey: "$ONE_KEY",
            api: "openai-responses",
            modelOverrides: { "same-model": { maxTokens: 4096 } },
          },
          "anthropic@two": { baseUrl: "https://two.example", apiKey: "$TWO_KEY" },
        },
      },
      {
        providers: () => ["openai", "anthropic"],
        models: (provider) => [
          {
            id: "same-model",
            name: "Same Model",
            api: provider === "anthropic" ? "anthropic-messages" : "openai-responses",
            provider,
            baseUrl: `https://${provider}.example`,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 16384,
          },
        ] as Parameters<typeof buildInheritedModels>[0],
      },
    );

    expect(registrations.map(({ name }) => name)).toEqual(["openai@one", "anthropic@two"]);
    expect(registrations[0]?.config.models?.[0]).toMatchObject({
      id: "same-model",
      name: "Same Model",
      api: "openai-responses",
      contextWindow: 65536,
      maxTokens: 4096,
    });
    expect(registrations[1]?.config.models?.[0]).toMatchObject({ id: "same-model", name: "Same Model" });
  });
});
