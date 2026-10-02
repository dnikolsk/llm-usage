import {createServer,request as httpRequest,type IncomingMessage} from 'node:http';
import {once} from 'node:events';
import {describe,it,expect} from 'vitest';
import {connectionPage,type ConnectionState} from '../src/providers/claude/connection-page';

const origin='https://worker.example:8443';
const token='a'.repeat(64);
async function withPage(run:(f:{url:string;state:ConnectionState;codes:string[];csrf:string})=>Promise<void>,onRequest?:(req:IncomingMessage)=>void){
 const state:ConnectionState={status:'waiting',submitted:false,authorization_url:'https://claude.com/cai/oauth/authorize?code=true'};
 const codes:string[]=[];
 const handler=connectionPage(token,origin,state,code=>codes.push(code));
 const server=createServer((req,res)=>{onRequest?.(req);void handler(req,res);});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/connect/${token}.html`;
 try{
  const page=await fetch(url);const html=await page.text();
  const csrf=html.match(/name="csrf" value="([a-f0-9]{64})"/)?.[1];expect(csrf).toBeTruthy();
  await run({url,state,codes,csrf:csrf!});
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
const post=(url:string,csrf:string,headers:Record<string,string>={})=>fetch(url,{method:'POST',headers,
 body:new URLSearchParams({csrf,code:'test-only'}),redirect:'manual'});

describe('phone code handoff',()=>{
 it('renders inline HTML and preserves the public HTTPS port across redirects',async()=>withPage(async({url,csrf,codes})=>{
  expect((await fetch(url.replace(token,'wrong'))).status).toBe(404);
  const redirect=await fetch(url.replace('.html',''),{redirect:'manual'});
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get('location')).toBe(`${origin}/connect/${token}.html`);
  expect(redirect.headers.get('content-type')).toMatch(/text\/html/);
  expect(redirect.headers.get('content-disposition')).toBe('inline');
  const page=await fetch(url);
  expect(page.headers.get('referrer-policy')).toBe('no-referrer');
  expect(page.headers.get('content-type')).toMatch(/text\/html/);
  expect(page.headers.get('content-disposition')).toBe('inline');
  expect(await page.text()).toContain('Sign in to Claude');
  const response=await post(url,csrf,{Origin:origin});
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(`${origin}/connect/${token}.html`);
  expect(response.headers.get('content-type')).toMatch(/text\/html/);
  expect(response.headers.get('content-disposition')).toBe('inline');
  expect(codes).toEqual(['test-only']);
  const after=await (await fetch(url)).text();
  expect(after).not.toContain('test-only');expect(after).not.toContain(csrf);
  expect((await post(url,csrf,{Origin:origin})).status).toBe(409);
  expect(codes).toHaveLength(1);
 }));

 it.each([
  ['all provenance headers omitted',{}],
  ['opaque Origin',{Origin:'null'}],
  ['matching Referer only',{Referer:origin+'/connect/'+token+'.html'}],
  ['same-origin fetch metadata only',{'Sec-Fetch-Site':'same-origin'}],
 ])('accepts a valid form when %s',async(_name,headers)=>withPage(async({url,csrf,codes})=>{
  expect((await post(url,csrf,headers as Record<string,string>)).status).toBe(303);
  expect(codes).toEqual(['test-only']);
 }));

 it.each([
  ['foreign Origin',{Origin:'https://evil.example'}],
  ['wrong public port',{Origin:'https://worker.example'}],
  ['cross-site fetch',{'Sec-Fetch-Site':'cross-site'}],
  ['foreign Referer',{Referer:'https://evil.example/'}],
  ['malformed Referer',{Referer:'not-a-url'}],
 ])('rejects %s even with the form nonce',async(_name,headers)=>withPage(async({url,csrf,codes})=>{
  expect((await post(url,csrf,headers as Record<string,string>)).status).toBe(403);
  expect(codes).toHaveLength(0);
 }));

 it('requires the form nonce even when browser headers claim same-origin',async()=>withPage(async({url,csrf,codes})=>{
  for(const headers of [{},{Origin:origin},{'Sec-Fetch-Site':'same-origin'}]){
   expect((await post(url,'wrong',headers as Record<string,string>)).status).toBe(403);
  }
  const duplicate=await fetch(url,{method:'POST',body:`csrf=${csrf}&csrf=${csrf}&code=test-only`});
  expect(duplicate.status).toBe(403);expect(codes).toHaveLength(0);
  expect((await post(url,csrf)).status).toBe(303);
 }));

 it('rejects oversized or multiline codes without consuming the valid form',async()=>withPage(async({url,csrf,codes})=>{
  const oversized=await fetch(url,{method:'POST',body:new URLSearchParams({csrf,code:'x'.repeat(5000)})});
  expect(oversized.status).toBe(413);
  const invalid=await fetch(url,{method:'POST',body:new URLSearchParams({csrf,code:'first\nsecond'})});
  expect(invalid.status).toBe(400);expect(codes).toHaveLength(0);
  expect((await post(url,csrf)).status).toBe(303);
 }));

 it('accepts only one of two concurrently streamed submissions',async()=>{
  let entered=0;let bothEntered:()=>void=()=>{};
  const ready=new Promise<void>(resolve=>{bothEntered=resolve;});
  await withPage(async({url,csrf,codes})=>{
   const start=()=>{
    let req:ReturnType<typeof httpRequest>;
    const response=new Promise<number>((resolve,reject)=>{
     req=httpRequest(url,{method:'POST'},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});
     req.on('error',reject);req.write(`csrf=${csrf}&code=`);
    });
    return {end:(code:string)=>req.end(code),response};
   };
   const first=start(),second=start();await ready;
   first.end('first');second.end('second');
   expect((await Promise.all([first.response,second.response])).sort()).toEqual([303,409]);
   expect(codes).toHaveLength(1);
  },req=>{if(req.method==='POST'&&++entered===2)bothEntered();});
 });
});
