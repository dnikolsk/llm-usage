import {createServer} from 'node:http';
import {once} from 'node:events';
import {describe,it,expect} from 'vitest';
import {connectionPage,type ConnectionState} from '../src/providers/claude/connection-page';
describe('phone code handoff',()=>{
 it('gates the page, enforces origin, accepts a code once and never echoes it',async()=>{
  const state:ConnectionState={status:'waiting',submitted:false,authorization_url:'https://claude.com/cai/oauth/authorize?code=true'};
  const codes:string[]=[];const token='a'.repeat(64);
  const server=createServer(connectionPage(token,'https://worker.example',state,code=>codes.push(code)));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}/connect/`;
  try{
   expect((await fetch(base+'wrong')).status).toBe(404);
   const page=await fetch(base+token);expect(page.headers.get('referrer-policy')).toBe('no-referrer');expect(await page.text()).toContain('Sign in to Claude');
   expect((await fetch(base+token,{method:'POST',headers:{Origin:'https://evil.example'},body:'code=test-only'})).status).toBe(403);
   const response=await fetch(base+token,{method:'POST',headers:{Origin:'https://worker.example'},body:'code=test-only',redirect:'manual'});
   expect(response.status).toBe(303);expect(codes).toEqual(['test-only']);
   expect(await (await fetch(base+token)).text()).not.toContain('test-only');
   expect((await fetch(base+token,{method:'POST',headers:{Origin:'https://worker.example'},body:'code=again'})).status).toBe(409);
   expect(codes).toHaveLength(1);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 });
});
