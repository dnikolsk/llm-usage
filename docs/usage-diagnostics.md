# Diagnose live usage publication

Use this when the dashboard lacks reset dates or paid subscription balances. The diagnostic compares current official provider readings, the private control service, and the dashboard. It submits no coding tasks, publishes no snapshots, and does not change service configuration or restart anything. `--collect` calls the existing provider quota readers; the official Codex CLI may refresh its own session normally. It does not initiate sign-in or use paid generation.

Run from a separate checkout on the machine that already hosts the worker. Do not pull or switch branches in the checkout used by a running worker just to run this test. Use the same OS account as the worker so existing auth profiles and process metadata are accessible.

The optional read credentials are:

- `JOB_TOKEN`: the private control service's existing job/client token.
- `LLM_USAGE_DASHBOARD_READ_TOKEN`: the Vercel dashboard's existing `READ_TOKEN` value, injected under this distinct local name. Do not substitute a token from the private service.

Load only these existing bindings using the machine's established secret mechanism. Never print them or paste them into chat. If either credential is unavailable, run anyway: the corresponding check reports `token_missing`, while provider collection can still run. Worker, write, admin and database credentials are unnecessary. Token variable names can be changed with `--control-token-env` and `--dashboard-token-env`; values never belong in arguments.

```bash
DIAGNOSTIC_DIR="$(mktemp -d /tmp/llm-usage-diagnostic.XXXXXX)"
REPORT_DIR="$(mktemp -d /tmp/llm-usage-report.XXXXXX)"
git clone --depth 1 --branch main https://github.com/dnikolsk/llm-usage.git "$DIAGNOSTIC_DIR"
cd "$DIAGNOSTIC_DIR"
pnpm install --frozen-lockfile
pnpm --filter @llm-usage/collector usage:doctor --discover \
  --dashboard https://YOUR_DASHBOARD.vercel.app \
  --collect --output "$REPORT_DIR/report.json"
```

`--discover` first inspects same-user Linux processes for configs referenced by `worker.ts`/`worker.js` or `usage-sync.ts`/`usage-sync.js`. It excludes the temporary diagnostic checkout itself. If no valid running config is visible, it checks saved worker JSON files and relevant systemd/cron definitions in the user's home and common service locations. It can inspect one level of a static service launcher, but never sources it, runs it, or reads its environment files. Searches skip dependency caches, auth profiles, example configs and secret files, and report entry/depth limits and unreadable locations.

The report now includes host/user identity, process visibility counts, possible container isolation, saved config paths, and service references. A uniquely referenced service config may be selected after a complete search. Unreferenced saved files or ambiguous/incomplete results are reported for explicit selection rather than used to execute provider CLIs. `worker_config_not_found` means discovery couldn't locate a configuration in the accessible view; it does not establish that the real worker is stopped or missing. The Vercel read check runs even when worker discovery is blocked.

Use repeatable `--search-root /absolute/directory` flags to limit config discovery to known locations, including which running-process references may be selected. On Macs or when automatic selection is blocked, replace `--discover` with the exact existing worker JSON path shown in the report. This is a config file, not a provider credential file. Don't start or restart a worker merely to make discovery succeed.

Exit codes: **0** means all requested checks passed; **2** means the report contains a failure, blocked check or provider-unreported value; **1** means the diagnostic itself could not run. Exit 2 is expected while diagnosing this issue: send the report rather than attempting repairs. The output path must be new; reports are created with mode `0600` and existing files are never overwritten.

The JSON includes normalized account IDs, usage percentages, UTC reset dates, paid amounts and units, observation times, findings, and candidate process IDs/directories/service names. Raw API bodies, account labels, CLI output, credentials, process environments and full command lines are excluded. Process candidates are not proof that a process is publishing usage; short-lived scheduled publishers may be absent. Check timestamps: quota can change between the provider collection and the last dashboard refresh.

Interpretation:

| Finding | Meaning |
| --- | --- |
| `dashboard_mirror_missing_or_different` | The private worker isn't configured to mirror to the requested dashboard; another publisher may exist |
| `reset_mismatch` | A provider/control reset differs from the corresponding dashboard bucket |
| `paid_usage_missing` | The source reports paid usage but the dashboard doesn't |
| `source_paid_usage_not_reported` | The source supplied no paid records; this is unknown, not zero |
| `dashboard_account_unavailable` | Missing read access or a missing/mismatched destination account ID |
| `token_missing`, `http_401`, `http_403` | The service could not be inspected; other report sections may still be useful |
| `worker_config_not_found`, `worker_config_ambiguous` | Discovery could not select one running worker configuration |
| `worker_config_requires_selection` | Saved configs were found, but none could be selected safely from the available service/process evidence |

Send `report.json` back for analysis. Do not send environment files, service definitions, provider session files or raw provider responses. The diagnostic does not enable [usage mirroring](execution.md#a-separate-vercel-usage-dashboard); installing the fix is a separate maintenance step after identifying the active publisher.
