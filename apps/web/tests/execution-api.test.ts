import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('../src/execution-store',()=>({
  ExecutionError:class extends Error{},workerResult:undefined,
  listExecutionAccounts:vi.fn(),planTask:vi.fn(),submitJob:vi.fn(),getJob:vi.fn(),cancelJob:vi.fn(),
}));
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../src/mcp';
import {POST as MCP} from '../app/mcp/route';
import {access,limitedBody} from '../src/execution-http';
import * as store from '../src/execution-store';
beforeEach(()=>{process.env.JOB_TOKEN='j'.repeat(40);process.env.ADMIN_TOKEN='a'.repeat(40);process.env.WORKER_TEST_WORKER_TOKEN='w'.repeat(40);});
afterEach(()=>{delete process.env.JOB_TOKEN;delete process.env.ADMIN_TOKEN;delete process.env.WORKER_TEST_WORKER_TOKEN;vi.clearAllMocks();});
describe('execution auth and MCP',()=>{
 it('separates submission, administration and worker identities',()=>{
  const req=new Request('http://localhost',{headers:{Authorization:`Bearer ${process.env.JOB_TOKEN}`}});
  expect(access(req,'job')).toBe(true);expect(access(req,'admin')).toBe(false);expect(access(req,'worker')).toBe(false);
  const worker=new Request('http://localhost',{headers:{Authorization:`Bearer ${process.env.WORKER_TEST_WORKER_TOKEN}`,'X-Worker-Id':'test-worker'}});
  expect(access(worker,'worker')).toBe(true);
  expect(access(new Request(worker,{headers:{Authorization:`Bearer ${process.env.WORKER_TEST_WORKER_TOKEN}`,'X-Worker-Id':'other-worker'}}),'worker')).toBe(false);
 });
 it('bounds streamed request size rather than trusting Content-Length',async()=>{
  const r=new Request('http://localhost',{method:'POST',body:'x'.repeat(65537)});
  await expect(limitedBody(r)).rejects.toThrow();
 });
 it('requires a bearer token before MCP processing',async()=>{
  expect((await MCP(new Request('http://localhost/mcp',{method:'POST',body:'{}'}))).status).toBe(401);
 });
 it('rejects unapproved browser origins even with a valid token',async()=>{
  expect((await MCP(new Request('http://localhost/mcp',{method:'POST',headers:{Authorization:`Bearer ${process.env.JOB_TOKEN}`,Origin:'https://other.example'},body:'{}'}))).status).toBe(403);
 });
 it('serves protocol initialization over stateless Streamable HTTP',async()=>{
  const r=await MCP(new Request('http://localhost/mcp',{method:'POST',headers:{Authorization:`Bearer ${process.env.JOB_TOKEN}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}})}));
  expect(r.status).toBe(200);expect((await r.json()).result.serverInfo.name).toBe('subscription-workers');
 });
 it('uses the same planner and queue through a real MCP SDK client',async()=>{
  vi.mocked(store.planTask).mockResolvedValue({outcome:'waiting',steps:[],candidates:[],selected:null,generated_at:new Date().toISOString(),spending_approval_required:false});
  vi.mocked(store.submitJob).mockResolvedValue({id:'job'});
  const server=createMcpServer();const client=new Client({name:'test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{
   const tools=await client.listTools();expect(tools.tools.map(t=>t.name)).toEqual(['list_accounts','plan_task','submit_task','get_task','cancel_task']);
   await client.callTool({name:'plan_task',arguments:{repository:'test-repo'}});
   expect(store.planTask).toHaveBeenCalledWith(expect.objectContaining({repository:'test-repo',execution:'auto'}));
   await client.callTool({name:'submit_task',arguments:{repository:'test-repo',prompt:'Fix tests',idempotency_key:'test-request-key-123'}});
   expect(store.submitJob).toHaveBeenCalledWith(expect.objectContaining({prompt:'Fix tests'}),'test-request-key-123');
  }finally{await client.close();await server.close();}
 });
});
