import { describe, it, expect } from "vitest";

// Test the pure parsing functions by importing the module and testing its behavior.
// Since collectors read /proc files (Linux-only), we test the parseable parts.

describe("selfmon collector", () => {
  it("collectSelfMonitor returns valid stats", async () => {
    const { collectSelfMonitor, setCollectionMs } = await import("../src/collectors/selfmon.js");
    setCollectionMs(50);
    const stats = collectSelfMonitor();

    expect(stats).toBeDefined();
    expect(stats.memoryMB).toBeGreaterThan(0);
    expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(stats.collectionMs).toBe(50);
    expect(stats.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("getLastSelfMonitor returns cached value", async () => {
    const { collectSelfMonitor, getLastSelfMonitor } = await import("../src/collectors/selfmon.js");
    collectSelfMonitor();
    const last = getLastSelfMonitor();
    expect(last).not.toBeNull();
    expect(last!.memoryMB).toBeGreaterThan(0);
  });
});

describe("sysinfo collector", () => {
  it("collectSysInfo returns system information", async () => {
    const { collectSysInfo } = await import("../src/collectors/sysinfo.js");
    const info = await collectSysInfo();

    expect(info).toBeDefined();
    expect(info.arch).toBeTruthy();
    expect(info.cpuCores).toBeGreaterThan(0);
    expect(info.totalMemGB).toBeGreaterThan(0);
    expect(info.bootTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(info.cpuModel).toBeTruthy();
  });

  it("caches result on subsequent calls", async () => {
    const { collectSysInfo } = await import("../src/collectors/sysinfo.js");
    const first = await collectSysInfo();
    const second = await collectSysInfo();
    expect(first).toBe(second); // same reference — cached
  });
});

describe("processes collector", () => {
  it("filters out self-measurement commands", async () => {
    const { collectTopProcesses } = await import("../src/collectors/processes.js");
    const result = await collectTopProcesses();

    expect(result.byCpu).toBeDefined();
    expect(result.byMem).toBeDefined();

    // Should never contain ps aux or pm2 jlist
    for (const proc of [...result.byCpu, ...result.byMem]) {
      expect(proc.command).not.toContain("ps aux");
      expect(proc.command).not.toContain("pm2 jlist");
    }
  });

  it("normalizes CPU to system percentage", async () => {
    const { collectTopProcesses } = await import("../src/collectors/processes.js");
    const result = await collectTopProcesses();

    // CPU should be 0-100% (normalized), not 0-400% for 4 cores
    for (const proc of result.byCpu) {
      expect(proc.cpu).toBeLessThanOrEqual(100);
      expect(proc.cpu).toBeGreaterThanOrEqual(0);
    }
  });
});
