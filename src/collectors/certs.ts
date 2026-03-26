import { exec } from "child_process";
import { promisify } from "util";
import type { CertStatus } from "../types.js";

const execAsync = promisify(exec);

const CERT_DOMAINS = (process.env.CERT_DOMAINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let lastCerts: CertStatus[] = [];

export async function collectCerts(): Promise<CertStatus[]> {
  if (CERT_DOMAINS.length === 0) { lastCerts = []; return []; }

  lastCerts = await Promise.all(CERT_DOMAINS.map(async (domain) => {
    try {
      const { stdout } = await execAsync(
        `echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates -issuer 2>/dev/null`,
        { timeout: 10000 },
      );
      let validTo = "", issuer = "";
      for (const line of stdout.split("\n")) {
        if (line.startsWith("notAfter=")) validTo = line.replace("notAfter=", "").trim();
        if (line.startsWith("issuer=")) issuer = line.replace("issuer=", "").trim().substring(0, 80);
      }
      const expiryDate = new Date(validTo);
      const daysRemaining = Math.floor((expiryDate.getTime() - Date.now()) / 86_400_000);
      return { domain, validTo: expiryDate.toISOString(), daysRemaining, issuer };
    } catch {
      return { domain, validTo: "", daysRemaining: -1, issuer: "", error: "Unable to check" };
    }
  }));
  return lastCerts;
}

export function getLastCerts(): CertStatus[] {
  return lastCerts;
}
