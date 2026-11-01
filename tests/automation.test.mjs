import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';

const bundle=await build({entryPoints:['src/index.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'container-stub',setup(b){
 b.onResolve({filter:/^@cloudflare\/containers$/},()=>({path:'containers',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export class Container {}',loader:'js'}));
}}]});
const {default:app}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const token='automation_test_key_'+ 'x'.repeat(43);
const base='https://example.test';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+file,'utf8'));
 let failLink=false,serial=Promise.resolve();
 const statement=(sql,args=[])=>({bind:(...values)=>statement(sql,values),
  async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},
  async run(){if(failLink&&sql.startsWith('INSERT INTO links'))throw Error('test link write failure');const result=db.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}
 });
 const DB={prepare:sql=>statement(sql),batch(statements){
  const work=serial.then(async()=>{db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(err){db.exec('ROLLBACK');throw err;}});
  serial=work.catch(()=>{});return work;
 }};
 const env={DB,ENVIRONMENT:'production',SITE_NAME:'测试资源库',SITE_ORIGIN:base,AUTOMATION_API_TOKEN:token};
 const request=(path,method='GET',body,headers={},bindings={})=>app.fetch(new Request(base+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined}),{...env,...bindings},{waitUntil:()=>{}});
 let seq=0;
 return {db,request,
  async list(query=''){const r=await request('/api/automation/resources'+query);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/json/);assert.equal(r.headers.get('content-disposition'),null);assert.equal(r.headers.get('cache-control'),'no-store');return r.json();},
  source(keyword='excel',provider='quark',url='https://pan.quark.cn/s/source',title='Excel 资料',time='2026-10-31T00:00:00Z'){
   db.prepare('INSERT INTO search_misses(keyword,provider) VALUES(?,?) ON CONFLICT DO NOTHING').run(keyword,provider);
   db.prepare('INSERT INTO network_result_clicks(id,keyword,provider,title,url,clicked_at) VALUES(?,?,?,?,?,?)').run('click-'+seq++,keyword,provider,title,url,time);
  },
  own(id='existing',url='https://pan.quark.cn/s/owned',status='published'){
   db.prepare('INSERT INTO resources(id,title,status) VALUES(?,?,?)').run(id,'已有资源',status);
   db.prepare('INSERT INTO links(id,resource_id,provider,url) VALUES(?,?,?,?)').run('link-'+id,id,url.includes('baidu')?'baidu':'quark',url);
  },
  complete(item,body={}){return request('/api/automation/resources/complete','POST',{sourceId:item.id,sourceUrl:item.sourceUrl,title:'转存后的 Excel',url:'https://pan.quark.cn/s/new-share?pwd=abcd',...body});},
  failLink(){failLink=true;},count:table=>db.prepare('SELECT count(*) n FROM '+table).get().n
 };
}

test('自动化接口始终需要独立密钥，错误认证不泄漏数据也不授予后台权限',async t=>{
 const f=fixture(t);f.source();
 for(const Authorization of ['', 'Bearer wrong','Basic '+token,'Bearer '+ 'z'.repeat(64)]){
  const r=await f.request('/api/automation/resources','GET',undefined,{Authorization});assert.equal(r.status,401);assert.equal(r.headers.get('www-authenticate'),'Bearer');assert.ok(!(await r.text()).includes('Excel 资料'));
 }
 for(const AUTOMATION_API_TOKEN of [undefined,'short','bad token'.repeat(8)])assert.equal((await f.request('/api/automation/resources','GET',undefined,{}, {AUTOMATION_API_TOKEN,ENVIRONMENT:'local'})).status,503);
 assert.equal((await f.request('/api/admin/export')).status,503);
 assert.equal((await f.request('/api/admin/resources','POST',{title:'不应发布',url:'https://pan.quark.cn/s/a'},{Origin:base})).status,503);
 assert.equal(f.count('resources'),0);
});

test('JSON 待处理资源按实际网盘识别历史记录，聚合关键词并去重分享链接',async t=>{
 const f=fixture(t);
 f.source('excel','quark','https://pan.quark.cn/s/source?from=search','旧标题','2026-10-30T00:00:00Z');
 f.source('办公','quark','https://pan.quark.cn/s/source?pwd=abcd','新标题');
 f.source('老词','unknown','https://pan.baidu.com/s/baidu','历史百度资料');
 f.db.prepare("INSERT INTO search_misses(keyword,provider) VALUES('只有搜索词','quark')").run();
 const q=await f.list();assert.equal(q.items.length,1);const item=q.items[0];assert.equal(item.provider,'quark');assert.equal(item.title,'新标题');assert.equal(item.extractionCode,'abcd');assert.equal(item.clickCount,2);assert.deepEqual(item.keywords,['excel','办公']);assert.match(item.id,/^src_[a-f0-9]{64}$/);assert.equal(q.nextCursor,null);
 const b=await f.list('?provider=baidu');assert.equal(b.items.length,1);assert.equal(b.items[0].provider,'baidu');assert.deepEqual(b.items[0].keywords,['老词']);
 assert.equal((await f.list('?provider=all')).items.length,2);
});

test('最新点击不含提取码时保留同一分享历史记录中的提取码',async t=>{
 const f=fixture(t);
 f.source('旧词','quark','https://pan.quark.cn/s/source?pwd=abcd','旧标题','2026-10-30T00:00:00Z');
 f.source('新词','quark','https://pan.quark.cn/s/source','新标题');
 const {items}=await f.list();assert.equal(items.length,1);const item=items[0];
 assert.equal(item.sourceUrl,'https://pan.quark.cn/s/source');assert.equal(item.title,'新标题');
 assert.equal(item.lastClickedAt,'2026-10-31T00:00:00Z');assert.equal(item.extractionCode,'abcd');assert.equal(item.clickCount,2);
 assert.equal((await f.complete(item)).status,201);
});

test('分页游标在前页完成后仍可继续，无效参数或跨网盘游标被拒绝',async t=>{
 const f=fixture(t);for(let i=0;i<4;i++)f.source('excel','quark','https://pan.quark.cn/s/source'+i);
 const first=await f.list('?limit=2');assert.equal(first.items.length,2);assert.equal(first.hasMore,true);
 for(const item of first.items)assert.equal((await f.complete(item,{url:'https://pan.quark.cn/s/new-'+item.id})).status,201);
 const next=await f.list('?limit=2&cursor='+first.nextCursor);assert.equal(next.items.length,2);assert.equal(next.hasMore,false);assert.ok(next.items.every(item=>!first.items.some(prior=>prior.id===item.id)));
 for(const query of ['?provider=bad','?provider=unknown','?limit=0','?limit=101','?limit=1.5','?limit=-1','?cursor=garbage','?status=completed','?provider=baidu&cursor='+first.nextCursor])assert.equal((await f.request('/api/automation/resources'+query)).status,400,query);
});

test('已发布的同一链接和有效已处理来源不返回，下架后可重新处理',async t=>{
 const f=fixture(t);f.source();f.source('已发布','quark','https://pan.quark.cn/s/already-owned?from=search');f.own('same','https://pan.quark.cn/s/already-owned');
 const list=await f.list();assert.equal(list.items.length,1);
 const response=await f.complete(list.items[0]);assert.equal(response.status,201);const data=await response.json();
 assert.equal((await f.list()).items.length,0);
 f.db.prepare("UPDATE resources SET status='archived' WHERE id=?").run(data.resource.id);
 assert.equal((await f.list()).items.length,1);
 const again=await f.complete(list.items[0]);assert.equal(again.status,201);assert.notEqual((await again.json()).resource.id,data.resource.id);
 assert.equal(f.db.prepare('SELECT status FROM resources WHERE id=?').get(data.resource.id).status,'archived');
});

test('提交一次完成资源发布及已处理标记；重试和并发不会重复发布',async t=>{
 const f=fixture(t);f.source();const item=(await f.list()).items[0];
 const responses=await Promise.all([f.complete(item),f.complete(item)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
 const saved=await responses[0].json(),other=await responses[1].json();assert.equal(saved.resource.id,other.resource.id);
 assert.equal(f.count('resources'),1);assert.equal(f.count('links'),1);assert.equal(f.count('processed_search_resources'),1);
 assert.equal(f.db.prepare('SELECT code FROM links').get().code,'abcd');assert.equal(f.db.prepare('SELECT status FROM resources').get().status,'published');
 assert.equal((await f.complete(item,{title:'重复提交的不同标题',url:'https://pan.quark.cn/s/another'})).status,200);
 assert.equal(f.db.prepare('SELECT title FROM resources').get().title,'转存后的 Excel');assert.equal(f.count('resources'),1);
 assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('后台已关联的来源可安全重试，不新增资源或覆盖人工记录',async t=>{
 const f=fixture(t);f.source();const item=(await f.list()).items[0];f.own();
 f.db.prepare('INSERT INTO processed_search_resources(source_identity,source_url,resource_id,target_url) VALUES(?,?,?,?)').run('quark:/s/source',item.sourceUrl,'existing','https://pan.quark.cn/s/owned');
 const response=await f.complete(item);assert.equal(response.status,200);const data=await response.json();assert.equal(data.status,'already_processed');assert.equal(data.resource.id,'existing');assert.equal(f.count('resources'),1);
});

test('写入失败整批回滚，记录仍待处理，可恢复后重新提交',async t=>{
 const f=fixture(t);f.source();const item=(await f.list()).items[0];f.failLink();
 assert.equal((await f.complete(item)).status,500);assert.equal(f.count('resources'),0);assert.equal(f.count('links'),0);assert.equal(f.count('processed_search_resources'),0);assert.equal((await f.list()).items.length,1);
});

test('拒绝伪造来源、危险链接、超长标题及浏览器跨站提交',async t=>{
 const f=fixture(t);f.source();const item=(await f.list()).items[0];
 for(const body of [{sourceId:'fake'},{sourceUrl:'https://pan.quark.cn/s/not-recorded'},{url:'javascript:alert(1)'},{url:'https://pan.quark.cn.evil.example/s/a'},{title:''},{title:'x'.repeat(121)}])assert.equal((await f.complete(item,body)).status,400);
 f.db.prepare('DELETE FROM network_result_clicks').run();assert.equal((await f.complete(item)).status,404);
 const payload={sourceId:item.id,sourceUrl:item.sourceUrl,title:'标题',url:'https://pan.quark.cn/s/new'};
 assert.equal((await f.request('/api/automation/resources/complete','POST',payload,{Origin:'https://evil.test','Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal((await f.request('/api/automation/resources/complete','POST',{...payload,title:'x'.repeat(17000)})).status,413);
 assert.equal(f.count('resources'),0);
});
