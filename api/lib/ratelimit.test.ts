import { describe, expect, it } from "vitest";
import { FailureLock, InFlight, SlidingWindow } from "./ratelimit";

describe("SlidingWindow", () => {
  it("allows up to limit then blocks until the window slides", () => {
    const w = new SlidingWindow(3, 1000);
    expect(w.hit("a", 0).ok).toBe(true);
    expect(w.hit("a", 10).ok).toBe(true);
    expect(w.hit("a", 20).ok).toBe(true);
    const blocked = w.hit("a", 30);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(970);
    expect(w.hit("b", 30).ok).toBe(true);
    expect(w.hit("a", 1001).ok).toBe(true);
  });
});

describe("FailureLock", () => {
  it("locks after N failures and unlocks after lockMs", () => {
    const l = new FailureLock(3, 10_000, 5_000);
    expect(l.fail("ip", 0)).toBe(0);
    expect(l.fail("ip", 1)).toBe(0);
    expect(l.fail("ip", 2)).toBe(5_000);
    expect(l.lockedFor("ip", 3)).toBe(4_999);
    expect(l.lockedFor("ip", 5_002)).toBe(0);
  });
  it("reset clears both counters", () => {
    const l = new FailureLock(2, 10_000, 5_000);
    l.fail("ip", 0);
    l.reset("ip");
    expect(l.fail("ip", 1)).toBe(0);
  });
});

describe("InFlight", () => {
  it("only one holder at a time", () => {
    const f = new InFlight();
    expect(f.tryAcquire("k")).toBe(true);
    expect(f.tryAcquire("k")).toBe(false);
    f.release("k");
    expect(f.tryAcquire("k")).toBe(true);
  });
});
