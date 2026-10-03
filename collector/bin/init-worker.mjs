import {mkdir,writeFile,stat,readFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function init(args){
 const opts={repositories:[]};
 for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!value||!['--state','--service','--worker-id','--tools','--repository','--output'].includes(flag))throw new Error('Expected --service URL --worker-id ID --tools TOOLS_MANIFEST --repository NAME=PATH [--output FILE]');if(flag==='--repository')opts.repositories.push(value);else opts[flag.slice(2)]=value;}
 for(const key of ['state','service','worker-id','tools'])if(!opts[key])throw new Error(`Missing --${key}`);
 const service=new URL(opts.service);
 if(service.username||service.password||service.search||service.hash||service.pathname!=='/'||!(service.protocol==='https:'||(service.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(service.hostname))))throw new Error('Service must be an HTTPS origin (or local HTTP), without credentials.');
 if(!/^[a-z][a-z0-9_-]{1,79}$/.test(opts['worker-id']))throw new Error('Invalid worker ID');
 const tools=JSON.parse(await readFile(resolve(opts.tools),'utf8'));
 if(tools.version!==1)throw new Error('Unsupported tools manifest version');
 for(const cli of ['codex','claude','cursor-agent','gemini']) {
  const tool=tools.providers?.[cli];
  if(cli==='gemini'&&!tool)continue; // optional fourth provider
  if(!tool||![tool.binary,tool.auth_dir].every(value=>typeof value==='string'&&value.startsWith('/')))throw new Error(`Missing absolute binary/auth_dir for ${cli}`);
 }
 const root=resolve(opts.state),repos={};
 for(const entry of opts.repositories){const split=entry.indexOf('=');const name=entry.slice(0,split),path=resolve(entry.slice(split+1));if(split<1||!/^[a-z][a-z0-9_-]{1,79}$/.test(name)||repos[name])throw new Error('Repository names must be unique identifiers: NAME=PATH');await stat(join(path,'.git'));repos[name]={path};}
 if(!Object.keys(repos).length)throw new Error('At least one --repository NAME=PATH is required');
 const targets=[['openai','chatgpt-personal','codex'],['anthropic','claude-personal','claude'],['cursor','cursor-personal','cursor-agent'],...(tools.providers.gemini?[['google','google-ai-pro-personal','gemini']]:[])].map(([provider,id,cli])=>({id:`${opts['worker-id']}-${provider}-local`,account_id:id,provider,mode:'local',binary:tools.providers[cli].binary,auth_dir:tools.providers[cli].auth_dir,repositories:repos,models:{},...(provider==='cursor'?{default_model:'auto'}:{}),billing:'unknown',setup_minutes:0}));
 if(targets.some(t=>t.id.length>80))throw new Error('Worker ID is too long for target IDs');
 const config={service_url:service.origin,worker_id:opts['worker-id'],token_env:`WORKER_${opts['worker-id'].replaceAll('-','_').toUpperCase()}_TOKEN`,artifact_dir:join(root,'jobs'),targets};
 const output=resolve(opts.output??join(root,'worker.json'));await mkdir(dirname(output),{recursive:true,mode:0o700});
 await writeFile(output,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
 return {output,token_env:config.token_env};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await init(process.argv.slice(2)),null,2));console.log('Config created; not registered or started. Confirm subscription-only billing, provision the named worker secret, then follow docs/execution.md.');}
 catch(error){console.error(error.code==='EEXIST'?'Output already exists; preserving your configuration.':error.message);process.exitCode=1;}
}
