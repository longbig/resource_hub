import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.TEST_ORIGIN||'http://127.0.0.1:8787';
const request=(path,method='GET',body,headers={})=>fetch(base+path,{method,headers:{...(method==='GET'?{}:{Origin:base}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,redirect:'manual'});
const backup=async()=> (await request('/api/admin/export')).json();
const nonce=crypto.randomUUID().slice(0,8);
const seed={title:`验收测试-${nonce}-<script>`,url:'https://pan.quark.cn/s/local-test-not-a-real-resource'};
const created=[];
test('简化后台、发布与搜索记录',async t=>{
 await t.test('后台表单只有标题和链接，移除旧功能',async()=>{
  assert.equal((await request('/health')).status,200);
  const homepage=await (await request('/')).text();assert.match(homepage,/value="quark" class="provider-tab active" aria-pressed="true"/);assert.match(homepage,/form="resource-search" name="provider" value="baidu"/);assert.doesNotMatch(homepage,/<select[^>]*name="provider"/);
  const html=await (await request('/admin/new')).text();
  assert.match(html,/name="title"/);assert.match(html,/name="url"/);
  assert.doesNotMatch(html,/name="(?:summary|body|category_id|status|featured|tags)"|分类管理|失效反馈/);
  for(const path of ['/admin/categories','/admin/reports','/categories'])assert.equal((await request(path)).status,404);
  assert.equal((await request('/api/reports','POST',{})).status,404);
 });
 await t.test('跨站请求与不合法链接被拒绝',async()=>{
  assert.equal((await request('/api/admin/resources','POST',seed,{Origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(base+'/api/admin/resources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(seed)})).status,403);
  for(const url of ['', 'javascript:alert(1)','https://pan.quark.cn.evil.example/s/xx','http://pan.quark.cn/s/xx'])assert.equal((await request('/api/admin/resources','POST',{...seed,url})).status,400);
 });
 let id,linkId;
 await t.test('仅标题和链接即可发布、搜索、跳转，标题安全转义',async()=>{
  const response=await request('/api/admin/resources','POST',seed);assert.equal(response.status,201);id=(await response.json()).id;created.push(id);
  const data=await backup();assert.equal(data.resources.find(r=>r.id===id).status,'published');linkId=data.links.find(l=>l.resource_id===id).id;
  const html=await (await request('/?q='+encodeURIComponent(seed.title))).text();assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.ok(html.includes('/go/'+linkId));
  assert.ok(!(await backup()).search_misses.some(r=>r.keyword===seed.title.toLowerCase()));
  assert.equal((await request('/r/'+id)).status,200);
  const go=await request('/go/'+linkId+'?url=https://evil.example');assert.equal(go.status,302);assert.equal(go.headers.get('location'),seed.url);
  const local=await (await request('/api/network-search','POST',{q:seed.title,provider:'quark',sources:['pansearch']})).json();assert.equal(local.local,false);assert.equal(local.sources.length,1);assert.equal(local.clickToken,undefined);
 });
 await t.test('修改链接保留跳转编号',async()=>{
  const url=seed.url+'-updated';assert.equal((await request('/api/admin/resources/'+id,'PUT',{...seed,url})).status,200);
  assert.equal((await request('/go/'+linkId)).headers.get('location'),url);
 });
 await t.test('仅打开搜索页或关闭网络来源不记录未命中搜索',async()=>{
  const q=`Missing-${nonce} Excel`;
  for(const keyword of [q,`  MISSING-${nonce}   EXCEL `])assert.equal((await request('/?q='+encodeURIComponent(keyword))).status,200);
  assert.equal((await backup()).search_misses.find(r=>r.keyword===q.toLowerCase()),undefined);
  await request('/api/network-search','POST',{q,sources:[]});await request('/?q='+encodeURIComponent(q)+'&page=2');await request('/?q=');
  assert.equal((await backup()).search_misses.find(r=>r.keyword===q.toLowerCase()),undefined);
  const html=await (await request('/admin/search-misses')).text();assert.ok(!html.includes(q.toLowerCase()));assert.match(html,/网络搜索有结果/);
  const paged=await (await request('/?q='+encodeURIComponent(q)+'&page=2')).text();assert.match(paged,/data-page="2"/);
 });
 await t.test('CSV 模板两列、预览不入库、确认即发布、拒绝重复及缺失链接',async()=>{
  assert.equal((await (await request('/api/admin/import-template')).text()).replace(/^\uFEFF/,''),'title,url\r\n');
  const rows=[{title:'批量验收-'+nonce,url:seed.url}];
  const before=(await backup()).resources.length;
  const preview=await (await request('/api/admin/import','POST',{rows})).json();assert.equal(preview.preview[0].url,seed.url);assert.equal((await backup()).resources.length,before);
  assert.equal((await request('/api/admin/import','POST',{rows,confirm:true})).status,200);
  const imported=(await backup()).resources.find(r=>r.title===rows[0].title);created.push(imported.id);assert.equal(imported.status,'published');
  assert.equal((await request('/api/admin/import','POST',{rows,confirm:true})).status,400);
  assert.equal((await request('/api/admin/import','POST',{rows:[{title:'缺失链接-'+nonce}],confirm:true})).status,400);
 });
 await t.test('其他网盘自动识别、编辑切换和 CSV 导入，按网盘匹配本地库',async()=>{
  const title='多盘验收-'+nonce;
  const response=await request('/api/admin/resources','POST',{title,url:'https://pan.baidu.com/s/otherdrive?pwd=abcd'});assert.equal(response.status,201);
  const id=(await response.json()).id;created.push(id);
  let link=(await backup()).links.find(l=>l.resource_id===id);assert.equal(link.provider,'baidu');assert.equal(link.code,'abcd');
  const html=await (await request('/?q='+title+'&provider=baidu')).text();assert.ok(html.includes('/go/'+link.id));assert.ok(html.includes('id="network-results"'));assert.ok(html.indexOf('/go/'+link.id)<html.indexOf('id="network-results"'));
  const all=await (await request('/?q='+title+'&provider=all')).text();assert.ok(all.includes('/go/'+link.id));assert.ok(all.includes('id="network-results"'));
  const own=await (await request('/api/network-search','POST',{q:title,provider:'baidu',sources:[]})).json();assert.equal(own.local,false);assert.equal(own.disabled,true);
  const other=await (await request('/api/network-search','POST',{q:title,provider:'quark',sources:[]})).json();assert.equal(other.local,false);
  const mixed=await (await request('/api/network-search','POST',{q:title,provider:'all',sources:[]})).json();assert.equal(mixed.local,false);
  assert.equal((await request('/api/network-search','POST',{q:title,provider:'unknown',sources:[]})).status,400);
  assert.equal((await request('/?q='+title+'&provider=unknown')).status,400);
  await request('/api/admin/resources/'+id,'PUT',{title,url:'https://www.alipan.com/s/newshare'});
  const oldId=link.id;link=(await backup()).links.find(l=>l.resource_id===id);assert.equal(link.id,oldId);assert.equal(link.provider,'aliyun');assert.equal(link.code,'');
  assert.equal((await request('/go/'+link.id)).headers.get('location'),'https://www.alipan.com/s/newshare');
  const rows=[{title:title+'-导入',url:'https://cloud.189.cn/t/abc?accessCode=1234'}];assert.equal((await request('/api/admin/import','POST',{rows,confirm:true})).status,200);
  const data=await backup();const imported=data.resources.find(r=>r.title===rows[0].title);created.push(imported.id);link=data.links.find(l=>l.resource_id===imported.id);assert.equal(link.provider,'tianyi');assert.equal(link.code,'1234');
 });
 await t.test('保留的页面正常渲染',async()=>{
  for(const path of ['/','/about','/request','/admin','/admin/requests','/admin/search-misses','/admin/data','/admin/settings','/admin/stats'])assert.equal((await request(path)).status,200,path);
 });
});
test.after(async()=>{for(const id of created)await request('/api/admin/resources/'+id,'DELETE');});
