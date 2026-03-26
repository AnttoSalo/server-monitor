import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { loadJson, saveJson, pruneByAge } from "../src/store.js";

describe("store", () => {
  describe("pruneByAge", () => {
    it("removes entries older than maxAge", () => {
      const now = Date.now();
      const entries = [
        { timestamp: new Date(now - 10_000).toISOString(), value: 1 },
        { timestamp: new Date(now - 5_000).toISOString(), value: 2 },
        { timestamp: new Date(now - 1_000).toISOString(), value: 3 },
      ];
      const result = pruneByAge(entries, 6_000);
      expect(result).toHaveLength(2);
      expect(result[0].value).toBe(2);
      expect(result[1].value).toBe(3);
    });

    it("returns empty array when all entries are expired", () => {
      const entries = [
        { timestamp: new Date(Date.now() - 100_000).toISOString() },
      ];
      expect(pruneByAge(entries, 1_000)).toHaveLength(0);
    });

    it("keeps all entries when none are expired", () => {
      const entries = [
        { timestamp: new Date().toISOString() },
        { timestamp: new Date().toISOString() },
      ];
      expect(pruneByAge(entries, 60_000)).toHaveLength(2);
    });

    it("handles empty array", () => {
      expect(pruneByAge([], 60_000)).toEqual([]);
    });
  });
});
