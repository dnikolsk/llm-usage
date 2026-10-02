/** Read-only provider telemetry. Callers supply fixed HTTPS URLs, never user URLs. */
export async function usageJson(url:string,init:RequestInit):Promise<unknown>{
  const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(15_000)});
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===401||response.status===403?'usage_auth_required':response.status===429?'usage_rate_limited':'usage_http_error');}
  const reader=response.body?.getReader();if(!reader)throw new Error('usage_empty_response');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144)throw new Error('usage_response_too_large');chunks.push(value);}}
  finally{await reader.cancel();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('usage_invalid_json');}
}
