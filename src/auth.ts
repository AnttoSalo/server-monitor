import { jwtDecrypt } from "jose";
import { hkdf } from "@panva/hkdf";
import type { Request, Response, NextFunction } from "express";

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "";
const AUTH_ENABLED = !!NEXTAUTH_SECRET;
const COOKIE_NAME = "authjs.session-token";

// NextAuth v5 uses HKDF to derive the encryption key from the secret
// Algorithm: dir + A256CBC-HS512 (requires 64-byte key)
async function getDerivedKey(secret: string): Promise<Uint8Array> {
  return new Uint8Array(
    await hkdf("sha256", secret, "", "Auth.js Generated Encryption Key", 64)
  );
}

async function verifyNextAuthToken(token: string, secret: string): Promise<boolean> {
  try {
    const key = await getDerivedKey(secret);
    const { payload } = await jwtDecrypt(token, key, {
      clockTolerance: 15,
    });
    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [key, ...val] = pair.trim().split("=");
    if (key) cookies[key.trim()] = val.join("=").trim();
  }
  return cookies;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth if no secret configured (LAN-only mode)
  if (!AUTH_ENABLED) { next(); return; }

  // Allow direct localhost access (not via reverse proxy)
  const forwarded = req.headers["x-forwarded-for"];
  if (!forwarded) {
    const ip = req.ip || req.socket.remoteAddress || "";
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
      next(); return;
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  verifyNextAuthToken(token, NEXTAUTH_SECRET).then((valid) => {
    if (valid) { next(); }
    else { res.status(401).json({ error: "Invalid or expired session" }); }
  }).catch(() => {
    res.status(401).json({ error: "Authentication error" });
  });
}
