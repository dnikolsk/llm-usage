import type {Run} from '../types';
import {jsonLines} from '../types';
export const loginArgs=['auth','login','--claudeai'];
export async function authenticated(run:Run,_authDir?:string) {
  const result=await run(['auth','status','--json']);
  if(result.code!==0)return false;
  try {const status=JSON.parse(result.stdout);return status.loggedIn===true && status.authMethod==='claude.ai';}catch{return false;}
}
export function localArgs(session?:string) {
  return ['-p','--output-format','stream-json','--verbose','--permission-mode','acceptEdits',...(session?['--resume',session]:[])];
}
export function localResult(stdout:string) {
  const result=jsonLines(stdout).reverse().find(e=>e.type==='result');
  return {complete:result?.subtype==='success' && !result.is_error,session:result?.session_id as string|undefined,
    summary:typeof result?.result==='string'?result.result.slice(-12_000):''};
}
