import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergePersonalSettings, resolveOutputPath } from "../../packages/shared/src/settings.js";

const globalSettings = {
  "@bingcoke/ext": {
    imageTool: { model: "global-model", apiKey: "global-key" },
  },
};

const projectSettings = {
  "@bingcoke/ext": {
    imageTool: { baseUrl: "https://images.example/v1" }
  }
};

describe("shared settings", () => {
  it("deep merges project @bingcoke/ext over global settings", () => {
    const merged = mergePersonalSettings(globalSettings, projectSettings);
    expect(merged.imageTool.model).toBe("global-model");
    expect(merged.imageTool.apiKey).toBe("global-key");
    expect(merged.imageTool.baseUrl).toBe("https://images.example/v1");
  });

  it("resolves cwd-relative output paths", () => {
    const resolved = resolveOutputPath(".pi/images", "/repo/project");
    expect(resolved).toBe(path.resolve("/repo/project", ".pi/images"));
  });
});
