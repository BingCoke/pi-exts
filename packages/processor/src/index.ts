import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
      const status = formatProcessorStatusLabel(record);
      return `${record.id} ${name} ${status} ${record.command}`;
    })
    .join("\n");
}

export function formatProcessorStatusLabel(record: ProcessorRecord): string {
  if (record.status === "exited") return `exited(${record.exitCode ?? "?"})`;
  return record.status;
}

export function formatProcessorStatus(processes: Map<string, ProcessorRecord>): string | undefined {
  if (processes.size === 0) return undefined;
  const running = Array.from(processes.values()).filter((record) => record.status === "running").length;
  return `proc: ${running}/${processes.size} running`;
}

function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength === 1) return "…";
  return `${text.slice(0, maxLength - 1)}…`;
}

const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

function visibleTextLength(text: string): number {
  return text.replace(ANSI_PATTERN, "").length;
}

function padVisibleEnd(text: string, width: number): string {
  const remaining = width - visibleTextLength(text);
  return remaining > 0 ? `${text}${" ".repeat(remaining)}` : text;
}

function renderFullWidthMessageLine(theme: { bg(color: "customMessageBg", text: string): string }, line: string, width: number): string {
  return theme.bg("customMessageBg", padVisibleEnd(` ${line} `, Math.max(0, width)));
}

function isKey(data: string, key: "up" | "down" | "enter" | "escape" | "delete" | "backspace"): boolean {
  if (key === "up") return data === "\x1b[A";
  if (key === "down") return data === "\x1b[B";
  if (key === "enter") return data === "\r" || data === "\n";
  if (key === "escape") return data === "\x1b";
  if (key === "delete") return data === "\x1b[3~";
  return data === "\x7f" || data === "\b";
}

type ProcessorTone = "success" | "warning" | "error" | "muted" | "accent" | "text";

interface ProcessorViewState {
  id: string;
  title: string;
  statusLabel: string;
  icon: string;
  iconTone: ProcessorTone;
  titleTone: ProcessorTone;
  statusTone: ProcessorTone;
  command: string;
  cwd?: string;
}

type ProcessorViewSource = Pick<ProcessorRecord, "id" | "name" | "command" | "cwd" | "status" | "exitCode"> & { statusLabel?: string };
type ProcessorTheme = { fg(color: ProcessorTone | "dim", text: string): string; bold(text: string): string };
const PROCESSOR_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function getProcessorViewState(source: ProcessorViewSource): ProcessorViewState {
  const statusLabel = source.statusLabel ?? (source.status === "exited" ? `exited(${source.exitCode ?? "?"})` : source.status);
  if (source.status === "running") {
    return {
      id: source.id,
      title: `${source.id}${source.name ? ` (${source.name})` : ""}`,
      statusLabel,
      icon: "●",
      iconTone: "success",
      titleTone: "accent",
      statusTone: "success",
      command: source.command,
      cwd: source.cwd,
    };
  }
  if (source.status === "stopped") {
    return {
      id: source.id,
      title: `${source.id}${source.name ? ` (${source.name})` : ""}`,
      statusLabel,
      icon: "■",
      iconTone: "warning",
      titleTone: "accent",
      statusTone: "warning",
      command: source.command,
      cwd: source.cwd,
    };
  }
  const ok = source.exitCode === 0;
  return {
    id: source.id,
    title: `${source.id}${source.name ? ` (${source.name})` : ""}`,
    statusLabel,
    icon: "○",
    iconTone: ok ? "muted" : "error",
    titleTone: ok ? "muted" : "accent",
    statusTone: ok ? "success" : "error",
    command: source.command,
    cwd: source.cwd,
  };
}

function renderProcessorSummaryLine(theme: ProcessorTheme, view: ProcessorViewState, selected = false): string {
  const marker = selected ? theme.fg("accent", "›") : theme.fg("dim", " ");
  return `${marker} ${theme.fg(view.iconTone, view.icon)} ${theme.fg(selected ? "accent" : view.titleTone, view.title)} ${theme.fg(view.statusTone, view.statusLabel)}`;
}

function renderProcessorRecordLine(theme: ProcessorTheme, record: ProcessorRecord, selected = false, runningIcon?: string): string {
  const view = getProcessorViewState(record);
  return renderProcessorSummaryLine(theme, record.status === "running" && runningIcon ? { ...view, icon: runningIcon } : view, selected);
}

export function formatProcessorWidget(processes: Map<string, ProcessorRecord>, limit = 5): string[] {
  if (processes.size === 0) return [];
  const records = Array.from(processes.values());
  const running = records.filter((record) => record.status === "running").length;
  const lines = [`processors: ${running} running / ${records.length} total`];
  for (const record of records.slice(-limit)) {
    const view = getProcessorViewState(record);
    lines.push(`${view.icon} ${view.title} ${view.statusLabel} ${truncateText(view.command, 80)}`);
  }
  if (records.length > limit) lines.push(`… ${records.length - limit} more`);
  return lines;
}

export type ProcessorEventReason = "process_exit" | "user_remove" | "agent_remove" | "session_shutdown";
export type ProcessorEventActor = "process" | "user" | "agent" | "system";

export interface ProcessorEventDetails {
  id: string;
  name: string | null;
  command: string;
  cwd: string | null;
  status: ProcessorStatus;
  statusLabel: string;
  exitCode: number | null;
  signal: string | null;
  reason: ProcessorEventReason;
  actor: ProcessorEventActor;
  recentOutput: string;
}

export interface ProcessorBatchEventDetails {
  events: ProcessorEventDetails[];
}

function isProcessorBatchEventDetails(details: ProcessorEventDetails | ProcessorBatchEventDetails | undefined): details is ProcessorBatchEventDetails {
  return Boolean(details && "events" in details);
}

export function createProcessorEventDetails(record: ProcessorRecord, reason: ProcessorEventReason, actor: ProcessorEventActor): ProcessorEventDetails {
  return {
    id: record.id,
    name: record.name ?? null,
    command: record.command,
    cwd: record.cwd ?? null,
    status: record.status,
    statusLabel: formatProcessorStatusLabel(record),
    exitCode: record.exitCode ?? null,
    signal: record.signal ?? null,
    reason,
    actor,
    recentOutput: record.output.text(20),
  };
}

export function getProcessorEventTitle(details: Pick<ProcessorEventDetails, "reason">): string {
  if (details.reason === "process_exit") return "Processor exited";
  if (details.reason === "user_remove") return "Processor removed by user";
  if (details.reason === "agent_remove") return "Processor cleaned by agent";
  return "Processor stopped during shutdown";
}

export function formatProcessorEventMessage(details: ProcessorEventDetails): string {
  return [
    getProcessorEventTitle(details),
    `Processor: ${details.id}${details.name ? ` (${details.name})` : ""}`,
    `Reason: ${details.reason}`,
    `Actor: ${details.actor}`,
    `Status: ${details.statusLabel}`,
    `Command: ${details.command}`,
    details.cwd ? `CWD: ${details.cwd}` : undefined,
    details.reason === "process_exit" ? "The processor has already been removed from processor_list." : undefined,
    details.recentOutput ? `Recent output:\n${details.recentOutput}` : "Recent output: (no output)",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function formatProcessorExitMessage(record: ProcessorRecord): string {
  return formatProcessorEventMessage(createProcessorEventDetails(record, "process_exit", "process"));
}

function refreshProcessorUi(ctx: ExtensionContext, processes: Map<string, ProcessorRecord>, spinnerFrame = 0): void {
  if (!ctx.hasUI) return;
  const records = Array.from(processes.values());
  if (records.length === 0) {
    ctx.ui.setStatus("processor", undefined);
    ctx.ui.setWidget("processor", undefined);
    return;
  }

  const theme = ctx.ui.theme;
  const running = records.filter((record) => record.status === "running").length;
  const runningColor = running > 0 ? "success" : "muted";
  const statusIcon = running > 0 ? PROCESSOR_SPINNER_FRAMES[spinnerFrame % PROCESSOR_SPINNER_FRAMES.length] : "⚙";
  ctx.ui.setStatus(
    "processor",
    `${theme.fg("accent", `${statusIcon} proc`)} ${theme.fg(runningColor, String(running))}${theme.fg("dim", "/")}${theme.fg("muted", String(records.length))}`
  );
}

function clearProcessorUi(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus("processor", undefined);
  ctx.ui.setWidget("processor", undefined);
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

export function stopProcessTree(child: ChildProcessWithoutNullStreams, platform: NodeJS.Platform = process.platform): void {
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

export interface ProcessorEvent {
  record: ProcessorRecord;
  reason: ProcessorEventReason;
  actor: ProcessorEventActor;
  batch?: ProcessorEvent[];
}

export type ProcessorEventHandler = (event: ProcessorEvent) => void;

export function createProcessorManager(cwd: string, onChange?: () => void, onEvent?: ProcessorEventHandler) {
  const processes = new Map<string, ProcessorRecord>();
  let nextId = 1;

  function notifyChange(): void {
    onChange?.();
  }

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
    let finalized = false;
    const finalize = (status: ProcessorStatus, code: number | null, signal: string | null, notifyExit: boolean) => {
      if (finalized) return;
      finalized = true;
      record.status = status;
      record.exitCode = code;
      record.signal = signal;
      record.child = undefined;
      processes.delete(id);
      notifyChange();
      if (notifyExit) onEvent?.({ record, reason: "process_exit", actor: "process" });
    };

    child.stdout.on("data", (chunk) => output.append(String(chunk)));
    child.stderr.on("data", (chunk) => output.append(String(chunk)));
    child.on("error", (error) => {
      output.append(`[processor error] ${error.message}`);
      finalize("exited", null, null, true);
    });
    child.on("exit", (code, signal) => {
      const status = record.status === "stopped" ? "stopped" : "exited";
      finalize(status, code, signal, status === "exited");
    });
    processes.set(id, record);
    notifyChange();
    return record;
  }

  function clean(idOrName?: string, actor: Extract<ProcessorEventActor, "user" | "agent"> = "agent", emitEvents = true): ProcessorRecord[] {
    const ids = idOrName ? [findProcessId(processes, idOrName)].filter((id): id is string => Boolean(id)) : Array.from(processes.keys());
    const removed: ProcessorRecord[] = [];
    for (const id of ids) {
      const record = processes.get(id);
      if (!record) continue;
      const child = record.child;
      record.status = "stopped";
      record.child = undefined;
      processes.delete(id);
      if (child) stopProcessTree(child);
      removed.push(record);
      if (emitEvents) onEvent?.({ record, reason: actor === "user" ? "user_remove" : "agent_remove", actor });
    }
    if (removed.length > 0) notifyChange();
    return removed;
  }

  function stopAll(): void {
    let changed = false;
    for (const record of processes.values()) {
      if (record.status === "running" && record.child) {
        record.status = "stopped";
        stopProcessTree(record.child);
        changed = true;
      }
    }
    if (changed) notifyChange();
  }

  return { processes, start, stopAll, clean };
}

function formatCleanResult(removed: ProcessorRecord[], idOrName?: string): string {
  if (removed.length > 0) return `Cleaned ${removed.map((record) => record.id).join(", ")}.`;
  return idOrName
    ? `No processor found to clean for ${idOrName}. It may already be cleaned.`
    : "No processors to clean.";
}


export default function processorExtension(pi: ExtensionAPI) {
  let manager: ReturnType<typeof createProcessorManager> | undefined;
  let uiContext: ExtensionContext | undefined;
  let listExpanded = false;
  let selectedProcessorIndex = 0;
  let scrollOffset = 0;
  const pendingUserEvents: ProcessorEvent[] = [];
  type ProcessorWidgetComponent = { render(width: number): string[]; handleInput?(data: string): void; invalidate(): void };
  type ProcessorWidgetTui = { setFocus(component: ProcessorWidgetComponent | null): void; requestRender(): void };
  let processorWidget: (ProcessorWidgetComponent & { handleInput(data: string): void }) | undefined;
  let processorWidgetTui: ProcessorWidgetTui | undefined;
  let processorListPreviousFocus: ProcessorWidgetComponent | null | undefined;
  let spinnerFrame = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;

  pi.registerMessageRenderer("processor-event", (message, { expanded }, theme) => {
    const rawDetails = message.details as ProcessorEventDetails | ProcessorBatchEventDetails | undefined;
    return {
      invalidate() {},
      render(width: number): string[] {
        if (!rawDetails) {
          const fallback = typeof message.content === "string" ? message.content : "";
          return fallback.split("\n").map((line: string) => renderFullWidthMessageLine(theme, truncateText(line, Math.max(0, width - 2)), width));
        }

        const detailsList = isProcessorBatchEventDetails(rawDetails) ? rawDetails.events : [rawDetails];
        const lines: string[] = [];
        for (const details of detailsList) {
          const color = details.reason === "process_exit"
            ? details.exitCode === 0 ? "success" : "error"
            : details.reason === "user_remove" ? "warning" : "accent";
          const eventIcon = details.reason === "process_exit" ? "○" : "✕";
          const title = truncateText(getProcessorEventTitle(details), Math.max(0, width - 4));
          const view = getProcessorViewState({
            id: details.id,
            name: details.name ?? undefined,
            command: details.command,
            cwd: details.cwd ?? undefined,
            status: details.status,
            exitCode: details.exitCode,
            statusLabel: details.statusLabel,
          });
          lines.push(`${theme.fg(color, eventIcon)} ${theme.fg(color, theme.bold(title))}`);
          lines.push(renderProcessorSummaryLine(theme, view));
          lines.push(`${theme.fg("dim", "reason:")} ${theme.fg(color, details.reason)} ${theme.fg("dim", "actor:")} ${theme.fg("accent", details.actor)}`);
          lines.push(`${theme.fg("dim", "command:")} ${truncateText(view.command, Math.max(0, width - 11))}`);
          if (expanded && details.recentOutput) {
            lines.push(theme.fg("dim", "recent output:"));
            lines.push(...details.recentOutput.split("\n").map((line) => truncateText(line, Math.max(0, width - 2))));
          }
          lines.push("");
        }
        if (lines.at(-1) === "") lines.pop();
        return lines.map((line) => renderFullWidthMessageLine(theme, line, width));
      },
    };
  });

  const publishProcessorEvent = (event: ProcessorEvent) => {
    const events = event.batch ?? [event];
    const detailsList = events
      .filter((candidate) => candidate.actor !== "agent" && candidate.reason !== "session_shutdown")
      .map((candidate) => createProcessorEventDetails(candidate.record, candidate.reason, candidate.actor));
    if (detailsList.length === 0) return;
    const content = detailsList.map((details) => formatProcessorEventMessage(details)).join("\n\n");
    const details: ProcessorEventDetails | ProcessorBatchEventDetails = detailsList.length === 1 ? detailsList[0]! : { events: detailsList };
    try {
      pi.sendMessage({
        customType: "processor-event",
        content,
        display: true,
        details,
      }, { triggerTurn: true, deliverAs: "followUp" });
    } catch (error) {
      uiContext?.ui.notify(`Failed to publish processor event: ${error instanceof Error ? error.message : String(error)}`, "warning");
    }
  };

  const queueUserRemoveEvents = (removed: ProcessorRecord[]) => {
    pendingUserEvents.push(...removed.map((record) => ({ record, reason: "user_remove" as const, actor: "user" as const })));
  };

  const flushUserRemoveEvents = () => {
    if (pendingUserEvents.length === 0) return;
    const batch = pendingUserEvents.splice(0);
    publishProcessorEvent({ record: batch[0]!.record, reason: "user_remove", actor: "user", batch });
  };

  const records = () => Array.from(manager?.processes.values() ?? []);

  const runningCount = () => records().filter((record) => record.status === "running").length;

  const stopSpinner = () => {
    if (!spinnerTimer) return;
    clearInterval(spinnerTimer);
    spinnerTimer = undefined;
  };

  const updateSpinner = () => {
    if (runningCount() === 0) {
      stopSpinner();
      return;
    }
    if (spinnerTimer) return;
    spinnerTimer = setInterval(() => {
      if (!manager || !uiContext || runningCount() === 0) {
        stopSpinner();
        refreshUi();
        return;
      }
      spinnerFrame = (spinnerFrame + 1) % PROCESSOR_SPINNER_FRAMES.length;
      refreshProcessorUi(uiContext, manager.processes, spinnerFrame);
      processorWidgetTui?.requestRender();
    }, 120);
  };

  const clampSelection = () => {
    const count = records().length;
    selectedProcessorIndex = count === 0 ? 0 : Math.min(Math.max(selectedProcessorIndex, 0), count - 1);
    const visibleCount = 3;
    const maxScroll = Math.max(0, count - visibleCount);
    scrollOffset = Math.min(Math.max(scrollOffset, 0), maxScroll);
    if (selectedProcessorIndex < scrollOffset) scrollOffset = selectedProcessorIndex;
    if (selectedProcessorIndex >= scrollOffset + visibleCount) scrollOffset = Math.min(maxScroll, selectedProcessorIndex - visibleCount + 1);
  };

  const closeProcessorList = () => {
    const wasExpanded = listExpanded;
    listExpanded = false;
    flushUserRemoveEvents();
    if (wasExpanded) {
      processorWidgetTui?.setFocus(processorListPreviousFocus ?? null);
      processorListPreviousFocus = undefined;
    }
    refreshUi();
  };

  const renderProcessorWidget = (theme: ProcessorTheme, width: number): string[] => {
    const items = records();
    const running = runningCount();
    const runningColor = running > 0 ? "success" : "muted";
    const runningIcon = PROCESSOR_SPINNER_FRAMES[spinnerFrame % PROCESSOR_SPINNER_FRAMES.length];
    if (items.length === 0) return [theme.fg("muted", "No background processors.")];
    clampSelection();

    if (!listExpanded) {
      const visible = items.slice(-3);
      const lines = [
        `${theme.fg("accent", theme.bold("processors"))} ${theme.fg(runningColor, `${running} running`)} ${theme.fg("dim", "/")} ${theme.fg("muted", `${items.length} total`)}`,
      ];
      for (const record of visible) {
        lines.push(renderProcessorRecordLine(theme, record, false, runningIcon));
      }
      if (items.length > visible.length) lines.push(theme.fg("dim", `… ${items.length - visible.length} more; /processor list to inspect`));
      return lines;
    }

    const visibleCount = 3;
    const visible = items.slice(scrollOffset, scrollOffset + visibleCount);
    const lines = [
      `${theme.fg("accent", theme.bold("processors list"))} ${theme.fg(runningColor, `${running} running`)} ${theme.fg("dim", "/")} ${theme.fg("muted", `${items.length} total`)}`,
      theme.fg("dim", "↑/↓ select • enter/o output • d/x/delete clean • q/esc close"),
    ];
    if (items.length > visibleCount) {
      lines.push(theme.fg("dim", `showing ${scrollOffset + 1}-${Math.min(scrollOffset + visibleCount, items.length)} of ${items.length}`));
    }
    for (let index = 0; index < visible.length; index++) {
      const record = visible[index]!;
      const itemIndex = scrollOffset + index;
      lines.push(renderProcessorRecordLine(theme, record, itemIndex === selectedProcessorIndex, runningIcon));
      lines.push(`  ${theme.fg("dim", truncateText(record.command, Math.max(20, width - 4)))}`);
    }
    return lines;
  };

  const selectedProcessor = () => {
    clampSelection();
    return records()[selectedProcessorIndex];
  };

  const ensureProcessorWidget = (ctx: ExtensionContext) => {
    if (!ctx.hasUI || !manager) return;
    if (manager.processes.size === 0) {
      if (listExpanded) closeProcessorList();
      ctx.ui.setWidget("processor", undefined);
      processorWidget = undefined;
      processorWidgetTui = undefined;
      return;
    }
    if (processorWidget) {
      processorWidgetTui?.requestRender();
      return;
    }
    ctx.ui.setWidget("processor", (tui, theme) => {
      processorWidgetTui = tui;
      processorWidget = {
        invalidate() {},
        render(width: number): string[] {
          return renderProcessorWidget(theme, width);
        },
        handleInput(data: string): void {
          if (!listExpanded) return;
          if (isKey(data, "escape") || data === "q") {
            closeProcessorList();
            return;
          }
          const items = records();
          if (isKey(data, "up")) {
            selectedProcessorIndex = Math.max(0, selectedProcessorIndex - 1);
            clampSelection();
            tui.requestRender();
            return;
          }
          if (isKey(data, "down")) {
            selectedProcessorIndex = Math.min(Math.max(items.length - 1, 0), selectedProcessorIndex + 1);
            clampSelection();
            tui.requestRender();
            return;
          }
          const record = selectedProcessor();
          if (!record) return;
          if (isKey(data, "enter") || data === "o") {
            uiContext?.ui.notify(record.output.text(80) || "(no output yet)", "info");
            return;
          }
          if (data === "d" || data === "x" || isKey(data, "delete") || isKey(data, "backspace")) {
            const removed = manager?.clean(record.id, "user", false) ?? [];
            queueUserRemoveEvents(removed);
            clampSelection();
            if ((manager?.processes.size ?? 0) === 0) {
              closeProcessorList();
              return;
            }
            tui.requestRender();
          }
        },
      };
      return processorWidget;
    });
  };

  const refreshUi = () => {
    if (!manager || !uiContext) return;
    refreshProcessorUi(uiContext, manager.processes, spinnerFrame);
    ensureProcessorWidget(uiContext);
    updateSpinner();
  };

  const getManager = (cwd: string) => {
    manager ??= createProcessorManager(cwd, refreshUi, publishProcessorEvent);
    return manager;
  };

  const attachUi = (ctx: ExtensionContext) => {
    uiContext = ctx;
    refreshUi();
  };

  pi.on("session_start", async (_event, ctx) => {
    uiContext = ctx;
    if (manager) refreshUi();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopSpinner();
    manager?.stopAll();
    manager = undefined;
    clearProcessorUi(ctx);
    uiContext = undefined;
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
      attachUi(ctx);
      const record = getManager(ctx.cwd).start(params.command, { name: params.name, cwd: params.cwd });
      return textResult(`Started ${record.id}${record.name ? ` (${record.name})` : ""}: ${record.command}`, { id: record.id, name: record.name });
    },
  });

  pi.registerTool({
    name: "processor_list",
    label: "List Processors",
    description: "List background processors started in this Pi session.",
    parameters: Type.Object({}),
    execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
      const current = getManager(ctx.cwd);
      return textResult(formatProcessList(current.processes));
    },
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
    name: "processor_clean",
    label: "Clean Processors",
    description: "Stop and remove one or more background processors. Without idOrName, cleans all processors.",
    parameters: Type.Object({ idOrName: Type.Optional(Type.String({ description: "Optional processor id or friendly name to clean" })) }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      attachUi(ctx);
      const removed = getManager(ctx.cwd).clean(params.idOrName, "agent");
      return textResult(formatCleanResult(removed, params.idOrName), { ids: removed.map((record) => record.id) });
    },
  });

  pi.registerCommand("processor", {
    description: "Manage background processors: /processor list | output <id> | clean [id]",
    handler: async (args, ctx) => {
      const [action, idOrName] = args.trim().split(/\s+/, 2);
      attachUi(ctx);
      const current = getManager(ctx.cwd);
      if (!action || action === "list") {
        if (current.processes.size === 0) {
          ctx.ui.notify("No background processors.", "info");
          refreshUi();
          return;
        }
        listExpanded = true;
        selectedProcessorIndex = 0;
        scrollOffset = 0;
        refreshUi();
        if (processorWidget && processorWidgetTui) {
          const focusedComponent = (processorWidgetTui as ProcessorWidgetTui & { focusedComponent?: ProcessorWidgetComponent | null }).focusedComponent;
          if (focusedComponent !== processorWidget) {
            processorListPreviousFocus = focusedComponent ?? null;
          }
          processorWidgetTui.setFocus(processorWidget);
        }
        return;
      }
      if (action === "output" && idOrName) {
        const id = findProcessId(current.processes, idOrName);
        const record = id ? current.processes.get(id) : undefined;
        ctx.ui.notify(record ? record.output.text(80) || "(no output yet)" : `Processor not found: ${idOrName}`, record ? "info" : "warning");
        refreshUi();
        return;
      }
      if (action === "clean") {
        const removed = current.clean(idOrName, "user", false);
        if (removed.length > 0) {
          publishProcessorEvent({
            record: removed[0]!,
            reason: "user_remove",
            actor: "user",
            batch: removed.map((record) => ({ record, reason: "user_remove" as const, actor: "user" as const })),
          });
        }
        ctx.ui.notify(formatCleanResult(removed, idOrName), "info");
        refreshUi();
        return;
      }
      ctx.ui.notify("Usage: /processor list | output <id-or-name> | clean [id-or-name]", "warning");
      refreshUi();
    },
  });
}
