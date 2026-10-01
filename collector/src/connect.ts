import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { workerConfig, providerEnvironment } from './providers/types';
import {loginArgs as codex} from './providers/codex/index';
import {loginArgs as claude} from './providers/claude/index';
import {loginArgs as cursor} from './providers/cursor/index';
const config=workerConfig.parse(JSON.parse(await readFile(process.argv[2]??'','utf8')));
const target=config.targets.find(t=>t.account_id===process.argv[3]);
if(!target)throw new Error('account_not_configured');
await mkdir(target.auth_dir,{recursive:true,mode:0o700});
console.log(`Connecting ${target.account_id}. Complete the provider login on your own browser. Do not paste credentials into bot chat.`);
const child=spawn(target.binary,target.provider==='openai'?codex:target.provider==='anthropic'?claude:cursor,
  {env:providerEnvironment(target),stdio:'inherit'});
child.on('error',()=>{console.error('Unable to start provider CLI');process.exitCode=1;});
child.on('close',code=>{process.exitCode=code??1;});
