import type { ProviderUsageSnapshot } from "openclaw/plugin-sdk/provider-usage";
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
        balance?: unknown;
        wallet?: unknown;
        credits?: unknown;
    };
};
/** @internal exported for testing (#2) */
export declare function nonNegativeNumber(value: unknown): number | undefined;
/** @internal exported for testing (#2) */
export declare function isFoundingSeat(slug: string | undefined, displayName: string | undefined): boolean;
/** @internal exported for testing — wallet/service_account detection (Aug 2026: plans removed) */
export declare function isServiceAccount(slug: string | undefined, displayName: string | undefined): boolean;
/** @internal exported for testing (#2) */
export declare function parseResetAtMs(resetsAt: string | undefined): number | undefined;
export declare function fetchUmansUsage(params: {
    token: string;
    timeoutMs: number;
    fetchFn: typeof fetch;
}): Promise<ProviderUsageSnapshot>;
//# sourceMappingURL=usage.d.ts.map