import {z} from 'zod';
import {ingestSnapshot} from '@llm-usage/core';
import {grant,type Grant,type Observer,type PendingEnrollment,type Deps,type Platform} from './types';
import {expiryFromJwt,pkce,providerJson,tokenJson} from './http';

/**
 * The public installed-app OAuth client embedded in the Gemini CLI. Its "secret" is not confidential by design
 * (installed-app clients cannot keep one); it is required by Google's token endpoint alongside PKCE.
 */
export const clientId='681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
export const clientSecret='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';
export const authorizeUrl='https://accounts.google.com/o/oauth2/v2/auth';
export const tokenUrl='https://oauth2.googleapis.com/token';
/** The CLI's no-browser flow: Google shows the code on this page for the person to paste back. */
export const redirectUri='https://codeassist.google.com/authcode';
export const codeAssistUrl='https://cloudcode-pa.googleapis.com/v1internal';
const scopes='https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

const bucket=z.object({modelId:z.string().min(1).optional(),tokenType:z.string().optional(),remainingFraction:z.number().finite().min(0).max(1).optional(),
  remainingAmount:z.union([z.string().regex(/^\d+$/),z.number().finite().nonnegative()]).transform(Number).optional(),resetTime:z.iso.datetime({offset:true}).optional()}).loose();
const quotaResponse=z.object({buckets:z.array(bucket).max(60).optional()}).loose();
const loadResponse=z.object({cloudaicompanionProject:z.union([z.string(),z.object({id:z.string().optional()}).loose()]).optional(),
  currentTier:z.object({id:z.string().optional(),name:z.string().optional()}).loose().optional()}).loose();

const modelScope=(id:string)=>id.toLowerCase().replace(/^models\//,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80)||'model';

/** Code Assist quota is per model with a daily reset; the common allowance is the tightest model, labeled as derived. */
export function normalizeUsage(raw:unknown,accountId:string,now=new Date(),tier?:string|null){
  const data=quotaResponse.parse(raw);
  const observed=now.toISOString();
  const buckets=(data.buckets??[]).filter(b=>b.remainingFraction!==undefined&&(b.tokenType===undefined||/request/i.test(b.tokenType)));
  if(!buckets.length)throw new Error('usage_schema_unrecognized');
  const seen=new Set<string>();
  const limits=buckets.flatMap(b=>{
    const scope=modelScope(b.modelId??'all');if(seen.has(scope))return[];seen.add(scope);
    return[{id:scope,account_id:accountId,kind:'daily',scope,unit:'fraction',window_seconds:86400,used_fraction:1-b.remainingFraction!,remaining_fraction:b.remainingFraction!,
      observed_at:observed,reset_at:b.resetTime?new Date(b.resetTime).toISOString():null,source:'official_api',confidence:'provider_reported'}];
  });
  const tightest=limits.reduce((a,b)=>b.remaining_fraction<a.remaining_fraction?b:a);
  limits.unshift({...tightest,id:'all_models',scope:'all_models',confidence:'estimated'});
  return{allowed:null,snapshot:ingestSnapshot.parse({account_id:accountId,provider:'google',observed_at:observed,status:'ok',limits,
    metadata:{adapter_version:'gemini-codeassist-v1',paid_usage:[],...(tier?{display_label:tier.replace(/[^a-zA-Z0-9 ._/-]/g,' ').slice(0,80)}:{})}})};
}

const tokenResponse=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1).optional(),id_token:z.string().min(1).optional(),expires_in:z.number().finite().positive().optional(),scope:z.string().optional()}).loose();
function toGrant(data:z.infer<typeof tokenResponse>,previous:Grant|null,now:number):Grant{
  return grant.parse({access_token:data.access_token,refresh_token:data.refresh_token??previous?.refresh_token??null,
    expires_at:data.expires_in?now+data.expires_in*1000:expiryFromJwt(data.access_token)??previous?.expires_at??null,
    claims:{...(previous?.claims??{}),...(data.scope?{scopes:data.scope}:{})},
    extra_tokens:{...(previous?.extra_tokens??{}),...(data.id_token?{id_token:data.id_token}:{})}});
}
const form=(fields:Record<string,string>)=>new URLSearchParams(fields).toString();

export const gemini:Observer={
  provider:'google',label:'Gemini',
  begin(deps={}){
    const {verifier,challenge,state}=pkce(deps);
    const url=new URL(authorizeUrl);
    for(const [key,value] of Object.entries({client_id:clientId,response_type:'code',redirect_uri:redirectUri,scope:scopes,code_challenge:challenge,code_challenge_method:'S256',state,access_type:'offline',prompt:'consent'}))url.searchParams.set(key,value);
    return{authorization_url:url.toString(),pending:{verifier,state,redirect_uri:redirectUri},
      instructions:'Sign in with the Google account that holds your Gemini subscription, approve access, then paste the code Google shows you.',input_label:'Authorization code'};
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
      body:form({grant_type:'authorization_code',code,redirect_uri:pending.redirect_uri??redirectUri,client_id:clientId,client_secret:clientSecret,code_verifier:pending.verifier})},deps));
    const granted=toGrant(data,null,(deps.now??Date.now)());
    // Discover the Code Assist project/tier once; later quota reads need the project id.
    try{
      const loaded=loadResponse.parse(await providerJson(`${codeAssistUrl}:loadCodeAssist`,{method:'POST',headers:{Authorization:`Bearer ${granted.access_token}`,'Content-Type':'application/json'},
        body:JSON.stringify({metadata:{ideType:'IDE_UNSPECIFIED',platform:'PLATFORM_UNSPECIFIED',pluginType:'GEMINI'}})},deps));
      const project=typeof loaded.cloudaicompanionProject==='string'?loaded.cloudaicompanionProject:loaded.cloudaicompanionProject?.id;
      const tier=loaded.currentTier?.name??loaded.currentTier?.id;
      return grant.parse({...granted,claims:{...granted.claims,...(project?{project}:{}),...(tier?{tier}:{})}});
    }catch{return granted;}
  },
  async refresh(current,deps={}){
    if(!current.refresh_token)throw new Error('usage_auth_required');
    const data=tokenResponse.parse(await tokenJson(tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
      body:form({grant_type:'refresh_token',refresh_token:current.refresh_token,client_id:clientId,client_secret:clientSecret})},deps));
    return toGrant(data,current,(deps.now??Date.now)());
  },
  async readUsage(current,accountId,deps={}){
    const raw=await providerJson(`${codeAssistUrl}:retrieveUserQuota`,{method:'POST',headers:{Authorization:`Bearer ${current.access_token}`,'Content-Type':'application/json'},
      body:JSON.stringify(current.claims.project?{project:current.claims.project}:{})},deps);
    return normalizeUsage(raw,accountId,new Date((deps.now??Date.now)()),current.claims.tier??null);
  },
  credentialFiles(current,_platform:Platform){
    // The CLI's file store under its home directory; the worker points the CLI's HOME at the account's auth_dir.
    return[{path:'.gemini/oauth_creds.json',content:JSON.stringify({access_token:current.access_token,refresh_token:'',scope:current.claims.scopes??scopes,token_type:'Bearer',
      id_token:current.extra_tokens.id_token??undefined,expiry_date:current.expires_at??undefined})}];
  },
};
