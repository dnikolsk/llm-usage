import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { ApiError, createHttpClient, type LlmUsageClient, type RouteQuery, type TaskRouteRequest } from "../src/client";
import { createMcpServer } from "../src/server";
import { LLM_USAGE_TOOL_NAMES } from "../src/tools";

const STATUS = {
  generated_at: "2026-09-26T12:00:00Z",
  accounts: [
    { id: "claude-personal", provider: "anthropic", stale: false, buckets: [{ kind: "weekly", remaining_fraction: 0.62, resets_at: "2026-09-29T00:00:00Z" }] },
    { id: "cursor-personal", provider: "cursor", stale: false, buckets: [{ kind: "monthly", remaining_fraction: 0.3, resets_at: "2026-10-01T00:00:00Z" }] },
  ],
};

function fakeClient() {
  const seen: { route: RouteQuery[]; routeTask: TaskRouteRequest[] } = { route: [], routeTask: [] };
  const client: LlmUsageClient = {
    async status() {
      return STATUS;
    },
    async route(query) {
      seen.route.push(query);
      return { recommended: { account_id: "claude-personal" }, candidates: [] };
    },
    async routeTask(request) {
      seen.routeTask.push(request);
      return {
        decision_source: "jev",
        recommended: { account_id: "claude-personal", model_id: "claude-sonnet", execution: "local" },
        reason: { execution_reason: "quick_local" },
        handoff: null,
      };
    },
  };
  return { client, seen };
}

async function connect(client: LlmUsageClient) {
  const server = createMcpServer(client);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return mcp;
}

const call = async (mcp: Client, name: string, args: Record<string, unknown> = {}) =>
  (await mcp.callTool({ name, arguments: args })) as CallToolResult;

describe("llm-usage MCP tools", () => {
  it("exposes exactly status, route and route_task — no write/ingest tools", async () => {
    const mcp = await connect(fakeClient().client);
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["route", "route_task", "status"]);
    expect([...LLM_USAGE_TOOL_NAMES].sort()).toEqual(names);
    expect(names.some((n) => /ingest|write|launch|delete|update|create/.test(n))).toBe(false);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("status passes the API payload through", async () => {
    const mcp = await connect(fakeClient().client);
    const result = await call(mcp, "status");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(STATUS);
  });

  it("route forwards capability and model_class", async () => {
    const { client, seen } = fakeClient();
    const mcp = await connect(client);
    const result = await call(mcp, "route", { capability: "coding", model_class: "high_reasoning" });
    expect(result.isError).toBeFalsy();
    expect(seen.route).toEqual([{ capability: "coding", model_class: "high_reasoning" }]);
    expect((result.structuredContent as { recommended: { account_id: string } }).recommended.account_id).toBe("claude-personal");
  });

  it("route requires capability", async () => {
    const { client, seen } = fakeClient();
    const mcp = await connect(client);
    const result = await call(mcp, "route", {});
    expect(result.isError).toBe(true);
    expect(seen.route).toHaveLength(0);
  });

  it("route_task forwards only provided fields", async () => {
    const { client, seen } = fakeClient();
    const mcp = await connect(client);
    const args = {
      task: "Continue implementing the iPhone widget and verify it on the connected device",
      project: { stage: "ongoing", current_account_id: "chatgpt-personal", current_model: "gpt-6-sol" },
      estimated_work: "large",
      interaction_level: "high",
      needs_mac: true,
      repo_pushed: true,
      capability: "coding",
    };
    const result = await call(mcp, "route_task", args);
    expect(result.isError).toBeFalsy();
    expect(seen.routeTask).toEqual([args]);

    await call(mcp, "route_task", { task: "Fix a typo in the README title" });
    expect(seen.routeTask[1]).toEqual({ task: "Fix a typo in the README title" });
  });

  it("route_task validates task length and enums before calling the API", async () => {
    const { client, seen } = fakeClient();
    const mcp = await connect(client);
    expect((await call(mcp, "route_task", { task: "too short" })).isError).toBe(true);
    expect((await call(mcp, "route_task", { task: "x".repeat(4001) })).isError).toBe(true);
    expect((await call(mcp, "route_task", { task: "A long enough task", estimated_work: "huge" })).isError).toBe(true);
    expect(seen.routeTask).toHaveLength(0);
  });

  it("HTTP errors surface as isError with status and no token", async () => {
    const token = "tok-should-never-leak-0123456789";
    const http = createHttpClient({
      baseUrl: "https://usage.example",
      token,
      fetchImpl: (async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })) as typeof fetch,
    });
    const mcp = await connect(http);
    for (const [name, args] of [
      ["status", {}],
      ["route", { capability: "coding" }],
      ["route_task", { task: "Fix a typo in the README title" }],
    ] as const) {
      const result = await call(mcp, name, args);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ status: 401, code: "unauthorized" });
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });

  it("non-API errors still produce isError results", async () => {
    const { client } = fakeClient();
    client.status = async () => {
      throw new ApiError(503, "llm-usage API GET /v1/status failed with HTTP 503", "unavailable");
    };
    const mcp = await connect(client);
    const result = await call(mcp, "status");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: 503 });
  });
});
