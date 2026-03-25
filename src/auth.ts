import { jwtDecrypt, base64url, calculateJwkThumbprint } from "jose";
import { hkdf } from "@panva/hkdf";
import type { Request, Response, NextFunction } from "express";

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "";
const AUTH_ENABLED = !!NEXTAUTH_SECRET;
const LOGIN_URL = process.env.LOGIN_URL || "https://nns.antto.org/login";
const COOKIE_NAME = "authjs.session-token";

// Exactly replicates NextAuth v5's getDerivedEncryptionKey
// The salt is the cookie name, and it's included in the HKDF info string
async function getDerivedEncryptionKey(secret: string, salt: string): Promise<Uint8Array> {
  return new Uint8Array(
    await hkdf("sha256", secret, salt, `Auth.js Generated Encryption Key (${salt})`, 64)
  );
}

async function verifyNextAuthToken(token: string, secret: string): Promise<boolean> {
  try {
    const encryptionSecret = await getDerivedEncryptionKey(secret, COOKIE_NAME);
    const thumbprint = await calculateJwkThumbprint(
      { kty: "oct", k: base64url.encode(encryptionSecret) },
      "sha512"
    );
    // Replicate NextAuth's decode: resolve key by kid thumbprint match
    await jwtDecrypt(token, async (header) => {
      if (header.kid === undefined || header.kid === thumbprint) {
        return encryptionSecret;
      }
      throw new Error("no matching decryption secret");
    }, {
      clockTolerance: 15,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256CBC-HS512"],
    });
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
  const token = cookies[COOKIE_NAME] || cookies["__Secure-" + COOKIE_NAME];

  if (!token) {
    const accept = req.headers.accept || "";
    if (accept.includes("text/html")) {
      res.redirect(LOGIN_URL);
    } else {
      res.status(401).json({ error: "Authentication required — log in at " + LOGIN_URL });
    }
    return;
  }

  verifyNextAuthToken(token, NEXTAUTH_SECRET).then((valid) => {
    if (valid) { next(); }
    else {
      const accept = req.headers.accept || "";
      if (accept.includes("text/html")) {
        res.redirect(LOGIN_URL);
      } else {
        res.status(401).json({ error: "Invalid or expired session" });
      }
    }
  }).catch(() => {
    res.status(401).json({ error: "Authentication error" });
  });
}
