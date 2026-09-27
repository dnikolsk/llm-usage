#!/usr/bin/env node
// stdio entrypoint: `pnpm --filter @llm-usage/mcp exec llm-usage-mcp` or `node packages/mcp/bin/llm-usage-mcp.mjs`.
import { register } from "tsx/esm/api";

register();
await import("../src/stdio.ts");
