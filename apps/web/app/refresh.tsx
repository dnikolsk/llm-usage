'use client';
import {useEffect,useTransition} from 'react';
import {useRouter} from 'next/navigation';
export default function Refresh(){
 const router=useRouter();
 const [pending,start]=useTransition();
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')start(()=>router.refresh());},60000);return()=>clearInterval(timer);},[router]);
 return <button className={`icon${pending?' spinning':''}`} onClick={()=>start(()=>router.refresh())} aria-label="Refresh usage" aria-busy={pending}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>;
}
