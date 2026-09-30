import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LlmUsageClient } from "./client";
import { registerLlmUsageTools } from "./tools";

export const SERVER_INFO = { name: "llm-usage", version: "0.1.0" } as const;

export const SERVER_INSTRUCTIONS =
  "llm-usage tracks remaining capacity on Dimitriy's LLM subscriptions (Claude, Cursor, ChatGPT/Codex). " +
  "Use status for capacity percentages and resets, route for a quick deterministic pick by capability, and " +
  "route_task when you have a concrete task and want account, model and local/cloud placement. " +
  "All tools are read-only; a cloud handoff in route_task is a recommendation, never a launched job.";

export function createMcpServer(client: LlmUsageClient): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });
  registerLlmUsageTools(server, client);
  return server;
}
