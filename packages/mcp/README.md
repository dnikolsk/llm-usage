# @llm-usage/mcp

Read-only stdio MCP server for llm-usage. It is a thin HTTP client to the deployed `/v1` API (default `https://llm-usage.vercel.app`), not a second backend. It exposes exactly three tools and has no ingest, write, or job-launching tools.

| Tool | API | Arguments |
|---|---|---|
| `status` | `GET /v1/status` | none |
| `route` | `GET /v1/route` | `capability` (required, e.g. `coding`, `chat`), `model_class` (optional) |
| `route_task` | `POST /v1/route` | `task` (required, 12–4000 chars), optional `project` (`{stage: new\|ongoing, current_account_id?, current_model?}`), `estimated_work` (`quick\|medium\|large`), `interaction_level` (`low\|high`), `needs_mac`, `repo_pushed`, `capability` (default `coding`) |

API responses are passed through unchanged; see [`docs/routing.md`](../../docs/routing.md) and [`openapi/openapi.yaml`](../../openapi/openapi.yaml). A `handoff` returned by `route_task` is a recommendation only. Nothing is launched.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `LLM_USAGE_READ_TOKEN` | yes | The service `READ_TOKEN`. The server exits 1 with a clear message if it is missing. Never use the write token. |
| `LLM_USAGE_BASE_URL` | no | Defaults to `https://llm-usage.vercel.app`. |

HTTP failures are returned as tool errors (`isError: true`) with the HTTP `status` and API error `code` (for example `401 unauthorized`, `503 jev_unavailable`). The token is never included in error text.

## Install

From the repository root, run `pnpm install`. Then run the server with:

```sh
LLM_USAGE_READ_TOKEN=... node /ABSOLUTE/PATH/llm-usage/packages/mcp/bin/llm-usage-mcp.mjs
```

### Cursor (`~/.cursor/mcp.json`) / Claude (`claude_desktop_config.json` or `.mcp.json`)

```json
{
  "mcpServers": {
    "llm-usage": {
      "command": "node",
      "args": ["/Users/you/Projects/llm-usage/packages/mcp/bin/llm-usage-mcp.mjs"],
      "env": {
        "LLM_USAGE_BASE_URL": "https://llm-usage.vercel.app",
        "LLM_USAGE_READ_TOKEN": "<read token>"
      }
    }
  }
}
```

For Claude Code: `claude mcp add llm-usage -e LLM_USAGE_READ_TOKEN=<read token> -- node /ABSOLUTE/PATH/llm-usage/packages/mcp/bin/llm-usage-mcp.mjs`.

Use an absolute path, because hosts do not start the server from the repository directory. `node` must be Node 22 or later; if the host cannot find it, use the absolute path from `which node`.

### Grok Bot (Product / AI Builder)

Register it as a custom stdio MCP server with `AddMcpServer`:

- **name:** `llm-usage`
- **command:** `node`
- **args:** `["/Users/dimitriynikolskiy/Projects/llm-usage/packages/mcp/bin/llm-usage-mcp.mjs"]`
- **env:** `LLM_USAGE_BASE_URL=https://llm-usage.vercel.app` (optional); supply `LLM_USAGE_READ_TOKEN` through the sensitive secret / `AuthenticateMcpServer` field, not in the plain config or the repository.

Then run `status`, `route` with `capability=coding`, and `route_task` to check the connection. Because the server calls production over HTTPS, no new Vercel deployment is needed.

## Develop

```sh
pnpm --filter @llm-usage/mcp test
pnpm --filter @llm-usage/mcp typecheck
pnpm --filter @llm-usage/mcp start   # stdio, needs LLM_USAGE_READ_TOKEN
```
