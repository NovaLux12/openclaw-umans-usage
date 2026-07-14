import { buildUsageHttpErrorSnapshot } from "openclaw/plugin-sdk/provider-usage";
import { readResponseWithLimit } from "openclaw/plugin-sdk/response-limit-runtime";
const UMANS_USAGE_URL = "https://api.code.umans.ai/v1/usage";
const UMANS_USAGE_RESPONSE_MAX_BYTES = 1024 * 1024;
function nonNegativeNumber(value) {
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
function formatResetTime(resetsAt) {
    if (!resetsAt)
        return undefined;
    try {
        const date = new Date(resetsAt);
        if (Number.isNaN(date.getTime()))
            return undefined;
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
        response = await params.fetchFn(UMANS_USAGE_URL, {
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
            error: "Usage unavailable",
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
    catch {
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
    const windows = [];
    if (effectiveRequestLimit !== undefined && effectiveRequestLimit > 0) {
        const used = Math.max(0, effectiveRequestLimit - (remainingRequests ?? effectiveRequestLimit));
        windows.push({
            label: "Request window",
            usedPercent: Math.min(100, Math.max(0, (used / effectiveRequestLimit) * 100)),
        });
    }
    if (effectiveConcurrencyLimit !== undefined && effectiveConcurrencyLimit > 0) {
        const pct = Math.min(100, Math.max(0, (concurrentSessions / effectiveConcurrencyLimit) * 100));
        windows.push({
            label: "Concurrency",
            usedPercent: pct,
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
    const resetAt = formatResetTime(stringOrUndefined(data.window?.resets_at));
    const summaryParts = [];
    if (remainingRequests !== undefined && effectiveRequestLimit !== undefined) {
        summaryParts.push(`${remainingRequests}/${effectiveRequestLimit} requests remaining`);
    }
    if (concurrentSessions !== undefined && effectiveConcurrencyLimit !== undefined) {
        summaryParts.push(`${concurrentSessions}/${effectiveConcurrencyLimit} concurrent sessions`);
    }
    if (resetAt) {
        summaryParts.push(`resets at ${resetAt}`);
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
//# sourceMappingURL=usage.js.map