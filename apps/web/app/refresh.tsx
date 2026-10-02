'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
export default function Refresh(){
 const router=useRouter();
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')router.refresh();},60000);return()=>clearInterval(timer);},[router]);
 return <button className="quiet" onClick={()=>router.refresh()} aria-label="Refresh usage">↻ Refresh</button>;
}
