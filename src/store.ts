import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";

const DATA_DIR = join(import.meta.dirname, "..", "data");

export async function loadJson<T>(filename: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(join(DATA_DIR, filename), "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function saveJson(filename: string, data: unknown): Promise<void> {
  const filepath = join(DATA_DIR, filename);
  await mkdir(dirname(filepath), { recursive: true });
  await writeFile(filepath, JSON.stringify(data));
}

export function pruneByAge<T extends { timestamp: string }>(
  entries: T[],
  maxAgeMs: number
): T[] {
  const cutoff = Date.now() - maxAgeMs;
  return entries.filter((e) => new Date(e.timestamp).getTime() > cutoff);
}
