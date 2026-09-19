// Only server-issued results can be recorded; clients never supply titles or URLs.
export type ClickResults = {keyword:string;items:Array<{title:string;url:string}>};
const key=(origin:string,token:string)=>new Request(new URL('/_click-results/'+token,origin));
export async function issueClickToken(cache:Cache,origin:string,data:ClickResults){
  const token=crypto.randomUUID();
  await cache.put(key(origin,token),new Response(JSON.stringify(data),{headers:{'Cache-Control':'public,max-age=3600'}}));
  return token;
}
export async function readClick(cache:Cache,origin:string,token:unknown,index:unknown){
  if(typeof token!=='string'||! /^[a-f0-9-]{36}$/.test(token)||!Number.isInteger(index)||Number(index)<0||Number(index)>=60)return null;
  const response=await cache.match(key(origin,token));if(!response)return null;
  const data=await response.json<ClickResults>(),item=data.items[Number(index)];
  return item?{id:token+':'+index,keyword:data.keyword,...item}:null;
}
export function csvCell(value:unknown){
  let text=String(value??'');
  if(/^[\s]*[=+@-]|^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
