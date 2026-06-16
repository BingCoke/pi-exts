import http from "node:http";
import { readClipboardImage, type ClipboardImage } from "./clipboard.js";

export interface BridgeServerOptions {
  host: string;
  port: number;
  readImage?: () => Promise<ClipboardImage | undefined>;
}

export async function createBridgeServer(options: BridgeServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const readImage = options.readImage ?? readClipboardImage;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url !== "/clipboard-image") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      const image = await readImage();
      if (!image) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ mimeType: image.mimeType, base64: Buffer.from(image.bytes).toString("base64") }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    url: `http://${options.host}:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

export async function serveBridge(host = "127.0.0.1", port = 38991): Promise<void> {
  await createBridgeServer({ host, port });
  console.log(`pi-image-bridge listening on http://${host}:${port}`);
}
