import type { ProviderUsageSnapshot } from "openclaw/plugin-sdk/provider-usage";
import { buildUsageHttpErrorSnapshot } from "openclaw/plugin-sdk/provider-usage";
import { readResponseWithLimit } from "openclaw/plugin-sdk/response-limit-runtime";

const UMANS_WALLET_URL = "https://api.code.umans.ai/v1/wallet";
const UMANS_USAGE_URL = "https://api.code.umans.ai/v1/usage";
const UMANS_RESPONSE_MAX_BYTES = 1024 * 1024;

export type UmansLimits = {
  requests?: {
    limit?: number;
    hard_cap?: number;
    window_seconds?: number;
    burst_pct?: number;
    description?: string;
  };
  concurrency?: {
    limit?: number;
    hard_cap?: number;
    burst_pct?: number;
    description?: string;
  };
};

export type UmansUsageResponse = {
  user_id?: unknown;
  plan?: {
    slug?: unknown;
    display_name?: unknown;
  };
  limits?: UmansLimits;
  window?: {
    started_at?: unknown;
    resets_at?: unknown;
    remaining_minutes?: number;
  };
  usage?: {
    requests_in_window?: number;
    weighted_in_window?: number;
    remaining_requests?: number;
    weighted_remaining_requests?: number;
    concurrent_sessions?: number;
    weighted_concurrent_sessions?: number;
    tokens_in?: number;
    tokens_out?: number;
    tokens_cached?: number;
    priority?: {
      low?: unknown;
      boxed_until?: unknown;
      reason?: unknown;
    };
    service_mode?: {
      current?: unknown;
      resets_at?: unknown;
    };
    priority_budget?: unknown;
  };
};

/**
 * Wallet endpoint response (balance-first, Aug 2026).
 * Shape is deliberately loose: the endpoint is new — accept both flat
 * (`balance` at the top level) and nested (`wallet.balance`) forms so a
 * schema tweak on the vendor side doesn't break the mapping.
 */
export type UmansWalletResponse = {
  user_id?: unknown;
  balance?: unknown;
  currency?: unknown;
  spent?: unknown;
  credited?: unknown;
  tier?: unknown;
  wallet?: {
    balance?: unknown;
    currency?: unknown;
    spent?: unknown;
    credited?: unknown;
  };
};

/** @internal exported for testing (#2) */
export function nonNegativeNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** @internal exported for testing (#2) */
export function isFoundingSeat(
  slug: string | undefined,
  displayName: string | undefined,
): boolean {
  if (!slug && !displayName) return false;
  const lowerSlug = slug?.toLowerCase() ?? "";
  const lowerName = displayName?.toLowerCase() ?? "";
  return lowerSlug.includes("founding") || lowerName.includes("founding");
}

/** @internal exported for testing — wallet/service_account detection (Aug 2026: plans removed) */
export function isServiceAccount(
  slug: string | undefined,
  displayName: string | undefined,
): boolean {
  if (!slug && !displayName) return false;
  const lowerSlug = slug?.toLowerCase() ?? "";
  const lowerName = displayName?.toLowerCase() ?? "";
  return lowerSlug === "service_account" || lowerName === "service account";
}

/**
 * Retry a fetch call on transient failure (#5).
 * One retry after 2s covers DNS hiccups and brief network blips
 * without missing a whole 60s dashboard poll cycle.
 */
async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  options: RequestInit,
  retries = 1,
  delayMs = 2000,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchFn(url, options);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

async function readPayload<T>(
  response: Response,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const buffer = await readResponseWithLimit(response, UMANS_RESPONSE_MAX_BYTES, {
    chunkTimeoutMs: timeoutMs,
    onOverflow: ({ maxBytes }) => new Error(`${label} response exceeds ${maxBytes} bytes`),
    onIdleTimeout: ({ chunkTimeoutMs }) =>
      new Error(`${label} response stalled for ${chunkTimeoutMs}ms`),
  });
  const data = objectRecord(JSON.parse(new TextDecoder().decode(buffer)));
  if (!data) {
    throw new Error(`${label} response is not an object`);
  }
  return data as T;
}

/**
 * Best-effort wallet fetch. The wallet endpoint is new (Aug 2026) and not
 * available for every key yet — any failure (network, HTTP error including
 * 404, or an unparseable body) yields `undefined` so the caller falls back
 * to /v1/usage instead of surfacing a dead-end error card.
 */
async function fetchUmansWallet(params: {
  token: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
}): Promise<UmansWalletResponse | undefined> {
  let response: Response;
  try {
    response = await fetchWithRetry(params.fetchFn, UMANS_WALLET_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${params.token}`,
      },
      signal: AbortSignal.timeout(params.timeoutMs),
    });
  } catch {
    return undefined;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  try {
    return await readPayload<UmansWalletResponse>(response, params.timeoutMs, "Umans wallet");
  } catch {
    return undefined;
  }
}

/**
 * Extract a spendable balance from a wallet response. Prefers the flat
 * `balance` field, falls back to `wallet.balance`; currency defaults to USD
 * when absent. Returns undefined when the response carries no usable balance.
 * @internal exported for testing
 */
export function extractWalletBalance(
  data: UmansWalletResponse,
): { balance: number; currency: string } | undefined {
  const balance = nonNegativeNumber(data.balance ?? data.wallet?.balance);
  if (balance === undefined) return undefined;
  const currency = stringOrUndefined(data.currency ?? data.wallet?.currency) ?? "USD";
  return { balance, currency };
}

function buildWalletSnapshot(balance: number, currency: string): ProviderUsageSnapshot {
  return {
    provider: "umans",
    displayName: "Umans Wallet",
    windows: [],
    billing: [{ type: "balance", label: "Wallet balance", amount: balance, unit: currency }],
    plan: "Umans Wallet",
  };
}

/** @internal exported for testing (#2) */
export function parseResetAtMs(resetsAt: string | undefined): number | undefined {
  if (!resetsAt) return undefined;
  try {
    const ms = Date.parse(resetsAt);
    return Number.isFinite(ms) ? ms : undefined;
  } catch {
    return undefined;
  }
}

function formatResetTime(resetsAtMs: number | undefined): string | undefined {
  if (resetsAtMs === undefined) return undefined;
  try {
    const date = new Date(resetsAtMs);
    if (Number.isNaN(date.getTime())) return undefined;
    // en-GB locale is deliberate (#4): consistent across all deployments,
    // and the dashboard is primarily UK-centric. Accepting the system default
    // would show 24h vs 12h inconsistently across machines.
    return date.toLocaleString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return undefined;
  }
}

export async function fetchUmansUsage(params: {
  token: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
}): Promise<ProviderUsageSnapshot> {
  // Wallet-first: if /v1/wallet answers with a balance, surface it as the
  // billing balance. Every failure mode (404 because the endpoint is not
  // available for this key, other HTTP errors, network blips, or a
  // balance-less body) falls back to /v1/usage below.
  const wallet = await fetchUmansWallet(params);
  const walletBalance = wallet ? extractWalletBalance(wallet) : undefined;
  if (walletBalance) {
    return buildWalletSnapshot(walletBalance.balance, walletBalance.currency);
  }

  let response: Response;
  try {
    // One retry on transient failure so a brief blip doesn't miss a whole poll cycle (#5)
    response = await fetchWithRetry(params.fetchFn, UMANS_USAGE_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${params.token}`,
      },
      signal: AbortSignal.timeout(params.timeoutMs),
    });
  } catch {
    return {
      provider: "umans",
      displayName: "Umans",
      windows: [],
      error: "Network error — usage endpoint unreachable",
    };
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return buildUsageHttpErrorSnapshot({ provider: "umans", status: response.status });
  }

  let data: UmansUsageResponse;
  try {
    data = await readPayload<UmansUsageResponse>(response, params.timeoutMs, "Umans usage");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      provider: "umans",
      displayName: "Umans",
      windows: [],
      error: `Bad usage response — ${msg}`,
    };
  }

  const rawPlanSlug = stringOrUndefined(data.plan?.slug);
  const rawPlanDisplayName = stringOrUndefined(data.plan?.display_name);
  const planDisplayName = rawPlanDisplayName ?? "Umans";
  const hasPlan = rawPlanSlug !== undefined || rawPlanDisplayName !== undefined;
  const founding = isFoundingSeat(rawPlanSlug, rawPlanDisplayName);
  const serviceAccount = isServiceAccount(rawPlanSlug, rawPlanDisplayName);
  // Wallet keys: plan.slug = service_account, or no plan at all (pure PAYG).
  // They carry no request/concurrency quota surface — only token spend (and
  // the billing balance when the wallet endpoint answers, handled above).
  const walletKey = serviceAccount || !hasPlan;
  const showLegacyWindows = hasPlan && !serviceAccount;
  const displayName = walletKey
    ? "Umans Wallet"
    : founding
      ? `${planDisplayName} ✨`
      : planDisplayName;

  const requestLimit = nonNegativeNumber(data.limits?.requests?.limit);
  const requestHardCap = nonNegativeNumber(data.limits?.requests?.hard_cap);
  const effectiveRequestLimit = requestLimit ?? requestHardCap;
  const remainingRequests = nonNegativeNumber(data.usage?.remaining_requests);
  const weightedRemainingRequests = nonNegativeNumber(data.usage?.weighted_remaining_requests);
  // Prefer weighted_remaining_requests when present — gateway enforces weighted quota
  // (Flash = 0.5 weight is why 7968 raw != 7969 weighted; earlier bug showed 249 vs 68)
  const effectiveRemainingRequests = weightedRemainingRequests ?? remainingRequests;
  const concurrencyLimit = nonNegativeNumber(data.limits?.concurrency?.limit);
  const concurrencyHardCap = nonNegativeNumber(data.limits?.concurrency?.hard_cap);
  const effectiveConcurrencyLimit = concurrencyLimit ?? concurrencyHardCap;
  const concurrentSessionsRaw = nonNegativeNumber(data.usage?.concurrent_sessions);
  const weightedConcurrentSessions = nonNegativeNumber(data.usage?.weighted_concurrent_sessions);
  const concurrentSessions = weightedConcurrentSessions ?? concurrentSessionsRaw ?? 0;
  const tokensIn = nonNegativeNumber(data.usage?.tokens_in);
  const tokensOut = nonNegativeNumber(data.usage?.tokens_out);
  const tokensCached = nonNegativeNumber(data.usage?.tokens_cached);

  // Headroom: buffer between soft limit and hard cap (8000/16000 for service_account)
  const headroom =
    requestHardCap !== undefined && requestLimit !== undefined && requestHardCap > requestLimit
      ? requestHardCap - requestLimit
      : undefined;

  const windows: NonNullable<ProviderUsageSnapshot["windows"]> = [];
  const windowResetMs = parseResetAtMs(stringOrUndefined(data.window?.resets_at));
  if (showLegacyWindows && effectiveRequestLimit !== undefined && effectiveRequestLimit > 0) {
    const remainingForCalc = effectiveRemainingRequests ?? effectiveRequestLimit;
    const used = Math.max(0, effectiveRequestLimit - remainingForCalc);
    const pct = Math.min(100, Math.max(0, (used / effectiveRequestLimit) * 100));
    // Founding seats: once you tap into headroom, label shifts as easter egg
    const inNovaZone = founding && headroom !== undefined && used >= effectiveRequestLimit;
    windows.push({
      label: inNovaZone ? "✨ Nova's zone" : "Request window",
      usedPercent: pct,
      ...(windowResetMs !== undefined ? { resetAt: windowResetMs } : {}),
    });
  }
  if (showLegacyWindows && effectiveConcurrencyLimit !== undefined && effectiveConcurrencyLimit > 0) {
    const pct = Math.min(100, Math.max(0, (concurrentSessions / effectiveConcurrencyLimit) * 100));
    windows.push({
      label: "Concurrency",
      usedPercent: pct,
      ...(windowResetMs !== undefined ? { resetAt: windowResetMs } : {}),
    });
  }

  const billing: NonNullable<ProviderUsageSnapshot["billing"]> = [];
  if (tokensIn !== undefined) {
    billing.push({ type: "spend", label: "Tokens in", amount: tokensIn, unit: "tokens" });
  }
  if (tokensOut !== undefined) {
    billing.push({ type: "spend", label: "Tokens out", amount: tokensOut, unit: "tokens" });
  }
  if (tokensCached !== undefined) {
    billing.push({ type: "spend", label: "Tokens cached", amount: tokensCached, unit: "tokens" });
  }
  // Headroom — visual nod to the safety net. Legacy-plan surface only:
  // wallet keys consume from a $ balance and have no request quota to buffer.
  if (showLegacyWindows && headroom !== undefined && headroom > 0) {
    billing.push({
      type: "spend",
      label: "Headroom (Nova's safety net ✨)",
      amount: headroom,
      unit: "requests",
    });
  }

  const resetTimeLabel = formatResetTime(windowResetMs);
  const summaryParts: string[] = [];
  if (showLegacyWindows) {
    if (effectiveRemainingRequests !== undefined && effectiveRequestLimit !== undefined) {
      summaryParts.push(`${effectiveRemainingRequests}/${effectiveRequestLimit} requests remaining`);
    }
    if (founding && headroom !== undefined) {
      summaryParts.push(`+${headroom} founding headroom`);
    }
    if (concurrentSessions !== undefined && effectiveConcurrencyLimit !== undefined) {
      summaryParts.push(`${concurrentSessions}/${effectiveConcurrencyLimit} concurrent sessions`);
    }
    if (resetTimeLabel) {
      summaryParts.push(`resets at ${resetTimeLabel}`);
    }
  }
  const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : undefined;

  const planField = walletKey ? "Umans Wallet" : hasPlan ? planDisplayName : undefined;

  return {
    provider: "umans",
    displayName,
    windows,
    ...(billing.length > 0 ? { billing } : {}),
    ...(summary ? { summary } : {}),
    ...(planField ? { plan: planField } : {}),
  };
}