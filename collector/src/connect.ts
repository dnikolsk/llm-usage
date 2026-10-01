import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { workerConfig, providerEnvironment, command } from './providers/types';
import {loginArgs as codex} from './providers/codex/index';
import {loginArgs as claude} from './providers/claude/index';
import {loginArgs as cursor, authenticated as cursorAuthenticated} from './providers/cursor/index';
const config=workerConfig.parse(JSON.parse(await readFile(process.argv[2]??'','utf8')));
const target=config.targets.find(t=>t.account_id===process.argv[3]);
if(!target)throw new Error('account_not_configured');
const reconnect=process.argv[4]==='--reconnect';
if(process.argv.length>5 || (process.argv[4]&&!reconnect))throw new Error('Usage: connect WORKER_CONFIG ACCOUNT_ID [--reconnect]');
if(reconnect&&target.provider!=='cursor')throw new Error('reconnect_supported_for_cursor_only');
await mkdir(target.auth_dir,{recursive:true,mode:0o700});
if(reconnect){
  const loggedOut=await command(target)(['logout']);
  if(loggedOut.code!==0)throw new Error('cursor_logout_failed');
  console.log('Cleared this worker account’s Cursor login using the official CLI.');
}
console.log(`Connecting ${target.account_id}. Complete the provider login on your own browser. Do not paste credentials into bot chat.`);
const child=spawn(target.binary,target.provider==='openai'?codex:target.provider==='anthropic'?claude:cursor,
  {env:providerEnvironment(target),stdio:'inherit'});
child.on('error',()=>{console.error('Unable to start provider CLI');process.exitCode=1;});
child.on('close',async code=>{
  process.exitCode=code??1;
  if(code===0&&target.provider==='cursor'){
    try{
      if(!await cursorAuthenticated(command(target)))throw new Error('cursor_backend_not_ready');
      console.log('Cursor backend accepted the login and returned available models.');
    }catch{
      console.error('Cursor login is not backend-verified. Stored tokens alone are insufficient. Retry with --reconnect; if it still fails, check Cursor service/network access.');
      process.exitCode=1;
    }
  }
});
