import { describe, expect, it } from "vitest";
import processorExtension, { buildProcessorSpawnOptions, buildStopPlan, createLineBuffer, createProcessorManager, findProcessId, formatProcessList, formatProcessorExitMessage, formatProcessorStatus, formatProcessorWidget } from "../../packages/processor/src/index.js";

describe("processor helpers", () => {
  it("keeps only the last N output lines", () => {
    const buffer = createLineBuffer(3);
    buffer.append("one\ntwo\n");
    buffer.append("three\nfour");
    expect(buffer.lines()).toEqual(["two", "three", "four"]);
  });

  it("finds a process by id or name", () => {
    const processes = new Map([
      ["proc-1", { id: "proc-1", name: "web", command: "npm run dev", status: "running" as const, startedAt: 1, output: createLineBuffer(10) }],
    ]);
    expect(findProcessId(processes, "proc-1")).toBe("proc-1");
    expect(findProcessId(processes, "web")).toBe("proc-1");
    expect(findProcessId(processes, "missing")).toBeUndefined();
  });

  it("formats process list with status and command", () => {
    const processes = new Map([
      ["proc-1", { id: "proc-1", name: "web", command: "npm run dev", status: "running" as const, startedAt: 1, output: createLineBuffer(10) }],
      ["proc-2", { id: "proc-2", command: "npm test", status: "exited" as const, exitCode: 0, startedAt: 2, output: createLineBuffer(10) }],
    ]);
    expect(formatProcessList(processes)).toContain("proc-1 web running npm run dev");
    expect(formatProcessList(processes)).toContain("proc-2 - exited(0) npm test");
  });

  it("formats persistent UI status and widget lines", () => {
    const processes = new Map([
      ["proc-1", { id: "proc-1", name: "web", command: "npm run dev", status: "running" as const, startedAt: 1, output: createLineBuffer(10) }],
      ["proc-2", { id: "proc-2", name: "test", command: "npm test", status: "exited" as const, exitCode: 1, startedAt: 2, output: createLineBuffer(10) }],
    ]);

    expect(formatProcessorStatus(processes)).toBe("proc: 1/2 running");
    expect(formatProcessorWidget(processes)).toEqual([
      "processors: 1 running / 2 total",
      "● proc-1 (web) running npm run dev",
      "○ proc-2 (test) exited(1) npm test",
    ]);
    expect(formatProcessorStatus(new Map())).toBeUndefined();
    expect(formatProcessorWidget(new Map())).toEqual([]);
  });

  it("formats processor exit messages for agent context", () => {
    const output = createLineBuffer(10);
    output.append("ready\nboom\n");
    const message = formatProcessorExitMessage({
      id: "proc-1",
      name: "web",
      command: "npm run dev",
      cwd: "/tmp/app",
      status: "exited",
      exitCode: 1,
      startedAt: 1,
      output,
    });

    expect(message).not.toContain("[processor-exit]");
    expect(message).toContain("Processor exited");
    expect(message).toContain("Processor: proc-1 (web)");
    expect(message).toContain("Status: exited(1)");
    expect(message).toContain("Reason: process_exit");
    expect(message).toContain("Actor: process");
    expect(message).toContain("Command: npm run dev");
    expect(message).toContain("The processor has already been removed from processor_list.");
    expect(message).toContain("Recent output:\nready\nboom");
  });

  it("uses taskkill to stop a Windows process tree", () => {
    expect(buildStopPlan(1234, "win32")).toEqual({
      kind: "taskkill",
      command: "taskkill",
      args: ["/PID", "1234", "/T", "/F"],
    });
  });

  it("uses negative process group pid to stop POSIX process trees", () => {
    expect(buildStopPlan(1234, "linux")).toEqual({ kind: "process-group", pid: -1234 });
    expect(buildStopPlan(1234, "darwin")).toEqual({ kind: "process-group", pid: -1234 });
  });

  it("starts POSIX processors as detached process groups", () => {
    expect(buildProcessorSpawnOptions("/tmp/app", "linux")).toMatchObject({ cwd: "/tmp/app", shell: true, detached: true });
    expect(buildProcessorSpawnOptions("/tmp/app", "darwin")).toMatchObject({ cwd: "/tmp/app", shell: true, detached: true });
    expect(buildProcessorSpawnOptions("C:/app", "win32")).toMatchObject({ cwd: "C:/app", shell: true, detached: false });
  });
});

describe("processor extension tools", () => {
  it("does not initialize or refresh UI when listing processors via the tool", async () => {
    const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
    const pi = {
      registerMessageRenderer: () => {},
      on: () => {},
      registerCommand: () => {},
      registerTool: (tool: { name: string; execute: (...args: any[]) => Promise<any> }) => {
        tools.set(tool.name, tool);
      },
      sendMessage: () => {},
    };
    const uiCalls: string[] = [];
    const ctx = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        theme: {
          fg: (_color: string, text: string) => text,
          bg: (_color: string, text: string) => text,
          bold: (text: string) => text,
        },
        setStatus: () => { uiCalls.push("setStatus"); },
        setWidget: () => { uiCalls.push("setWidget"); },
        notify: () => {},
      },
    };

    processorExtension(pi as any);
    const listTool = tools.get("processor_list");
    expect(listTool).toBeDefined();

    await listTool!.execute("tool-call", {}, undefined, undefined, ctx);

    expect(uiCalls).toEqual([]);
  });

  it("restores editor focus when closing the focused processor list with escape", async () => {
    const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
    let processorCommand: { handler: (args: string, ctx: any) => Promise<void> } | undefined;
    const pi = {
      registerMessageRenderer: () => {},
      on: () => {},
      registerCommand: (name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) => {
        if (name === "processor") processorCommand = command;
      },
      registerTool: (tool: { name: string; execute: (...args: any[]) => Promise<any> }) => {
        tools.set(tool.name, tool);
      },
      sendMessage: () => {},
    };
    const editor = { render: () => [], invalidate: () => {}, handleInput: () => {} };
    const focusCalls: unknown[] = [];
    let processorWidget: { render(width: number): string[]; handleInput(data: string): void; invalidate(): void } | undefined;
    const tui: { focusedComponent: unknown; setFocus(component: unknown): void; requestRender(): void } = {
      focusedComponent: editor,
      setFocus: (component: unknown) => {
        focusCalls.push(component);
        tui.focusedComponent = component;
      },
      requestRender: () => {},
    };
    const theme = {
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    const ctx = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        theme,
        setStatus: () => {},
        setWidget: (_key: string, content: unknown) => {
          processorWidget = typeof content === "function" ? (content as any)(tui, theme) : undefined;
        },
        notify: () => {},
      },
    };

    processorExtension(pi as any);
    const startTool = tools.get("processor_start");
    const cleanTool = tools.get("processor_clean");
    expect(startTool).toBeDefined();
    expect(cleanTool).toBeDefined();
    expect(processorCommand).toBeDefined();

    await startTool!.execute("tool-call", { command: "node -e \"setTimeout(()=>{}, 30000)\"", name: "focus-test" }, undefined, undefined, ctx);
    try {
      await processorCommand!.handler("list", ctx);
      expect(processorWidget).toBeDefined();
      expect(tui.focusedComponent).toBe(processorWidget);

      processorWidget!.handleInput("\x1b");

      expect(tui.focusedComponent).toBe(editor);
    } finally {
      await cleanTool!.execute("tool-call", {}, undefined, undefined, ctx);
    }
  });
});


describe("processor manager", () => {
  it("notifies when a process exits and removes it from the active list", async () => {
    let changes = 0;
    const exitedRecords: string[] = [];
    const { processes, start, stopAll } = createProcessorManager(
      process.cwd(),
      () => { changes += 1; },
      (event) => { exitedRecords.push(event.record.id); }
    );
    const record = start("node -e \"process.exit(42)\"", { name: "crasher" });

    await new Promise<void>((resolve) => {
      if (!record.child) return resolve();
      record.child.on("exit", () => resolve());
    });

    expect(changes).toBeGreaterThanOrEqual(2);
    expect(exitedRecords).toEqual([record.id]);
    expect(record.status).toBe("exited");
    expect(record.exitCode).toBe(42);
    expect(record.child).toBeUndefined();
    expect(processes.has(record.id)).toBe(false);
    expect(formatProcessList(processes)).toBe("No background processors.");
    stopAll();
  });

  it("cleans stale stopped or exited records", () => {
    const { processes, clean } = createProcessorManager(process.cwd());
    processes.set("proc-1", { id: "proc-1", name: "old", command: "npm test", status: "exited", exitCode: 1, startedAt: 1, output: createLineBuffer(10) });
    processes.set("proc-2", { id: "proc-2", name: "live", command: "npm run dev", status: "running", startedAt: 2, output: createLineBuffer(10) });

    expect(clean()).toEqual([expect.objectContaining({ id: "proc-1" }), expect.objectContaining({ id: "proc-2" })]);
    expect(processes.has("proc-1")).toBe(false);
    expect(processes.has("proc-2")).toBe(false);
  });

  it("reports user clean events", () => {
    const events: string[] = [];
    const { processes, clean } = createProcessorManager(process.cwd(), undefined, (event) => {
      events.push(`${event.actor}:${event.reason}:${event.record.id}`);
    });
    processes.set("proc-1", { id: "proc-1", command: "npm test", status: "exited", exitCode: 1, startedAt: 1, output: createLineBuffer(10) });

    expect(clean("proc-1", "user")).toEqual([expect.objectContaining({ id: "proc-1" })]);
    expect(events).toEqual(["user:user_remove:proc-1"]);
  });

  it("cleans a real background process by stopping and removing it", async () => {
    const { processes, start, clean, stopAll } = createProcessorManager(process.cwd());
    const record = start("node -e \"setTimeout(()=>{}, 30000)\"", { name: "test-proc" });
    const child = record.child;
    expect(record.status).toBe("running");
    const removed = clean("test-proc");
    expect(removed).toEqual([record]);
    expect(record.status).toBe("stopped");
    expect(processes.has(record.id)).toBe(false);
    // wait for exit to clean up
    await new Promise<void>((resolve) => {
      if (!child) return resolve();
      const timeout = setTimeout(() => resolve(), 5000);
      child.on("exit", () => { clearTimeout(timeout); resolve(); });
    });
    stopAll();
  }, 15000);
});
