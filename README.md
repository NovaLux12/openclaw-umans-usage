# openclaw-umans-usage

OpenClaw provider plugin that surfaces **Umans Code** plan limits and usage in the *Provider Plans & Billing* dashboard.

## What it shows

- Current Umans plan (e.g. *Code Pro*)
- Request window quota (`remaining / limit`)
- Concurrency usage (`current / limit`)
- Token counters: input, output, cached
- Window reset time

## Install

```bash
openclaw plugins install openclaw-umans-usage
```

Or add to `openclaw.json` under `plugins.entries`:

```json
{
  "id": "openclaw-umans-usage",
  "source": "npm:@novalux12/openclaw-umans-usage@0.1.0"
}
```

The plugin reuses the API key already configured for `models.providers.umans` (or the `UMANS_API_KEY` env var). No extra credentials are required.

## Requirements

- OpenClaw Gateway >= 2026.3.24-beta.2
- An existing Umans provider configuration (`models.providers.umans`)

## Provider ID

`umans`

## License

MIT — NovaLux12
