import { describe, expect, it } from "vitest";
import codingGuardrailsExtension from "../../packages/coding-guardrails/src/index.js";

type BeforeAgentStartHandler = (event: {
  systemPrompt: string;
}) => Promise<{ systemPrompt: string }>;

describe("coding-guardrails", () => {
  it("injects root-cause, architecture, and superseded-work rules", async () => {
    let handler: BeforeAgentStartHandler | undefined;
    const pi = {
      on(event: string, registered: BeforeAgentStartHandler) {
        expect(event).toBe("before_agent_start");
        handler = registered;
      },
    };

    codingGuardrailsExtension(pi as never);
    if (!handler) throw new Error("before_agent_start handler was not registered");

    const result = await handler({ systemPrompt: "Base prompt" });

    expect(result.systemPrompt).toContain("Base prompt");
    expect(result.systemPrompt).toContain("narrowest owner-level change");
    expect(result.systemPrompt).toContain("enter a read-only design phase");
    expect(result.systemPrompt).toContain("Evaluate design patterns as candidate solutions");
    expect(result.systemPrompt).toContain("stop and wait for the user's explicit approval");
    expect(result.systemPrompt).toContain("obtain explicit approval again");
    expect(result.systemPrompt).toContain("supersedes local workarounds");
    expect(result.systemPrompt).toContain("treat the current requirements and supported contracts as the source of truth");
    expect(result.systemPrompt).toContain("Artifacts created by the superseded work cannot justify their own retention");
    expect(result.systemPrompt).toContain("make a residue pass the final plan and implementation step");
    expect(result.systemPrompt).toContain("would still be created from today's requirements if the old approach were unknown");
  });
});
