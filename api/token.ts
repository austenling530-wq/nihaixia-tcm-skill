import crypto from "node:crypto";
import { env } from "./lib/env";

// 轻量 HMAC 令牌：base64url(codeId.expiresAt).signature
// 口令验证通过后签发，7 天有效；服务端无状态校验

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", env.appSecret)
    .update(payload)
    .digest("base64url");
}

export function issueToken(codeId: number): string {
  const payload = b64url(`${codeId}.${Date.now() + TTL_MS}`);
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const decoded = Buffer.from(payload, "base64url").toString();
  const [codeIdStr, expStr] = decoded.split(".");
  const codeId = Number(codeIdStr);
  const exp = Number(expStr);
  if (!Number.isInteger(codeId) || !Number.isFinite(exp) || exp < Date.now()) {
    return null;
  }
  return codeId;
}
