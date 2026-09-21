import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  ip: string;
};

/** 反向代理（nginx）后面取真实 IP；直连时退回 socket 地址 */
export function clientIp(headers: Headers, fallback = "unknown"): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return fallback;
}

export async function createContext(
  opts: FetchCreateContextFnOptions,
  ip?: string,
): Promise<TrpcContext> {
  return { req: opts.req, resHeaders: opts.resHeaders, ip: ip ?? clientIp(opts.req.headers) };
}
