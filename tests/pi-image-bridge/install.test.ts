import { describe, expect, it } from "vitest";
import { buildSshConfigBlock, extractManagedHosts, mergeManagedHosts, removeManagedSshConfigBlock } from "../../packages/pi-image-bridge/src/install.js";

describe("bridge installer", () => {
  it("builds default Host * ssh config block", () => {
    const block = buildSshConfigBlock({ hosts: ["*"], port: 38991, remoteBind: "127.0.0.1" });
    expect(block).toContain("Host *");
    expect(block).toContain("RemoteForward 127.0.0.1:38991 127.0.0.1:38991");
  });

  it("supports explicit host restriction as an advanced option", () => {
    expect(buildSshConfigBlock({ hosts: ["my-server"], port: 38991, remoteBind: "127.0.0.1" })).toContain("Host my-server");
  });

  it("merges additional hosts idempotently", () => {
    expect(mergeManagedHosts(["a"], ["b", "a"])).toEqual(["a", "b"]);
    expect(mergeManagedHosts(["*"], ["b"])).toEqual(["*"]);
  });

  it("extracts managed hosts from an existing block", () => {
    const input = "Host a\n  User root\n# >>> pi-image-bridge\nHost a b\n  RemoteForward 1 127.0.0.1:1\n# <<< pi-image-bridge\n";
    expect(extractManagedHosts(input)).toEqual(["a", "b"]);
  });

  it("removes existing managed ssh config block", () => {
    const input = "Host a\n  User root\n# >>> pi-image-bridge\nHost *\n  RemoteForward 1 127.0.0.1:1\n# <<< pi-image-bridge\n";
    expect(removeManagedSshConfigBlock(input)).toBe("Host a\n  User root\n");
  });

  it("refuses to remove malformed managed blocks", () => {
    expect(() => removeManagedSshConfigBlock("Host a\n# >>> pi-image-bridge\nHost *\n")).toThrow(/malformed/i);
  });
});
