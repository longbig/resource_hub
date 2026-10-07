import sources from '../config/search-sources.json';
import { providers, enabledProviderIds, shareUrl, shareIdentity, extractionCode } from './providers';
import type { Bindings } from './types';
export const searchSources=sources;
export type NetworkItem={provider:string;title:string;summary:string;url:string;code:string;source:string;sourceUrl:string;datetime:string};
export type SourceResult={id:string;label:string;status:'ok'|'error';count:number};
export function plain(raw:string):string {
 return raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>|<\/p>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v>0&&v<=0x10ffff?String.fromCodePoint(v):'';}).replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,n)=>(({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '} as Record<string,string>)[n]!)).trim();
}
export function matchesQuery(text:string,q:string){return q.toLowerCase().split(/\s+/).filter(Boolean).slice(0,5).every(t=>text.toLowerCase().includes(t));}
export function quarkUrl(raw:string):string|null {
 return shareUrl('quark',raw);
}
export function normalizedDate(value:unknown):string {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value))return '';const t=Date.parse(value);return Number.isFinite(t)&&t>=0?new Date(t).toISOString():'';}
export function deduplicate(items:NetworkItem[]):NetworkItem[]{
 const sorted=[...items].sort((a,b)=>(Date.parse(b.datetime)||0)-(Date.parse(a.datetime)||0)||a.url.localeCompare(b.url));
 const seen=new Map<string,NetworkItem>();for(const item of sorted){const key=shareIdentity(item.provider,item.url),prior=seen.get(key);if(!prior)seen.set(key,{...item});else if(!prior.code&&item.code){prior.code=item.code;prior.url=item.url;}}return [...seen.values()].slice(0,60);
}
export function pansouBody(q:string,ids:string[],cloudTypes:string[]=enabledProviderIds){
 const selected=searchSources.filter(s=>ids.includes(s.id)),plugins=selected.filter(s=>s.kind==='plugin').map(s=>s.id),channels=selected.filter(s=>s.kind==='channel').map(s=>s.id);
 return {kw:q,res:'all',src:plugins.length?(channels.length?'all':'plugin'):'tg',plugins,channels,cloud_types:cloudTypes,conc:5};
}
export function parsePanSou(payload:unknown,q:string,ids:string[],cloudTypes:string[]=enabledProviderIds):NetworkItem[]{
 if(!payload||typeof payload!=='object')throw Error('invalid response');
 const envelope=payload as {code?:number;data?:{total?:number;results?:Array<{content?:string;links?:Array<{url?:string}>}>;merged_by_type?:Record<string,unknown[]>}};
 if(envelope.code!==0||!envelope.data||typeof envelope.data.total!=='number')throw Error('invalid response');
 const types=cloudTypes.filter(id=>Object.hasOwn(providers,id));
 const descriptions=new Map<string,string>();
 for(const r of (envelope.data.results||[]).slice(0,500))if(typeof r.content==='string'&&Array.isArray(r.links))for(const l of r.links)if(typeof l.url==='string')for(const type of types){const u=shareUrl(type,l.url);if(u)descriptions.set(shareIdentity(type,u),plain(r.content).slice(0,10000));}
 const items:NetworkItem[]=[];
 for(const provider of types){
  const rows=envelope.data.merged_by_type?.[provider]||[];if(!Array.isArray(rows))throw Error('invalid response');
  for(const raw of rows.slice(0,500)){
   if(!raw||typeof raw!=='object')continue;const row=raw as Record<string,unknown>;
   if(typeof row.url!=='string'||typeof row.note!=='string')continue;const url=shareUrl(provider,row.url);if(!url)continue;
   const note=plain(row.note).slice(0,3000),description=descriptions.get(shareIdentity(provider,url))||note;if(!matchesQuery(note+' '+description,q))continue;
   const source=String(row.source||'');const entry=searchSources.find(s=>ids.includes(s.id)&&source===`${s.kind==='plugin'?'plugin':'tg'}:${s.id}`);if(!entry)continue;
   const code=typeof row.password==='string'&&/^[a-z0-9]{1,12}$/i.test(row.password)?row.password:extractionCode(url);
   items.push({provider,datetime:normalizedDate(row.datetime),title:(note.split('\n').find(t=>t.trim())||q).slice(0,100),summary:description.replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').slice(0,220),url,code,source:entry.label,sourceUrl:entry.kind==='channel'?'https://t.me/s/'+entry.id:entry.id==='pansearch'?'https://www.pansearch.me/search?'+new URLSearchParams({keyword:q,pan:provider}):''});
  }
 }
 return deduplicate(items);
}
async function boundedJson(response:Response):Promise<unknown>{
 if(!response.ok||!response.body)throw Error('PanSou unavailable');const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3*1024*1024)throw Error('response too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(all));
}
type LinkState='ok'|'bad'|'locked'|'unsupported'|'uncertain';
// Keep the original order except for the first verified result; never check its successors.
export async function promoteFirstValid(items:NetworkItem[],check:(item:NetworkItem)=>Promise<LinkState>,canContinue=()=>true):Promise<NetworkItem[]> {
 const retained:NetworkItem[]=[];
 for(let i=0;i<items.length;i++){
  if(!canContinue())return [...retained,...items.slice(i)];
  let state:LinkState;
  try{state=await check(items[i]);}catch{return [...retained,...items.slice(i)];}
  if(state==='ok')return [items[i],...retained,...items.slice(i+1)];
  if(state!=='bad')retained.push(items[i]);
 }
 return retained;
}
export async function verifyFirstResult(items:NetworkItem[],env:Bindings):Promise<NetworkItem[]> {
 const deadline=Date.now()+15000;
 return promoteFirstValid(items,async item=>{
  if(!providers[item.provider]?.check)return 'unsupported';
  const controller=new AbortController();
  const timeout=Math.min(10500,deadline-Date.now());
  if(timeout<=0)throw Error('check deadline');
  let timer:ReturnType<typeof setTimeout>|undefined;
  const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('check timeout'));},timeout);});
  try{return await Promise.race([(async()=>{
   const init:RequestInit={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{disk_type:item.provider,url:item.url,password:item.code}]}),signal:controller.signal};
   const response=env.ENVIRONMENT==='local'?await fetch('http://127.0.0.1:8888/api/check/links',init):await env.PANSOU_CONTAINER!.getByName('search').fetch('http://pansou/api/check/links',init);
   const payload=await boundedJson(response) as {results?:Array<{url?:string;disk_type?:string;state?:string}>};
   const result=payload?.results;
   if(!Array.isArray(result)||result.length!==1||result[0].url!==item.url||result[0].disk_type!==item.provider||!['ok','bad','locked','unsupported','uncertain'].includes(result[0].state||''))throw Error('invalid check response');
   return result[0].state as LinkState;
  })(),expired]);}finally{if(timer!==undefined)clearTimeout(timer);}
 },()=>Date.now()<deadline);
}
export async function networkSearch(q:string,ids:string[],env:Bindings,cloudTypes:string[]=enabledProviderIds){
 const selected=searchSources.filter(s=>ids.includes(s.id));if(!selected.length||!cloudTypes.length)return {items:[],sources:[]};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 try{const init:RequestInit={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pansouBody(q,ids,cloudTypes)),signal:controller.signal};
 const response=env.ENVIRONMENT==='local'?await fetch('http://127.0.0.1:8888/api/search',init):await env.PANSOU_CONTAINER!.getByName('search').fetch('http://pansou/api/search',init);
 const parsed=parsePanSou(await boundedJson(response),q,ids,cloudTypes);
 clearTimeout(timer);
 const items=await verifyFirstResult(parsed,env);
 return {items,sources:selected.map(s=>({id:s.id,label:s.label,status:'ok',count:items.filter(i=>i.source===s.label).length} as SourceResult))};
 }catch(error){console.warn('PanSou unavailable:',error instanceof Error?error.message:'error');return {items:[],sources:selected.map(s=>({id:s.id,label:s.label,status:'error',count:0} as SourceResult))};}finally{clearTimeout(timer);}
}
