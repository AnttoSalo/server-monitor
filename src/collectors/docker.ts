import { exec } from "child_process";
import { promisify } from "util";
import type { DockerContainer } from "../types.js";

const execAsync = promisify(exec);

let dockerAvailable: boolean | null = null;
let lastContainers: DockerContainer[] = [];

async function checkDocker(): Promise<boolean> {
  try {
    await execAsync("docker info", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function collectDocker(): Promise<DockerContainer[]> {
  if (dockerAvailable === null) {
    dockerAvailable = await checkDocker();
    if (!dockerAvailable) {
      console.log("Docker: not available, skipping container monitoring");
      return [];
    }
    console.log("Docker: monitoring enabled");
  }
  if (!dockerAvailable) return lastContainers;

  try {
    const { stdout } = await execAsync(
      "docker ps --format '{{json .}}' 2>/dev/null",
      { timeout: 5000 },
    );
    lastContainers = stdout.trim().split("\n").filter(Boolean).map((line) => {
      try {
        const c = JSON.parse(line);
        return {
          id: (c.ID || "").substring(0, 12),
          name: c.Names || "",
          image: c.Image || "",
          status: c.Status || "",
          state: c.State || "",
          ports: c.Ports || "",
        };
      } catch {
        return null;
      }
    }).filter((c): c is DockerContainer => c !== null);
  } catch {
    // Docker may have become unavailable
  }
  return lastContainers;
}

export function getLastDocker(): DockerContainer[] {
  return lastContainers;
}
