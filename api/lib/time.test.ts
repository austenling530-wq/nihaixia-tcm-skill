import { describe, expect, it } from "vitest";
import { startOfTodayShanghai } from "./time";

describe("startOfTodayShanghai", () => {
  it("is 16:00 UTC of the previous day", () => {
    // 2026-09-21 01:30 北京时间 = 2026-09-20T17:30Z
    const now = Date.parse("2026-09-20T17:30:00Z");
    expect(startOfTodayShanghai(now).toISOString()).toBe("2026-09-20T16:00:00.000Z");
    // 2026-09-20 23:59 北京时间 = 2026-09-20T15:59Z → 还是 9/20
    expect(startOfTodayShanghai(Date.parse("2026-09-20T15:59:00Z")).toISOString()).toBe("2026-09-19T16:00:00.000Z");
  });
});
