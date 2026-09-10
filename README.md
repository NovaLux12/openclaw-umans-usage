# openclaw-umans-usage

OpenClaw provider plugin that surfaces **Umans** wallet balance (when the API exposes it), token usage, and — for legacy plan keys — request/concurrency windows in the OpenClaw *Provider Plans & Billing* dashboard, alongside the built-in MiniMax and OpenRouter cards.

> **Aug 2026:** Umans is wallet-first. Code plans (Code Pro, Code Max, founding seats) were removed; every key is now a **wallet key** billed pay-per-token. The plugin probes the new wallet endpoint first and falls back to the classic `/v1/usage` endpoint, so it works for wallet keys today, keeps legacy plan keys rendering as before, and is forward-compatible with the balance API Umans is still rolling out.

## The Umans wallet — what you're actually looking at

Umans no longer sells request allowances. It sells **tokens, prepaid through a credit wallet**:

- **Top-up** credits at `app.umans.ai/billing` (wallet tab). Optional auto-top-up; promos apply at the point of purchase.
- **Balance is the real limit.** When your dollar balance hits zero, requests stop. There is no "you're out of requests" state — there's "you're out of money" (or you're temporarily burst-limited, see below).
- **Pay-per-token pricing** differs per model. Live `/v1/models` listing (public, no auth, 2026-08-28):

  | Model | Input $/M tokens | Output $/M tokens |
  |-------|------------------|-------------------|
  | `umans-deepseek-v4-flash-0731` (Flash) | **$0.14** | **$0.28** |
  | `umans-flash` | $0.15 | $1.00 |
  | `umans-qwen3.6-35b-a3b` | $0.15 | $1.00 |
  | `umans-coder` | $0.95 | $4.00 |
  | `umans-kimi-k2.7` | $0.95 | $4.00 |
  | `umans-deepseek-v4-pro-0813` | $1.32 | $3.96 |
  | `umans-glm-5.2` | $1.40 | $4.40 |
  | `umans-kimi-k3` | $3.00 | $15.00 |

  Flash also has a **cache rate of $0.028/M tokens**. The billing formula was verified to the cent against real ledger rows: `input × $0.14/M + cached × $0.028/M + output × $0.28/M`.

- **Tiers 0–3 unlock burst limits**, and only *paid* top-ups count toward them — promo/bonus credits never do:

  | Tier | Unlocked by lifetime paid top-up | Burst ceiling (approx., 5h rolling window) |
  |------|----------------------------------|--------------------------------------------|
  | 0 | default (no paid top-up) | baseline |
  | 1 | $50 | — |
  | 2 | $250 | 8,000 requests / 5h (soft) · 16,000 hard cap · 12 concurrent |
  | 3 | $1,000 | 16K requests / 5h |

  The wallet page shows your tier and how close you are to the next one ("$X to T3"). Your *actual* limits are what the API reports — no need to read the tier table.

## Plans vs Pay-by-token

| | Legacy Plans (≤ Jul 2026) | Wallet / Pay-by-token (Aug 2026+) |
|---|---|---|
| Billing | Monthly subscription (e.g. Code Pro $20/mo) | Prepaid credit wallet, per-token billing |
| Spend limit | The plan's request allowance | **Your dollar balance** |
| Request window | An allowance you draw down — used/remaining was the point | A **burst governor** — a rate ceiling, not a spend limit (not rendered, see next section) |
| `plan` field | `code_pro`, `code_max`, `code_pro_founding` | `service_account` (or absent) |
| When it stops | Window exhausted → wait for reset (or paid more) | Balance at $0 → top up |

The practical difference: with a plan, hitting your request window meant the window was your allowance. With a wallet, you can keep burning tokens until the **balance** hits $0 — "8,000 requests / 5h" only says how *fast* you may burn, and it refills every 5 hours regardless of spend.

## Why the Request window is hidden for wallet

Wallet keys render **without the Request window (and without Concurrency)** — deliberately:

- The numbers `/v1/usage` reports for wallet keys (8,000 requests / 5h soft, 16,000 hard cap) are a **burst governor** — a rate ceiling that protects shared capacity, *not* a spend allowance. The API says so itself: `limits.requests.description = "8000 requests per 5 hours"`, `burst_pct: 1.0`.
- Your **balance is the spend limit**. Rendering a "Request window" that refills every 5 hours regardless of spend would misrepresent the model — the card would look like you get a fresh allowance when really you're spending dollars.
- So for wallet keys the plugin shows only what's meaningful: **token burn** (in/out/cached), plus the **balance row** when the wallet endpoint answers.
- If Umans ever exposes a burst window worth surfacing separately, it will reappear as a **"Burst window"** — the response types already parse `burst_pct` / `window_seconds`, so it's a label change, not a rewrite.
- Legacy plan keys (a real `plan` that isn't `service_account`) keep the full window surface — Request window, Concurrency, headroom, and reset, exactly as before.

## Wallet endpoint status — `GET /v1/wallet`

The plugin is **wallet-first**: it probes `GET https://api.code.umans.ai/v1/wallet` on every poll, best-effort.

- **Today there is no wallet endpoint for most keys** — `GET /v1/wallet`, `/v1/billing`, and `/v1/balance` return **404**. The plugin treats this like any other wallet-fetch failure: **silently falls back to `/v1/usage`** and renders token spend for the window. No dead-end error card, no dashboard noise.
- Your dollar balance/credits therefore remain **dashboard-only** at `app.umans.ai/billing` (wallet tab, Stripe portal) until the endpoint ships.
- **When it answers**, the balance renders as a native balance row (`type: "balance"` — OpenClaw's `ProviderUsageBilling` supports it out of the box). The parsing is deliberately loose: flat (`balance`, `currency`, `spent`, `credited`, `tier`) and nested (`wallet.balance`, …) shapes are both accepted, unknown fields are ignored, and currency defaults to USD — so a vendor schema tweak won't break the mapping.

## What you see in the dashboard

**Wallet keys** (current standard):

- Provider card named **Umans Wallet** with a matching plan badge — the raw `service_account` slug is never exposed to the dashboard
- **Token counters** — input, output, and cached tokens for the current window
- **Wallet balance row** — appears automatically the moment `GET /v1/wallet` answers
- No Request window / no Concurrency / no reset line — the burst governor isn't a spend surface (see above)

**Legacy plan keys** (pre-Aug 2026):

- Provider card with the plan name (e.g. *Code Pro (Founding Seat) ✨*)
- **Request window** — remaining / limit bar, using **weighted** quota when the API provides it (the gateway enforces weighted quota — Flash's 0.5 weight is why raw and weighted counts diverge)
- **Concurrency** — active sessions vs cap · **Token counters** · **Headroom** (soft-limit-to-hard-cap buffer)
- **Reset time** — per-window countdown and summary line
- <img width="522" height="366" alt="image" src="https://github.com/user-attachments/assets/6d7ae513-762d-42d7-8bc9-46fabdbbcc09" />

## How it works

OpenClaw's dashboard polls the `usage.status` Gateway method every ~60 seconds. When the `umans` provider is configured, this plugin:

1. Resolves your Umans API key from the existing provider config (or `UMANS_API_KEY` env var) — no extra credentials needed
2. **Wallet-first:** probes `https://api.code.umans.ai/v1/wallet` with your bearer token — any failure (404, network, empty body) falls through silently
3. **Falls back to `https://api.code.umans.ai/v1/usage`** (the classic endpoint) and parses plan, limits, token counters, and windows
4. Maps the result to OpenClaw's `ProviderUsageSnapshot` shape: balance (when available), token billing, and a human-readable summary

The hook is registered via `api.registerProvider({ resolveUsageAuth, fetchUsageSnapshot })` — the same SDK interface used by the built-in MiniMax and OpenRouter providers. The mapping is key-type agnostic: wallet keys, legacy plans, and future pure-PAYG responses (no `plan`, no limits) all render without config changes.

## Example snapshots

### Current — wallet key: live fetch 2026-08-28 22:44 BST

Raw `/v1/usage` response (user id trimmed; this is the shape the plugin receives after `/v1/wallet` 404s):

```json
{
  "plan": { "slug": "service_account", "display_name": "Service Account" },
  "limits": {
    "requests": {
      "limit": 8000,
      "hard_cap": 16000,
      "burst_pct": 1.0,
      "window_seconds": 18000,
      "description": "8000 requests per 5 hours"
    },
    "concurrency": {
      "limit": 12,
      "hard_cap": 24,
      "burst_pct": 1.0,
      "description": "12 concurrent sessions"
    }
  },
  "window": {
    "started_at": "2026-08-28T19:39:02.060174+00:00",
    "resets_at": "2026-08-29T00:39:02.060174+00:00",
    "remaining_minutes": 114
  },
  "usage": {
    "requests_in_window": 388,
    "weighted_in_window": 97.0,
    "remaining_requests": 7612,
    "weighted_remaining_requests": 7903.0,
    "concurrent_sessions": 0,
    "weighted_concurrent_sessions": 0.0,
    "tokens_in": 45053513,
    "tokens_out": 370856,
    "tokens_cached": 42859264
  }
}
```

What the plugin renders for that response (the dashboard card — token spend only, no windows):

```json
{
  "provider": "umans",
  "displayName": "Umans Wallet",
  "windows": [],
  "billing": [
    { "type": "spend", "label": "Tokens in", "amount": 45053513, "unit": "tokens" },
    { "type": "spend", "label": "Tokens out", "amount": 370856, "unit": "tokens" },
    { "type": "spend", "label": "Tokens cached", "amount": 42859264, "unit": "tokens" }
  ],
  "plan": "Umans Wallet"
}
```

The burst numbers from the raw response (8,000/5h soft, 16,000 hard, 12 concurrent) are the **burst governor** — deliberately not rendered for wallet keys, because the limit that matters is the dollar balance (see above). Note also the **weighted vs raw** split: 388 raw requests burned this window but only **97 weighted** — the gateway enforces weighted quota, and per-model weights (Flash = 0.5) are why the two diverge.

### Forward-compatible — the balance row, once `GET /v1/wallet` answers

When the endpoint starts returning a balance, the plugin short-circuits to this card (amounts illustrative):

```json
{
  "provider": "umans",
  "displayName": "Umans Wallet",
  "windows": [],
  "billing": [
    { "type": "balance", "label": "Wallet balance", "amount": 11.38, "unit": "USD" }
  ],
  "plan": "Umans Wallet"
}
```

Until then, the balance lives at `app.umans.ai/billing` — and the card above is what you'll see in OpenClaw the day it ships, with no plugin update required.

### Legacy — plan keys (pre-Aug 2026) still render exactly as before

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

## Install

```bash
openclaw plugins install @novalux12/openclaw-umans-usage
```

Or add to `openclaw.json` under `plugins.entries`:

```json
{
  "id": "openclaw-umans-usage",
  "source": "npm:@novalux12/openclaw-umans-usage@0.1.5"
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

No additional configuration — the plugin reuses the API key from your existing `models.providers.umans` block.

## Requirements

- **OpenClaw Gateway >= 2026.7.1** (plugin uses manifest `contracts.usageProviders`)
- An existing Umans provider configuration (`models.providers.umans` with an `apiKey`) — wallet key or legacy plan key both work
- The `/v1/usage` endpoint on `api.code.umans.ai` (authenticated with the same inference key); `/v1/wallet` is probed but optional — 404s today

## Known limitations

- OpenClaw's `ProviderUsageBilling` type supports only `balance`, `spend`, and `budget` billing categories. Token counters are mapped as `type: "spend"` with `unit: "tokens"` — pragmatic but not a perfect semantic match. A dedicated `token` billing type would improve this, but it's a framework-level change.
- **No `$` balance via API (yet).** `GET /v1/wallet` returns 404 for current keys, so the plugin falls back to `/v1/usage`. Your dollar balance/credits are dashboard-only at `app.umans.ai/billing` (Stripe portal). The plugin is already wired to render the balance the moment the endpoint answers.
- **Weighted vs raw quota.** The plugin prefers `weighted_remaining_requests` when present because the gateway enforces weighted quota — this is deliberate, but it means the numbers on the card can differ from a naive raw-request count.
- **Windows are intentionally absent for wallet keys.** The burst governor and concurrency ceiling are rate limits, not spend allowances; token burn (and, later, balance) is the wallet's real surface. See *Why the Request window is hidden for wallet*.

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