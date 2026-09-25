# Providers

The mock collector proves the normalized contract. The preferred collectors reuse existing CLI sign-ins without browser profiles or cookie handling:

- `claude-cli preview` invokes Claude Code's built-in `claude -p /usage` in an empty private directory and parses its session and all-model weekly percentages. The reset text is local-time prose, so `reset_at` stays unknown.
- `openai-cli preview` reads structured Work/Codex five-hour and weekly limits from the installed Codex CLI's local app-server. It keeps reported reset timestamps in UTC.

Run the matching `sync` command after deployment with `LLM_USAGE_URL` set. Both publish only normalized snapshots. Missing meters become unknown buckets, so routing will not mistake absent measurements for free capacity.

Cursor [does not currently expose a public API or CLI command for individual subscription usage](https://forum.cursor.com/t/usage-api-cli-command/160967/5). Its Admin API is for teams and must not be confused with a personal subscription. The Cursor CLI can be signed in while still offering no personal quota reading. Leave Cursor capacity unknown in a browser-free setup rather than inferring it from token logs or API billing.

The OpenAI collector measures only the Work/Codex subscription allowance, [shared across those products](https://help.openai.com/fr-ca/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex). It does not represent ordinary chat-message limits, API billing, or purchased credits. Its bucket scope is `work_codex`. Provision that model class for a class-filtered route; the pre-existing `chatgpt-personal` account row must be updated before such a route will include it.
