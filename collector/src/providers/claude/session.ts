import {readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';

/** The public OAuth client and token endpoint used by the Claude Code CLI itself. */
export const tokenEndpoint='https://console.anthropic.com/v1/oauth/token';
export const clientId='9d1c250a-e61b-44d9-88ed-5944d1962f5e';
/** Refresh slightly early so a token does not expire between the read and the usage request. */
const refreshMarginMs=120_000;

const oauth=z.object({accessToken:z.string().min(1),refreshToken:z.string().min(1).optional(),expiresAt:z.number().finite().optional()}).loose();
const store=z.object({claudeAiOauth:oauth}).loose();
const refreshed=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1).optional(),expires_in:z.number().finite().positive().optional()}).loose();

export function sessionPath(authDir:string){return join(authDir,'.credentials.json');}

async function readStore(path:string){return store.parse(JSON.parse(await readFile(path,'utf8')));}

/**
 * Return a valid access token for the account's own Claude Code session.
 * When the stored access token has expired, the stored refresh token is exchanged at the CLI's own
 * token endpoint and the rotated session is written back to the same file, exactly as the CLI would.
 * The worker's Claude CLI only runs during tasks, so without this the telemetry token lapses within hours.
 */
export async function accessToken(authDir:string,deps:{fetch?:typeof fetch;now?:()=>number}={}){
  const path=sessionPath(authDir),send=deps.fetch??fetch,now=deps.now??Date.now;
  const current=(await readStore(path)).claudeAiOauth;
  if(current.expiresAt===undefined||current.expiresAt>now()+refreshMarginMs)return{token:current.accessToken,refreshed:false};
  if(!current.refreshToken)throw new Error('usage_auth_required');
  const response=await send(tokenEndpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
    headers:{'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({grant_type:'refresh_token',refresh_token:current.refreshToken,client_id:clientId})});
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===400||response.status===401||response.status===403?'usage_auth_required':'usage_http_error');}
  const body=await response.text();
  if(body.length>65_536)throw new Error('usage_response_too_large');
  let granted:z.infer<typeof refreshed>;
  try{granted=refreshed.parse(JSON.parse(body));}catch{throw new Error('usage_auth_required');}
  // The CLI may have refreshed concurrently during a task; its newer session wins and ours is discarded.
  const latest=await readStore(path);
  if(latest.claudeAiOauth.accessToken!==current.accessToken)return{token:latest.claudeAiOauth.accessToken,refreshed:false};
  const next={...latest,claudeAiOauth:{...latest.claudeAiOauth,accessToken:granted.access_token,
    ...(granted.refresh_token?{refreshToken:granted.refresh_token}:{}),
    ...(granted.expires_in?{expiresAt:now()+granted.expires_in*1000}:{})}};
  const temporary=`${path}.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(next),{mode:0o600});
  await rename(temporary,path);
  return{token:granted.access_token,refreshed:true};
}
