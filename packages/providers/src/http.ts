import {createHash,randomBytes} from 'node:crypto';
import type {Deps} from './types';

export const diagnostics=new Set(['usage_auth_required','usage_rate_limited','usage_http_error','usage_empty_response','usage_response_too_large',
  'usage_invalid_json','usage_schema_unrecognized','usage_subscription_login_required','usage_unavailable','enrollment_rejected','enrollment_pending','enrollment_state_mismatch','enrollment_input_invalid']);
export const diagnosticCode=(error:unknown)=>error instanceof Error&&diagnostics.has(error.message)?error.message:'usage_unavailable';

/** Fixed provider HTTPS origins only, redirects disabled, bounded bodies. Bodies are never surfaced to callers. */
export async function providerJson(url:string,init:RequestInit,deps:Deps={},limit=262144):Promise<unknown>{
  const send=deps.fetch??fetch;
  const response=await send(url,{...init,redirect:'error',signal:AbortSignal.timeout(15_000)});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error(response.status===401||response.status===403?'usage_auth_required':response.status===429?'usage_rate_limited':'usage_http_error');}
  const reader=response.body?.getReader();if(!reader)throw new Error('usage_empty_response');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new Error('usage_response_too_large');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('usage_invalid_json');}
}

/** Token endpoints answer 400 for a rejected code/refresh token; that is an authorization failure, not a transport one. */
export async function tokenJson(url:string,init:RequestInit,deps:Deps={}):Promise<unknown>{
  const send=deps.fetch??fetch;
  const response=await send(url,{...init,redirect:'error',signal:AbortSignal.timeout(15_000)});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error(response.status===400||response.status===401||response.status===403?'enrollment_rejected':response.status===429?'usage_rate_limited':'usage_http_error');}
  const text=await response.text();
  if(text.length>65_536)throw new Error('usage_response_too_large');
  try{return JSON.parse(text);}catch{throw new Error('usage_invalid_json');}
}

export function pkce(deps:Deps={}){
  const random=deps.random??randomBytes;
  const verifier=random(32).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const state=random(24).toString('base64url');
  return{verifier,challenge,state};
}

/** Read a JWT payload without verifying it; used only for non-secret identifiers and expiry hints. */
export function jwtPayload(token:string):Record<string,unknown>{
  const parts=token.split('.');if(parts.length<2)return{};
  try{const parsed=JSON.parse(Buffer.from(parts[1]!,'base64url').toString('utf8'));return parsed&&typeof parsed==='object'?parsed as Record<string,unknown>:{};}catch{return{};}
}
export const expiryFromJwt=(token:string)=>{const exp=jwtPayload(token).exp;return typeof exp==='number'&&Number.isFinite(exp)?exp*1000:null;};
