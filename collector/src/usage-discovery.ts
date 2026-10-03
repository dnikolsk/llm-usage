import {opendir,readFile,readlink,realpath,stat} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {homedir,hostname,userInfo} from 'node:os';
import {workerConfig} from './providers/types';

const relevant=/llm|usage|collector|ai-builder|subscription/i;
const skipped=/^(?:node_modules|\.git|\.cache|\.npm|\.pnpm-store|\.ssh|\.aws|\.claude|\.codex|\.cursor|accounts|auth|credentials|jobs|artifacts|cache|npm-cache|pnpm-store|pgdata|providers|site-packages|\.next|dist|build|tests?|fixtures?|examples?)$/i;
const configName=(file:string)=>/^(?:[a-zA-Z0-9._-]+[._-])?worker(?:[._-][a-zA-Z0-9._-]+)?\.json$/.test(basename(file))&&!/example|sample|fixture|test|template|backup|secret|token|credential|\.bak\./i.test(basename(file));
type Candidate={path:string;worker_id:string;service_origin:string;providers:string[];service_references:string[]};
type Service={path:string;launchers:string[];worker_configs:string[]};

/** Locate configs without sourcing launchers, reading env files, or executing services. */
export async function discoverSavedWorkers(options:{roots?:string[];home?:string;maxEntries?:number;maxDepth?:number}={}){
  const home=options.home??homedir();
  const roots=options.roots??[join(home,'.config/systemd/user'),join(home,'.local/share/ai-builder'),join(home,'.config/llm-usage'),
    '/etc/systemd/system','/etc/cron.d',home,'/opt','/srv','/workspace','/usr/lib/systemd/system'];
  const maxEntries=options.maxEntries??12000,maxDepth=options.maxDepth??7;
  const configs=new Map<string,Candidate>(),services:Service[]=[];
  const filesSeen=new Set<string>(),directoriesSeen=new Set<string>();
  const scans:{path:string;status:string}[]=[];
  let examined=0,denied=0,invalid=0,depthLimited=false;
  async function textFile(path:string){
    const info=await stat(path);if(!info.isFile()||info.size>262144)throw new Error('file_not_supported');
    return readFile(path,'utf8');
  }
  async function candidate(path:string,service?:string){
    if(!configName(path))return;
    try{
      const canonical=await realpath(path);
      let found=configs.get(canonical);
      if(!found){
        const data=workerConfig.parse(JSON.parse(await textFile(canonical)));
        found={path:canonical,worker_id:data.worker_id,service_origin:new URL(data.service_url).origin,providers:[...new Set(data.targets.map(target=>target.provider))],service_references:[]};
        configs.set(canonical,found);
      }
      if(service&&!found.service_references.includes(service))found.service_references.push(service);
    }catch{invalid++;}
  }
  const paths=(text:string,extension:string)=>[...text.matchAll(new RegExp(`(?:/|%h/|~/|\\$HOME/)[a-zA-Z0-9_./-]+\\.${extension}(?=[\\s'";]|$)`,'g'))]
    .map(match=>match[0].replace(/^(?:%h|~|\$HOME)(?=\/)/,home));
  async function service(path:string){
    try{
      const content=await textFile(path);
      // Do not inspect Environment/EnvironmentFile values, shell profiles or secrets.
      const commands=path.endsWith('.service')?content.split('\n').filter(line=>/^ExecStart=/.test(line)).join('\n'):content;
      const launchers=paths(commands,'(?:sh|mjs|cjs|js|ts|py)');
      const found=new Set(paths(commands,'json').filter(configName));
      for(const launcher of launchers){
        // One level of static wrapper inspection, without executing or sourcing it.
        try{for(const file of paths(await textFile(launcher),'json').filter(configName))found.add(file);}catch{}
      }
      for(const file of found)await candidate(file,path);
      services.push({path,launchers:[...new Set(launchers)],worker_configs:[...found]});
    }catch{denied++;}
  }
  async function visit(directory:string,depth:number):Promise<void>{
    if(examined>=maxEntries)return;
    let handle;
    try{
      const canonical=await realpath(directory);if(directoriesSeen.has(canonical))return;directoriesSeen.add(canonical);
      handle=await opendir(directory);
    }catch{denied++;return;}
    for await(const entry of handle){
      examined++;if(examined>maxEntries)break;
      const path=join(directory,entry.name);
      if(entry.isDirectory()){
        if(skipped.test(entry.name)||entry.name.startsWith('llm-usage-diagnostic.'))continue;
        if(depth>=maxDepth){depthLimited=true;continue;}
        await visit(path,depth+1);
      }else if(entry.isFile()||entry.isSymbolicLink()){
        if(filesSeen.has(path))continue;filesSeen.add(path);
        if(configName(path))await candidate(path);
        if(relevant.test(entry.name)&&(entry.name.endsWith('.service')||directory.endsWith('/cron.d')))await service(path);
      }
    }
  }
  for(const root of [...new Set(roots.map(root=>resolve(root)))]){
    if(examined>=maxEntries){scans.push({path:root,status:'entry_limit'});continue;}
    try{if(!(await stat(root)).isDirectory()){scans.push({path:root,status:'not_directory'});continue;}}
    catch{scans.push({path:root,status:'missing_or_unreadable'});continue;}
    const before=denied;await visit(root,0);scans.push({path:root,status:examined>=maxEntries?'entry_limit':denied>before?'partly_unreadable':'scanned'});
  }
  return{status:examined>=maxEntries||depthLimited?'bounded_search_incomplete':'searched_accessible_locations',scans,entries_examined:examined,unreadable_locations:denied,invalid_config_candidates:invalid,depth_limit_reached:depthLimited,
    candidates:[...configs.values()].sort((a,b)=>a.path.localeCompare(b.path)),services};
}

export async function machineContext(proc='/proc'){
  let user:string|null=null;try{user=userInfo().username;}catch{}
  let pidNamespace:string|null=null;try{pidNamespace=await readlink(join(proc,'self/ns/pid'));}catch{}
  return{hostname:hostname(),user,uid:process.getuid?.()??null,platform:process.platform,home:homedir(),pid_namespace:pidNamespace,
    container_hint:await stat('/.dockerenv').then(()=>true,()=>false)};
}
