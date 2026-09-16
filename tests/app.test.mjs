import test from 'node:test';
import assert from 'node:assert/strict';

const base=process.env.TEST_ORIGIN||'http://127.0.0.1:8787';
const production=process.env.TEST_PRODUCTION_ORIGIN;
const request=(path,method='GET',body,headers={})=>fetch(base+path,{method,headers:{...(method==='GET'?{}:{Origin:base}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,redirect:'manual'});
const nonce=crypto.randomUUID().slice(0,8);
const seed={title:`验收测试-${nonce}`,summary:'验证发布、中文搜索和安全边界',body:'## 目录\n\n- 第一个项目\n- 第二个项目\n\n<script>alert(1)</script>',category_id:'',tags:'验收,中文检索',format:'PDF',size:'',cover_key:'',status:'draft',featured:false,links:[{provider:'quark',url:'https://pan.quark.cn/s/local-test-not-a-real-resource',code:'test',status:'active'}]};
let resourceId,linkId,categoryId,uploadKey;

test('完整资源流程与边界验证',async t=>{
  await t.test('本地服务健康、首页包含主要浏览入口',async()=>{
    assert.equal((await request('/health')).status,200);
    const r=await request('/');assert.equal(r.status,200);const html=await r.text();assert.match(html,/拾藏资源库/);assert.match(html,/搜索资源/);assert.doesNotMatch(html,/resource-list-row/);assert.match(html,/搜索设置/);
  });
  await t.test('后台写入拒绝跨站请求和缺少 Origin 的请求',async()=>{
    assert.equal((await request('/api/admin/resources','POST',seed,{Origin:'https://other.example'})).status,403);
    const r=await fetch(base+'/api/admin/resources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(seed)});assert.equal(r.status,403);
  });
  await t.test('拒绝非夸克链接和伪造网盘域名',async()=>{
    for(const url of ['javascript:alert(1)','https://pan.quark.cn.evil.example/s/xx','https://pan.quark.cn@evil.example/s/xx','http://pan.quark.cn/s/test']){
      assert.equal((await request('/api/admin/resources','POST',{...seed,links:[{...seed.links[0],url}]})).status,400);
    }
  });
  await t.test('创建草稿，公开详情与网盘入口均不能访问',async()=>{
    const r=await request('/api/admin/resources','POST',seed);assert.equal(r.status,201);resourceId=(await r.json()).id;
    const exportData=await (await request('/api/admin/export')).json();linkId=exportData.links.find(x=>x.resource_id===resourceId).id;
    assert.equal((await request('/r/'+resourceId)).status,404);
    assert.equal((await request('/go/'+linkId)).status,404);
    const preview=await request('/admin/preview/'+resourceId);assert.equal(preview.status,200);const html=await preview.text();assert.match(html,/管理员预览/);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>alert'));
  });
  await t.test('草稿发布、中文搜索与安全正文渲染',async()=>{
    assert.equal((await request('/api/admin/resources/'+resourceId,'PUT',{...seed,status:'published',links:[{...seed.links[0],id:linkId}]})).status,200);
    const r=await request('/r/'+resourceId);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    const html=await r.text();assert.match(html,/<h2>目录<\/h2>/);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>alert'));
    const search=await (await request('/?q='+encodeURIComponent('中文检索'))).text();assert.ok(search.includes(seed.title));
  });
  await t.test('本站命中时直接返回本地结果，不调用 PanSou',async()=>{
    const r=await request('/api/network-search','POST',{q:seed.title,sources:['pansearch']});assert.equal(r.status,200);const data=await r.json();assert.equal(data.local,true);assert.deepEqual(data.items,[]);assert.deepEqual(data.sources,[]);
    assert.equal((await request('/api/network-search','POST',{q:seed.title,sources:['unknown']})).status,400);
    assert.equal((await request('/api/network-search','POST',{q:seed.title,sources:['pansearch']},{Origin:'https://other.example'})).status,403);
  });
  await t.test('网盘入口跳转使用保存的地址，忽略额外目标参数',async()=>{
    const r=await request('/go/'+linkId+'?from=smoke-test&url=https://evil.example');assert.equal(r.status,302);assert.equal(r.headers.get('location'),seed.links[0].url);assert.equal(r.headers.get('cache-control'),'no-store');
    const r2=await request('/go/'+linkId+'?from=invalid%3Cscript%3E');assert.equal(r2.status,302);
  });
  await t.test('反馈可提交，后台可标记已处理',async()=>{
    const r=await request('/api/reports','POST',{resource_id:resourceId,reason:'链接失效',note:'自动验收测试'});assert.equal(r.status,200);
    const data=await (await request('/api/admin/export')).json();const report=data.reports.find(x=>x.resource_id===resourceId);assert.ok(report);
    assert.equal((await request('/api/admin/reports/'+report.id,'PATCH')).status,200);
  });
  await t.test('链接可更新并保留编号，禁用后立即拒绝跳转',async()=>{
    assert.equal((await request('/api/admin/resources/'+resourceId,'PUT',{...seed,status:'published',links:[{...seed.links[0],id:linkId,status:'disabled'}]})).status,200);
    assert.equal((await request('/go/'+linkId)).status,404);
  });
  await t.test('下架后不再出现在公开详情和搜索中',async()=>{
    assert.equal((await request('/api/admin/resources/'+resourceId,'PUT',{...seed,status:'archived',links:[{...seed.links[0],id:linkId}]})).status,200);
    assert.equal((await request('/r/'+resourceId)).status,404);
    const html=await (await request('/?q='+encodeURIComponent(seed.title))).text();assert.ok(!html.includes('class="resource-card"'));
  });
  await t.test('分类创建、唯一性与删除',async()=>{
    const name='验收分类-'+nonce;const r=await request('/api/admin/categories','POST',{name,description:'test',position:50});assert.equal(r.status,200);categoryId=(await r.json()).id;
    assert.equal((await request('/api/admin/categories','POST',{name})).status,400);
    assert.equal((await request('/api/admin/categories/'+categoryId,'DELETE')).status,200);categoryId=null;
  });
  await t.test('批量导入预览不会写库，确认导入为草稿，重复拒绝',async()=>{
    const rows=[{title:'批量验收-'+nonce,summary:'导入测试',url:seed.links[0].url,code:'1234'}];
    const before=await (await request('/api/admin/export')).json();
    assert.equal((await request('/api/admin/import','POST',{rows,confirm:false})).status,200);
    const after=await (await request('/api/admin/export')).json();assert.equal(before.resources.length,after.resources.length);
    assert.equal((await request('/api/admin/import','POST',{rows,confirm:true})).status,200);
    const data=await (await request('/api/admin/export')).json();const imported=data.resources.find(r=>r.title===rows[0].title);assert.equal(imported.status,'draft');
    try{assert.equal((await request('/api/admin/import','POST',{rows,confirm:true})).status,400);}finally{await request('/api/admin/resources/'+imported.id,'DELETE');}
  });
  await t.test('图片上传拒绝伪装文件，允许真实 PNG 并可读取',async()=>{
    const fake=new FormData();fake.append('file',new Blob(['<script>bad</script>'],{type:'image/png'}),'fake.png');
    assert.equal((await fetch(base+'/api/admin/upload',{method:'POST',headers:{Origin:base},body:fake})).status,400);
    const data=new FormData();data.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'test.png');
    const r=await fetch(base+'/api/admin/upload',{method:'POST',headers:{Origin:base},body:data});assert.equal(r.status,200);uploadKey=(await r.json()).key;
    const image=await request('/media/'+uploadKey);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  });
  await t.test('所有后台页面和帮助页可渲染',async()=>{
    for(const p of ['/categories','/about','/request','/admin/requests','/admin','/admin/new','/admin/categories','/admin/reports','/admin/stats','/admin/data','/admin/settings'])assert.equal((await request(p)).status,200,p);
  });
  await t.test('清理本次测试资源',async()=>{
    assert.equal((await request('/api/admin/resources/'+resourceId,'DELETE')).status,200);
    const data=await (await request('/api/admin/export')).json();assert.ok(!data.resources.some(r=>r.id===resourceId));assert.ok(!data.links.some(r=>r.resource_id===resourceId));assert.ok(!data.reports.some(r=>r.resource_id===resourceId));
    resourceId=null;
  });
});

test('生产模式在未配置 Access 时拒绝所有后台入口',{skip:!production},async()=>{
  for(const path of ['/admin','/admin/new','/api/admin/export']){
    const r=await fetch(production+path,{redirect:'manual'});assert.equal(r.status,503,path);
  }
  const r=await fetch(production+'/api/admin/resources',{method:'POST',headers:{Origin:production,'Content-Type':'application/json'},body:JSON.stringify(seed)});assert.equal(r.status,503);
});

test.after(async()=>{
  if(resourceId)await request('/api/admin/resources/'+resourceId,'DELETE');
  if(categoryId)await request('/api/admin/categories/'+categoryId,'DELETE');
});
