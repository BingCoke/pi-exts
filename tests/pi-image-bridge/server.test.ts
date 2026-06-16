import { afterEach, describe, expect, it } from "vitest";
import { createBridgeServer } from "../../packages/pi-image-bridge/src/server.js";

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (close) await close();
  close = undefined;
});

describe("pi-image-bridge server", () => {
  it("returns clipboard image JSON", async () => {
    const server = await createBridgeServer({
      host: "127.0.0.1",
      port: 0,
      readImage: async () => ({ mimeType: "image/png", bytes: Buffer.from("hello") }),
    });
    close = server.close;
    const response = await fetch(`${server.url}/clipboard-image`);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.mimeType).toBe("image/png");
    expect(json.base64).toBe(Buffer.from("hello").toString("base64"));
  });

  it("returns health JSON", async () => {
    const server = await createBridgeServer({
      host: "127.0.0.1",
      port: 0,
      readImage: async () => undefined,
    });
    close = server.close;
    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
