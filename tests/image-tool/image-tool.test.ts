import { describe, expect, it } from "vitest";
import {
  buildImageRequest,
  buildTaskPollUrl,
  extractImagePayload,
  extractImageTask,
} from "../../packages/image-tool/src/index.js";

describe("image-tool", () => {
  it("builds OpenAI-compatible request payload and omits undefined options", () => {
    expect(buildImageRequest({
      prompt: "cat",
      model: "gpt-image-1",
      size: "1024x1024",
      n: 1,
      quality: "low",
      outputFormat: "png",
      responseFormat: undefined,
    })).toEqual({
      model: "gpt-image-1",
      prompt: "cat",
      size: "1024x1024",
      n: 1,
      quality: "low",
      output_format: "png",
    });
  });

  it("extracts OpenAI base64 image payload", () => {
    const payload = extractImagePayload({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });
    expect(payload.kind).toBe("base64");
  });

  it("extracts OpenAI image url payload", () => {
    const payload = extractImagePayload({ data: [{ url: "https://example.com/a.png" }] });
    expect(payload).toEqual({ kind: "url", url: "https://example.com/a.png" });
  });

  it("extracts common OpenAI-compatible alternate payloads", () => {
    expect(extractImagePayload({ data: [{ base64: "data:image/png;base64,abc" }] })).toEqual({ kind: "base64", b64: "abc" });
    expect(extractImagePayload({ images: [{ image_url: { url: "https://example.com/b.png" } }] })).toEqual({ kind: "url", url: "https://example.com/b.png" });
    expect(extractImagePayload({ output: [{ result: "https://example.com/c.png" }] })).toEqual({ kind: "url", url: "https://example.com/c.png" });
    expect(extractImagePayload({ artifacts: [{ base64_json: "def" }] })).toEqual({ kind: "base64", b64: "def" });
  });

  it("extracts async task metadata from OpenAI-compatible task responses", () => {
    expect(extractImageTask({ code: 200, data: [{ status: "submitted", task_id: "task_123" }] })).toEqual({
      taskId: "task_123",
      status: "submitted",
    });
    expect(extractImageTask({ object: "image.generation.task", id: "task_456", status: "pending", poll_url: "/v1/images/generations/task_456" })).toEqual({
      taskId: "task_456",
      status: "pending",
      pollUrl: "/v1/images/generations/task_456",
    });
  });

  it("extracts completed async task image urls", () => {
    expect(extractImagePayload({
      code: 200,
      data: {
        id: "task_123",
        status: "completed",
        result: {
          images: [{ url: ["https://upload.example/image.png"] }],
        },
      },
    })).toEqual({ kind: "url", url: "https://upload.example/image.png" });
  });

  it("builds task polling URLs from poll_url, configured templates, and defaults", () => {
    expect(buildTaskPollUrl("https://api.example/v1", { taskId: "task_1", pollUrl: "https://tasks.example/task_1" })).toBe("https://tasks.example/task_1");
    expect(buildTaskPollUrl("https://api.example/v1", { taskId: "task_1", pollUrl: "/v1/images/generations/task_1" })).toBe("https://api.example/v1/images/generations/task_1");
    expect(buildTaskPollUrl("https://api.example/v1", { taskId: "task_1" }, "/images/generations/{task_id}")).toBe("https://api.example/v1/images/generations/task_1");
    expect(buildTaskPollUrl("https://api.example/v1", { taskId: "task_1" })).toBe("https://api.example/v1/tasks/task_1");
  });
});
