import { describe, expect, it } from "vitest";
import { buildImageRequest, extractImagePayload } from "../../packages/image-tool/src/index.js";

describe("image-tool", () => {
  it("builds OpenAI-compatible request payload", () => {
    expect(buildImageRequest({ prompt: "cat", model: "gpt-image-1", size: "1024x1024" })).toEqual({
      model: "gpt-image-1",
      prompt: "cat",
      size: "1024x1024",
    });
  });

  it("extracts base64 image payload", () => {
    const payload = extractImagePayload({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });
    expect(payload.kind).toBe("base64");
  });

  it("extracts image url payload", () => {
    const payload = extractImagePayload({ data: [{ url: "https://example.com/a.png" }] });
    expect(payload).toEqual({ kind: "url", url: "https://example.com/a.png" });
  });
});
