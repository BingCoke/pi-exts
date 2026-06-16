import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergePersonalSettings, resolveOutputPath } from "../../packages/shared/src/settings.js";

const globalSettings = {
  personalPiTools: {
    imageTool: { model: "global-model", outputDir: "~/global-images" },
    sshCopy: { remoteImageDir: "~/global-paste" }
  }
};

const projectSettings = {
  personalPiTools: {
    imageTool: { outputDir: ".pi/project-images" }
  }
};

describe("shared settings", () => {
  it("deep merges project personalPiTools over global settings", () => {
    const merged = mergePersonalSettings(globalSettings, projectSettings);
    expect(merged.imageTool.model).toBe("global-model");
    expect(merged.imageTool.outputDir).toBe(".pi/project-images");
    expect(merged.sshCopy.remoteImageDir).toBe("~/global-paste");
  });

  it("resolves cwd-relative output paths", () => {
    const resolved = resolveOutputPath(".pi/images", "/repo/project");
    expect(resolved).toBe(path.resolve("/repo/project", ".pi/images"));
  });
});
