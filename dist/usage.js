import { buildUsageHttpErrorSnapshot } from "openclaw/plugin-sdk/provider-usage";
import { readResponseWithLimit } from "openclaw/plugin-sdk/response-limit-runtime";
const UMANS_USAGE_URL = "https://api.code.umans.ai/v1/usage";
const UMANS_USAGE_RESPONSE_MAX_BYTES = 1024 * 1024;
/** @internal exported for testing (#2) */
export function nonNegativeNumber(value) {
    const parsed = typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
            ? Number(value)
            : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
function objectRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function stringOrUndefined(value) {
    return typeof value === "string" ? value : undefined;
}
/** @internal exported for testing (#2) */
export function isFoundingSeat(slug, displayName) {
    if (!slug && !displayName)
        return false;
    const lowerSlug = slug?.toLowerCase() ?? "";
    const lowerName = displayName?.toLowerCase() ?? "";
    return lowerSlug.includes("founding") || lowerName.includes("founding");
}
/** @internal exported for testing — wallet/service_account detection (Aug 2026: plans removed) */
export function isServiceAccount(slug, displayName) {
    if (!slug && !displayName)
        return false;
    const lowerSlug = slug?.toLowerCase() ?? "";
    const lowerName = displayName?.toLowerCase() ?? "";
    return lowerSlug === "service_account" || lowerName === "service account";
}
/**
 * Retry a fetch call on transient failure (#5).
 * One retry after 2s covers DNS hiccups and brief network blips
 * without missing a whole 60s dashboard poll cycle.
 */
async function fetchWithRetry(fetchFn, url, options, retries = 1, delayMs = 2000) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fetchFn(url, options);
        }
        catch (err) {
            lastError = err;
            if (attempt < retries) {
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }
    }
    throw lastError;
}
async function readPayload(response, timeoutMs) {
    const buffer = await readResponseWithLimit(response, UMANS_USAGE_RESPONSE_MAX_BYTES, {
        chunkTimeoutMs: timeoutMs,
        onOverflow: ({ maxBytes }) => new Error(`Umans usage response exceeds ${maxBytes} bytes`),
        onIdleTimeout: ({ chunkTimeoutMs }) => new Error(`Umans usage response stalled for ${chunkTimeoutMs}ms`),
    });
    const data = objectRecord(JSON.parse(new TextDecoder().decode(buffer)));
    if (!data) {
        throw new Error("Umans usage response is not an object");
    }
    return data;
}
/** @internal exported for testing (#2) */
export function parseResetAtMs(resetsAt) {
    if (!resetsAt)
        return undefined;
    try {
        const ms = Date.parse(resetsAt);
        return Number.isFinite(ms) ? ms : undefined;
    }
    catch {
        return undefined;
    }
}
function formatResetTime(resetsAtMs) {
    if (resetsAtMs === undefined)
        return undefined;
    try {
        const date = new Date(resetsAtMs);
        if (Number.isNaN(date.getTime()))
            return undefined;
        // en-GB locale is deliberate (#4): consistent across all deployments,
        // and the dashboard is primarily UK-centric. Accepting the system default
        // would show 24h vs 12h inconsistently across machines.
        return date.toLocaleString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
        });
    }
    catch {
        return undefined;
    }
}
export async function fetchUmansUsage(params) {
    let response;
    try {
        // One retry on transient failure so a brief blip doesn't miss a whole poll cycle (#5)
        response = await fetchWithRetry(params.fetchFn, UMANS_USAGE_URL, {
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${params.token}`,
            },
            signal: AbortSignal.timeout(params.timeoutMs),
        });
    }
    catch {
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
    let data;
    try {
        data = await readPayload(response, params.timeoutMs);
    }
    catch (err) {
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
    const _serviceAccount = isServiceAccount(rawPlanSlug, rawPlanDisplayName);
    void _serviceAccount; // used in summary logic below; keep for clarity
    const displayName = founding ? `${planDisplayName} ✨` : planDisplayName;
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
    const headroom = requestHardCap !== undefined && requestLimit !== undefined && requestHardCap > requestLimit
        ? requestHardCap - requestLimit
        : undefined;
    const windows = [];
    const windowResetMs = parseResetAtMs(stringOrUndefined(data.window?.resets_at));
    if (effectiveRequestLimit !== undefined && effectiveRequestLimit > 0) {
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
    if (effectiveConcurrencyLimit !== undefined && effectiveConcurrencyLimit > 0) {
        const pct = Math.min(100, Math.max(0, (concurrentSessions / effectiveConcurrencyLimit) * 100));
        windows.push({
            label: "Concurrency",
            usedPercent: pct,
            ...(windowResetMs !== undefined ? { resetAt: windowResetMs } : {}),
        });
    }
    const billing = [];
    if (tokensIn !== undefined) {
        billing.push({ type: "spend", label: "Tokens in", amount: tokensIn, unit: "tokens" });
    }
    if (tokensOut !== undefined) {
        billing.push({ type: "spend", label: "Tokens out", amount: tokensOut, unit: "tokens" });
    }
    if (tokensCached !== undefined) {
        billing.push({ type: "spend", label: "Tokens cached", amount: tokensCached, unit: "tokens" });
    }
    // Headroom — visual nod to the safety net (founding or service_account)
    if (headroom !== undefined && headroom > 0) {
        billing.push({
            type: "spend",
            label: "Headroom (Nova's safety net ✨)",
            amount: headroom,
            unit: "requests",
        });
    }
    const resetTimeLabel = formatResetTime(windowResetMs);
    const summaryParts = [];
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
    const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : undefined;
    const planField = hasPlan ? planDisplayName : undefined;
    return {
        provider: "umans",
        displayName,
        windows,
        ...(billing.length > 0 ? { billing } : {}),
        ...(summary ? { summary } : {}),
        // Use API's display_name directly (#6) — service_account/wallet works without code changes.
        // Omitted when API returned no plan at all (future pure PAYG).
        ...(planField ? { plan: planField } : {}),
    };
}
//# sourceMappingURL=usage.js.map