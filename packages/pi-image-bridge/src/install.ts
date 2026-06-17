import { getClipboardUnavailableHint } from "./clipboard.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const START = "# >>> pi-image-bridge";
const END = "# <<< pi-image-bridge";

export function buildSshConfigBlock(options: { hosts: string[]; port: number; remoteBind?: string }): string {
  const remoteBind = options.remoteBind || "127.0.0.1";
  return [
    START,
    `Host ${options.hosts.join(" ")}`,
    `  RemoteForward ${remoteBind}:${options.port} 127.0.0.1:${options.port}`,
    "  ExitOnForwardFailure no",
    END,
    "",
  ].join("\n");
}

export function mergeManagedHosts(existingHosts: string[], requestedHosts: string[]): string[] {
  if (existingHosts.includes("*") || requestedHosts.includes("*")) return ["*"];
  return Array.from(new Set([...existingHosts, ...requestedHosts]));
}

export function hostMergeBroadensScope(existingHosts: string[], requestedHosts: string[]): boolean {
  return !existingHosts.includes("*") && existingHosts.length > 0 && requestedHosts.includes("*");
}

export function extractManagedHosts(input: string): string[] {
  const start = input.indexOf(START);
  const end = input.indexOf(END);
  if (start === -1 && end === -1) return [];
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Malformed pi-image-bridge managed SSH config block; remove it manually before reinstalling.");
  }
  const block = input.slice(start, end);
  const hostLine = block.split(/\r?\n/).find((line) => line.trim().startsWith("Host "));
  return hostLine ? hostLine.trim().slice("Host ".length).split(/\s+/).filter(Boolean) : [];
}

export function removeManagedSshConfigBlock(input: string): string {
  const start = input.indexOf(START);
  const end = input.indexOf(END);
  if (start === -1 && end === -1) return input;
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Malformed pi-image-bridge managed SSH config block; remove it manually before reinstalling.");
  }
  const afterEnd = end + END.length;
  const trailingNewline = input.slice(afterEnd).startsWith("\n") ? 1 : 0;
  return input.slice(0, start) + input.slice(afterEnd + trailingNewline);
}

export function verifyManagedSshConfig(input: string, options: { port: number; remoteBind?: string }): void {
  const remoteBind = options.remoteBind || "127.0.0.1";
  if (!input.includes(START) || !input.includes(END)) {
    throw new Error("pi-image-bridge managed SSH config block not found after write.");
  }
  const expectedForward = `RemoteForward ${remoteBind}:${options.port} 127.0.0.1:${options.port}`;
  if (!input.includes(expectedForward)) {
    throw new Error(`pi-image-bridge managed SSH config missing expected ${expectedForward}.`);
  }
}

function parseHosts(args: string[]): string[] {
  const hosts: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--ssh-host" && args[i + 1]) hosts.push(args[i + 1]);
  }
  return hosts.length > 0 ? hosts : ["*"];
}

function parseRemoteBind(args: string[]): string {
  const index = args.indexOf("--remote-bind");
  return index >= 0 && args[index + 1] ? args[index + 1] : "127.0.0.1";
}

async function writeSshConfig(args: string[]): Promise<void> {
  const sshDir = path.join(os.homedir(), ".ssh");
  const configPath = path.join(sshDir, "config");
  await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });
  const existing = await fs.readFile(configPath, "utf8").catch(() => "");
  const requestedHosts = parseHosts(args);
  const existingManagedHosts = extractManagedHosts(existing);
  if (hostMergeBroadensScope(existingManagedHosts, requestedHosts)) {
    console.warn("pi-image-bridge: expanding managed SSH config from explicit hosts to Host * for zero-argument install.");
  }
  const hosts = mergeManagedHosts(existingManagedHosts, requestedHosts);
  const cleaned = removeManagedSshConfigBlock(existing).trimEnd();
  const port = Number(process.env.PI_IMAGE_BRIDGE_PORT || "38991");
  const remoteBind = parseRemoteBind(args);
  const block = buildSshConfigBlock({ hosts, port, remoteBind });
  const next = `${cleaned}${cleaned ? "\n" : ""}${block}`;
  await fs.writeFile(configPath, next, { mode: 0o600 });
  const written = await fs.readFile(configPath, "utf8");
  verifyManagedSshConfig(written, { port, remoteBind });
}

function currentCommand(): string {
  const node = process.execPath;
  const cli = path.resolve(process.argv[1]);
  return `\"${node}\" \"${cli}\" serve`;
}

async function installWindows(): Promise<void> {
  const command = currentCommand().replaceAll("\"", "\\\"");
  spawnSync("schtasks", ["/Create", "/TN", "PiImageBridge", "/SC", "ONLOGON", "/TR", command, "/F"], { stdio: "inherit" });
}

async function installMac(): Promise<void> {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", "com.pi.image-bridge.plist");
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  const [node, cli] = [process.execPath, path.resolve(process.argv[1])];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.pi.image-bridge</string><key>ProgramArguments</key><array><string>${node}</string><string>${cli}</string><string>serve</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>\n`;
  await fs.writeFile(plistPath, plist);
  spawnSync("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 501}`, plistPath], { stdio: "ignore" });
}

async function installLinux(): Promise<void> {
  const userDir = path.join(os.homedir(), ".config", "systemd", "user");
  const servicePath = path.join(userDir, "pi-image-bridge.service");
  await fs.mkdir(userDir, { recursive: true });
  await fs.writeFile(servicePath, `[Unit]\nDescription=Pi Image Bridge\n\n[Service]\nExecStart=${currentCommand()}\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n`);
  const enable = spawnSync("systemctl", ["--user", "enable", "--now", "pi-image-bridge.service"], { stdio: "inherit" });
  if (enable.status !== 0) {
    const autostartDir = path.join(os.homedir(), ".config", "autostart");
    await fs.mkdir(autostartDir, { recursive: true });
    await fs.writeFile(path.join(autostartDir, "pi-image-bridge.desktop"), `[Desktop Entry]\nType=Application\nName=Pi Image Bridge\nExec=${currentCommand()}\nX-GNOME-Autostart-enabled=true\n`);
  }
}

export async function installBridge(args: string[] = []): Promise<void> {
  await writeSshConfig(args);
  if (process.platform === "win32") await installWindows();
  else if (process.platform === "darwin") await installMac();
  else await installLinux();
  console.log("pi-image-bridge installed. Open a new SSH connection for configured hosts so RemoteForward takes effect.");
}

export async function uninstallBridge(): Promise<void> {
  const configPath = path.join(os.homedir(), ".ssh", "config");
  const existing = await fs.readFile(configPath, "utf8").catch(() => "");
  await fs.writeFile(configPath, removeManagedSshConfigBlock(existing));
  if (process.platform === "win32") spawnSync("schtasks", ["/Delete", "/TN", "PiImageBridge", "/F"], { stdio: "inherit" });
  console.log("pi-image-bridge ssh config removed; platform service cleanup attempted when supported.");
}

export async function statusBridge(): Promise<void> {
  const ok = await fetch(`http://127.0.0.1:${process.env.PI_IMAGE_BRIDGE_PORT || "38991"}/health`).then((r) => r.ok).catch(() => false);
  console.log(ok ? "pi-image-bridge is reachable" : "pi-image-bridge is not reachable");
}

export async function doctorBridge(): Promise<void> {
  await statusBridge();
  const configPath = path.join(os.homedir(), ".ssh", "config");
  const config = await fs.readFile(configPath, "utf8").catch(() => "");
  console.log(config.includes(START) ? "ssh config block is installed" : "ssh config block is missing");
  console.log(process.env.SSH_CONNECTION ? "running inside SSH session" : "not running inside SSH session");
  const clipboardHint = getClipboardUnavailableHint();
  if (clipboardHint) console.log(clipboardHint);
}
