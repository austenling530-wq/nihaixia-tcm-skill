// 进程内限流（单实例够用；多实例部署时换 Redis）

type Stamp = number[];

export class SlidingWindow {
  private hits = new Map<string, Stamp>();
  private limit: number;
  private windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
    const t = setInterval(() => this.sweep(), Math.max(windowMs, 60_000));
    t.unref?.();
  }

  /** 记一次；超限时返回 ok=false 与建议等待毫秒 */
  hit(key: string, now = Date.now()): { ok: boolean; retryAfterMs: number } {
    const since = now - this.windowMs;
    let arr = this.hits.get(key);
    if (!arr) this.hits.set(key, (arr = []));
    while (arr.length && arr[0] <= since) arr.shift();
    if (arr.length >= this.limit) {
      return { ok: false, retryAfterMs: arr[0] + this.windowMs - now };
    }
    arr.push(now);
    return { ok: true, retryAfterMs: 0 };
  }

  private sweep(now = Date.now()) {
    const since = now - this.windowMs;
    for (const [k, arr] of this.hits) {
      while (arr.length && arr[0] <= since) arr.shift();
      if (!arr.length) this.hits.delete(k);
    }
  }
}

/** 连续失败锁：窗口内失败 maxFailures 次后锁 lockMs */
export class FailureLock {
  private fails = new Map<string, Stamp>();
  private locked = new Map<string, number>();
  private maxFailures: number;
  private windowMs: number;
  private lockMs: number;
  constructor(maxFailures: number, windowMs: number, lockMs: number) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.lockMs = lockMs;
    const t = setInterval(() => this.sweep(), 60_000);
    t.unref?.();
  }

  /** 返回剩余锁定毫秒；0 表示未锁 */
  lockedFor(key: string, now = Date.now()): number {
    const until = this.locked.get(key);
    if (!until) return 0;
    if (until <= now) {
      this.locked.delete(key);
      return 0;
    }
    return until - now;
  }

  fail(key: string, now = Date.now()): number {
    const since = now - this.windowMs;
    let arr = this.fails.get(key);
    if (!arr) this.fails.set(key, (arr = []));
    while (arr.length && arr[0] <= since) arr.shift();
    arr.push(now);
    if (arr.length >= this.maxFailures) {
      this.locked.set(key, now + this.lockMs);
      this.fails.delete(key);
      return this.lockMs;
    }
    return 0;
  }

  reset(key: string) {
    this.fails.delete(key);
    this.locked.delete(key);
  }

  private sweep(now = Date.now()) {
    for (const [k, until] of this.locked) if (until <= now) this.locked.delete(k);
    const since = now - this.windowMs;
    for (const [k, arr] of this.fails) {
      while (arr.length && arr[0] <= since) arr.shift();
      if (!arr.length) this.fails.delete(k);
    }
  }
}

/** 同一 key 同时只允许一个在途请求 */
export class InFlight {
  private set = new Set<string>();
  tryAcquire(key: string): boolean {
    if (this.set.has(key)) return false;
    this.set.add(key);
    return true;
  }
  release(key: string) {
    this.set.delete(key);
  }
}

export function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} 秒`;
  return `${Math.ceil(s / 60)} 分钟`;
}
