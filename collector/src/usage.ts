import type {IngestSnapshot} from '@llm-usage/core';
import type {Target} from './providers/types';
import {readUsage as codex} from './providers/codex/usage';
import {readUsage as claude} from './providers/claude/usage';
import {readUsage as cursor} from './providers/cursor/usage';
const readers={openai:codex,anthropic:claude,cursor};
const diagnostics=new Set(['usage_auth_required','usage_rate_limited','usage_http_error','usage_empty_response','usage_response_too_large',
  'usage_credentials_missing','usage_invalid_json','usage_schema_unrecognized','usage_credential_store_unsupported','usage_subscription_login_required']);
export async function collectUsage(target:Target):Promise<{allowed:boolean|null;snapshot:IngestSnapshot}>{
  try{return await readers[target.provider](target);}
  catch(error){
    const message=(error as {code?:string})?.code==='ENOENT'?'usage_credentials_missing':error instanceof Error?error.message:'';
    return{allowed:null,snapshot:{account_id:target.account_id,provider:target.provider,observed_at:new Date().toISOString(),status:'error',limits:[],
      metadata:{diagnostic_code:diagnostics.has(message)?message:'usage_unavailable'}}};
  }
}
