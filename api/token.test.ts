import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.APP_SECRET = "test-secret";
});

describe("token", () => {
  it("round-trips and rejects tampering", async () => {
    const { issueToken, verifyToken } = await import("./token");
    const t = issueToken(42);
    expect(verifyToken(t)).toBe(42);
    expect(verifyToken(t.slice(0, -2) + "zz")).toBeNull();
    expect(verifyToken("garbage")).toBeNull();
    const [payload] = t.split(".");
    expect(verifyToken(payload + ".AAAA")).toBeNull();
  });
});
