import { describe, it } from "node:test";
import assert from "node:assert";
import {
  nonNegativeNumber,
  parseResetAtMs,
  isFoundingSeat,
  isServiceAccount,
  extractWalletBalance,
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

void describe("extractWalletBalance", () => {
  void it("pulls a flat top-level balance with its currency", () => {
    assert.deepStrictEqual(
      extractWalletBalance({ balance: 11.38, currency: "USD" }),
      { balance: 11.38, currency: "USD" },
    );
  });

  void it("accepts a nested wallet.balance (schema-tweak tolerance)", () => {
    assert.deepStrictEqual(
      extractWalletBalance({ wallet: { balance: 42, currency: "GBP" } }),
      { balance: 42, currency: "GBP" },
    );
  });

  void it("defaults currency to USD when absent", () => {
    assert.deepStrictEqual(extractWalletBalance({ balance: 500 }), {
      balance: 500,
      currency: "USD",
    });
  });

  void it("keeps a zero balance (a $0 wallet is still a wallet)", () => {
    assert.deepStrictEqual(extractWalletBalance({ balance: 0 }), {
      balance: 0,
      currency: "USD",
    });
  });

  void it("returns undefined when there is no usable balance", () => {
    assert.strictEqual(extractWalletBalance({}), undefined);
    assert.strictEqual(extractWalletBalance({ spent: 12, credited: 40 }), undefined);
    assert.strictEqual(extractWalletBalance({ wallet: {} }), undefined);
    assert.strictEqual(extractWalletBalance({ balance: null }), undefined);
  });

  void it("rejects negative or non-numeric balances", () => {
    assert.strictEqual(extractWalletBalance({ balance: -5 }), undefined);
    assert.strictEqual(extractWalletBalance({ balance: "abc" }), undefined);
    assert.strictEqual(extractWalletBalance({ wallet: { balance: "-1" } }), undefined);
  });
});

// ── fetch helpers (URL-routing mocks) ──────────────────────────────────────

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Routes by URL fragment. `calls` (optional) records every URL fetched so
 * tests can assert wallet-first ordering (wallet attempted before usage).
 */
function mockRoutingFetch(
  routes: Record<string, { payload: unknown; status?: number }>,
  calls?: string[],
): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    calls?.push(u);
    for (const [fragment, route] of Object.entries(routes)) {
      if (u.includes(fragment)) {
        return jsonResponse(route.payload, route.status ?? 200);
      }
    }
    throw new Error(`mockRoutingFetch: no route for ${u}`);
  }) as typeof fetch;
}

/** Wallet answers `payload`; usage is never reached (and would fail loudly). */
function mockWalletFetch(payload: unknown, status = 200, calls?: string[]): typeof fetch {
  return mockRoutingFetch({ "/v1/wallet": { payload, status } }, calls);
}

/** Every request rejects — simulates a fully unreachable host (after retries). */
function mockRejectingFetch(calls?: string[]): typeof fetch {
  return (async (url: string | URL) => {
    calls?.push(String(url));
    throw new Error("connection refused");
  }) as typeof fetch;
}

/** Wallet 404s (like the real API today); usage answers with `payload`. */
function mockUsageFetch(payload: unknown, status = 200, calls?: string[]): typeof fetch {
  return mockRoutingFetch(
    { "/v1/wallet": { payload: {}, status: 404 }, "/v1/usage": { payload, status } },
    calls,
  );
}

const WALLET_URL = "https://api.code.umans.ai/v1/wallet";
const USAGE_URL = "https://api.code.umans.ai/v1/usage";

// Legacy plan payload — pre-Aug 2026 keys still carry plan quota semantics.
const legacyPayload = {
  plan: { slug: "code_pro", display_name: "Code Pro" },
  limits: {
    requests: { limit: 200 },
    concurrency: { limit: 5 },
  },
  window: { resets_at: "2026-08-29T00:39:02.060174+00:00" },
  usage: {
    remaining_requests: 100,
    weighted_remaining_requests: 100,
    concurrent_sessions: 0,
    weighted_concurrent_sessions: 0,
    tokens_in: 10,
  },
};

void describe("fetchUmansUsage — wallet-first", () => {
  void it("maps GET /v1/wallet 200 balance into a billing balance row", async () => {
    const calls: string[] = [];
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockWalletFetch({ balance: 11.38, currency: "USD" }, 200, calls),
    });
    assert.deepStrictEqual(calls, [WALLET_URL], "usage must not be fetched when wallet answers");
    assert.strictEqual(snap.displayName, "Umans Wallet");
    assert.strictEqual(snap.plan, "Umans Wallet");
    assert.strictEqual(snap.windows.length, 0);
    const balance = snap.billing?.find((b) => b.type === "balance");
    assert.ok(balance, "billing should contain a balance entry");
    assert.strictEqual(balance!.label, "Wallet balance");
    assert.strictEqual(balance!.amount, 11.38);
    assert.strictEqual(balance!.unit, "USD");
  });

  void it("maps a nested wallet.balance (schema-tolerance path)", async () => {
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockWalletFetch({ wallet: { balance: 42, currency: "GBP" } }),
    });
    const balance = snap.billing?.find((b) => b.type === "balance");
    assert.ok(balance);
    assert.strictEqual(balance!.amount, 42);
    assert.strictEqual(balance!.unit, "GBP");
    assert.strictEqual(snap.summary, undefined, "wallet snapshot carries no quota summary");
  });

  void it("renders a zero balance instead of dropping the row", async () => {
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockWalletFetch({ balance: 0 }),
    });
    const balance = snap.billing?.find((b) => b.type === "balance");
    assert.ok(balance);
    assert.strictEqual(balance!.amount, 0);
  });

  void it("falls back to /v1/usage when /v1/wallet returns 404", async () => {
    const calls: string[] = [];
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockUsageFetch(legacyPayload, 200, calls),
    });
    // wallet-first ordering: wallet attempted, 404, then usage.
    assert.deepStrictEqual(calls, [WALLET_URL, USAGE_URL]);
    assert.strictEqual(snap.plan, "Code Pro");
    assert.strictEqual(snap.displayName, "Code Pro");
    assert.ok(
      snap.windows.some((w) => w.label === "Request window"),
      "legacy plan must keep its windows after the wallet fallback",
    );
  });

  void it("falls back to /v1/usage on any wallet HTTP error (e.g. 500)", async () => {
    const calls: string[] = [];
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockRoutingFetch(
        { "/v1/wallet": { payload: {}, status: 500 }, "/v1/usage": { payload: legacyPayload } },
        calls,
      ),
    });
    assert.deepStrictEqual(calls, [WALLET_URL, USAGE_URL]);
    assert.strictEqual(snap.error, undefined, "fallback must not surface the wallet 500");
    assert.strictEqual(snap.plan, "Code Pro");
  });

  void it("falls back to /v1/usage when /v1/wallet is unreachable", async () => {
    const calls: string[] = [];
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockRejectingFetch(calls),
    });
    // wallet-first ordering survives even when both endpoints are down:
    // wallet attempted first, then usage — the snapshot is the usage-path
    // network error, not a dead-end wallet error card. Each endpoint is hit
    // twice because fetchWithRetry does one retry per endpoint (#5).
    assert.deepStrictEqual([...new Set(calls)], [WALLET_URL, USAGE_URL]);
    assert.strictEqual(calls.length, 4);
    assert.ok(snap.error?.includes("Network error"), `got error: ${snap.error}`);
  });

  void it("falls back when /v1/wallet 200 body is unparseable", async () => {
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockRoutingFetch({
        "/v1/wallet": { payload: "not-an-object", status: 200 },
        "/v1/usage": { payload: legacyPayload },
      }),
    });
    assert.strictEqual(snap.error, undefined);
    assert.ok(snap.windows.some((w) => w.label === "Request window"));
    assert.strictEqual(snap.plan, "Code Pro");
  });

  void it("falls back when /v1/wallet 200 carries no balance", async () => {
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockRoutingFetch({
        "/v1/wallet": { payload: { spent: 12, credited: 40 }, status: 200 },
        "/v1/usage": { payload: legacyPayload },
      }),
    });
    assert.strictEqual(snap.error, undefined);
    assert.strictEqual(snap.plan, "Code Pro");
    assert.ok(snap.windows.length >= 1);
  });
});

void describe("fetchUmansUsage — wallet vs legacy mapping via /v1/usage", () => {
  const serviceAccountPayload = {
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
      tokens_in: 15978752,
      tokens_out: 151201,
      tokens_cached: 15373056,
    },
  };

  void it("service_account hides quota windows (wallet-first)", async () => {
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockUsageFetch(serviceAccountPayload),
    });
    // Wallet keys render as the wallet card: no request/concurrency bars,
    // no headroom row, no quota summary — but token spend is still shown.
    assert.strictEqual(snap.displayName, "Umans Wallet");
    assert.strictEqual(snap.plan, "Umans Wallet");
    assert.strictEqual(snap.windows.length, 0, "service_account must not show windows");
    assert.strictEqual(snap.summary, undefined);
    const headroom = snap.billing?.find((b) => b.label.includes("Headroom"));
    assert.strictEqual(headroom, undefined, "headroom is a legacy-plan surface");
    assert.ok(snap.billing?.some((b) => b.label === "Tokens in"));
    assert.ok(snap.billing?.some((b) => b.label === "Tokens out"));
    assert.ok(snap.billing?.some((b) => b.label === "Tokens cached"));
  });

  void it("pure PAYG (no plan) also renders as a wallet card without windows", async () => {
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockUsageFetch({
        limits: {
          requests: { limit: 8000, hard_cap: 16000 },
          concurrency: { limit: 12, hard_cap: 24 },
        },
        window: { resets_at: "2026-08-29T00:39:02.060174+00:00" },
        usage: {
          remaining_requests: 5000,
          weighted_remaining_requests: 5000,
          concurrent_sessions: 1,
          tokens_in: 42,
        },
      }),
    });
    assert.strictEqual(snap.displayName, "Umans Wallet");
    assert.strictEqual(snap.plan, "Umans Wallet");
    assert.strictEqual(snap.windows.length, 0);
    assert.strictEqual(snap.summary, undefined);
    assert.ok(snap.billing?.some((b) => b.label === "Tokens in"));
  });

  void it("missing limits → no windows, only token billing", async () => {
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockUsageFetch({
        plan: { slug: "service_account", display_name: "Service Account" },
        window: {},
        usage: { tokens_in: 123, tokens_out: 456 },
      }),
    });
    assert.strictEqual(snap.windows.length, 0);
    assert.ok(snap.billing?.find((b) => b.label === "Tokens in"));
    assert.ok(snap.billing?.find((b) => b.label === "Tokens out"));
  });

  void it("legacy plan keeps its windows (request + concurrency)", async () => {
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockUsageFetch(legacyPayload),
    });
    assert.strictEqual(snap.displayName, "Code Pro");
    assert.strictEqual(snap.plan, "Code Pro");
    assert.strictEqual(snap.windows.length, 2);
    assert.ok(snap.windows.some((w) => w.label === "Request window"));
    assert.ok(snap.windows.some((w) => w.label === "Concurrency"));
    assert.ok(snap.summary?.startsWith("100/200 requests remaining"));
    assert.ok(snap.summary?.includes("0/5 concurrent sessions"));
  });

  void it("legacy founding seats keep windows, sparkle, and headroom", async () => {
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockUsageFetch({
        plan: { slug: "code_pro_founding", display_name: "Code Pro (Founding Seat)" },
        limits: {
          requests: { limit: 200, hard_cap: 400 },
          concurrency: { limit: 5, hard_cap: 10 },
        },
        window: { resets_at: "2026-08-29T00:39:02.060174+00:00" },
        usage: {
          remaining_requests: 100,
          weighted_remaining_requests: 100,
          concurrent_sessions: 0,
          weighted_concurrent_sessions: 0,
        },
      }),
    });
    assert.ok(snap.displayName.includes("\u2728"));
    assert.strictEqual(snap.windows.length, 2);
    assert.strictEqual(snap.windows[0]!.usedPercent, 50);
    const headroom = snap.billing?.find((b) => b.label.includes("Headroom"));
    assert.ok(headroom);
    assert.strictEqual(headroom!.amount, 200);
    assert.ok(snap.summary?.includes("+200 founding headroom"));
  });

  void it("prefers weighted_remaining_requests for legacy summary (gateway enforces weighted)", async () => {
    const snap = await fetchUmansUsage({
      token: "***",
      timeoutMs: 5000,
      fetchFn: mockUsageFetch({
        plan: { slug: "code_pro", display_name: "Code Pro" },
        limits: {
          requests: { limit: 8000 },
          concurrency: { limit: 12 },
        },
        window: { resets_at: "2026-08-29T00:39:02.060174+00:00" },
        usage: {
          remaining_requests: 7899,
          weighted_remaining_requests: 7969,
          concurrent_sessions: 5,
          weighted_concurrent_sessions: 3,
        },
      }),
    });
    assert.ok(snap.summary?.startsWith("7969/8000"), `summary: ${snap.summary}`);
    assert.ok(snap.summary?.includes("3/12 concurrent"), `summary: ${snap.summary}`);
  });
});