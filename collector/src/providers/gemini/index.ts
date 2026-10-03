import {access} from 'node:fs/promises';
import {join} from 'node:path';
import type {Run} from '../types';
export const loginArgs:string[]=[];
/**
 * Gemini CLI has no auth-status command and every prompt consumes quota, so readiness is the presence of the
 * service-issued credential file the worker writes before each check. The CLI's HOME is the account's auth_dir.
 */
export async function authenticated(_run:Run,authDir?:string){
  if(!authDir)return false;
  try{await access(join(authDir,'.gemini','oauth_creds.json'));return true;}catch{return false;}
}
export function localArgs(_session?:string){
  // Prompt arrives on stdin; edits are auto-approved inside the sandboxed task clone, never shell commands.
  return ['--prompt','','--approval-mode','auto_edit','--output-format','json'];
}
export function localResult(stdout:string){
  const start=stdout.indexOf('{');
  try{
    const parsed=JSON.parse(start>=0?stdout.slice(start):stdout) as {response?:unknown;session_id?:unknown;error?:unknown};
    const summary=typeof parsed.response==='string'?parsed.response.slice(-12_000):'';
    return{complete:!parsed.error&&typeof parsed.response==='string',session:typeof parsed.session_id==='string'?parsed.session_id:undefined,summary};
  }catch{return{complete:false,session:undefined,summary:''};}
}
