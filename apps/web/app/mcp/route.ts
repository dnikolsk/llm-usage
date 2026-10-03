import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '../../src/mcp';
import { access, limitedBody, json, failure } from '../../src/execution-http';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(request: Request) {
  if (!access(request,'job')) return json({error:'unauthorized'},401);
  const origin = request.headers.get('origin');
  const allowed = (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);
  if (origin && !allowed.includes(origin)) return json({error:'origin_forbidden'},403);
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try {
    const parsedBody = await limitedBody(request);
    await server.connect(transport);
    const response = await transport.handleRequest(request,{parsedBody});
    response.headers.set('Cache-Control','no-store');
    return response;
  } catch (error) { return failure(error); }
  finally { await server.close(); }
}
export async function GET() { return json({error:'method_not_allowed'},405); }
export async function DELETE() { return json({error:'method_not_allowed'},405); }
