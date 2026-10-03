import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isAbsolute,relative,resolve} from 'node:path';
import {workerConfig} from './providers/types';
import {diagnoseUsage,publisherCandidates,inspectDashboard,serviceOrigin} from './usage-doctor';
import {discoverSavedWorkers,machineContext} from './usage-discovery';

async function main(){
  const [path,...args]=process.argv.slice(2);
  const options:{dashboard:string;collect?:boolean;controlTokenEnv?:string;dashboardTokenEnv?:string}={dashboard:''};
  let output:string|undefined;const searchRoots:string[]=[];
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--collect'){options.collect=true;continue;}
    if(!['--dashboard','--output','--control-token-env','--dashboard-token-env','--search-root'].includes(arg)||!args[i+1])throw new Error('arguments');
    const value=args[++i];
    if(arg==='--dashboard')options.dashboard=value;
    if(arg==='--output')output=value;
    if(arg==='--control-token-env')options.controlTokenEnv=value;
    if(arg==='--dashboard-token-env')options.dashboardTokenEnv=value;
    if(arg==='--search-root')searchRoots.push(value);
  }
  if(!path||!options.dashboard)throw new Error('arguments');
  serviceOrigin(options.dashboard);
  let revision:string|null=null;
  try{const value=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../..',import.meta.url)),encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000}).trim();if(/^[a-f0-9]{40}$/.test(value))revision=value;}catch{}
  const processes=await publisherCandidates();
  const machine=await machineContext();
  let discovery:Awaited<ReturnType<typeof discoverSavedWorkers>>|undefined;
  let configPath=path;
  if(path==='--discover'){
    const found=new Map<string,ReturnType<typeof workerConfig.parse>>();
    for(const candidate of processes.candidates){
      if(!candidate.worker_config||found.has(candidate.worker_config))continue;
      if(searchRoots.length&&!searchRoots.some(root=>{const path=relative(resolve(root),candidate.worker_config!);return path!=='..'&&!path.startsWith('../')&&!isAbsolute(path);} ))continue;
      try{found.set(candidate.worker_config,workerConfig.parse(JSON.parse(await readFile(candidate.worker_config,'utf8'))));}catch{}
    }
    if(found.size===0){
      discovery=await discoverSavedWorkers(searchRoots.length?{roots:searchRoots}:{});
      // A saved file alone is not evidence that its CLIs should be executed.
      const referenced=discovery.candidates.filter(candidate=>candidate.service_references.length);
      if(referenced.length===1&&discovery.status==='searched_accessible_locations'){
        const selected=referenced[0];
        found.set(selected.path,workerConfig.parse(JSON.parse(await readFile(selected.path,'utf8'))));
      }
    }
    if(found.size!==1){
      const code=found.size?'worker_config_ambiguous':discovery?.candidates.length?'worker_config_requires_selection':'worker_config_not_found';
      const dashboard=await inspectDashboard(options.dashboard,options.dashboardTokenEnv);
      const report={version:2,mode:'read_only',result:'blocked',diagnostic_revision:revision,checks:[{status:'blocked',code},
        {status:dashboard.status==='ok'?'pass':'blocked',code:`dashboard_${dashboard.status}`}],machine,processes,discovery,dashboard};
      await printReport(report,output);process.exitCode=2;return;
    }
    configPath=[...found.keys()][0];
  }
  const config=workerConfig.parse(JSON.parse(await readFile(configPath,'utf8')));
  const report={...await diagnoseUsage(config,options),version:2,diagnostic_revision:revision,worker_config:configPath,machine,processes,discovery};
  await printReport(report,output);
  if(report.result!=='pass')process.exitCode=2;
}
async function printReport(report:unknown,output:string|undefined){
  const json=JSON.stringify(report,null,2)+'\n';
  if(output)await writeFile(output,json,{mode:0o600,flag:'wx'});
  process.stdout.write(json);
}
main().catch(()=>{
  console.error('Diagnostic could not run. Check the worker JSON, HTTPS destination, independent token bindings and a new writable output path. No exception details are printed because they may contain secrets.');
  console.error('Usage: usage:doctor WORKER_CONFIG_OR_--discover --dashboard HTTPS_ORIGIN [--collect] [--output NEW_REPORT_FILE] [--search-root DIRECTORY] [--control-token-env JOB_TOKEN] [--dashboard-token-env LLM_USAGE_DASHBOARD_READ_TOKEN]');
  process.exitCode=1;
});
