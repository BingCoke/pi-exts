import { describe, expect, it } from "vitest";
import { buildProcessorSpawnOptions, buildStopPlan, createLineBuffer, createProcessorManager, findProcessId, formatProcessList } from "../../packages/processor/src/index.js";

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

describe("processor manager", () => {
  it("stops a real background process", async () => {
    const { start, stop, stopAll } = createProcessorManager(process.cwd());
    const record = start("node -e \"setTimeout(()=>{}, 30000)\"", { name: "test-proc" });
    expect(record.status).toBe("running");
    const stopped = stop("test-proc");
    expect(stopped).toBeDefined();
    expect(stopped!.status).toBe("stopped");
    // wait for exit to clean up
    await new Promise<void>((resolve) => {
      if (!record.child) return resolve();
      const timeout = setTimeout(() => resolve(), 5000);
      record.child.on("exit", () => { clearTimeout(timeout); resolve(); });
    });
    stopAll();
  }, 15000);
});
