import { describe, it } from "node:test";
import assert from "node:assert";
import {
  nonNegativeNumber,
  parseResetAtMs,
  isFoundingSeat,
  isServiceAccount,
  fetchUmansUsage,
} from "../dist/usage.js";

void describe("nonNegativeNumber", () => {
  void it("returns the value for positive numbers", () => {
    assert.strictEqual(nonNegativeNumber(42), 42);
    assert.strictEqual(nonNegativeNumber(0), 0);
    assert.strictEqual(nonNegativeNumber(1e6), 1_000_000);
  });

  void it("returns undefined for negative numbers", () => {
    assert.strictEqual(nonNegativeNumber(-1), undefined);
  });

  void it("returns undefined for non-finite values", () => {
    assert.strictEqual(nonNegativeNumber(Number.NaN), undefined);
    assert.strictEqual(nonNegativeNumber(Infinity), undefined);
  });

  void it("parses numeric strings", () => {
    assert.strictEqual(nonNegativeNumber("42"), 42);
    assert.strictEqual(nonNegativeNumber("0"), 0);
  });

  void it("returns undefined for non-numeric strings", () => {
    assert.strictEqual(nonNegativeNumber(""), undefined);
    assert.strictEqual(nonNegativeNumber("abc"), undefined);
  });

  void it("returns undefined for non-number, non-string inputs", () => {
    assert.strictEqual(nonNegativeNumber(null), undefined);
    assert.strictEqual(nonNegativeNumber(undefined), undefined);
    assert.strictEqual(nonNegativeNumber({}), undefined);
    assert.strictEqual(nonNegativeNumber([]), undefined);
  });
});

void describe("parseResetAtMs", () => {
  void it("parses a valid ISO date string", () => {
    const result = parseResetAtMs("2026-07-14T23:00:00Z");
    assert.ok(result !== undefined);
    assert.strictEqual(typeof result, "number");
    assert.ok(result > 0);
  });

  void it("returns undefined for undefined input", () => {
    assert.strictEqual(parseResetAtMs(undefined), undefined);
  });

  void it("returns undefined for empty string", () => {
    assert.strictEqual(parseResetAtMs(""), undefined);
  });

  void it("returns undefined for invalid date", () => {
    assert.strictEqual(parseResetAtMs("not-a-date"), undefined);
  });
});

void describe("isFoundingSeat", () => {
  void it("detects 'founding' in the display name", () => {
    assert.strictEqual(
      isFoundingSeat("code_pro", "Code Pro (Founding Seat)"),
      true,
    );
  });

  void it("detects 'founding' in the slug", () => {
    assert.strictEqual(
      isFoundingSeat("code_pro_founding", "Code Pro"),
      true,
    );
  });

  void it("returns false for non-founding seats", () => {
    assert.strictEqual(isFoundingSeat("code_pro", "Code Pro"), false);
    assert.strictEqual(isFoundingSeat("code_max", "Code Max"), false);
    assert.strictEqual(isFoundingSeat("unknown", "Starter"), false);
  });

  void it("returns false when both inputs are empty/undefined", () => {
    assert.strictEqual(isFoundingSeat(undefined, undefined), false);
    assert.strictEqual(isFoundingSeat("", ""), false);
  });

  void it("is case-insensitive", () => {
    assert.strictEqual(
      isFoundingSeat("CODE_PRO_FOUNDING", "Code Pro"),
      true,
    );
    assert.strictEqual(
      isFoundingSeat("code_pro", "CODE PRO (FOUNDING SEAT)"),
      true,
    );
  });
});

void describe("isServiceAccount", () => {
  void it("detects service_account slug", () => {
    assert.strictEqual(isServiceAccount("service_account", "Service Account"), true);
  });

  void it("is case-insensitive", () => {
    assert.strictEqual(isServiceAccount("SERVICE_ACCOUNT", "anything"), true);
    assert.strictEqual(isServiceAccount("service_account", "SERVICE ACCOUNT"), true);
  });

  void it("returns false for founding or unknown", () => {
    assert.strictEqual(isServiceAccount("code_pro", "Code Pro"), false);
    assert.strictEqual(isServiceAccount("unknown", "Umans"), false);
    assert.strictEqual(isServiceAccount(undefined, undefined), false);
  });

  void it("does not treat founding as service_account", () => {
    assert.strictEqual(isServiceAccount("code_pro_founding", "Code Pro (Founding Seat)"), false);
  });
});

// helper to create a mock fetch that returns given JSON payload
function mockFetch(payload: unknown, status = 200): typeof fetch {
  return (async (_url: string | URL, _init?: RequestInit) => {
    const body = JSON.stringify(payload);
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

void describe("fetchUmansUsage — wallet/service_account handling", () => {
  void it("prefers weighted_remaining_requests over raw (Aug 2026 wallet fix)", async () => {
    const payload = {
      plan: { slug: "service_account", display_name: "Service Account" },
      limits: {
        requests: { limit: 8000, hard_cap: 16000 },
        concurrency: { limit: 12, hard_cap: 24 },
      },
      window: { resets_at: "2026-08-29T00:39:02.060174+00:00" },
      usage: {
        remaining_requests: 7899,
        weighted_remaining_requests: 7969,
        concurrent_sessions: 0,
        weighted_concurrent_sessions: 0,
        tokens_in: 100,
        tokens_out: 50,
        tokens_cached: 10,
      },
    };
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockFetch(payload),
    });
    // weighted 7969 should be used for remaining + summary, not raw 7899
    assert.ok(snap.summary?.includes("7969/8000"));
    // window pct = (8000-7969)/8000 = 0.3875%
    const win = snap.windows.find((w) => w.label === "Request window");
    assert.ok(win, "Request window should exist");
    assert.ok(win!.usedPercent < 1, `usedPercent should be ~0.38, got ${win!.usedPercent}`);
  });

  void it("handles service_account correctly (no founding sparkle, headroom shown)", async () => {
    const payload = {
      plan: { slug: "service_account", display_name: "Service Account" },
      limits: {
        requests: { limit: 8000, hard_cap: 16000 },
        concurrency: { limit: 12, hard_cap: 24 },
      },
      window: { resets_at: "2026-08-29T00:39:02.060174+00:00" },
      usage: {
        remaining_requests: 7942,
        weighted_remaining_requests: 7942,
        concurrent_sessions: 0,
        tokens_in: 15978752,
        tokens_out: 151201,
        tokens_cached: 15373056,
      },
    };
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockFetch(payload),
    });
    assert.strictEqual(snap.displayName, "Service Account");
    assert.strictEqual(snap.plan, "Service Account");
    // headroom should be in billing even though not founding
    const headroom = snap.billing?.find((b) => b.label.includes("Headroom"));
    assert.ok(headroom, "headroom billing should be present for service_account");
    assert.strictEqual(headroom!.amount, 8000);
    // should NOT have founding sparkle in displayName
    assert.ok(!snap.displayName.includes("\u2728"));
  });

  void it("handles null/missing plan (future pure PAYG wallet) gracefully", async () => {
    const payload = {
      // no plan at all
      limits: {
        requests: { limit: 8000, hard_cap: 16000 },
        concurrency: { limit: 12, hard_cap: 24 },
      },
      window: { resets_at: "2026-08-29T00:39:02.060174+00:00" },
      usage: {
        remaining_requests: 5000,
        concurrent_sessions: 1,
        tokens_in: 42,
      },
    };
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockFetch(payload),
    });
    assert.strictEqual(snap.displayName, "Umans");
    assert.strictEqual(snap.plan, undefined);
    assert.ok(snap.windows.length >= 1);
    assert.ok(snap.billing?.some((b) => b.label === "Tokens in"));
  });

  void it("handles missing limits (no windows, only tokens)", async () => {
    const payload = {
      plan: { slug: "service_account", display_name: "Service Account" },
      // no limits
      window: {},
      usage: {
        tokens_in: 123,
        tokens_out: 456,
      },
    };
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockFetch(payload),
    });
    assert.strictEqual(snap.windows.length, 0);
    assert.ok(snap.billing?.find((b) => b.label === "Tokens in"));
    assert.ok(snap.billing?.find((b) => b.label === "Tokens out"));
  });

  void it("preserves founding sparkle for legacy founding seats", async () => {
    const payload = {
      plan: { slug: "code_pro_founding", display_name: "Code Pro (Founding Seat)" },
      limits: {
        requests: { limit: 200, hard_cap: 400 },
        concurrency: { limit: 5, hard_cap: 10 },
      },
      window: { resets_at: "2026-08-29T00:39:02.060174+00:00" },
      usage: {
        remaining_requests: 100,
        concurrent_sessions: 0,
      },
    };
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockFetch(payload),
    });
    assert.ok(snap.displayName.includes("\u2728"));
    assert.ok(snap.summary?.includes("founding headroom"));
  });
});
