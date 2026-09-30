# Routing v1

Filter enabled accounts, capability/model class, health, freshness, bucket exhaustion, reserves, and buckets whose reset has already passed. Among eligible accounts, maximize the smallest applicable remaining fraction above its reserve. If capacities are within five percentage points, prefer the account with a sooner reset within two hours; higher account priority breaks further ties, followed by capacity and account ID. The core function also supports an explicit preference list; the web API currently loads reserve settings only. Return every candidate's eligibility and inputs. Default reserves are 10% for `session`, 15% for `weekly`, and zero for other bucket kinds. The default policy row for owner `personal` can override reserves in `routing_policies.configuration_json`. Both GET filters (`capability`, `model_class`) are optional; without a model-class filter, all account buckets apply. Unknown measured capacity is not eligible; an account without a bucket for a requested model scope may not claim capacity for it.

## Task-aware routing

`POST /v1/route` accepts a task description and up to six optional context fields. It uses the same read bearer token as the GET endpoint. The Jev key is a separate `TYPESAFE_API_KEY` server environment variable. It must never be sent by callers or returned in responses. The service does not store the task description or Jev response.

```json
{
  "task": "Continue implementing the iPhone widget and verify it on the connected device",
  "project": {"stage": "ongoing", "current_account_id": "chatgpt-personal", "current_model": "gpt-6-sol"},
  "estimated_work": "medium",
  "interaction_level": "high",
  "needs_mac": true,
  "repo_pushed": true,
  "capability": "coding"
}
```

Jev makes four narrow judgments in one call: difficulty, work size, likely interactivity, and whether Mac resources are needed. Explicit caller fields override inferred work size, interactivity, or Mac dependency. The service applies hard eligibility and quality checks in code, then prefers an ongoing project's current account and model when it can finish the estimated work. A quick continuation can use a small reserved tail, but never an exhausted or stale bucket. For new short work, a positive renewal-pace surplus is favored; large work requires more headroom. These fractional work estimates are heuristics, not token forecasts.

`project.current_account_id` must be an inventory id from `GET /v1/status` (for example `claude-personal`, `cursor-personal`, `chatgpt-personal`, `google-ai-pro-personal`), and `current_model` a task model id (`claude-sonnet`, `claude-opus`, `gpt-6-sol`, `gpt-6-astra`, `cursor-auto`, `cursor-other-models`, `gemini-flash`, `gemini-pro`).

OpenAI task models (`gpt-6-astra`, `gpt-6-sol`) use class `work_codex` (ChatGPT / Codex subscription only — never Cursor cloud or `other_models`). Claude (`claude-opus`, `claude-sonnet`) uses `high_reasoning`, not Cursor `other_models`. Cursor's own models use `cursor_models`; `cursor-other-models` is the `other_models` pool alias (Fable bills that pool but is not a routable quality-ladder id). Accounts must carry the same `model_classes` in inventory. See [providers](providers.md#subscription-billing-buckets).

### Quality floor

One rule applies to every task, whether it runs on the Mac or in the cloud: when Jev difficulty is **≥ 1.75** (on its 0–3 scale), only `advanced`-tier models (`gpt-6-astra`, `claude-opus`, `gpt-6-sol`, `gemini-pro`) are eligible and general-tier rows carry `quality_below_task`. Below 1.75, general-tier models are preferred after continuity (including over advanced Sol); advanced models remain eligible. Placement does not change the model-selection rules, so identical inputs and account state select the same model whether placement ends up local or cloud. `reason.quality_floor` reports `advanced` or `general`.

### Advanced quality ranks

Among eligible advanced models, a fixed quality ladder beats renewal pace: **`gpt-6-astra` > `claude-opus` > `gpt-6-sol`**. This comparison runs after continuity and the large-work capacity comparison below; when those do not decide, Astra beats Opus even if Opus has a richer `pace_surplus`. Unranked advanced models (for example `gemini-pro`) fall through to the usual pace and capacity tie-breaks against ranked peers.

### Capacity, pace, and selection order

Estimated work requires at least 0.03 (`quick`), 0.10 (`medium`), or 0.25 (`large`) usable capacity after reserves. Without an override, Jev work-size scores below 0.65 mean quick, below 1.45 mean medium, and otherwise mean large. A quick continuation can waive reserves only when reserve exclusions are its only exclusions and at least 0.03 raw capacity remains.

Eligible model rows are compared in this order:

1. Prefer a continuation on the current account, restricted to `current_model` when supplied.
2. Below the advanced difficulty floor, prefer general tier.
3. For large work, prefer greater usable capacity if the gap exceeds 0.15.
4. Between two explicitly ranked advanced models, prefer the higher quality rank.
5. Prefer greater pace surplus if the gap exceeds 0.03 (unknown pace is compared as -1).
6. Prefer greater usable capacity if the gap exceeds 0.03, then higher account priority, then account/model ID alphabetically.

Pace surplus is remaining fraction minus the fraction of the window's time still left, taking the minimum over applicable buckets with known remaining capacity, reset, and window start or duration. Positive surplus means capacity is ahead of that linear pace. Buckets without enough timing information do not contribute. A missing reset alone does not exclude an otherwise measured bucket from routing.

### Placement

Placement is decided last, and `reason.execution_reason` names the rule that decided it. Rules are checked in this order:

| `execution_reason` | `execution` | When |
|---|---|---|
| `mac_dependencies` | local | `needs_mac` (explicit, or Jev ≥ 0.7) |
| `interactive_work` | local | `interaction_level=high` (explicit, or Jev ≥ 0.7) |
| `quick_local` | local | quick work; small tasks default to local |
| `short_or_medium_work` | local | medium work |
| `repository_not_ready_for_cloud` | local | large unattended work, but `repo_pushed` is not `true` |
| `low_jev_confidence` | local | large unattended work with a pushed repo, but Jev confidence < 0.5 |
| `unattended_large_job` | cloud | large unattended work, pushed repo, Jev confidence ≥ 0.5 (or null) |

The core accepts null confidence and does not treat it as low; the current Jev HTTP adapter requires numeric difficulty/work-size confidences and uses their minimum.

Only `unattended_large_job` returns `execution=cloud` and an unstarted `handoff`. The endpoint does not launch cloud jobs.

### Warnings

- `low_jev_confidence`: Jev confidence is below 0.6. Below 0.5 it also blocks cloud placement.
- `continuity_account_unknown`: an ongoing project supplies a model without an account, or names an account absent from inventory. Omitting both continuity fields does not warn.
- `continuity_model_unknown`: `current_model` is not a task model of the named account.
- `continuity_ineligible`: the account (and model) are known but cannot take the work (exhausted, reserves, stale, `quality_below_task`, or insufficient capacity).
- `renewal_pace_unknown`: none of the winner’s applicable buckets has enough timing and capacity information to calculate pace.

With a continuity warning, `reason.project_continuity` is `false` when there is a winner; if no account is eligible, `reason` is null.

### Candidates

`candidates` lists one row per account and task model, with `model_id`, `model_label`, `model_class`, `tier`, `estimated_need`, `pace_surplus`, `continuation`, and the GET candidate fields. Accounts with no routable task model (for example, a model class that the task router does not map) appear as one account-level row with `model_id`, `model_label`, `model_class`, and `tier` set to `null`, `eligible=false`, and their GET exclusions plus `model_class_unsupported`. That way the response always explains why every account lost, such as `exhausted` or `reserve:weekly`. If Jev is unavailable, it returns `503 jev_unavailable` rather than labeling a deterministic fallback as a Jev decision. `GET /v1/route` retains its original contract.

## API checks and errors

Both endpoints require the service read bearer token. A request with no eligible account still returns HTTP 200 with `recommended` and `reason` set to null; POST also returns a null `handoff`. Inspect `candidates` for exclusions.

After loading the local environment and setting a real `TYPESAFE_API_KEY` on the web service:

```sh
curl --fail-with-body -X POST http://localhost:3000/v1/route \
  -H "Authorization: Bearer $READ_TOKEN" -H 'Content-Type: application/json' \
  -d '{"task":"Fix a typo in the README title","estimated_work":"quick"}'
```

The trimmed task must be 12–4000 characters; unknown body fields are rejected. GET invalid filters return `400 invalid_filter`; malformed or invalid POST bodies return `400 invalid_request`. Missing/invalid read authentication returns `401 unauthorized`. Storage failures return `503 service_unavailable`; missing Jev configuration, invalid Jev responses, timeouts, and upstream failures return `503 jev_unavailable`. The dashboard's coding recommendation uses deterministic GET-style routing and does not require Jev.
