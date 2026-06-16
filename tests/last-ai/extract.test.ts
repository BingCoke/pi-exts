import { describe, expect, it } from "vitest";
import { buildLastAiDocument, extractAssistantTexts, extractReplyBelowSeparator } from "../../packages/last-ai/src/index.js";

const branch = [
  { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "first" }] } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "second" }] } },
];

describe("last-ai", () => {
  it("extracts last n assistant texts", () => {
    expect(extractAssistantTexts(branch, 1)).toEqual(["second"]);
    expect(extractAssistantTexts(branch, 2)).toEqual(["first", "second"]);
  });

  it("builds a markdown document with reply separator", () => {
    const doc = buildLastAiDocument(["second"]);
    expect(doc).toContain("## AI Message 1");
    expect(doc).toContain("second");
    expect(doc).toContain("\n----\n");
  });

  it("extracts editor reply below separator", () => {
    expect(extractReplyBelowSeparator("above\n----\nreply text\n")).toBe("reply text");
  });

  it("extracts editor reply with CRLF separator", () => {
    expect(extractReplyBelowSeparator("above\r\n----\r\nreply text\r\n")).toBe("reply text");
  });
});
