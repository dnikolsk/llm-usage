import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { taskSpec, jobRequest } from '@llm-usage/core';
import { listExecutionAccounts, planTask, submitJob, getJob, cancelJob, ExecutionError } from './execution-store';
export function createMcpServer() {
  const server = new McpServer({name:'subscription-workers',version:'0.1.0'});
  const wrap = async (fn: () => Promise<unknown>) => {
    try { return {content:[{type:'text' as const,text:JSON.stringify(await fn())}]}; }
    catch (error) { return {isError:true,content:[{type:'text' as const,text:error instanceof ExecutionError ? error.code : 'service_unavailable'}]}; }
  };
  server.registerTool('list_accounts',{description:'List registered subscription accounts and execution targets. Registration does not mean logged in.',
    inputSchema:{},annotations:{readOnlyHint:true}},()=>wrap(listExecutionAccounts));
  server.registerTool('plan_task',{description:'Explain each routing step: explicit provider/account, scope, login, billing, existing work, setup, remaining quota, and reset time. Does not execute.',
    inputSchema:taskSpec,annotations:{readOnlyHint:true}},input=>wrap(()=>planTask(input)));
  server.registerTool('submit_task',{description:'Queue an authorized coding task. Can edit repositories through an official CLI. Reuse the same idempotency_key for retries. No paid API fallback; no automatic replay after uncertain execution.',
    inputSchema:jobRequest.extend({idempotency_key:z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/)}),
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:true}},input=>{
      const {idempotency_key,...request}=input; return wrap(()=>submitJob(request,idempotency_key));
    });
  server.registerTool('get_task',{description:'Read task status, routing explanation and result.',inputSchema:{job_id:z.uuid()},annotations:{readOnlyHint:true}},
    input=>wrap(()=>getJob(input.job_id)));
  server.registerTool('cancel_task',{description:'Request cancellation. Running jobs stop cooperatively; uncertain or provider-cloud work may require review.',
    inputSchema:{job_id:z.uuid()},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true}},input=>wrap(()=>cancelJob(input.job_id)));
  return server;
}
