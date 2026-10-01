import type {Run} from '../types';
import {jsonLines} from '../types';
export const loginArgs=['login'];
export async function authenticated(run:Run) {
  const result=await run(['status','--format','json']);
  try {const status=JSON.parse(result.stdout);return result.code===0 && status.isAuthenticated===true && status.hasAccessToken===true;}catch{return false;}
}
export function localArgs(session?:string) {
  return ['-p','--output-format','stream-json','--sandbox','enabled',...(session?['--resume',session]:[])];
}
export function localResult(stdout:string) {
  const result=jsonLines(stdout).reverse().find(e=>e.type==='result');
  return {complete:result?.subtype==='success'&&!result.is_error,session:result?.session_id as string|undefined,
    summary:typeof result?.result==='string'?result.result.slice(-12_000):''};
}
