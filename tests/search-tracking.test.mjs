import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['src/search-tracking.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {issueClickToken,readClick,csvCell}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
test('点击凭据绑定服务器搜索结果，拒绝过期凭据和无效序号',async()=>{
 const entries=new Map();const cache={put:async(k,v)=>entries.set(k.url,v),match:async k=>entries.get(k.url)?.clone()};
 const origin='https://example.com';const data={keyword:'excel',items:[{title:'Excel 教程',url:'https://pan.quark.cn/s/abc123'}]};
 const token=await issueClickToken(cache,origin,data);
 assert.deepEqual(await readClick(cache,origin,token,0),{id:token+':0',keyword:'excel',...data.items[0]});
 for(const index of [-1,1,0.5,'0',null])assert.equal(await readClick(cache,origin,token,index),null);
 assert.equal(await readClick(cache,origin,'fake',0),null);entries.clear();assert.equal(await readClick(cache,origin,token,0),null);
});
test('CSV 正确处理引号、换行和表格公式',()=>{
 assert.equal(csvCell('教程,"Excel"\n第二行'),'"教程,""Excel""\n第二行"');
 assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell(' +1'),'"\' +1"');assert.equal(csvCell(null),'""');
});
test('后台导出完整 CSV，点击接口拒绝伪造及跨站请求',async()=>{
 const base=process.env.TEST_ORIGIN||'http://127.0.0.1:8787';
 const response=await fetch(base+'/api/admin/search-misses/export');assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);const csv=await response.text();assert.match(csv,/搜索词/);assert.match(csv,/点击的资源标题/);
 for(const [origin,status] of [[base,400],['https://evil.example',403]]){
  const r=await fetch(base+'/api/network-click',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:'fake',index:0,url:'https://pan.quark.cn/s/fake'})});assert.equal(r.status,status);
 }
});
