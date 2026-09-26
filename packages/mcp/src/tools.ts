import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ApiError, type LlmUsageClient, type TaskRouteRequest } from "./client";

/** The full, read-only tool surface. No ingest/write tools and nothing that launches jobs. */
export const LLM_USAGE_TOOL_NAMES = ["status", "route", "route_task"] as const;

function ok(structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
}

function fail(message: string, extra: Record<string, unknown> = {}): CallToolResult {
  const payload = { error: message, ...extra };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload, isError: true };
}

function describeError(err: unknown): CallToolResult {
  if (err instanceof ApiError) return fail(err.message, { status: err.status, ...(err.code ? { code: err.code } : {}) });
  return fail(err instanceof Error ? err.message : String(err));
}

async function run(fn: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return describeError(err);
  }
}

// Same filter shape the API enforces for GET /v1/route.
const filterSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/, "lowercase identifier, e.g. coding");

export function registerLlmUsageTools(server: McpServer, client: LlmUsageClient): void {
  server.registerTool(
    "status",
    {
      title: "LLM capacity status",
      description:
        "Current capacity for every tracked LLM subscription account (Claude, Cursor, ChatGPT/Codex): " +
        "usage buckets with remaining fractions, reset times (UTC), freshness/staleness, and health. " +
        "Use this to answer 'how much do I have left' without a coding task. Read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => run(() => client.status()),
  );

  server.registerTool(
    "route",
    {
      title: "Deterministic route",
      description:
        "Deterministic headroom picker (GET /v1/route): recommends the eligible account with the most remaining " +
        "capacity above reserves for a capability, with every candidate's eligibility and exclusions. " +
        "No task description needed. Read-only.",
      inputSchema: {
        capability: filterSchema.describe("Capability to route for, e.g. coding or chat"),
        model_class: filterSchema.optional().describe("Optional model class filter, e.g. high_reasoning"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ capability, model_class }) => run(() => client.route({ capability, model_class })),
  );

  server.registerTool(
    "route_task",
    {
      title: "Task-aware route (Jev)",
      description:
        "Task-aware recommendation (POST /v1/route): Jev judges difficulty, work size, interactivity and Mac " +
        "dependency; the service picks account + model and placement (local vs cloud) with reasons, warnings, " +
        "alternatives and candidates. A returned `handoff` is only a recommendation: nothing is launched. " +
        "Explicit fields override Jev's inferences. The task text is not stored by the service.",
      inputSchema: {
        task: z.string().min(12).max(4000).describe("What needs to be done (12–4000 chars)"),
        project: z
          .object({
            stage: z.enum(["new", "ongoing"]),
            current_account_id: z
              .string()
              .optional()
              .describe("Inventory id from status, e.g. claude-personal, cursor-personal, chatgpt-personal"),
            current_model: z
              .string()
              .optional()
              .describe("Task model id, e.g. claude-sonnet, claude-opus, gpt-6-sol, gpt-6-astra, cursor-auto"),
          })
          .strict()
          .optional()
          .describe("Project context; for ongoing work name the current account/model to prefer continuity"),
        estimated_work: z.enum(["quick", "medium", "large"]).optional(),
        interaction_level: z.enum(["low", "high"]).optional(),
        needs_mac: z.boolean().optional().describe("Task needs Mac resources (devices, Xcode, local sign-ins)"),
        repo_pushed: z.boolean().optional().describe("Repository is pushed, so cloud placement is possible"),
        capability: z.string().optional().describe("Capability, defaults to coding"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => {
      const request: TaskRouteRequest = Object.fromEntries(
        Object.entries(args).filter(([, v]) => v !== undefined),
      ) as unknown as TaskRouteRequest;
      return run(() => client.routeTask(request));
    },
  );
}
