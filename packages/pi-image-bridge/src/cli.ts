#!/usr/bin/env node
import { doctorBridge, installBridge, statusBridge, uninstallBridge } from "./install.js";
import { serveBridge } from "./server.js";

const command = process.argv[2] || "serve";

if (command === "serve") {
  await serveBridge(process.env.PI_IMAGE_BRIDGE_HOST || "127.0.0.1", Number(process.env.PI_IMAGE_BRIDGE_PORT || "38991"));
} else if (command === "install") {
  await installBridge(process.argv.slice(3));
} else if (command === "uninstall") {
  await uninstallBridge();
} else if (command === "status") {
  await statusBridge();
} else if (command === "doctor") {
  await doctorBridge();
} else {
  console.error("Usage: pi-image-bridge <serve|install|uninstall|status|doctor>");
  process.exitCode = 1;
}
