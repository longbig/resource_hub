import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { identifyProvider, providers, selectedProviders, extractionCode } from './providers';
import { activeProcessedSource, processedSources, sourceIdentity } from './processed-resources';
import type { AppEnv } from './types';

type PendingResource={id:string;provider:string;providerName:string;title:string;sourceUrl:string;extractionCode:string;keywords:string[];clickCount:number;lastClickedAt:string};
type SourceRow={keyword:string;url:string;title:string;clicks:number;last_clicked_at:string};
const api=new Hono<AppEnv>();
api.use('*',bodyLimit({maxSize:16384,onError:c=>c.json({error:'请求体不能超过 16 KB。'},413)}));
const uid=()=>crypto.randomUUID().replace(/-/g,'');
const sourceId=async(identity:string)=>'src_'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)))).map(x=>x.toString(16).padStart(2,'0')).join('');

function decodeCursor(raw:string,provider:string):string|null {
  if(!raw)return '';
  if(raw.length>512||!/^[a-zA-Z0-9_-]+$/.test(raw))return null;
  try{
    const data=JSON.parse(atob(raw.replace(/-/g,'+').replace(/_/g,'/')));
    return data.v===1&&data.provider===provider&&/^src_[a-f0-9]{64}$/.test(data.after)?data.after:null;
  }catch{return null;}
}
const encodeCursor=(provider:string,after:string)=>btoa(JSON.stringify({v:1,provider,after})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

api.get('/resources',async c=>{
  const provider=c.req.query('provider')||'quark',types=selectedProviders(provider),limitText=c.req.query('limit')||'50';
  if(!types.length)return c.json({error:'不支持的网盘类型。'},400);
  if(c.req.query('status')&&c.req.query('status')!=='pending')return c.json({error:'只支持查询 pending 资源。'},400);
  if(!/^[1-9][0-9]{0,2}$/.test(limitText)||Number(limitText)>100)return c.json({error:'limit 必须为 1–100 的整数。'},400);
  const after=decodeCursor(c.req.query('cursor')||'',provider);
  if(after===null)return c.json({error:'分页游标无效或不属于当前网盘。'},400);
  const [rows,processed,own]=(await Promise.all([
    c.env.DB.prepare(`SELECT n.keyword,n.url,n.title,count(*) clicks,max(n.clicked_at) last_clicked_at FROM network_result_clicks n JOIN search_misses m ON m.keyword=n.keyword AND m.provider=n.provider WHERE m.provider IN (${[...types,'unknown'].map(()=>'?').join(',')}) GROUP BY n.keyword,n.provider,n.url ORDER BY last_clicked_at DESC,n.url,n.keyword`).bind(...types,'unknown').all<SourceRow>(),
    processedSources(c.env.DB),
    c.env.DB.prepare("SELECT l.url FROM links l JOIN resources r ON r.id=l.resource_id WHERE r.status='published' AND l.status='active'").all<{url:string}>()
  ]));
  const owned=new Set(own.results.map(row=>sourceIdentity(row.url)).filter(Boolean));
  const grouped=new Map<string,{item:Omit<PendingResource,'id'>;keywords:Set<string>}>();
  for(const row of rows.results){
    const type=identifyProvider(row.url),identity=sourceIdentity(row.url);
    if(!type||!types.includes(type)||!identity||processed.has(identity)||owned.has(identity))continue;
    const prior=grouped.get(identity);
    if(prior){prior.keywords.add(row.keyword);prior.item.clickCount+=row.clicks;prior.item.extractionCode ||= extractionCode(row.url);continue;}
    grouped.set(identity,{item:{provider:type,providerName:providers[type].label,title:row.title,sourceUrl:row.url,extractionCode:extractionCode(row.url),keywords:[],clickCount:row.clicks,lastClickedAt:row.last_clicked_at},keywords:new Set([row.keyword])});
  }
  const items=(await Promise.all([...grouped].map(async([identity,{item,keywords}])=>({id:await sourceId(identity),...item,keywords:[...keywords].sort()})))).sort((a,b)=>a.id.localeCompare(b.id)).filter(item=>item.id>after);
  const limit=Number(limitText),page=items.slice(0,limit),hasMore=items.length>limit;
  return c.json({items:page,hasMore,nextCursor:hasMore?encodeCursor(provider,page.at(-1)!.id):null});
});

api.post('/resources/complete',async c=>{
  const b=await c.req.json().catch(()=>null);
  if(!b||typeof b.sourceId!=='string'||!/^src_[a-f0-9]{64}$/.test(b.sourceId)||typeof b.sourceUrl!=='string'||b.sourceUrl.length>2048||typeof b.title!=='string'||!b.title.trim()||b.title.trim().length>120||typeof b.url!=='string'||b.url.length>2048)return c.json({error:'请提供 sourceId、sourceUrl、120 字以内的 title 和网盘分享 url。'},400);
  const sourceUrl=b.sourceUrl.trim(),identity=sourceIdentity(sourceUrl),url=b.url.trim(),provider=identifyProvider(url),title=b.title.trim();
  if(!identity||!provider||await sourceId(identity)!==b.sourceId)return c.json({error:'来源标识或网盘分享链接无效。'},400);
  if(!await c.env.DB.prepare('SELECT id FROM network_result_clicks WHERE url=? LIMIT 1').bind(sourceUrl).first())return c.json({error:'来源不在已记录的网络资源中。'},404);
  const resourceId=uid(),linkId=uid();
  // Each D1 batch is one transaction. Only its first successful completion can create a resource.
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO resources(id,title,status) SELECT ?,?,'published' WHERE NOT EXISTS (${activeProcessedSource} AND p.source_identity=?)`).bind(resourceId,title,identity),
    c.env.DB.prepare("INSERT INTO links(id,resource_id,provider,url,code,status,position) SELECT ?,?,?,?,?, 'active',0 FROM resources WHERE id=?").bind(linkId,resourceId,provider,url,extractionCode(url),resourceId),
    c.env.DB.prepare("INSERT INTO processed_search_resources(source_identity,source_url,resource_id,target_url) SELECT ?,?,?,? FROM resources WHERE id=? ON CONFLICT(source_identity) DO UPDATE SET source_url=excluded.source_url,resource_id=excluded.resource_id,target_url=excluded.target_url,processed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(identity,sourceUrl,resourceId,url,resourceId)
  ]);
  const saved=await c.env.DB.prepare(activeProcessedSource+' AND p.source_identity=?').bind(identity).first<{resource_id:string;target_url:string;title:string}>();
  if(!saved)throw Error('Automation completion was not persisted');
  const created=saved.resource_id===resourceId;
  return c.json({ok:true,status:created?'created':'already_processed',sourceId:b.sourceId,resource:{id:saved.resource_id,title:saved.title,provider:identifyProvider(saved.target_url),url:saved.target_url}},created?201:200);
});

export default api;
