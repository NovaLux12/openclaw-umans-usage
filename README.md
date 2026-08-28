# openclaw-umans-usage

OpenClaw provider plugin that surfaces **Umans** quota, request budgets, and token usage in the OpenClaw *Provider Plans & Billing* dashboard — alongside the built-in MiniMax and OpenRouter cards.

> **Aug 2026 update:** Umans removed Code plans (Code Pro etc.). Standard API keys now return `service_account` (8000 requests / 5h, 12 concurrent, 16k hard cap) via the same `/v1/usage` endpoint. The plugin is now key-type agnostic — it auto-detects `service_account` / wallet keys and legacy plans without config changes. Your `$` balance remains dashboard-only at `app.umans.ai/billing` (no API surface).

## What you see in the dashboard

- **Provider card** with current quota name (e.g. *Service Account* — 8000/5h for standard wallet keys; legacy *Code Pro* still renders)
- **Request window** — remaining / limit bar (uses `weighted_remaining_requests` when the API provides it — Flash = 0.5 weight is why raw vs weighted can differ)
- **Concurrency** — active sessions vs your cap (12 for service_account)
- **Token counters** — input, output, and cached tokens for the current window
- **Reset time** — both as a per-window countdown and in the summary line
- <img width="522" height="366" alt="image" src="https://github.com/user-attachments/assets/6d7ae513-762d-42d7-8bc9-46fabdbbcc09" />


## How it works

OpenClaw's dashboard polls the `usage.status` Gateway method every ~60 seconds. When the `umans` provider is configured, this plugin:

1. Resolves your Umans API key from the existing provider config (or `UMANS_API_KEY` env var) — no extra credentials needed
2. Calls `https://api.code.umans.ai/v1/usage` with your bearer token
3. Maps the response to OpenClaw's `ProviderUsageSnapshot` shape: quota info, usage windows, token billing, and a human-readable summary

The hook is registered via `api.registerProvider({ resolveUsageAuth, fetchUsageSnapshot })` — the same SDK interface used by the built-in MiniMax and OpenRouter providers. The mapping is key-type agnostic: if `plan` is missing (future pure-PAYG wallet) it still renders tokens/windows without a fake badge.

## Install

```bash
openclaw plugins install @novalux12/openclaw-umans-usage
```

Or add to `openclaw.json` under `plugins.entries`:

```json
{
  "id": "openclaw-umans-usage",
  "source": "npm:@novalux12/openclaw-umans-usage@0.1.4"
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

No additional configuration — the plugin reuses the API key from your existing `models.providers.umans` block.

## Requirements

- **OpenClaw Gateway >= 2026.7.1** (plugin uses manifest `contracts.usageProviders`)
- An existing Umans provider configuration (`models.providers.umans` with an `apiKey`) — standard wallet key or legacy plan key both work
- The `/v1/usage` endpoint on `api.code.umans.ai` (authenticated with the same inference key)

## Example `usage.status` output

Current wallet key (`service_account` — 2026-08-28):

```json
{
  "provider": "umans",
  "displayName": "Service Account",
  "windows": [
    { "label": "Request window", "usedPercent": 0.38, "resetAt": 1724812740000 },
    { "label": "Concurrency", "usedPercent": 0, "resetAt": 1724812740000 }
  ],
  "billing": [
    { "type": "spend", "label": "Tokens in", "amount": 15978752, "unit": "tokens" },
    { "type": "spend", "label": "Tokens out", "amount": 151201, "unit": "tokens" },
    { "type": "spend", "label": "Tokens cached", "amount": 15373056, "unit": "tokens" },
    { "type": "spend", "label": "Headroom (Nova's safety net ✨)", "amount": 8000, "unit": "requests" }
  ],
  "summary": "7969/8000 requests remaining · 0/12 concurrent sessions · resets at 01:39 BST",
  "plan": "Service Account"
}
```

Legacy plan keys (pre-Aug 2026) still render as before:

```json
{
  "provider": "umans",
  "displayName": "Code Pro (Founding Seat) ✨",
  "windows": [
    { "label": "Request window", "usedPercent": 62, "resetAt": 1744070800000 },
    { "label": "Concurrency", "usedPercent": 0, "resetAt": 1744070800000 }
  ],
  "billing": [
    { "type": "spend", "label": "Tokens in", "amount": 1084775, "unit": "tokens" }
  ],
  "summary": "76/200 requests remaining · 0/5 concurrent sessions · resets at 16:56 BST",
  "plan": "Code Pro"
}
```

## Known limitations

- OpenClaw's `ProviderUsageBilling` type supports only `balance`, `spend`, and `budget` billing categories. Token counters are mapped as `type: "spend"` with `unit: "tokens"` — which is a pragmatic fit but not a perfect semantic match. A dedicated `token` billing type would improve this, but it's a framework-level change.
- **No `$` balance via API.** `GET /v1/billing`, `/v1/wallet`, `/v1/balance` all return 404 today. Your dollar balance/credits are only on the web dashboard at `app.umans.ai/billing` (Stripe portal). The plugin surfaces the quota/tokens that *are* available via `/v1/usage`.

## Contributing

PRs are welcome. A few things to know:

- **This is a small, focused plugin.** It does one thing: surface Umans usage in OpenClaw's dashboard. PRs that expand the scope significantly (e.g. adding usage for other providers, bundled model catalogs) are likely out of scope — discuss in an issue first.
- **Security matters.** Any PR that touches auth resolution, HTTP requests, or error paths gets extra scrutiny. Exfiltration via a malicious PR is a real threat model for a plugin that handles an API key.
- **Keep it readable.** The codebase is ~200 lines. Prefer clarity over cleverness.
- **CI runs on GitHub Actions** — `tsc --noEmit` plus the Node test suite on every push and PR. There are no issue templates or CODEOWNERS; just open a PR.
- **Local setup:** openclaw is not a locked devDependency (its published package ships an `npm-shrinkwrap.json`, so we cannot patch its transitive dependency tree). Install it ad hoc before building:
  ```bash
  npm install openclaw@2026.7.1 --no-save
  ```

First PR already merged — thanks @hkJerryLeung!

## Repository

`https://github.com/NovaLux12/openclaw-umans-usage`

## License

MIT — [NovaLux12](https://github.com/NovaLux12)
