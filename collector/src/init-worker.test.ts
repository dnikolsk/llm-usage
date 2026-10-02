import {test,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {workerConfig} from './providers/types';

test('worker:init owns schema/defaults and accepts installer-supplied tool locations',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'enroll-'));
 try{
  const repo=join(dir,'repo');await mkdir(join(repo,'.git'),{recursive:true});
  const tools=join(dir,'tools.json');
  const providers=Object.fromEntries(['codex','claude','cursor-agent'].map(cli=>[cli,{binary:join(dir,'custom-bin',cli),auth_dir:join(dir,'profiles',cli)}]));
  await writeFile(tools,JSON.stringify({version:1,providers}));
  const args=['--state',dir,'--tools',tools,'--service','https://worker.example','--worker-id','test-machine','--repository',`test-repo=${repo}`];
  const run=(input=args)=>spawnSync(process.execPath,[resolve('bin/init-worker.mjs'),...input],{encoding:'utf8'});
  const result=run();expect(result.status,result.stderr).toBe(0);
  const file=join(dir,'worker.json'),config=workerConfig.parse(JSON.parse(await readFile(file,'utf8')));
  expect(config.token_env).toBe('WORKER_TEST_MACHINE_TOKEN');expect(config.targets).toHaveLength(3);
  expect(config.targets.every(t=>t.billing==='unknown'&&t.id.startsWith('test-machine-'))).toBe(true);
  expect(config.targets[2].default_model).toBe('auto');expect(config.targets[2].binary).toBe(providers['cursor-agent'].binary);
  expect(config.targets[1].auth_dir).toBe(providers.claude.auth_dir);
  expect((await stat(file)).mode&0o777).toBe(0o600);
  expect(run().status).toBe(1);expect(run(args.map(a=>a==='https://worker.example'?'http://remote.example':a)).status).toBe(1);
  await writeFile(tools,JSON.stringify({version:2,providers}));expect(run().stderr).toContain('Unsupported tools manifest');
 }finally{await rm(dir,{recursive:true,force:true});}
});
