import type { Run } from '../types';
import { jsonLines } from '../types';
export const loginArgs=['login','--device-auth'];
export async function authenticated(run:Run) {
  const result=await run(['login','status']);
  return result.code===0 && /logged in using chatgpt/i.test(result.stdout+'\n'+result.stderr);
}
export function localArgs(session?:string) {
  const args=['exec','--json','-c','approval_policy="never"','-c','cli_auth_credentials_store="file"'];
  if(session) return [...args,'-c','sandbox_mode="workspace-write"','resume',session,'-'];
  return [...args,'--sandbox','workspace-write','-'];
}
export function localResult(stdout:string) {
  const events=jsonLines(stdout);
  const session=events.find(e=>e.type==='thread.started')?.thread_id;
  const complete=events.some(e=>e.type==='turn.completed');
  const messages=events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').map(e=>e.item.text);
  return {complete,session:typeof session==='string'?session:undefined,summary:messages.join('\n').slice(-12_000)};
}
export function cloudTaskUrl(stdout:string) {
  return stdout.split(/\s+/).find(s=>/^https:\/\/chatgpt\.com\/codex\/tasks\/task_[a-zA-Z0-9_-]+$/.test(s));
}
export function cloudState(stdout:string) {
  return /^\[(READY|APPLIED)\]/m.test(stdout)?'ready':/^\[ERROR\]/m.test(stdout)?'failed':/^\[PENDING\]/m.test(stdout)?'pending':'unknown';
}
