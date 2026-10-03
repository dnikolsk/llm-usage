import type {Run} from '../types';
import {jsonLines} from '../types';
export const loginArgs=['login'];
export async function authenticated(run:Run,_authDir?:string) {
  const result=await run(['status','--format','json']);
  try {
    const status=JSON.parse(result.stdout);
    if(result.code!==0 || status.isAuthenticated!==true || status.hasAccessToken!==true) return false;
  }catch{return false;}
  // Cursor status reports authenticated even when getMe fails. The official
  // models command checks backend credentials (and refreshes through the CLI)
  // without running an inference task or using an API-key fallback.
  const models=await run(['models']);
  return models.code===0 && /Available models/.test(models.stdout);
}
export function localArgs(session?:string) {
  return ['-p','--output-format','stream-json','--sandbox','enabled','--trust',...(session?['--resume',session]:[])];
}
export function localResult(stdout:string) {
  const result=jsonLines(stdout).reverse().find(e=>e.type==='result');
  return {complete:result?.subtype==='success'&&!result.is_error,session:result?.session_id as string|undefined,
    summary:typeof result?.result==='string'?result.result.slice(-12_000):''};
}
