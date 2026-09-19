import { issueClickToken, readClick, csvCell } from './search-tracking';
export { PanSouContainer } from './pansou-container';
import { searchSources, networkSearch } from './network-search';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv, Resource, Link, Category } from './types';
import { adminAuth, sameOrigin, providers, validLink } from './security';
import { layout, home, detail, editor, e, adminHeading, option } from './views';

const app = new Hono<AppEnv>();
const uid = () => crypto.randomUUID().replace(/-/g,'');
const selectResource = `SELECT r.*,c.name category_name FROM resources r LEFT JOIN categories c ON r.category_id=c.id`;
app.use('*', secureHeaders({ contentSecurityPolicy: { defaultSrc: ["'self'"], scriptSrc:["'self'",'https://plausible.shipsolo.io'], styleSrc:["'self'"], imgSrc:["'self'",'data:','blob:'], fontSrc:["'self'"], connectSrc:["'self'",'https://plausible.shipsolo.io'], formAction:["'self'"], frameAncestors:["'none'"], baseUri:["'self'"] }, referrerPolicy:'strict-origin-when-cross-origin' }));
app.use('*', async(c,next)=>{ c.header('Cache-Control','no-store'); await next(); });
app.use('/api/*', sameOrigin);
app.use('/api/*', bodyLimit({maxSize:6*1024*1024,onError:c=>c.json({error:'请求过大，图片最大 5 MB。'},413)}));
app.use('/admin',adminAuth);
app.use('/admin/*',adminAuth);
app.use('/api/admin/*',adminAuth);
app.onError((err,c)=>{console.error(err.message);return c.json({error:'暂时无法完成操作，请稍后重试。'},500);});
app.notFound(c=>c.html(layout('页面未找到',`<div class="empty"><span>404</span><h1>这份收藏暂时不在书架上</h1><p>资源可能已下架，或地址输入有误。</p><a class="button primary" href="/">返回资源书架</a></div>`,c.env.SITE_NAME,{noindex:true}),404));
const cats = async(db:D1Database) => (await db.prepare('SELECT * FROM categories ORDER BY position,name').all<Category>()).results;
const siteName = async(db:D1Database, fallback:string) => (await db.prepare("SELECT value FROM settings WHERE key='site_name'").first<{value:string}>())?.value||fallback;
const adminOpts = (env:AppEnv['Bindings'],nav:string) => ({admin:true,local:env.ENVIRONMENT==='local',nav,noindex:true});

app.get('/health',async c=>{await c.env.DB.prepare('SELECT 1').first();return c.json({ok:true});});
app.get('/',async c=>{
  const q=(c.req.query('q')||'').trim().slice(0,100), category=(c.req.query('category')||'').slice(0,64), provider=(c.req.query('provider')||'').slice(0,30);
  if(!q){const name=await siteName(c.env.DB,c.env.SITE_NAME);return c.html(layout('资源搜索',home([],[],0,'','',1,''),name,{canonical:c.env.SITE_ORIGIN?c.env.SITE_ORIGIN+'/':undefined}));}
  const page=Math.max(1,Math.min(10000,parseInt(c.req.query('page')||'1')||1));
  const filters=["r.status='published'"], args:unknown[]=[];
  if(category){filters.push('r.category_id=?');args.push(category);}
  if(provider){filters.push("EXISTS(SELECT 1 FROM links l WHERE l.resource_id=r.id AND l.provider=? AND l.status='active')");args.push(provider);}
  for(const term of q.split(/\s+/).filter(Boolean).slice(0,5)){filters.push("(r.title LIKE ? ESCAPE '\\' OR r.summary LIKE ? ESCAPE '\\' OR r.tags LIKE ? ESCAPE '\\')");const pattern='%'+term.replace(/[\\%_]/g,'\\$&')+'%';args.push(pattern,pattern,pattern);}
  const where=filters.join(' AND ');
  const [list,count,categories,name] = await Promise.all([
    c.env.DB.prepare(`SELECT r.*,c.name category_name,l.id share_id,l.url share_url,l.code share_code FROM resources r LEFT JOIN categories c ON r.category_id=c.id LEFT JOIN links l ON l.id=(SELECT id FROM links WHERE resource_id=r.id AND provider='quark' AND status='active' ORDER BY position,id LIMIT 1) WHERE ${where} ORDER BY r.updated_at DESC,r.id LIMIT 12 OFFSET ?`).bind(...args,(page-1)*12).all<Resource>(),
    c.env.DB.prepare(`SELECT count(*) n FROM resources r WHERE ${where}`).bind(...args).first<{n:number}>(),cats(c.env.DB),siteName(c.env.DB,c.env.SITE_NAME)
  ]);
  if(!count?.n&&page===1&&c.req.method==='GET'&&!category&&!provider){
    const keyword=q.replace(/\s+/g,' ').toLowerCase();
    await c.env.DB.prepare("INSERT INTO search_misses(keyword,count) VALUES(?,1) ON CONFLICT(keyword) DO UPDATE SET count=count+1,last_searched_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(keyword).run().catch(err=>console.error('Search tracking unavailable',err.message));
  }
  return c.html(layout(q?`搜索：${q}`:'发现资源',home(list.results,categories,count?.n||0,q,category,page,provider),name,{noindex:!!q,canonical:!q&&!category&&!provider&&page===1&&c.env.SITE_ORIGIN?c.env.SITE_ORIGIN+'/':undefined}));
});
app.get('/r/:id',async c=>{
  const r=await c.env.DB.prepare(`${selectResource} WHERE r.id=? AND r.status='published'`).bind(c.req.param('id')).first<Resource>();
  if(!r)return c.notFound();
  const [links,related,name]=await Promise.all([c.env.DB.prepare('SELECT * FROM links WHERE resource_id=? ORDER BY position').bind(r.id).all<Link>(),c.env.DB.prepare(`${selectResource} WHERE r.category_id=? AND r.status='published' AND r.id!=? ORDER BY r.updated_at DESC LIMIT 3`).bind(r.category_id,r.id).all<Resource>(),siteName(c.env.DB,c.env.SITE_NAME)]);
  return c.html(layout(r.title,detail(r,links.results,related.results,channel(c.req.query('from'))),name,{description:r.summary,canonical:c.env.SITE_ORIGIN?`${c.env.SITE_ORIGIN}/r/${r.id}`:undefined}));
});
function channel(raw?:string){return raw&&/^[a-zA-Z0-9_-]{1,40}$/.test(raw)?raw:'direct';}
app.get('/go/:id',async c=>{
  const link=await c.env.DB.prepare("SELECT l.* FROM links l JOIN resources r ON r.id=l.resource_id WHERE l.id=? AND l.status='active' AND r.status='published'").bind(c.req.param('id')).first<Link>();
  if(!link||!validLink(link.provider,link.url))return c.notFound();
  if(c.req.method==='GET')c.executionCtx.waitUntil(c.env.DB.prepare("INSERT INTO daily_clicks(day,resource_id,provider,channel,count) VALUES(?,?,?,?,1) ON CONFLICT(day,resource_id,provider,channel) DO UPDATE SET count=count+1").bind(new Date(Date.now()+8*3600000).toISOString().slice(0,10),link.resource_id,link.provider,channel(c.req.query('from'))).run().catch(err=>console.error('Click tracking unavailable',err.message)));
  c.header('X-Robots-Tag','noindex, nofollow'); return c.redirect(link.url,302);
});
app.get('/media/:key',c=>c.notFound());
app.get('/help',c=>c.redirect('/about',301));
app.get('/about',async c=>{
  const name=await siteName(c.env.DB,c.env.SITE_NAME);
  return c.html(layout('关于',`<article class="about-page prose"><a class="about-back" href="/">← 返回首页</a><h1>关于${e(name)}</h1><p>${e(name)}是一个夸克网盘资源分享站，整理学习资料、办公模板、设计素材、软件工具和 AI 教程，帮助你快速找到需要的内容。</p><h2>如何使用</h2><p>在首页搜索关键词，打开资源详情，按页面提示复制提取码、进入夸克网盘，保存到自己的账号。</p><h2>资源说明</h2><p>本站提供资源介绍和网盘分享链接，文件由网盘服务提供。分享链接可能失效，遇到问题可通过下方邮箱联系。标有“演示资料”的内容仅用于展示，没有真实下载链接。</p><p>请尊重创作者的版权，并遵守资源的使用许可。部分链接可能涉及网盘推广；网盘的保存、下载和收费规则以其页面说明为准。</p><h2>联系我</h2><p>资源建议、链接问题或版权反馈，请邮件联系，并附上相关资源页面和问题说明。</p><p><a class="about-email" href="mailto:dnboy985@gmail.com">dnboy985@gmail.com</a></p><h2>关于数据</h2><p>浏览本站无需注册。网站记录网盘入口的点击次数和来源渠道，资源需求仅用于补充内容；本站未命中的搜索词会记录次数和时间，供管理员完善资源库；同时记录被点击的网络资源标题、链接与时间，不记录搜索者身份。本站没有匹配结果时，会将搜索关键词发送到你启用的公开搜索来源；网络结果由外部来源提供，未逐一核实有效性。</p></article>`,name,{nav:'about',canonical:c.env.SITE_ORIGIN?`${c.env.SITE_ORIGIN}/about`:undefined}));
});
app.get('/robots.txt',c=>c.text(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /go/\n${c.env.SITE_ORIGIN?`Sitemap: ${c.env.SITE_ORIGIN}/sitemap.xml\n`:''}`));
app.get('/sitemap.xml',async c=>{
  const rows=(await c.env.DB.prepare("SELECT id,updated_at FROM resources WHERE status='published' AND demo=0 ORDER BY updated_at DESC LIMIT 45000").all<Resource>()).results;
  if(!c.env.SITE_ORIGIN)return c.text('Site origin not configured',503);
  c.header('Content-Type','application/xml;charset=UTF-8');return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/','/about',...rows.map(r=>'/r/'+r.id)].map(path=>`<url><loc>${e(c.env.SITE_ORIGIN+path)}</loc></url>`).join('')}</urlset>`);
});
app.get('/admin',async c=>{
  const q=(c.req.query('q')||'').slice(0,100), status=c.req.query('status')||'';
  const page=Math.max(1,parseInt(c.req.query('page')||'1')||1), filters=['1=1'],args:unknown[]=[];
  if(q){filters.push('r.title LIKE ?');args.push('%'+q+'%');}if(['draft','published','archived'].includes(status)){filters.push('r.status=?');args.push(status);}
  const [rows,counts]=await Promise.all([c.env.DB.prepare(`${selectResource} WHERE ${filters.join(' AND ')} ORDER BY r.updated_at DESC LIMIT 30 OFFSET ?`).bind(...args,(page-1)*30).all<Resource>(),c.env.DB.prepare('SELECT status,count(*) n FROM resources GROUP BY status').all<{status:string;n:number}>()]);
  const statuses:Record<string,string>={draft:'草稿',published:'已发布',archived:'已下架'};
  const content=adminHeading('资源管理','每一份资源，都可以在这里更新和维护。','<a class="button primary" href="/admin/new">＋ 发布新资源</a>')+`<div class="stats-row">${['published','draft','archived'].map(s=>`<a class="stat-card" href="/admin?status=${s}"><span>${statuses[s]}</span><strong>${counts.results.find(x=>x.status===s)?.n||0}</strong></a>`).join('')}</div><section class="panel"><form class="admin-search" method="get"><input name="q" placeholder="查找资源标题" aria-label="查找资源标题" value="${e(q)}"><select name="status" aria-label="资源状态">${option('','全部状态',status)}${Object.entries(statuses).map(([k,v])=>option(k,v,status)).join('')}</select><button class="button">筛选</button></form><div class="table-wrap"><table><thead><tr><th>资源</th><th>状态</th><th>更新日期</th><th>操作</th></tr></thead><tbody>${rows.results.map(r=>`<tr><td><a class="table-title" href="/admin/edit/${e(r.id)}">${e(r.title)}</a>${r.demo?'<span class="tiny-label">演示</span>':''}${r.featured?'<span class="tiny-label">精选</span>':''}</td><td><span class="status ${r.status}">${statuses[r.status]}</span></td><td>${r.updated_at.slice(0,10)}</td><td class="table-actions"><a href="/admin/edit/${r.id}">编辑</a><a href="/admin/preview/${r.id}" target="_blank">预览</a><button class="text-button danger" data-delete-resource="${r.id}">删除</button></td></tr>`).join('')||'<tr><td colspan="4" class="empty-cell">暂无资源，发布第一份收藏吧。</td></tr>'}</tbody></table></div><nav class="pagination">${page>1?`<a href="/admin?${new URLSearchParams({q,status,page:String(page-1)})}">上一页</a>`:''}<span>第 ${page} 页</span>${rows.results.length===30?`<a href="/admin?${new URLSearchParams({q,status,page:String(page+1)})}">下一页</a>`:''}</nav></section>`;
  return c.html(layout('资源管理',content,await siteName(c.env.DB,c.env.SITE_NAME),adminOpts(c.env,'resources')));
});
app.get('/admin/new',async c=>c.html(layout('发布资源',editor({},[]),await siteName(c.env.DB,c.env.SITE_NAME),adminOpts(c.env,'resources'))));
app.get('/admin/edit/:id',async c=>{
  const r=await c.env.DB.prepare(`${selectResource} WHERE r.id=?`).bind(c.req.param('id')).first<Resource>();if(!r)return c.notFound();
  const links=(await c.env.DB.prepare('SELECT * FROM links WHERE resource_id=? ORDER BY position').bind(r.id).all<Link>()).results;
  return c.html(layout('编辑资源',editor(r,links),await siteName(c.env.DB,c.env.SITE_NAME),adminOpts(c.env,'resources')));
});
app.get('/admin/preview/:id',async c=>{
  const r=await c.env.DB.prepare(`${selectResource} WHERE r.id=?`).bind(c.req.param('id')).first<Resource>();if(!r)return c.notFound();
  return c.html(layout('预览资源',detail(r,(await c.env.DB.prepare('SELECT * FROM links WHERE resource_id=? ORDER BY position').bind(r.id).all<Link>()).results,[],'direct',true),await siteName(c.env.DB,c.env.SITE_NAME),{noindex:true}));
});

type ResourceInput = {title:string;url:string};
function parseResource(b:any):ResourceInput {
  if(!b||typeof b.title!=='string'||!b.title.trim()||b.title.trim().length>120)throw new Error('请填写 120 字以内的资源标题。');
  if(typeof b.url!=='string'||b.url.length>2048||!validLink('quark',b.url.trim()))throw new Error('请填写夸克网盘的 HTTPS 分享链接。');
  return {title:b.title.trim(),url:b.url.trim()};
}
async function saveResource(db:D1Database,b:ResourceInput,id:string,existing:boolean) {
  const link=existing?await db.prepare("SELECT id,code,url FROM links WHERE resource_id=? AND provider='quark' ORDER BY position,id LIMIT 1").bind(id).first<Link>():null;
  const main=existing?db.prepare("UPDATE resources SET title=?,status='published',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(b.title,id):db.prepare("INSERT INTO resources(id,title,status) VALUES(?,?,'published')").bind(id,b.title);
  // Keep existing link IDs and extraction codes when editing the same URL.
  const code=link?.url===b.url?link.code:'';
  await db.batch([main,db.prepare("INSERT INTO links(id,resource_id,provider,url,code,status,position) VALUES(?,?,'quark',?,?,'active',0) ON CONFLICT(id) DO UPDATE SET url=excluded.url,code=excluded.code,status='active'").bind(link?.id||uid(),id,b.url,code)]);
}
app.post('/api/admin/resources',async c=>{try{const b=parseResource(await c.req.json());const id=uid();await saveResource(c.env.DB,b,id,false);return c.json({ok:true,id},201);}catch(err){return c.json({error:(err as Error).message},400);}});
app.put('/api/admin/resources/:id',async c=>{try{const id=c.req.param('id');if(!await c.env.DB.prepare('SELECT id FROM resources WHERE id=?').bind(id).first())return c.json({error:'资源不存在。'},404);await saveResource(c.env.DB,parseResource(await c.req.json()),id,true);return c.json({ok:true,id});}catch(err){return c.json({error:(err as Error).message},400);}});
app.delete('/api/admin/resources/:id',async c=>{await c.env.DB.prepare('DELETE FROM resources WHERE id=?').bind(c.req.param('id')).run();return c.json({ok:true});});
app.post('/api/admin/upload',c=>c.json({error:'当前不支持图片上传。'},404));

app.get('/admin/search-misses',async c=>{
  const page=Math.max(1,Math.min(10000,parseInt(c.req.query('page')||'1')||1));
  const rows=(await c.env.DB.prepare('SELECT * FROM search_misses ORDER BY last_searched_at DESC,keyword LIMIT 51 OFFSET ?').bind((page-1)*50).all<{keyword:string;count:number;first_searched_at:string;last_searched_at:string}>()).results;
  const clicks=(await c.env.DB.prepare('SELECT keyword,title,url,count(*) clicks,max(clicked_at) latest FROM network_result_clicks WHERE keyword IN (SELECT keyword FROM search_misses ORDER BY last_searched_at DESC,keyword LIMIT 50 OFFSET ?) GROUP BY keyword,url ORDER BY latest DESC').bind((page-1)*50).all<{keyword:string;title:string;url:string;clicks:number;latest:string}>()).results;
  const time=(v:string)=>e(new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}));
  return c.html(layout('未命中搜索',adminHeading('未命中搜索','记录本站资源库没有匹配内容的搜索词，即使网络搜索有结果也会记录。相同词合并计数；同时记录用户点击的网络资源。','<a class="button" href="/api/admin/search-misses/export">导出 CSV ↓</a>')+`<section class="panel"><div class="table-wrap"><table><thead><tr><th>搜索词</th><th>搜索次数</th><th>首次搜索</th><th>最近搜索</th><th>点击的网络资源</th></tr></thead><tbody>${rows.slice(0,50).map(r=>`<tr><td>${e(r.keyword)}</td><td>${r.count}</td><td>${time(r.first_searched_at)}</td><td>${time(r.last_searched_at)}</td><td>${clicks.filter(x=>x.keyword===r.keyword).map(x=>`<p><a href="${e(x.url)}" target="_blank" rel="noopener noreferrer">${e(x.title)}</a><br><small>${x.clicks} 次点击 · ${time(x.latest)}</small></p>`).join('')||'暂无点击'}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-cell">暂时没有未命中的搜索。</td></tr>'}</tbody></table></div><nav class="pagination">${page>1?`<a href="?page=${page-1}">上一页</a>`:''}<span>第 ${page} 页</span>${rows.length>50?`<a href="?page=${page+1}">下一页</a>`:''}</nav></section>`,await siteName(c.env.DB,c.env.SITE_NAME),adminOpts(c.env,'search-misses')));
});
app.get('/api/admin/search-misses/export',async c=>{
 const rows=(await c.env.DB.prepare(`SELECT m.keyword,m.count,m.first_searched_at,m.last_searched_at,n.title,n.url,count(n.id) clicks,max(n.clicked_at) last_clicked_at FROM search_misses m LEFT JOIN network_result_clicks n ON n.keyword=m.keyword GROUP BY m.keyword,n.url ORDER BY m.last_searched_at DESC,m.keyword,last_clicked_at DESC`).all<Record<string,unknown>>()).results;
 const columns=['keyword','count','first_searched_at','last_searched_at','title','url','clicks','last_clicked_at'];
 const header=['搜索词','搜索次数','首次搜索时间（UTC）','最近搜索时间（UTC）','点击的资源标题','网盘链接','点击次数','最近点击时间（UTC）'];
 c.header('Content-Type','text/csv;charset=utf-8');c.header('Content-Disposition','attachment; filename="search-misses.csv"');
 return c.body('\uFEFF'+[header.map(csvCell).join(','),...rows.map(r=>columns.map(k=>csvCell(r[k])).join(','))].join('\r\n')+'\r\n');
});
app.post('/api/network-click',async c=>{
 const b=await c.req.json().catch(()=>null);
 const click=await readClick(caches.default,c.req.url,b?.token,b?.index);
 if(!click||!validLink('quark',click.url))return c.json({error:'搜索记录已过期。'},400);
 await c.env.DB.batch([
   c.env.DB.prepare('INSERT INTO search_misses(keyword,count) VALUES(?,1) ON CONFLICT(keyword) DO NOTHING').bind(click.keyword),
   c.env.DB.prepare('INSERT INTO network_result_clicks(id,keyword,title,url) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(click.id,click.keyword,click.title,click.url)
 ]);
 return c.json({ok:true});
});
app.get('/admin/stats',async c=>{
  const [total,resources,channels]=await Promise.all([c.env.DB.prepare("SELECT coalesce(sum(count),0) n FROM daily_clicks WHERE day>=date('now','+8 hours','-29 days')").first<{n:number}>(),c.env.DB.prepare("SELECT r.title,r.id,sum(d.count) n FROM daily_clicks d JOIN resources r ON r.id=d.resource_id WHERE d.day>=date('now','+8 hours','-29 days') GROUP BY r.id ORDER BY n DESC LIMIT 20").all<any>(),c.env.DB.prepare("SELECT channel,sum(count) n FROM daily_clicks WHERE day>=date('now','+8 hours','-29 days') GROUP BY channel ORDER BY n DESC LIMIT 30").all<any>()]);
  return c.html(layout('点击统计',adminHeading('点击统计','最近 30 天 · 北京时间 · 网盘入口点击次数，不代表实际拉新人数或佣金。')+`<div class="stats-row"><div class="stat-card"><span>网盘入口点击</span><strong>${total?.n||0}</strong></div></div><div class="admin-two-col"><section class="panel"><h2>热门资源</h2>${resources.results.map(r=>`<div class="category-admin-row"><a href="/r/${e(r.id)}">${e(r.title)}</a><b>${r.n}</b></div>`).join('')||'<p class="muted">暂时没有点击数据。</p>'}</section><section class="panel"><h2>访问渠道</h2>${channels.results.map(r=>`<div class="category-admin-row"><span>${r.channel==='direct'?'直接访问':e(r.channel)}</span><b>${r.n}</b></div>`).join('')||'<p class="muted">暂时没有渠道数据。</p>'}<p class="hint">分享资源页时加上 ?from=xiaohongshu 或 ?from=wechat，就能区分不同渠道的网盘点击。</p></section></div>`,await siteName(c.env.DB,c.env.SITE_NAME),adminOpts(c.env,'stats')));
});
app.get('/admin/settings',async c=>{
  const settings=Object.fromEntries((await c.env.DB.prepare('SELECT * FROM settings').all<{key:string;value:string}>()).results.map(r=>[r.key,r.value]));
  return c.html(layout('网站设置',adminHeading('网站设置','维护网站名称与联系信息。')+`<form id="settings-form" class="panel narrow"><label>网站名称<input name="site_name" required maxlength="30" value="${e(settings.site_name||c.env.SITE_NAME)}"></label><label>联系邮箱<input type="email" name="contact_email" maxlength="200" value="${e(settings.contact_email||'')}" placeholder="公开显示在使用帮助页"></label><button class="button primary">保存设置</button></form>`,await siteName(c.env.DB,c.env.SITE_NAME),adminOpts(c.env,'settings')));
});
app.put('/api/admin/settings',async c=>{const b=await c.req.json();if(typeof b.site_name!=='string'||!b.site_name.trim()||b.site_name.length>30||typeof b.contact_email!=='string'||b.contact_email.length>200||(b.contact_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.contact_email)))return c.json({error:'请检查网站名称和邮箱格式。'},400);await c.env.DB.batch(['site_name','contact_email'].map(k=>c.env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k,b[k].trim())));return c.json({ok:true});});
app.get('/admin/data',async c=>c.html(layout('导入与备份',adminHeading('导入与备份','批量整理已有资源，保留一份自己的数据副本。')+`<div class="admin-two-col"><section class="panel"><h2>从 CSV 导入资源</h2><p class="muted">每次最多 15 条，先检查内容再确认导入。确认后直接发布。</p><a class="text-link" href="/api/admin/import-template">下载 CSV 模板 ↓</a><label>选择 CSV 文件<input id="csv-file" type="file" accept=".csv,text/csv"></label><p class="hint">列名：title（标题）、url（链接）。当前网盘类型为夸克。</p><div id="import-preview"></div><button class="button primary" id="confirm-import" hidden>确认导入并发布</button></section><section class="panel"><h2>导出网站数据</h2><p>导出资源、网盘链接、搜索记录、资源需求、点击统计和网站设置（包含历史数据）。</p><a class="button" href="/api/admin/export">下载 JSON 备份 ↓</a><p class="hint">当前不存储图片。JSON 可用于检查和迁移；完整数据库恢复请使用部署文档中的 D1 备份方式。</p><hr><h2>演示资料</h2><p class="muted">正式使用前，可以清空本地预置的演示资源。你自己发布的资源会保留。</p><button class="button" id="clear-demo">清空演示资料</button></section></div>`,await siteName(c.env.DB,c.env.SITE_NAME),adminOpts(c.env,'data'))));
app.get('/api/admin/import-template',c=>{c.header('Content-Type','text/csv;charset=utf-8');c.header('Content-Disposition','attachment; filename="resource-template.csv"');return c.body('\uFEFFtitle,url\r\n');});
app.get('/api/admin/export',async c=>{
  const tables=['categories','resources','links','reports','resource_requests','search_misses','network_result_clicks','daily_clicks','settings'];const data:Record<string,unknown>={version:1,exported_at:new Date().toISOString()};
  for(const t of tables)data[t]=(await c.env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
  c.header('Content-Disposition',`attachment; filename="resource-hub-${new Date().toISOString().slice(0,10)}.json"`);return c.json(data);
});
app.post('/api/admin/import',async c=>{
  try{
    const b=await c.req.json();if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>15)return c.json({error:'每次请导入 1–15 条资源。'},400);
    const seen=new Set<string>();const inputs:ResourceInput[]=[];
    for(const row of b.rows){
      if(typeof row.title!=='string')throw new Error('CSV 缺少 title 列。');const title=row.title.trim();if(seen.has(title)||await c.env.DB.prepare('SELECT id FROM resources WHERE title=?').bind(title).first())throw new Error(`资源标题重复：${title}`);seen.add(title);
      inputs.push(parseResource(row));
    }
    if(b.confirm!==true)return c.json({ok:true,preview:inputs.map(r=>({title:r.title,url:r.url}))});
    const statements:D1PreparedStatement[]=[];for(const r of inputs){const id=uid();statements.push(c.env.DB.prepare("INSERT INTO resources(id,title,status) VALUES(?,?,'published')").bind(id,r.title),c.env.DB.prepare("INSERT INTO links(id,resource_id,provider,url,code,status,position) VALUES(?,?,'quark',?,'','active',0)").bind(uid(),id,r.url));}
    await c.env.DB.batch(statements);return c.json({ok:true,count:inputs.length});
  }catch(err){return c.json({error:(err as Error).message},400);}
});
app.delete('/api/admin/demo',async c=>{await c.env.DB.prepare('DELETE FROM resources WHERE demo=1').run();return c.json({ok:true});});
app.get('/request',async c=>c.html(layout('求资源',`<section class="about-page"><a class="about-back" href="/">← 返回首页</a><h1>没找到想要的资源？</h1><p class="muted">告诉我们你需要什么，收到后会查看并尽量补充。</p><form id="request-form" class="panel"><label>资源名称<input name="title" required maxlength="100" value="${e((c.req.query('q')||'').slice(0,100))}" placeholder="例如：Excel 入门教程"></label><label>补充说明（选填）<textarea name="note" rows="4" maxlength="1000" placeholder="版本、作者、用途等，越具体越容易找到"></textarea></label><label class="honeypot" aria-hidden="true">留空<input name="website" tabindex="-1" autocomplete="off"></label><button class="button primary" type="submit">提交需求</button><p id="request-status" role="status" class="muted">提交内容仅管理员可见，请勿填写密码等敏感信息。</p></form></section>`,await siteName(c.env.DB,c.env.SITE_NAME),{noindex:true})));
app.post('/api/requests',async c=>{
 const b=await c.req.json().catch(()=>null);
 if(!b||typeof b!=='object')return c.json({error:'提交格式不正确。'},400);
 if(b.website)return c.json({ok:true});
 if(typeof b.title!=='string'||!b.title.trim()||b.title.length>100||typeof b.note!=='string'||b.note.length>1000)return c.json({error:'请填写 100 字以内的资源名称和 1000 字以内的说明。'},400);
 const hour=Math.floor(Date.now()/3600000),ip=c.req.header('CF-Connecting-IP')||'local';
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`request:${hour}:${ip}`)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const rate=await c.env.DB.prepare('INSERT INTO report_limits(fingerprint,window,count) VALUES(?,?,1) ON CONFLICT(fingerprint) DO UPDATE SET count=count+1 RETURNING count').bind(fingerprint,hour).first<{count:number}>();
 if((rate?.count||0)>5)return c.json({error:'本小时提交较多，请稍后再试。'},429);
 await c.env.DB.batch([c.env.DB.prepare('INSERT INTO resource_requests(id,title,note) VALUES(?,?,?)').bind(uid(),b.title.trim(),b.note.trim()),c.env.DB.prepare('DELETE FROM report_limits WHERE window<?').bind(hour-2)]);
 return c.json({ok:true});
});
app.get('/admin/requests',async c=>{
 const page=Math.max(1,parseInt(c.req.query('page')||'1')||1);
 const rows=(await c.env.DB.prepare("SELECT * FROM resource_requests ORDER BY status ASC,created_at DESC LIMIT 30 OFFSET ?").bind((page-1)*30).all<{id:string;title:string;note:string;status:string;created_at:string}>()).results;
 return c.html(layout('求资源',adminHeading('求资源','查看用户需要的资源，处理完成后标记。')+`<section class="panel">${rows.map(r=>`<article class="report-row"><div><strong>${e(r.title)}</strong><p>${e(r.note||'没有补充说明')}</p><small>${e(r.created_at.slice(0,10))}</small></div><button class="button" data-request-id="${e(r.id)}" data-request-status="${r.status==='open'?'resolved':'open'}">${r.status==='open'?'标记已处理':'已处理 · 重新打开'}</button></article>`).join('')||'<div class="empty"><h2>暂无资源需求</h2><p>用户提交的需求会出现在这里。</p></div>'}<nav class="pagination">${page>1?`<a href="?page=${page-1}">上一页</a>`:''}<span>第 ${page} 页</span>${rows.length===30?`<a href="?page=${page+1}">下一页</a>`:''}</nav></section>`,await siteName(c.env.DB,c.env.SITE_NAME),adminOpts(c.env,'requests')));
});
app.patch('/api/admin/requests/:id',async c=>{
 const b=await c.req.json().catch(()=>null);if(!['open','resolved'].includes(b?.status))return c.json({error:'状态不正确。'},400);
 const result=await c.env.DB.prepare('UPDATE resource_requests SET status=? WHERE id=?').bind(b.status,c.req.param('id')).run();
 return result.meta.changes?c.json({ok:true}):c.json({error:'需求不存在。'},404);
});

app.post('/api/network-search',async c=>{
 const b=await c.req.json().catch(()=>null);if(typeof b?.q!=='string'||!b.q.trim()||b.q.length>100||!Array.isArray(b.sources)||b.sources.length>searchSources.length||b.sources.some((id:unknown)=>!searchSources.some(s=>s.id===id)))return c.json({error:'请检查关键词和搜索来源。'},400);
 const q=b.q.trim(),ids=[...new Set<string>(b.sources)].sort();
 // Check local inventory again at request time, even when called directly.
 const args:string[]=[],filters=["status='published'"];
 for(const term of q.split(/\s+/).filter(Boolean).slice(0,5)){const p='%'+term.replace(/[\\%_]/g,'\\$&')+'%';filters.push("(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')");args.push(p,p,p);}
 if(await c.env.DB.prepare('SELECT id FROM resources WHERE '+filters.join(' AND ')+' LIMIT 1').bind(...args).first())return c.json({local:true,items:[],sources:[]});
 if(!ids.length)return c.json({local:false,items:[],sources:[],disabled:true});
 const window=Math.floor(Date.now()/600000),ip=c.req.header('CF-Connecting-IP')||'local';
 const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const rate=await c.env.DB.prepare('INSERT INTO report_limits(fingerprint,window,count) VALUES(?,?,1) ON CONFLICT(fingerprint) DO UPDATE SET count=count+1 RETURNING count').bind(await hash(`search:${window}:${ip}`),Math.floor(Date.now()/3600000)).first<{count:number}>();
 if((rate?.count||0)>30)return c.json({error:'搜索过于频繁，请稍后再试。'},429);
 c.executionCtx.waitUntil(c.env.DB.prepare('DELETE FROM report_limits WHERE window<?').bind(Math.floor(Date.now()/3600000)-2).run());
 const cache=caches.default,key=new Request(new URL('/_network-cache/'+await hash(JSON.stringify([q,ids,'pansou-v4-first-valid'])),c.req.url));
 const tracked=async(data:any)=>{
   if(!data.items?.length)return c.json(data);
   try{const clickToken=await issueClickToken(cache,c.req.url,{keyword:q.replace(/\s+/g,' ').toLowerCase(),items:data.items.map((item:any)=>({title:item.title,url:item.url}))});return c.json({...data,clickToken});}
   catch(err){console.error('Click tracking unavailable');return c.json(data);}
 };
 const cached=await cache.match(key);if(cached)return tracked({...await cached.json<any>(),cached:true});
 const data={local:false,...await networkSearch(q,ids,c.env)};
 if(data.items.length&&data.sources.every(s=>s.status==='ok'))c.executionCtx.waitUntil(cache.put(key,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=300'}})));
 return tracked(data);
});

export default app;
