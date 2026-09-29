# Providers

The mock collector proves the normalized contract. The preferred collectors reuse existing sign-ins without browser profiles or cookie handling:

- `claude-cli preview` invokes Claude Code's built-in `claude -p /usage` in an empty private directory and parses its session and all-model weekly percentages. The reset text is local-time prose, so `reset_at` stays unknown.
- `openai-cli preview` reads structured Work/Codex five-hour and weekly limits from the installed Codex CLI's local app-server. It keeps reported reset timestamps in UTC.
- `cursor-cli preview` reads the signed-in Cursor desktop app's local access token in memory and asks Cursor's current-period endpoint for the Cursor Models and Other Models percentages and monthly reset. If that path fails, it falls back to the Cursor Agent CLI's authentication health.

Run the matching `sync` command after deployment with `LLM_USAGE_URL` set. All three publish only normalized snapshots. Missing meters become unknown buckets, so routing will not mistake absent measurements for free capacity.

Cursor [does not currently expose a public API or CLI command for individual subscription usage](https://forum.cursor.com/t/usage-api-cli-command/160967/5). Its Admin API is for teams and must not be confused with a personal subscription. The desktop app's current-period endpoint is undocumented and can change; the collector never persists or publishes its access token. If that endpoint fails, `cursor-cli sync` records an authenticated CLI as `partial` with no limits and diagnostic `personal_usage_unavailable`; a signed-out or failed check records `error`. No allowance is inferred from token logs or API billing.

The OpenAI collector measures only the Work/Codex subscription allowance, [shared across those products](https://help.openai.com/fr-ca/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex). It does not represent ordinary chat-message limits, API billing, or purchased credits. Its bucket scope is `work_codex`. Provision that model class for a class-filtered route; an account tagged only `general` will not match it.

- `google-cli preview` measures the **Google AI Pro subscription** (Gemini Apps / Antigravity Gemini-model group), not Gemini API usage or Cloud billing. It reads the signed-in Antigravity CLI session on the Mac (`~/.gemini/antigravity-cli/antigravity-oauth-token`) in memory and asks Code Assist for five-hour and weekly remaining fractions. The access token is never logged, published, or committed. Gemini API keys (`GEMINI_API_KEY`, AI Studio, pay-as-you-go) are ignored. If the Mac session is missing or expired, the snapshot is `error` with `sign_in_required` or `token_expired` so a human can sign in to Gemini/Antigravity on the mini.

Account id `google-ai-pro-personal`, provider `google`, bucket scope `gemini_apps`. Do not provision a Gemini API account in this inventory.
