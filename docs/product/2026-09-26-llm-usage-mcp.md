# llm-usage MCP connector

**Owner:** Product → AI Builder  
**Repo:** `github.com/dnikolsk/llm-usage`  
**Prod API:** `https://llm-usage.vercel.app`  
**Auth:** Bearer `READ_TOKEN` only (never WRITE_TOKEN, never TYPESAFE_API_KEY)

## Goal
Ship a thin MCP so Grok agents (Product primary, AI Builder secondary) can:
1. Check capacity %s with no coding task
2. Deterministic route (GET)
3. Jev task-aware route (POST)

## Tools

### `status`
- Maps to `GET /v1/status`
- No required args
- Returns accounts, remaining fractions, freshness, resets (pass through; trim nothing useful)

### `route`
- Maps to `GET /v1/route`
- Args: `capability` (required, e.g. `coding`|`chat`), optional `model_class`
- Deterministic headroom picker

### `route_task`
- Maps to `POST /v1/route`
- Args: `task` (required, 12–4000 chars), optional `project`, `estimated_work`, `interaction_level`, `needs_mac`, `repo_pushed`, `capability`
- Returns recommendation + handoff (handoff ≠ launched)

## Non-goals
- No ingest/write tools
- No dashboard password tools
- No launching cloud jobs
- Do not expose Jev key to the client

## Packaging / install for Grok Bot
Prefer whatever AI Builder already uses to add a **user-installable MCP/plugin** that Product and AI Builder can AuthenticateMcpServer against.
- Base URL configurable; default `https://llm-usage.vercel.app`
- Secret: `READ_TOKEN` (sensitive) via MCP auth / plugin setup field — never bake into repo
- If Grok Bot custom MCP = stdio server in-repo: add `packages/mcp` or `apps/mcp` with stdio JSON-RPC, env `LLM_USAGE_BASE_URL` + `LLM_USAGE_READ_TOKEN`
- Document install steps for Dimitriy (Product + AI Builder)

Land on the branch that **production / agents will actually use**. Current Vercel prod tracks `codex/jev-router` (not `main`). Either:
- PR into `codex/jev-router` for fast availability of any HTTP-served MCP metadata, OR
- Ship MCP as a local stdio package that does not depend on a new Vercel deploy (preferred if MCP is stdio-only — then only need the package on Mac / in the plugin bundle)

**Prefer stdio MCP package in-repo** so Product can test without waiting on Vercel, as long as it calls prod HTTPS with the read token.

## Build method
Claude CLI latest Opus on Mac mini at `/Users/dimitriynikolskiy/Projects/llm-usage`. GitHub PR (not Origin).

## Done when
1. MCP package exists with the three tools
2. Documented how to install for Grok Bot Product + AI Builder
3. AI Builder pings Product with install path / plugin id / config
4. Product runs live tests: status, route(coding), route_task(small), route_task(large+mac) — confirms shapes match API
5. Optional: tiny Product skill `llm-usage-route` that says when to call which tool (Product can author skill after MCP works)

## Test vectors Product will run after install
- status → see Claude/Cursor/ChatGPT rows
- route capability=coding → recommendation
- route_task “Fix a typo in the README title” → local quick_local-ish
- route_task needs_mac large → local
- bad/missing token → clear error, no secret echo
