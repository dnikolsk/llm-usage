# Routing v1

Filter enabled accounts, capability/model class, health, freshness, bucket exhaustion, reserves, and buckets whose reset has already passed. Among eligible accounts, maximize the smallest applicable remaining fraction above its reserve. If capacities are within five percentage points, prefer the account with a sooner reset within two hours; priority breaks further ties. Return every candidate's eligibility and inputs. Unknown measured capacity is not eligible; an account without a bucket for a requested model scope may not claim capacity for it.

## Task-aware routing

`POST /v1/route` accepts a task description and up to six optional context fields. It uses the same read bearer token as the GET endpoint. The Jev key is a separate `TYPESAFE_API_KEY` server environment variable. It must never be sent by callers or returned in responses. The service does not store the task description or Jev response.

```json
{
  "task": "Continue implementing the iPhone widget and verify it on the connected device",
  "project": {"stage": "ongoing", "current_account_id": "openai-personal", "current_model": "gpt-6-sol"},
  "estimated_work": "medium",
  "interaction_level": "high",
  "needs_mac": true,
  "repo_pushed": true,
  "capability": "coding"
}
```

Jev makes four narrow judgments in one call: difficulty, work size, likely interactivity, and whether Mac resources are needed. Explicit caller fields override inferred work size, interactivity, or Mac dependency. The service applies hard eligibility and quality checks in code, then prefers an ongoing project's current account and model when it can finish the estimated work. A quick continuation can use a small reserved tail, but never an exhausted or stale bucket. For new short work, a positive renewal-pace surplus is favored; large work requires more headroom. These fractional work estimates are heuristics, not token forecasts.

Placement is decided last. Mac-dependent or interactive work stays local. A large, mostly unattended task with a pushed repository can be recommended for cloud execution. The response includes an unstarted cloud handoff, alternatives, exclusion reasons, and warnings for weak Jev confidence or unknown renewal pace. The endpoint does not launch cloud jobs. If Jev is unavailable, it returns `503 jev_unavailable` rather than labeling a deterministic fallback as a Jev decision. `GET /v1/route` retains its original contract.
