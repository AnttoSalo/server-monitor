import { createHmac } from "crypto";
import type { Request, Response, NextFunction } from "express";

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "";
const AUTH_ENABLED = !!NEXTAUTH_SECRET;
const COOKIE_NAME = "authjs.session-token";

// NextAuth uses a derived key for JWT signing
function deriveKey(secret: string): Buffer {
  return Buffer.from(
    createHmac("sha256", "NextAuth.js Generated Encryption Key")
      .update(secret)
      .digest()
  );
}

// Decode NextAuth JWE token (compact serialization)
// NextAuth v5 uses JWE (encrypted JWT), not plain JWT
// The token is: header.encryptedKey.iv.ciphertext.tag
// We verify by attempting to decrypt with the derived key
async function verifyNextAuthToken(token: string, secret: string): Promise<boolean> {
  try {
    // NextAuth v5 uses jose library for JWE
    // We can verify by importing jose dynamically or by simply checking
    // the token structure and deriving the key
    const parts = token.split(".");
    if (parts.length !== 5) return false; // JWE has 5 parts

    // Use the Web Crypto API to decrypt
    const enc = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (!enc.alg || !enc.enc) return false;

    // Import the derived key
    const rawKey = deriveKey(secret);
    const cryptoKey = await crypto.subtle.importKey(
      "raw", new Uint8Array(rawKey), { name: "AES-GCM" }, false, ["decrypt"]
    );

    // Decode JWE parts
    const iv = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    const tag = Buffer.from(parts[4], "base64url");

    // Combine ciphertext + tag for AES-GCM
    const combined = Buffer.concat([ciphertext, tag]);

    // AAD is the protected header
    const aad = new TextEncoder().encode(parts[0]);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
      cryptoKey,
      combined
    );

    const payload = JSON.parse(new TextDecoder().decode(decrypted));
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
