import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import path from "node:path";
import { errorResult, textResult } from "../../shared/src/tool-result.js";

export type ProcessorStatus = "running" | "exited" | "stopped";

export interface LineBuffer {
  append(chunk: string): void;
  lines(limit?: number): string[];
  text(limit?: number): string;
}

export interface ProcessorRecord {
  id: string;
  name?: string;
  command: string;
  cwd?: string;
  status: ProcessorStatus;
  exitCode?: number | null;
  signal?: string | null;
  startedAt: number;
  output: LineBuffer;
  child?: ChildProcessWithoutNullStreams;
}

export function createLineBuffer(maxLines: number): LineBuffer {
  const stored: string[] = [];
  let pending = "";
  const pushLine = (line: string) => {
    stored.push(line);
    while (stored.length > maxLines) stored.shift();
  };
  return {
    append(chunk: string) {
      const text = pending + chunk.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
      const parts = text.split("\n");
      pending = parts.pop() ?? "";
      for (const part of parts) pushLine(part);
    },
    lines(limit?: number) {
      const all = pending ? [...stored, pending] : [...stored];
      return all.slice(-(typeof limit === "number" ? Math.max(0, limit) : maxLines));
    },
    text(limit?: number) {
      return this.lines(limit).join("\n");
    },
  };
}

export function findProcessId(processes: Map<string, ProcessorRecord>, idOrName: string): string | undefined {
  if (processes.has(idOrName)) return idOrName;
  for (const [id, record] of processes) {
    if (record.name === idOrName) return id;
  }
  return undefined;
}

export function formatProcessList(processes: Map<string, ProcessorRecord>): string {
  if (processes.size === 0) return "No background processors.";
  return Array.from(processes.values())
    .map((record) => {
      const name = record.name ?? "-";
      const status = record.status === "exited" ? `exited(${record.exitCode ?? "?"})` : record.status;
      return `${record.id} ${name} ${status} ${record.command}`;
    })
    .join("\n");
}

export type StopPlan =
  | { kind: "taskkill"; command: "taskkill"; args: string[] }
  | { kind: "process-group"; pid: number };

export function buildProcessorSpawnOptions(cwd: string, platform: NodeJS.Platform = process.platform): SpawnOptionsWithoutStdio {
  return {
    cwd,
    env: process.env,
    shell: true,
    detached: platform !== "win32",
    windowsHide: true,
  };
}

export function buildStopPlan(pid: number, platform: NodeJS.Platform = process.platform): StopPlan {
  if (platform === "win32") {
    return { kind: "taskkill", command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] };
  }
  return { kind: "process-group", pid: -pid };
}

function stopProcessTree(child: ChildProcessWithoutNullStreams, platform: NodeJS.Platform = process.platform): void {
  if (!child.pid) {
    child.kill();
    return;
  }
  const plan = buildStopPlan(child.pid, platform);
  if (plan.kind === "taskkill") {
    const result = spawnSync(plan.command, plan.args, { stdio: "ignore" });
    if (result.status !== 0) child.kill();
    return;
  }
  try {
    process.kill(plan.pid);
  } catch {
    child.kill();
  }
}

function createProcessorManager(cwd: string) {
  const processes = new Map<string, ProcessorRecord>();
  let nextId = 1;

  function start(command: string, options: { name?: string; cwd?: string; maxOutputLines?: number } = {}): ProcessorRecord {
    const id = `proc-${nextId++}`;
    const output = createLineBuffer(options.maxOutputLines ?? 500);
    const processCwd = options.cwd ? path.resolve(cwd, options.cwd) : cwd;
    const child = spawn(command, buildProcessorSpawnOptions(processCwd));
    const record: ProcessorRecord = {
      id,
      name: options.name,
      command,
      cwd: processCwd,
      status: "running",
      startedAt: Date.now(),
      output,
      child,
    };
    child.stdout.on("data", (chunk) => output.append(String(chunk)));
    child.stderr.on("data", (chunk) => output.append(String(chunk)));
    child.on("exit", (code, signal) => {
      record.status = record.status === "stopped" ? "stopped" : "exited";
      record.exitCode = code;
      record.signal = signal;
      record.child = undefined;
    });
    processes.set(id, record);
    return record;
  }

  function stop(idOrName: string): ProcessorRecord | undefined {
    const id = findProcessId(processes, idOrName);
    if (!id) return undefined;
    const record = processes.get(id);
    if (!record) return undefined;
    if (record.status === "running" && record.child) {
      record.status = "stopped";
      stopProcessTree(record.child);
    }
    return record;
  }

  function stopAll(): void {
    for (const record of processes.values()) {
      if (record.status === "running" && record.child) {
        record.status = "stopped";
        stopProcessTree(record.child);
      }
    }
  }

  return { processes, start, stop, stopAll };
}

export default function processorExtension(pi: ExtensionAPI) {
  let manager: ReturnType<typeof createProcessorManager> | undefined;
  const getManager = (cwd: string) => {
    manager ??= createProcessorManager(cwd);
    return manager;
  };

  pi.on("session_shutdown", async () => {
    manager?.stopAll();
    manager = undefined;
  });

  pi.registerTool({
    name: "processor_start",
    label: "Start Processor",
    description: "Start a long-running background shell command, such as a web development server.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to run in the background" }),
      name: Type.Optional(Type.String({ description: "Optional friendly name, e.g. web" })),
      cwd: Type.Optional(Type.String({ description: "Optional cwd relative to Pi cwd" })),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const record = getManager(ctx.cwd).start(params.command, { name: params.name, cwd: params.cwd });
      return textResult(`Started ${record.id}${record.name ? ` (${record.name})` : ""}: ${record.command}`, { id: record.id, name: record.name });
    },
  });

  pi.registerTool({
    name: "processor_list",
    label: "List Processors",
    description: "List background processors started in this Pi session.",
    parameters: Type.Object({}),
    execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => textResult(formatProcessList(getManager(ctx.cwd).processes)),
  });

  pi.registerTool({
    name: "processor_output",
    label: "Processor Output",
    description: "Read recent output from a background processor by id or name.",
    parameters: Type.Object({
      idOrName: Type.String({ description: "Processor id or friendly name" }),
      lines: Type.Optional(Type.Number({ description: "Number of recent lines to return" })),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const processes = getManager(ctx.cwd).processes;
      const id = findProcessId(processes, params.idOrName);
      const record = id ? processes.get(id) : undefined;
      if (!record) return errorResult(`Processor not found: ${params.idOrName}`);
      return textResult(record.output.text(params.lines ?? 80) || "(no output yet)", { id: record.id, status: record.status });
    },
  });

  pi.registerTool({
    name: "processor_stop",
    label: "Stop Processor",
    description: "Stop a background processor by id or name.",
    parameters: Type.Object({ idOrName: Type.String({ description: "Processor id or friendly name" }) }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const record = getManager(ctx.cwd).stop(params.idOrName);
      if (!record) return errorResult(`Processor not found: ${params.idOrName}`);
      return textResult(`Stopped ${record.id}${record.name ? ` (${record.name})` : ""}.`, { id: record.id, status: record.status });
    },
  });

  pi.registerCommand("processor", {
    description: "Manage background processors: /processor list | output <id> | stop <id>",
    handler: async (args, ctx) => {
      const [action, idOrName] = args.trim().split(/\s+/, 2);
      const current = getManager(ctx.cwd);
      if (!action || action === "list") {
        ctx.ui.notify(formatProcessList(current.processes), "info");
        return;
      }
      if (action === "output" && idOrName) {
        const id = findProcessId(current.processes, idOrName);
        const record = id ? current.processes.get(id) : undefined;
        ctx.ui.notify(record ? record.output.text(80) || "(no output yet)" : `Processor not found: ${idOrName}`, record ? "info" : "warning");
        return;
      }
      if (action === "stop" && idOrName) {
        const record = current.stop(idOrName);
        ctx.ui.notify(record ? `Stopped ${record.id}` : `Processor not found: ${idOrName}`, record ? "info" : "warning");
        return;
      }
      ctx.ui.notify("Usage: /processor list | output <id-or-name> | stop <id-or-name>", "warning");
    },
  });
}
