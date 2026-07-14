import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { fetchUmansUsage } from "./usage.js";

const PROVIDER_ID = "umans";

export default {
  id: "openclaw-umans-usage",
  name: "Umans Code usage dashboard",
  description:
    "Surfaces Umans Code plan limits, request budgets, and token usage in OpenClaw's Provider Plans & Billing dashboard.",
  version: "0.1.2",
  register(api: OpenClawPluginApi) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: "Umans",
      docsPath: "/providers/umans",
      auth: [],
      resolveUsageAuth: (ctx) => {
        const apiKey = ctx.resolveApiKeyFromConfigAndStore({ providerIds: ["umans"] });
        return apiKey ? { token: apiKey } : null;
      },
      fetchUsageSnapshot: async (ctx) => {
        return await fetchUmansUsage({
          token: ctx.token,
          timeoutMs: ctx.timeoutMs,
          fetchFn: ctx.fetchFn,
        });
      },
    } satisfies Parameters<OpenClawPluginApi["registerProvider"]>[0]);
  },
};
