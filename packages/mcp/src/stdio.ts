// stdio MCP server for local agent hosts (Claude, Cursor, Grok Bot via a local runner).
// Env: LLM_USAGE_READ_TOKEN (required), LLM_USAGE_BASE_URL (default https://llm-usage.vercel.app).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHttpClient } from "./client";
import { apiConfigFromEnv } from "./env";
import { createMcpServer } from "./server";

const server = createMcpServer(createHttpClient(apiConfigFromEnv()));
await server.connect(new StdioServerTransport());
