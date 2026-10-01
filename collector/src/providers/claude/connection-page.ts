import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type ConnectionState = { authorization_url?: string; status: 'starting'|'waiting'|'complete'|'failed'; submitted: boolean };
const escape = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Worker-local, short-lived code handoff. OAuth codes never enter the service DB or bot chat. */
export function connectionPage(token:string, origin:string, state:ConnectionState, submit:(code:string)=>void) {
  return async (req:IncomingMessage,res:ServerResponse) => {
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options','nosniff');
    const supplied=req.url?.split('?')[0].slice('/connect/'.length)??'';
    const hash=(s:string)=>createHash('sha256').update(s).digest();
    if(!req.url?.startsWith('/connect/')||!timingSafeEqual(hash(supplied),hash(token))){res.writeHead(404);res.end();return;}
    if(req.method==='POST'){
      if(req.headers.origin!==origin){res.writeHead(403);res.end();return;}
      if(state.status!=='waiting'||state.submitted){res.writeHead(409);res.end('This connection is no longer waiting for a code.');return;}
      let body='';for await(const chunk of req){body+=chunk.toString();if(body.length>4096){res.writeHead(413);res.end();return;}}
      const code=new URLSearchParams(body).get('code')?.trim();
      if(!code||/[\r\n\x00]/.test(code)||code.length>2048){res.writeHead(400);res.end('Invalid authorization code.');return;}
      state.submitted=true;submit(code);res.writeHead(303,{Location:req.url!.split('?')[0]});res.end();return;
    }
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    const url=state.authorization_url;
    const content=state.status==='complete'?'<p>Claude is connected. You can close this page.</p>':state.status==='failed'?'<p>Sign-in did not finish. Start a new connection.</p>':state.submitted?'<p>Completing sign-in. Refresh this page in a few seconds.</p>':url?
      `<p>Open Claude sign-in, then return here with the code shown by Claude.</p><p><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Sign in to Claude</a></p><form method="post"><label>Authorization code <input name="code" type="password" autocomplete="off" required></label><button>Connect account</button></form>`:'<p>Preparing sign-in. Refresh this page in a few seconds.</p>';
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Claude</title><style>body{font:18px system-ui;max-width:36rem;margin:3rem auto;padding:1rem}input,button{display:block;font:inherit;margin:1rem 0;padding:.6rem}</style></head><body><h1>Connect Claude</h1>${content}</body></html>`);
  };
}
