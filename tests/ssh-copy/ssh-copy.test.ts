import { describe, expect, it } from "vitest";
import { bridgeImageToBuffer, formatInsertedImageText, isSshSession } from "../../packages/ssh-copy/src/index.js";

describe("ssh-copy", () => {
  it("detects ssh session", () => {
    expect(isSshSession({ SSH_CONNECTION: "1 2 3 4" })).toBe(true);
    expect(isSshSession({})).toBe(false);
  });

  it("decodes bridge image json", () => {
    const decoded = bridgeImageToBuffer({ mimeType: "image/png", base64: Buffer.from("x").toString("base64") });
    expect(decoded.ext).toBe("png");
    expect(decoded.buffer.toString()).toBe("x");
  });

  it("formats inserted text", () => {
    expect(formatInsertedImageText("/tmp/a.png", "path")).toBe("/tmp/a.png");
    expect(formatInsertedImageText("/tmp/a.png", "markdown")).toBe("![pasted image](/tmp/a.png)");
  });

  it("extracts clipboard image url when response is url-based", () => {
    expect(formatInsertedImageText("https://example.com/a.png", "markdown")).toBe("![pasted image](https://example.com/a.png)");
  });
});
