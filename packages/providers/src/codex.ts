import {z} from 'zod';
import {ingestSnapshot} from '@llm-usage/core';
import {grant,type Grant,type Observer,type PendingEnrollment,type Deps,type Platform} from './types';
import {expiryFromJwt,jwtPayload,pkce,providerJson,tokenJson} from './http';

/** The public OAuth client and endpoints used by the Codex CLI itself. */
export const clientId='app_EMoamEEZ73f0CkXaXp7hrann';
export const authorizeUrl='https://auth.openai.com/oauth/authorize';
export const tokenUrl='https://auth.openai.com/oauth/token';
/** The CLI's loopback callback. The service cannot receive it, so the person pastes the redirected URL instead. */
export const redirectUri='http://localhost:1455/auth/callback';
export const usageUrl='https://chatgpt.com/backend-api/wham/usage';
const scopes='openid profile email offline_access';

const window=z.object({used_percent:z.number().finite().min(0).max(100),limit_window_seconds:z.number().int().positive().nullable().optional(),
  reset_after_seconds:z.number().finite().nonnegative().nullable().optional(),reset_at:z.number().finite().nonnegative().nullable().optional()}).loose();
const rateLimit=z.object({allowed:z.boolean().nullable().optional(),limit_reached:z.boolean().nullable().optional(),
  primary_window:window.nullable().optional(),secondary_window:window.nullable().optional()}).loose();
const usageResponse=z.object({plan_type:z.string().nullable().optional(),rate_limit:rateLimit.nullable().optional(),
  rate_limits:z.record(z.string(),rateLimit).nullable().optional(),credits:z.unknown().optional()}).loose();
const creditSchema=z.object({has_credits:z.boolean().optional(),unlimited:z.boolean().optional(),balance:z.union([z.string().regex(/^\d+(?:\.\d+)?$/),z.number().finite().nonnegative()]).transform(Number).nullable().optional()}).loose();

export function normalizeUsage(raw:unknown,accountId:string,now=new Date()){
  const data=usageResponse.parse(raw);
  const entries=data.rate_limits&&Object.keys(data.rate_limits).length?Object.entries(data.rate_limits):data.rate_limit?[['codex',data.rate_limit] as const]:[];
  if(!entries.length)throw new Error('usage_schema_unrecognized');
  const observed=now.toISOString(),epoch=now.getTime();
  const limits=entries.flatMap(([id,limit])=>Object.entries({primary:limit.primary_window,secondary:limit.secondary_window}).flatMap(([name,w])=>{
    if(!w)return[];
    const seconds=w.limit_window_seconds??null;
    const kind=seconds===604800?'weekly':seconds===18000?'session':`window_${seconds??name}`;
    const reset=w.reset_at!=null?new Date(w.reset_at*1000):w.reset_after_seconds!=null?new Date(epoch+w.reset_after_seconds*1000):null;
    return[{id:`${id}-${name}`,account_id:accountId,kind,scope:'all_models',unit:'fraction',used_fraction:w.used_percent/100,remaining_fraction:1-w.used_percent/100,
      window_seconds:seconds,observed_at:observed,reset_at:reset?reset.toISOString():null,source:'official_api',confidence:'provider_reported'}];
  }));
  const credit=data.credits==null?null:creditSchema.safeParse(data.credits);
  const paid=credit?.success?[{id:'credits',label:'Paid credits',kind:'balance',unit:'credits',remaining:credit.data.balance??null,enabled:null,unlimited:credit.data.unlimited??false,observed_at:observed,reset_at:null}]:[];
  const allowed=entries.map(([,l])=>l.allowed??(l.limit_reached==null?null:!l.limit_reached)).find(v=>v!==null)??null;
  return{allowed,snapshot:ingestSnapshot.parse({account_id:accountId,provider:'openai',observed_at:observed,status:'ok',limits,
    metadata:{adapter_version:'codex-backend-v1',paid_usage:paid,...(credit&&!credit.success?{paid_usage_diagnostic:'paid_usage_schema_unrecognized'}:{})}})};
}

const tokenResponse=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1).optional(),id_token:z.string().min(1).optional(),expires_in:z.number().finite().positive().optional()}).loose();
function accountIdFrom(idToken:string|undefined){
  if(!idToken)return undefined;
  const auth=jwtPayload(idToken)['https://api.openai.com/auth'];
  const id=auth&&typeof auth==='object'?(auth as Record<string,unknown>).chatgpt_account_id:undefined;
  return typeof id==='string'&&id?id:undefined;
}
function toGrant(data:z.infer<typeof tokenResponse>,previous:Grant|null,now:number):Grant{
  const account=accountIdFrom(data.id_token)??previous?.claims.account_id;
  return grant.parse({access_token:data.access_token,refresh_token:data.refresh_token??previous?.refresh_token??null,
    expires_at:data.expires_in?now+data.expires_in*1000:expiryFromJwt(data.access_token)??previous?.expires_at??null,
    claims:{...(previous?.claims??{}),...(account?{account_id:account}:{})},
    extra_tokens:{...(previous?.extra_tokens??{}),...(data.id_token?{id_token:data.id_token}:{})}});
}
const form=(fields:Record<string,string>)=>new URLSearchParams(fields).toString();

export const codex:Observer={
  provider:'openai',label:'Codex',
  begin(deps={}){
    const {verifier,challenge,state}=pkce(deps);
    const url=new URL(authorizeUrl);
    for(const [key,value] of Object.entries({response_type:'code',client_id:clientId,redirect_uri:redirectUri,scope:scopes,code_challenge:challenge,code_challenge_method:'S256',state,
      id_token_add_organizations:'true',codex_cli_simplified_flow:'true',originator:'codex_cli_rs'}))url.searchParams.set(key,value);
    return{authorization_url:url.toString(),pending:{verifier,state,redirect_uri:redirectUri},
      instructions:'Sign in to ChatGPT. Your browser will then try to open a localhost page that does not load; copy that page’s full address from the address bar and paste it here.',input_label:'Redirected address (or code)'};
  },
  async complete(pending:PendingEnrollment,input:string,deps={}){
    const trimmed=input.trim();if(!trimmed||trimmed.length>8192)throw new Error('enrollment_input_invalid');
    let code=trimmed,state:string|null=null;
    if(/^https?:\/\//i.test(trimmed)){
      let url:URL;try{url=new URL(trimmed);}catch{throw new Error('enrollment_input_invalid');}
      code=url.searchParams.get('code')??'';state=url.searchParams.get('state');
    }
    if(!code||/\s/.test(code))throw new Error('enrollment_input_invalid');
    if(state!==null&&state!==pending.state)throw new Error('enrollment_state_mismatch');
    const data=tokenResponse.parse(await tokenJson(tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
      body:form({grant_type:'authorization_code',code,redirect_uri:pending.redirect_uri??redirectUri,client_id:clientId,code_verifier:pending.verifier})},deps));
    return toGrant(data,null,(deps.now??Date.now)());
  },
  async refresh(current,deps={}){
    if(!current.refresh_token)throw new Error('usage_auth_required');
    const data=tokenResponse.parse(await tokenJson(tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
      body:form({grant_type:'refresh_token',refresh_token:current.refresh_token,client_id:clientId,scope:'openid profile email'})},deps));
    return toGrant(data,current,(deps.now??Date.now)());
  },
  async readUsage(current,accountId,deps={}){
    const headers:Record<string,string>={Authorization:`Bearer ${current.access_token}`,Accept:'application/json'};
    if(current.claims.account_id)headers['ChatGPT-Account-Id']=current.claims.account_id;
    const raw=await providerJson(usageUrl,{headers},deps);
    return normalizeUsage(raw,accountId,new Date((deps.now??Date.now)()));
  },
  credentialFiles(current,_platform:Platform){
    // Codex's file credential store. An empty refresh token means the CLI reports a login problem instead of rotating the service's grant.
    return[{path:'auth.json',content:JSON.stringify({OPENAI_API_KEY:null,tokens:{id_token:current.extra_tokens.id_token??'',access_token:current.access_token,refresh_token:'',account_id:current.claims.account_id??null},last_refresh:new Date().toISOString()})}];
  },
};
