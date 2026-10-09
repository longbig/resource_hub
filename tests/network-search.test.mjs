import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled=await build({entryPoints:['src/network-search.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {parsePanSou,pansouBody,quarkUrl,networkSearch,promoteFirstValid,verifyFirstResult,excludeLocalShares}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const envelope=rows=>({code:0,data:{total:rows.length,merged_by_type:{quark:rows}}});
const row={url:'https://pan.quark.cn/s/abc123',note:'Python 入门教程',source:'plugin:pansearch',password:''};
test('网络来源选择不会意外启用全部插件或频道',()=>{
 assert.equal(pansouBody('Python',['yunpanx']).src,'tg');assert.equal(pansouBody('Python',['pansearch']).src,'plugin');assert.equal(pansouBody('Python',['pansearch','yunpanx']).src,'all');assert.deepEqual(pansouBody('Python',['pansearch'],['quark']).cloud_types,['quark']);
});
test('PanSou 响应校验、关键词过滤、链接去重与提取码保留',()=>{
 const items=parsePanSou(envelope([row,{...row,password:'abcd'},{...row,url:'https://evil.example/s/x'},{...row,url:'https://pan.quark.cn/s/other',note:'无关内容'},{...row,url:'https://pan.quark.cn/s/unselected',source:'plugin:unknown'}]),'Python',['pansearch']);
 assert.equal(items.length,1);assert.equal(items[0].code,'abcd');assert.equal(items[0].source,'PanSearch');assert.throws(()=>parsePanSou({code:500},'Python',['pansearch']));
});
test('仅允许 HTTPS 夸克分享地址，清理无关跳转参数',()=>{
 for(const url of ['javascript:alert(1)','https://pan.quark.cn.evil.example/s/abc','https://x@pan.quark.cn/s/abc','https://pan.quark.cn/login','https://pan.quark.cn:8443/s/abc'])assert.equal(quarkUrl(url),null);
 assert.equal(quarkUrl('https://pan.quark.cn/s/abc?redirect=https://evil.example&pwd=1234'),'https://pan.quark.cn/s/abc?pwd=1234');
});
test('所有来源关闭时不请求后端；后端故障不会伪装成正常空结果',async()=>{
 const original=globalThis.fetch;let called=0;globalThis.fetch=async()=>{called++;throw Error('offline');};
 try{assert.deepEqual(await networkSearch('Python',[],{ENVIRONMENT:'local'}),{items:[],sources:[]});assert.equal(called,0);const result=await networkSearch('Python',['pansearch'],{ENVIRONMENT:'local'});assert.equal(result.sources[0].status,'error');}finally{globalThis.fetch=original;}
});

test('PanSou 正文匹配时保留标题不含关键词的资源',()=>{
 const d=envelope([{...row,note:'办公自动化课程'}]);d.data.results=[{content:'使用 Python 自动处理表格',links:[{url:row.url}]}];assert.equal(parsePanSou(d,'Python',['pansearch']).length,1);
});

test('网络结果按时间倒序，重复链接保留最新记录，未知时间最后',()=>{
 const items=parsePanSou(envelope([
 {...row,url:'https://pan.quark.cn/s/unknown',datetime:'0001-01-01T00:00:00Z'},
 {...row,datetime:'2024-01-01T00:00:00Z',password:'code'},
 {...row,note:'Python 新版',datetime:'2026-09-14T00:00:00Z'},
 {...row,url:'https://pan.quark.cn/s/middle',datetime:'2025-06-01T00:00:00Z'}
 ]),'Python',['pansearch']);assert.deepEqual(items.map(i=>i.url.split('/').pop()),['abc123','middle','unknown']);assert.equal(items[0].title,'Python 新版');assert.equal(items[0].code,'code');assert.equal(items[2].datetime,'');
});

const candidates=['a','b','c','d'].map(title=>({provider:'quark',title,url:'https://pan.quark.cn/s/'+title,code:'1234',datetime:'',summary:'',source:'',sourceUrl:''}));
test('找到首条有效结果就置顶并停止，未知保留、失效过滤、后续不检测',async()=>{
 const calls=[];const states=['uncertain','bad','ok'];
 const result=await promoteFirstValid(candidates,async item=>{calls.push(item.title);return states[calls.length-1];});
 assert.deepEqual(calls,['a','b','c']);assert.deepEqual(result.map(x=>x.title),['c','a','d']);
});
test('第一条有效时只检测一次；全部失效时返回空列表',async()=>{
 let calls=0;assert.deepEqual(await promoteFirstValid(candidates,async()=>{calls++;return 'ok';}),candidates);assert.equal(calls,1);
 assert.deepEqual(await promoteFirstValid(candidates,async()=> 'bad'),[]);
});
test('检测异常或达到时间预算时保留尚未检测的结果',async()=>{
 let calls=0;const result=await promoteFirstValid(candidates,async()=>{if(++calls===1)return 'bad';throw Error('offline');});
 assert.deepEqual(result,candidates.slice(1));assert.equal(calls,2);
 calls=0;const limited=await promoteFirstValid(candidates,async()=>{calls++;return 'uncertain';},()=>calls<1);
 assert.deepEqual(limited,candidates);assert.equal(calls,1);
});
test('调用真实检测协议，传递提取码，找到有效项后不再请求',async()=>{
 const calls=[];const env={ENVIRONMENT:'production',PANSOU_CONTAINER:{getByName(name){assert.equal(name,'search');return {async fetch(url,init){
  assert.equal(url,'http://pansou/api/check/links');const body=JSON.parse(init.body);assert.equal(body.items.length,1);assert.equal(body.items[0].password,'1234');calls.push(body.items[0].url);
  return Response.json({results:[{...body.items[0],state:calls.length===1?'bad':'ok'}]});
 }}}}};
 assert.deepEqual(await verifyFirstResult(candidates,env),candidates.slice(1));assert.equal(calls.length,2);
});
test('不信任返回其他链接的检测结果，失败时不隐藏正常搜索结果',async()=>{
 const env={ENVIRONMENT:'production',PANSOU_CONTAINER:{getByName(){return {fetch:async()=>Response.json({results:[{url:'https://pan.quark.cn/s/other',disk_type:'quark',state:'bad'}]})}}}};
 assert.deepEqual(await verifyFirstResult(candidates,env),candidates);
});

const multiRows={quark:[row],baidu:[{...row,url:'https://pan.baidu.com/s/abc123?pwd=abcd',datetime:'2026-10-01T00:00:00Z'}],mobile:[{...row,url:'https://yun.139.com/shareweb/#/w/i/AAA'},{...row,url:'https://yun.139.com/shareweb/#/w/i/BBB'}]};
test('多网盘结果保留类型和提取码，相同分享路径不会跨盘去重，移动链接保留 hash',()=>{
 const payload={code:0,data:{total:4,merged_by_type:multiRows}};
 const items=parsePanSou(payload,'Python',['pansearch']);
 assert.equal(items.length,4);assert.equal(items[0].provider,'baidu');assert.equal(items[0].code,'abcd');
 assert.equal(items.filter(i=>i.provider==='mobile').length,2);
 assert.deepEqual(parsePanSou(payload,'Python',['pansearch'],['quark']).map(i=>i.provider),['quark']);
 assert.deepEqual(pansouBody('Python',['pansearch'],['baidu','aliyun']).cloud_types,['baidu','aliyun']);
});
test('网盘类型与域名不一致的网络结果不能混入其他网盘',()=>{
 assert.deepEqual(parsePanSou({code:0,data:{total:1,merged_by_type:{baidu:[row]}}},'Python',['pansearch']),[]);
});
test('多网盘有效性检测使用对应 disk_type，不支持检测的网盘保留且不发请求',async()=>{
 const calls=[];const env={ENVIRONMENT:'production',PANSOU_CONTAINER:{getByName(){return {async fetch(url,init){
  const item=JSON.parse(init.body).items[0];calls.push(item.disk_type);return Response.json({results:[{...item,state:'ok'}]});
 }}}}};
 const items=[{...candidates[0],provider:'pikpak',url:'https://mypikpak.com/s/abc'}, {...candidates[1],provider:'baidu',url:'https://pan.baidu.com/s/xyz'},candidates[2]];
 assert.deepEqual((await verifyFirstResult(items,env)).map(i=>i.provider),['baidu','pikpak','quark']);assert.deepEqual(calls,['baidu']);
});
test('网络搜索在有本站资源时仍返回其他结果，重复链接不占用首条有效检测',async()=>{
 const calls=[];
 const env={ENVIRONMENT:'production',PANSOU_CONTAINER:{getByName(){return {async fetch(url,init){
  const body=JSON.parse(init.body);calls.push({url,body});
  if(url.endsWith('/api/search'))return Response.json(envelope([
   {...row,url:row.url+'?pwd=abcd',datetime:'2026-10-09T00:00:00Z'},
   {...row,url:'https://pan.quark.cn/s/second',datetime:'2026-10-08T00:00:00Z'},
   {...row,url:'https://pan.quark.cn/s/third',datetime:'2026-10-07T00:00:00Z'}
  ]));
  return Response.json({results:body.items.map(item=>({...item,state:'ok'}))});
 }}}}};
 const result=await networkSearch('Python',['pansearch'],env,['quark'],[{provider:'quark',url:row.url+'?from=wechat'}]);
 assert.deepEqual(result.items.map(i=>i.url),['https://pan.quark.cn/s/second','https://pan.quark.cn/s/third']);
 assert.deepEqual(calls[0].body.cloud_types,['quark']);assert.equal(calls.length,2);assert.equal(calls[1].body.items[0].url,result.items[0].url);
});
test('跨本站与网络去重识别别名和提取码，同时保留不同网盘与不同移动分享',()=>{
 const items=[
  {...candidates[0],provider:'aliyun',url:'https://www.alipan.com/s/same'},
  {...candidates[1],provider:'quark',url:'https://pan.quark.cn/s/same'},
  {...candidates[2],provider:'mobile',url:'https://yun.139.com/shareweb/#/w/i/AAA'},
  {...candidates[3],provider:'mobile',url:'https://yun.139.com/shareweb/#/w/i/BBB'}
 ];
 const result=excludeLocalShares(items,[{provider:'aliyun',url:'https://aliyundrive.com/s/same?pwd=abcd'},{provider:'mobile',url:items[2].url}]);
 assert.deepEqual(result,[items[1],items[3]]);
});
test('先剔除本站重复链接再限制数量，仍可补足 60 条其他网络结果',()=>{
 const rows=Array.from({length:65},(_,i)=>({...row,url:'https://pan.quark.cn/s/share'+String(i).padStart(2,'0')}));
 const own=rows.slice(0,5).map(r=>({provider:'quark',url:r.url}));
 const items=parsePanSou(envelope(rows),'Python',['pansearch'],['quark'],own);
 assert.equal(items.length,60);assert.equal(items[0].url,rows[5].url);assert.equal(items.at(-1).url,rows.at(-1).url);
});
