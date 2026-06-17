import { describe, expect, it } from "vitest";
import { getClipboardUnavailableHint } from "../../packages/pi-image-bridge/src/clipboard.js";

describe("clipboard diagnostics", () => {
  it("reports explicit macOS limitation when native clipboard image support is unavailable", () => {
    expect(getClipboardUnavailableHint("darwin")).toContain("macOS clipboard image extraction is unavailable");
    expect(getClipboardUnavailableHint("darwin")).toContain("no pngpaste, Swift, or AppleScript fallback");
  });

  it("does not report macOS limitation on linux", () => {
    expect(getClipboardUnavailableHint("linux")).toBeUndefined();
  });
});
