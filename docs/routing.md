# Routing v1

Filter enabled accounts, capability/model class, health, freshness, bucket exhaustion, reserves, and buckets whose reset has already passed. Among eligible accounts, maximize the smallest applicable remaining fraction above its reserve. If capacities are within five percentage points, prefer the account with a sooner reset within two hours; priority breaks further ties. Return every candidate's eligibility and inputs. Unknown measured capacity is not eligible; an account without a bucket for a requested model scope may not claim capacity for it.

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

### Quality floor

One rule applies to every task, whether it runs on the Mac or in the cloud: when Jev difficulty is **≥ 1.75** (on its 0–3 scale), only `advanced`-tier models (`claude-opus`, `gpt-6-astra`, `gemini-pro`) are eligible and general-tier rows carry `quality_below_task`. Below 1.75, general-tier models are preferred everywhere, so the same large task may be recommended Sonnet on the Mac and Sonnet in the cloud, never Sonnet on one and Opus on the other. `reason.quality_floor` reports `advanced` or `general`.

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
| `unattended_large_job` | cloud | large unattended work, pushed repo, Jev confidence ≥ 0.5 |

Only `unattended_large_job` returns `execution=cloud` and an unstarted `handoff`. The endpoint does not launch cloud jobs.

### Warnings

- `low_jev_confidence`: Jev confidence is below 0.6. Below 0.5 it also blocks cloud placement.
- `continuity_account_unknown`: an ongoing project names no current account, or one not in the inventory.
- `continuity_model_unknown`: `current_model` is not a task model of the named account.
- `continuity_ineligible`: the account (and model) are known but cannot take the work (exhausted, reserves, stale, `quality_below_task`, or insufficient capacity).
- `renewal_pace_unknown`: the winner has no bucket with a known window, so renewal pace was not used.

In every continuity warning case, `reason.project_continuity` is `false`.

### Candidates

`candidates` lists one row per account and task model, with `model_id`, `model_label`, `model_class`, `tier`, `estimated_need`, `pace_surplus`, `continuation`, and the GET candidate fields. Accounts with no routable task model (for example, a model class that the task router does not map) appear as one account-level row with `model_id`, `model_label`, `model_class`, and `tier` set to `null`, `eligible=false`, and their GET exclusions plus `model_class_unsupported`. That way the response always explains why every account lost, such as `exhausted` or `reserve:weekly`. If Jev is unavailable, it returns `503 jev_unavailable` rather than labeling a deterministic fallback as a Jev decision. `GET /v1/route` retains its original contract.
