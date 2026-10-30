import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const bundled=await build({
 entryPoints:['src/index.ts'],bundle:true,write:false,platform:'node',format:'esm',
 plugins:[{name:'container-node-stub',setup(b){
  b.onResolve({filter:/^@cloudflare\/containers$/},()=>({path:'containers',namespace:'node-stub'}));
  b.onLoad({filter:/.*/,namespace:'node-stub'},()=>({contents:'export class Container {}',loader:'js'}));
 }}]
});
const {default:app}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('migrations/'+file,'utf8'));
 t.after(()=>sqlite.close());
 const statement=(sql,args=[])=>({
  bind:(...values)=>statement(sql,values),
  async first(){return sqlite.prepare(sql).get(...args)||null;},
  async all(){return {results:sqlite.prepare(sql).all(...args)};},
  async run(){const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}
 });
 const DB={prepare:sql=>statement(sql),batch:async statements=>{
  sqlite.exec('BEGIN');
  try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}
  catch(error){sqlite.exec('ROLLBACK');throw error;}
 }};
 const entries=new Map();
 const cache={put:async(key,response)=>entries.set(key.url,response.clone()),match:async key=>entries.get(key.url)?.clone()};
 const previousCaches=globalThis.caches;
 globalThis.caches={default:cache};
 t.after(()=>{globalThis.caches=previousCaches;});
 let items=[{provider:'quark',url:'https://pan.quark.cn/s/network'}],failed=false,state='ok',searchCalls=0;
 const origin='https://example.test';
 const env={DB,ENVIRONMENT:'production',SITE_NAME:'测试资源库',SITE_ORIGIN:origin,
  PANSOU_CONTAINER:{getByName:()=>({fetch:async(url,init)=>{
   const body=JSON.parse(init.body);
   if(url.endsWith('/api/check/links'))return Response.json({results:body.items.map(item=>({...item,state}))});
   assert.ok(url.endsWith('/api/search'));searchCalls++;
   if(failed)throw Error('test upstream unavailable');
   const merged={};
   for(const item of items){(merged[item.provider]||=[]).push({url:item.url,note:item.title||body.kw+' 教程',source:'plugin:pansearch',datetime:'2026-10-01T00:00:00Z'});}
   return Response.json({code:0,data:{total:items.length,merged_by_type:merged}});
  }})}
 };
 const request=async(path,method='GET',body,local=false)=>{
  const pending=[];
  const requestOrigin=local?'http://127.0.0.1:8787':origin;
  const bindings=local?{...env,ENVIRONMENT:'local',SITE_ORIGIN:requestOrigin}:env;
  const response=await app.fetch(new Request(requestOrigin+path,{method,headers:{Origin:requestOrigin,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),bindings,{waitUntil:p=>pending.push(p)});
  await Promise.all(pending);return response;
 };
 return {
  request,
  admin:path=>request(path,'GET',undefined,true),
  async search(body={}){const response=await request('/api/network-search','POST',{q:'Excel',provider:'quark',sources:['pansearch'],...body});assert.equal(response.status,200);return response.json();},
  misses:()=>sqlite.prepare('SELECT * FROM search_misses ORDER BY keyword,provider').all().map(row=>({...row})),
  clicks:()=>sqlite.prepare('SELECT * FROM network_result_clicks').all().map(row=>({...row})),
  miss(keyword,provider,count=1){sqlite.prepare('INSERT INTO search_misses(keyword,provider,count) VALUES(?,?,?)').run(keyword,provider,count);},
  click(id,keyword,provider,title,url){sqlite.prepare('INSERT INTO network_result_clicks(id,keyword,provider,title,url) VALUES(?,?,?,?,?)').run(id,keyword,provider,title,url);},
  async token(data){const token=crypto.randomUUID();await cache.put(new Request(origin+'/_click-results/'+token),Response.json(data));return token;},
  own(provider='quark',title='Excel'){
   const id='own-'+provider;
   sqlite.prepare("INSERT INTO resources(id,title,status) VALUES(?,?,'published')").run(id,title);
   const url=provider==='baidu'?'https://pan.baidu.com/s/local':'https://pan.quark.cn/s/local';
   sqlite.prepare("INSERT INTO links(id,resource_id,provider,url) VALUES(?,?,?,?)").run(id+'-link',id,provider,url);
  },
  setItems:next=>{items=next;},fail:()=>{failed=true;},setState:next=>{state=next;},
  get searchCalls(){return searchCalls;},clearCache:()=>entries.clear()
 };
}

test('仅打开搜索页或 HEAD 请求不会提前写入未命中记录',async t=>{
 const f=fixture(t);
 for(const method of ['GET','HEAD'])assert.equal((await f.request('/?q=不存在的资源',method)).status,200);
 assert.deepEqual(f.misses(),[]);assert.equal(f.searchCalls,0);
});

test('没有可展示的网络结果、来源关闭或上游故障时不记录',async t=>{
 for(const scenario of ['empty','disabled','error','unrelated','all-invalid'])await t.test(scenario,async t=>{
  const f=fixture(t);
  if(scenario==='empty')f.setItems([]);
  if(scenario==='error')f.fail();
  if(scenario==='unrelated')f.setItems([{provider:'quark',url:'https://pan.quark.cn/s/unrelated',title:'完全不相关的内容'}]);
  if(scenario==='all-invalid')f.setState('bad');
  const data=await f.search(scenario==='disabled'?{sources:[]}:{});
  assert.deepEqual(data.items,[]);assert.deepEqual(f.misses(),[]);assert.equal(data.clickToken,undefined);
 });
});

test('网络有结果且本站无匹配时记录，无需等到用户点击，并合并大小写和空白',async t=>{
 const f=fixture(t);
 const first=await f.search({q:'  Excel   入门  '});assert.equal(first.items.length,1);assert.ok(first.clickToken);
 let rows=f.misses();assert.equal(rows.length,1);assert.equal(rows[0].keyword,'excel 入门');assert.equal(rows[0].provider,'quark');assert.equal(rows[0].count,1);assert.ok(rows[0].first_searched_at);assert.ok(rows[0].last_searched_at);
 await f.search({q:'EXCEL 入门'});
 rows=f.misses();assert.equal(rows.length,1);assert.equal(rows[0].count,2);assert.deepEqual(f.clicks(),[]);
});

test('网络缓存命中仍计入本次有效缺口搜索',async t=>{
 const f=fixture(t);
 assert.equal((await f.search()).items.length,1);
 const cached=await f.search();assert.equal(cached.cached,true);assert.equal(f.searchCalls,1);
 assert.equal(f.misses()[0].count,2);
});

test('所选网盘已有匹配资源时，附加的网络结果不记入缺口',async t=>{
 const f=fixture(t);f.own();
 const data=await f.search();assert.equal(data.items.length,1);assert.equal(data.clickToken,undefined);assert.deepEqual(f.misses(),[]);
});

test('其他网盘有资源不影响当前所选网盘的缺口记录',async t=>{
 const f=fixture(t);f.own('baidu');
 const data=await f.search();assert.equal(data.items.length,1);assert.equal(f.misses()[0].provider,'quark');assert.equal(f.misses()[0].count,1);
});

test('全部网盘模式只有缺失网盘的网络结果才触发记录，已有网盘点击不计入',async t=>{
 const f=fixture(t);f.own();
 const existingOnly=await f.search({provider:'all'});assert.equal(existingOnly.items.length,1);assert.deepEqual(f.misses(),[]);assert.equal(existingOnly.clickToken,undefined);
 f.clearCache();f.setItems([{provider:'quark',url:'https://pan.quark.cn/s/network'},{provider:'baidu',url:'https://pan.baidu.com/s/network'}]);
 const data=await f.search({provider:'all'});assert.equal(data.items.length,2);assert.equal(f.misses()[0].count,1);
 for(const provider of ['quark','baidu']){
  const index=data.items.findIndex(item=>item.provider===provider);
  assert.equal((await f.request('/api/network-click','POST',{token:data.clickToken,index})).status,200);
  assert.equal(f.clicks().length,provider==='quark'?0:1);
 }
 assert.equal(f.misses()[0].count,1);assert.equal(f.misses()[0].provider,'baidu');assert.equal(f.clicks()[0].provider,'baidu');assert.equal(f.clicks()[0].url,'https://pan.baidu.com/s/network');
});

test('重复点击不重复累计搜索次数及同条点击明细，使用服务器签发的资源信息',async t=>{
 const f=fixture(t);const data=await f.search();assert.equal(f.misses()[0].count,1);
 for(let i=0;i<2;i++)assert.equal((await f.request('/api/network-click','POST',{token:data.clickToken,index:0,title:'伪造标题',url:'https://evil.example/'})).status,200);
 assert.equal(f.misses()[0].count,1);assert.equal(f.clicks().length,1);assert.equal(f.clicks()[0].provider,'quark');assert.equal(f.clicks()[0].title,'Excel 教程');assert.equal(f.clicks()[0].url,'https://pan.quark.cn/s/network');
});

test('分页和分类查询不记录缺口，第一页复用缓存时正常计数',async t=>{
 const f=fixture(t);
 for(const body of [{page:2},{category:'filtered-category'}]){
  const data=await f.search(body);assert.equal(data.items.length,1);assert.deepEqual(f.misses(),[]);assert.equal(data.clickToken,undefined);
 }
 const first=await f.search({page:1});assert.equal(first.cached,true);assert.equal(f.misses()[0].count,1);
});

test('同一搜索词在不同网盘分别累计，重复搜索只增加所选网盘的次数',async t=>{
 const f=fixture(t);
 f.setItems([{provider:'quark',url:'https://pan.quark.cn/s/network'},{provider:'baidu',url:'https://pan.baidu.com/s/network'}]);
 await f.search();await f.search();await f.search({provider:'baidu'});
 assert.deepEqual(f.misses().map(({keyword,provider,count})=>({keyword,provider,count})),[
  {keyword:'excel',provider:'baidu',count:1},{keyword:'excel',provider:'quark',count:2}
 ]);
});

test('全部网盘按实际返回的缺失类型各记一次，同盘多条结果不会重复增加次数',async t=>{
 const f=fixture(t);
 f.setItems([{provider:'quark',url:'https://pan.quark.cn/s/first'},{provider:'quark',url:'https://pan.quark.cn/s/second'},{provider:'baidu',url:'https://pan.baidu.com/s/first'}]);
 const data=await f.search({provider:'all'});assert.equal(data.items.length,3);
 assert.deepEqual(f.misses().map(({provider,count})=>({provider,count})),[{provider:'baidu',count:1},{provider:'quark',count:1}]);
 const cached=await f.search({provider:'all'});assert.equal(cached.cached,true);assert.equal(f.searchCalls,1);
 assert.deepEqual(f.misses().map(({provider,count})=>({provider,count})),[{provider:'baidu',count:2},{provider:'quark',count:2}]);
 for(const [index,item] of data.items.entries())assert.equal((await f.request('/api/network-click','POST',{token:data.clickToken,index,provider:item.provider==='quark'?'baidu':'quark'})).status,200);
 assert.deepEqual(f.clicks().map(({provider,url})=>({provider,url})).sort((a,b)=>a.url.localeCompare(b.url)),data.items.map(({provider,url})=>({provider,url})).sort((a,b)=>a.url.localeCompare(b.url)));
 assert.deepEqual(f.misses().map(({provider,count})=>({provider,count})),[{provider:'baidu',count:2},{provider:'quark',count:2}]);
});

test('旧服务器点击凭据可从可信链接识别网盘，不修改同词的历史未分类统计',async t=>{
 const f=fixture(t);f.miss('excel','unknown',7);
 const token=await f.token({keyword:'excel',items:[{title:'旧凭据中的 Excel 资料',url:'https://pan.quark.cn/s/legacy'}]});
 for(let i=0;i<2;i++)assert.equal((await f.request('/api/network-click','POST',{token,index:0,provider:'baidu'})).status,200);
 assert.deepEqual(f.misses().map(({provider,count})=>({provider,count})),[{provider:'quark',count:1},{provider:'unknown',count:7}]);
 assert.equal(f.clicks().length,1);assert.equal(f.clicks()[0].provider,'quark');
});

test('已迁移为历史未分类的旧点击重放时，不创建额外网盘搜索记录',async t=>{
 const f=fixture(t);f.miss('excel','unknown',7);
 const item={title:'迁移前已点击的 Excel 资料',url:'https://pan.quark.cn/s/legacy'};
 const token=await f.token({keyword:'excel',items:[item]});
 f.click(token+':0','excel','unknown',item.title,item.url);
 assert.equal((await f.request('/api/network-click','POST',{token,index:0})).status,200);
 assert.deepEqual(f.misses().map(({provider,count})=>({provider,count})),[{provider:'unknown',count:7}]);
 assert.equal(f.clicks().length,1);assert.equal(f.clicks()[0].provider,'unknown');
});

test('后台列表和 CSV 按网盘筛选，同词点击不会串到另一网盘，历史数据可单独查看',async t=>{
 const f=fixture(t);
 f.setItems([{provider:'quark',url:'https://pan.quark.cn/s/quark-result',title:'Excel 夸克独有资源'},{provider:'baidu',url:'https://pan.baidu.com/s/baidu-result',title:'Excel 百度独有资源'}]);
 const data=await f.search({provider:'all'});
 for(let index=0;index<data.items.length;index++)assert.equal((await f.request('/api/network-click','POST',{token:data.clickToken,index})).status,200);
 f.miss('legacy-only','unknown',5);
 assert.equal((await f.request('/admin/search-misses')).status,503);
 for(const [provider,label,expected,unexpected] of [['quark','夸克网盘','Excel 夸克独有资源','Excel 百度独有资源'],['baidu','百度网盘','Excel 百度独有资源','Excel 夸克独有资源']]){
  const response=await f.admin('/admin/search-misses?provider='+provider);assert.equal(response.status,200);
  const html=await response.text();assert.match(html,/<th>网盘(?:类型)?<\/th>/);assert.ok(html.includes(expected));assert.ok(!html.includes(unexpected));assert.ok(!html.includes('legacy-only'));
  const exportHref=[...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1].replace(/&amp;/g,'&')).find(href=>href.startsWith('/api/admin/search-misses/export'));
  assert.equal(new URL(exportHref,'http://127.0.0.1:8787').searchParams.get('provider'),provider);
  const csvResponse=await f.admin('/api/admin/search-misses/export?provider='+provider);assert.equal(csvResponse.status,200);assert.match(csvResponse.headers.get('content-disposition'),/attachment/);
  const csv=await csvResponse.text();const rows=csv.trim().split(/\r?\n/).map(line=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match=>match[1].replace(/""/g,'"')));
  assert.equal(rows.length,2);const providerColumn=rows[0].indexOf('网盘类型');assert.notEqual(providerColumn,-1);assert.equal(rows[1][providerColumn],label);assert.ok(csv.includes(expected));assert.ok(!csv.includes(unexpected));assert.ok(!csv.includes('legacy-only'));
 }
 for(const query of ['','?provider=','?provider=all']){
  const html=await (await f.admin('/admin/search-misses'+query)).text();assert.ok(html.includes('Excel 夸克独有资源'));assert.ok(html.includes('Excel 百度独有资源'));assert.ok(html.includes('legacy-only'));
  const csv=await (await f.admin('/api/admin/search-misses/export'+query)).text();assert.ok(csv.includes('夸克网盘'));assert.ok(csv.includes('百度网盘'));assert.ok(csv.includes('legacy-only'));assert.ok(csv.includes('历史未分类'));
 }
 const history=await (await f.admin('/admin/search-misses?provider=unknown')).text();assert.ok(history.includes('legacy-only'));assert.ok(!history.includes('Excel 夸克独有资源'));assert.ok(!history.includes('Excel 百度独有资源'));
 const historicalCSV=await (await f.admin('/api/admin/search-misses/export?provider=unknown')).text();assert.ok(historicalCSV.includes('legacy-only'));assert.ok(!historicalCSV.includes('Excel 夸克独有资源'));
 for(const path of ['/admin/search-misses','/api/admin/search-misses/export'])assert.equal((await f.admin(path+'?provider=invalid-provider')).status,400);
});

test('后台未命中列表翻页时保留网盘筛选',async t=>{
 const f=fixture(t);
 for(let i=0;i<51;i++)f.miss('分页-'+String(i).padStart(2,'0'),'quark');
 f.miss('不在夸克分页中的词','baidu');
 const first=await (await f.admin('/admin/search-misses?provider=quark')).text();assert.ok(!first.includes('不在夸克分页中的词'));
 const links=[...first.matchAll(/href="([^"]+)"/g)].map(match=>new URL(match[1].replace(/&amp;/g,'&'),'http://127.0.0.1:8787/admin/search-misses?provider=quark'));
 const next=links.find(url=>url.pathname==='/admin/search-misses'&&url.searchParams.get('page')==='2');assert.ok(next);assert.equal(next.searchParams.get('provider'),'quark');
 const second=await (await f.admin(next.pathname+next.search)).text();
 const previous=[...second.matchAll(/href="([^"]+)"/g)].map(match=>new URL(match[1].replace(/&amp;/g,'&'),next.href)).find(url=>url.pathname==='/admin/search-misses'&&url.searchParams.get('page')==='1');
 assert.ok(previous);assert.equal(previous.searchParams.get('provider'),'quark');
 const exportResponse=await f.admin('/api/admin/search-misses/export?provider=quark');assert.equal(exportResponse.status,200);
 const csv=await exportResponse.text(),lines=csv.trim().split(/\r?\n/);
 assert.equal(lines.length,52);assert.ok(lines.slice(1).every(line=>line.startsWith('"夸克网盘",')));assert.ok(!csv.includes('不在夸克分页中的词'));
});

test('只有已发布并有可用链接的入库资源可标记，已处理来源不再导出且历史仍可见',async t=>{
 const f=fixture(t);
 f.miss('已完成','quark');f.miss('同源别词','quark');f.miss('无点击','quark');f.miss('还有其他链接','quark');
 const source='https://pan.quark.cn/s/abc123?pwd=1234';
 f.click('a','已完成','quark','已处理内容',source);
 f.click('b','同源别词','quark','同一个分享','https://pan.quark.cn/s/abc123?utm_source=tracking');
 f.click('c','还有其他链接','quark','尚未处理','https://pan.quark.cn/s/unprocessed');
 f.click('d','还有其他链接','quark','已处理的另一条',source);
 const post=(body,local=true)=>f.request('/api/admin/search-misses/processed','POST',body,local);
 assert.equal((await post({sourceUrl:source,resourceId:'missing'})).status,400);
 assert.equal((await post({sourceUrl:'https://pan.quark.cn/s/not-clicked',resourceId:'missing'})).status,404);
 assert.equal((await post({sourceUrl:source,resourceId:'missing'},false)).status,503);
 f.own('quark','自己的资源');
 assert.equal((await post({sourceUrl:source,resourceId:'own-quark'})).status,200);
 assert.equal((await post({sourceUrl:source,resourceId:'own-quark'})).status,200);
 const csv=await (await f.admin('/api/admin/search-misses/export')).text();
 assert.ok(!csv.includes('abc123'));assert.ok(!csv.includes('已完成'));assert.ok(!csv.includes('同源别词'));
 assert.ok(csv.includes('无点击'));assert.ok(csv.includes('尚未处理'));assert.ok(csv.includes('unprocessed'));
 const html=await (await f.admin('/admin/search-misses')).text();assert.ok(html.includes('已处理内容'));assert.ok(html.includes('已转存入库'));
 const backup=await (await f.admin('/api/admin/export')).json();assert.equal(backup.processed_search_resources.length,1);
 assert.equal((await f.request('/api/admin/resources/own-quark','PUT',{title:'自己的资源',url:'https://pan.quark.cn/s/replaced'},true)).status,200);
 assert.ok((await (await f.admin('/api/admin/search-misses/export')).text()).includes('abc123'));
 assert.equal((await post({sourceUrl:source,resourceId:'own-quark'})).status,200);
 assert.ok(!(await (await f.admin('/api/admin/search-misses/export')).text()).includes('abc123'));
 assert.equal((await f.request('/api/admin/resources/own-quark','DELETE',undefined,true)).status,200);
 const after=await (await f.admin('/api/admin/search-misses/export')).text();assert.ok(after.includes('abc123'));assert.ok(after.includes('已完成'));
});

test('分享子目录与完整分享分别去重，标记不可关联其他资源',async t=>{
 const f=fixture(t);f.miss('子目录','quark');
 const root='https://pan.quark.cn/s/share',sub=root+'#/list/share/fid1',other=root+'#/list/share/fid2';
 f.click('root','子目录','quark','完整分享',root);f.click('sub','子目录','quark','子目录一',sub);f.click('other','子目录','quark','子目录二',other);
 f.own('quark','资源一');f.own('baidu','资源二');
 const post=body=>f.request('/api/admin/search-misses/processed','POST',body,true);
 assert.equal((await post({sourceUrl:sub,resourceId:'own-quark'})).status,200);
 assert.equal((await post({sourceUrl:sub,resourceId:'own-baidu'})).status,409);
 const csv=await (await f.admin('/api/admin/search-misses/export')).text();
 assert.ok(!csv.includes('子目录一'));assert.ok(csv.includes('完整分享'));assert.ok(csv.includes('子目录二'));
});
