import { createHash, timingSafeEqual } from 'node:crypto';
export function authorized(request:Request, access:'read'|'write') {
  const secret=process.env[access === 'read' ? 'READ_TOKEN' : 'WRITE_TOKEN'];
  if (!secret || secret.length < 32 || secret === process.env[access === 'read' ? 'WRITE_TOKEN' : 'READ_TOKEN']) return false;
  const header=request.headers.get('authorization') ?? '';
  const candidate=header.startsWith('Bearer ') ? header.slice(7) : '';
  const digest=(s:string)=>createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(secret),digest(candidate));
}
export const unauthorized=()=>Response.json({error:'unauthorized'},{status:401,headers:{'Cache-Control':'no-store'}});
export const unavailable=()=>Response.json({error:'service_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
