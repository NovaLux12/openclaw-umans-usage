# openclaw-umans-usage

OpenClaw provider plugin that surfaces **Umans Code** plan limits, request quotas, and token usage in the OpenClaw *Provider Plans & Billing* dashboard — alongside the built-in MiniMax and OpenRouter cards.

## What you see in the dashboard

- **Provider card** with current plan name (e.g. *Code Pro*)
- **Request window** — remaining / limit bar with countdown to next reset
- **Concurrency** — active sessions vs your plan cap
- **Token counters** — input, output, and cached tokens for the current window
- **Reset time** — both as a per-window countdown and in the summary line
- <img width="522" height="366" alt="image" src="https://github.com/user-attachments/assets/6d7ae513-762d-42d7-8bc9-46fabdbbcc09" />


## How it works

OpenClaw's dashboard polls the `usage.status` Gateway method every ~60 seconds. When the `umans` provider is configured, this plugin:

1. Resolves your Umans API key from the existing provider config (or `UMANS_API_KEY` env var) — no extra credentials needed
2. Calls `https://api.code.umans.ai/v1/usage` with your bearer token
3. Maps the response to OpenClaw's `ProviderUsageSnapshot` shape: plan info, usage windows, token billing, and a human-readable summary

The hook is registered via `api.registerProvider({ resolveUsageAuth, fetchUsageSnapshot })` — the same SDK interface used by the built-in MiniMax and OpenRouter providers.

## Install

```bash
openclaw plugins install @novalux12/openclaw-umans-usage
```

Or add to `openclaw.json` under `plugins.entries`:

```json
{
  "id": "openclaw-umans-usage",
  "source": "npm:@novalux12/openclaw-umans-usage@0.1.2"
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

No additional configuration — the plugin reuses the API key from your existing `models.providers.umans` block.

## Requirements

- **OpenClaw Gateway >= 2026.7.1** (plugin uses manifest `contracts.usageProviders`)
- An existing Umans provider configuration (`models.providers.umans` with an `apiKey`)
- The `/v1/usage` endpoint on `api.code.umans.ai` (authenticated with the same inference key)

## Example `usage.status` output

```json
{
  "provider": "umans",
  "displayName": "Code Pro (Founding Seat)",
  "windows": [
    { "label": "Request window", "usedPercent": 62, "resetAt": 1744070800000 },
    { "label": "Concurrency", "usedPercent": 0, "resetAt": 1744070800000 }
  ],
  "billing": [
    { "type": "spend", "label": "Tokens in", "amount": 1084775, "unit": "tokens" },
    { "type": "spend", "label": "Tokens out", "amount": 35719, "unit": "tokens" },
    { "type": "spend", "label": "Tokens cached", "amount": 9231424, "unit": "tokens" }
  ],
  "summary": "76/200 requests remaining · 0/5 concurrent sessions · resets at 16:56 BST",
  "plan": "Code Pro"
}
```

## Known limitation

OpenClaw's `ProviderUsageBilling` type supports only `balance`, `spend`, and `budget` billing categories. Token counters are mapped as `type: "spend"` with `unit: "tokens"` — which is a pragmatic fit but not a perfect semantic match. A dedicated `token` billing type would improve this, but it's a framework-level change.

## Contributing

PRs are welcome. A few things to know:

- **This is a small, focused plugin.** It does one thing: surface Umans Code usage in OpenClaw's dashboard. PRs that expand the scope significantly (e.g. adding usage for other providers, bundled model catalogs) are likely out of scope — discuss in an issue first.
- **Security matters.** Any PR that touches auth resolution, HTTP requests, or error paths gets extra scrutiny. Exfiltration via a malicious PR is a real threat model for a plugin that handles an API key.
- **Keep it readable.** The codebase is ~200 lines. Prefer clarity over cleverness.
- **No CI**, no templates, no CODEOWNERS. For now it's just me reading what you send.

First PR already merged — thanks @hkJerryLeung!

## Repository

`https://github.com/NovaLux12/openclaw-umans-usage`

## License

MIT — [NovaLux12](https://github.com/NovaLux12)
