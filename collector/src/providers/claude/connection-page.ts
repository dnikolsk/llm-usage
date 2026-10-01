import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type ConnectionState = { authorization_url?: string; status: 'starting'|'waiting'|'complete'|'failed'; submitted: boolean };
const escape = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const htmlHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Disposition': 'inline',
};
/** Worker-local, short-lived code handoff. OAuth codes never enter the service DB or bot chat. */
export function connectionPage(token:string, origin:string, state:ConnectionState, submit:(code:string)=>void) {
  // Independent of the URL capability: a submitting browser must first read this page.
  const formToken=randomBytes(32).toString('hex');
  const expectedOrigin=new URL(origin).origin;
  const hash=(s:string)=>createHash('sha256').update(s).digest();
  return async (req:IncomingMessage,res:ServerResponse) => {
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options','nosniff');
    const pathOnly=req.url?.split('?')[0]??'';
    const raw=pathOnly.startsWith('/connect/')?pathOnly.slice('/connect/'.length):'';
    // Optional .html suffix so iOS Safari renders instead of saving as .bin when MIME sniffing fails.
    const supplied=raw.endsWith('.html')?raw.slice(0,-5):raw;
    if(!pathOnly.startsWith('/connect/')||!timingSafeEqual(hash(supplied),hash(token))){
      res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'inline'});res.end('Not found');return;
    }
    const pagePath=`/connect/${token}.html`;
    if(req.method==='POST'){
      // Embedded browsers may omit all provenance headers or send an opaque Origin.
      // The form nonce remains mandatory; explicit conflicting provenance is rejected.
      const reqOrigin=typeof req.headers.origin==='string'?req.headers.origin:'';
      const referer=typeof req.headers.referer==='string'?req.headers.referer:'';
      const fetchSite=typeof req.headers['sec-fetch-site']==='string'?req.headers['sec-fetch-site']:'';
      let refererOk=true;
      if(referer){try{refererOk=new URL(referer).origin===expectedOrigin;}catch{refererOk=false;}}
      const originOk=!reqOrigin||reqOrigin==='null'||reqOrigin===expectedOrigin;
      if(!originOk||!refererOk||fetchSite==='cross-site'){
        res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'inline'});
        res.end('This submission came from a different site. Reopen the private connection link.');return;
      }
      if(state.status!=='waiting'||state.submitted){res.writeHead(409,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'inline'});res.end('This connection is no longer waiting for a code.');return;}
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>4096){res.writeHead(413,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'inline'});res.end('Too large');return;}chunks.push(bytes);}
      const form=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      if(form.getAll('csrf').length!==1||!timingSafeEqual(hash(form.get('csrf')??''),hash(formToken))){
        res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'inline'});
        res.end('This connection form is invalid or expired. Reopen the private connection link.');return;
      }
      const code=form.get('code')?.trim();
      if(!code||/[\r\n\x00]/.test(code)||code.length>2048){res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'inline'});res.end('Invalid authorization code.');return;}
      // Reading a request body yields: another POST may have completed in the meantime.
      if(state.status!=='waiting'||state.submitted){res.writeHead(409,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'inline'});res.end('This connection is no longer waiting for a code.');return;}
      state.submitted=true;submit(code);
      // Absolute Location under the public HTTPS origin; relative redirects through Tailscale+Safari can stall as a download.
      res.writeHead(303,{...htmlHeaders,Location:`${origin}${pagePath}`});
      res.end('<!doctype html><html><head><meta charset="utf-8"><title>Continuing</title></head><body><p>Continuing sign-in…</p></body></html>');
      return;
    }
    if(req.method!=='GET'){res.writeHead(405,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'inline'});res.end('Method not allowed');return;}
    // Prefer the .html URL so bookmarks/shares render in mobile browsers.
    if(!raw.endsWith('.html')){
      res.writeHead(302,{...htmlHeaders,Location:`${origin}${pagePath}`});
      res.end('<!doctype html><html><head><meta charset="utf-8"><title>Redirecting</title></head><body><p>Redirecting…</p></body></html>');
      return;
    }
    const url=state.authorization_url;
    const content=state.status==='complete'?'<p>Claude is connected. You can close this page.</p>':state.status==='failed'?'<p>Sign-in did not finish. Start a new connection.</p>':state.submitted?'<p>Completing sign-in. Refresh this page in a few seconds.</p>':url?
      `<p>Open Claude sign-in, then return here with the code shown by Claude.</p><p><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Sign in to Claude</a></p><form method="post" action="${escape(pagePath)}"><input type="hidden" name="csrf" value="${formToken}"><label>Authorization code <input name="code" type="password" autocomplete="off" required></label><button>Connect account</button></form>`:'<p>Preparing sign-in. Refresh this page in a few seconds.</p>';
    res.writeHead(200,htmlHeaders);
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Connect Claude</title><style>body{font:18px system-ui;max-width:36rem;margin:3rem auto;padding:1rem}input,button{display:block;font:inherit;margin:1rem 0;padding:.6rem}</style></head><body><h1>Connect Claude</h1>${content}</body></html>`);
  };
}
