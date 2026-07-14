import type { ProviderUsageSnapshot } from "openclaw/plugin-sdk/provider-usage";
import { buildUsageHttpErrorSnapshot } from "openclaw/plugin-sdk/provider-usage";
import { readResponseWithLimit } from "openclaw/plugin-sdk/response-limit-runtime";

const UMANS_USAGE_URL = "https://api.code.umans.ai/v1/usage";
const UMANS_USAGE_RESPONSE_MAX_BYTES = 1024 * 1024;

export type UmansLimits = {
  requests?: {
    limit?: number;
    hard_cap?: number;
    description?: string;
  };
  concurrency?: {
    limit?: number;
    hard_cap?: number;
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
  };
};

function nonNegativeNumber(value: unknown): number | undefined {
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

async function readPayload(response: Response, timeoutMs: number): Promise<UmansUsageResponse> {
  const buffer = await readResponseWithLimit(response, UMANS_USAGE_RESPONSE_MAX_BYTES, {
    chunkTimeoutMs: timeoutMs,
    onOverflow: ({ maxBytes }) => new Error(`Umans usage response exceeds ${maxBytes} bytes`),
    onIdleTimeout: ({ chunkTimeoutMs }) =>
      new Error(`Umans usage response stalled for ${chunkTimeoutMs}ms`),
  });
  const data = objectRecord(JSON.parse(new TextDecoder().decode(buffer)));
  if (!data) {
    throw new Error("Umans usage response is not an object");
  }
  return data as UmansUsageResponse;
}

function parseResetAtMs(resetsAt: string | undefined): number | undefined {
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
  let response: Response;
  try {
    response = await params.fetchFn(UMANS_USAGE_URL, {
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
      error: "Usage unavailable",
    };
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return buildUsageHttpErrorSnapshot({ provider: "umans", status: response.status });
  }

  let data: UmansUsageResponse;
  try {
    data = await readPayload(response, params.timeoutMs);
  } catch {
    return {
      provider: "umans",
      displayName: "Umans",
      windows: [],
      error: "Malformed usage response",
    };
  }

  const planSlug = stringOrUndefined(data.plan?.slug) ?? "unknown";
  const planDisplayName = stringOrUndefined(data.plan?.display_name) ?? "Umans";
  const requestLimit = nonNegativeNumber(data.limits?.requests?.limit);
  const requestHardCap = nonNegativeNumber(data.limits?.requests?.hard_cap);
  const effectiveRequestLimit = requestLimit ?? requestHardCap;
  const remainingRequests = nonNegativeNumber(data.usage?.remaining_requests);
  const concurrencyLimit = nonNegativeNumber(data.limits?.concurrency?.limit);
  const concurrencyHardCap = nonNegativeNumber(data.limits?.concurrency?.hard_cap);
  const effectiveConcurrencyLimit = concurrencyLimit ?? concurrencyHardCap;
  const concurrentSessions = nonNegativeNumber(data.usage?.concurrent_sessions) ?? 0;
  const tokensIn = nonNegativeNumber(data.usage?.tokens_in);
  const tokensOut = nonNegativeNumber(data.usage?.tokens_out);
  const tokensCached = nonNegativeNumber(data.usage?.tokens_cached);

  const windows: NonNullable<ProviderUsageSnapshot["windows"]> = [];
  const windowResetMs = parseResetAtMs(stringOrUndefined(data.window?.resets_at));
  if (effectiveRequestLimit !== undefined && effectiveRequestLimit > 0) {
    const used = Math.max(0, effectiveRequestLimit - (remainingRequests ?? effectiveRequestLimit));
    const pct = Math.min(100, Math.max(0, (used / effectiveRequestLimit) * 100));
    windows.push({
      label: "Request window",
      usedPercent: pct,
      ...(windowResetMs !== undefined ? { resetAt: windowResetMs } : {}),
    });
  }
  if (effectiveConcurrencyLimit !== undefined && effectiveConcurrencyLimit > 0) {
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

  const resetTimeLabel = formatResetTime(windowResetMs);
  const summaryParts: string[] = [];
  if (remainingRequests !== undefined && effectiveRequestLimit !== undefined) {
    summaryParts.push(`${remainingRequests}/${effectiveRequestLimit} requests remaining`);
  }
  if (concurrentSessions !== undefined && effectiveConcurrencyLimit !== undefined) {
    summaryParts.push(`${concurrentSessions}/${effectiveConcurrencyLimit} concurrent sessions`);
  }
  if (resetTimeLabel) {
    summaryParts.push(`resets at ${resetTimeLabel}`);
  }
  const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : undefined;

  return {
    provider: "umans",
    displayName: planDisplayName,
    windows,
    ...(billing.length > 0 ? { billing } : {}),
    ...(summary ? { summary } : {}),
    plan: planSlug === "code_pro" ? "Code Pro" : planDisplayName,
  };
}
