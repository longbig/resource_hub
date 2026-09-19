import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled=await build({entryPoints:['src/network-search.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {parsePanSou,pansouBody,quarkUrl,networkSearch,promoteFirstValid,verifyFirstResult}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const envelope=rows=>({code:0,data:{total:rows.length,merged_by_type:{quark:rows}}});
const row={url:'https://pan.quark.cn/s/abc123',note:'Python 入门教程',source:'plugin:pansearch',password:''};
test('网络来源选择不会意外启用全部插件或频道',()=>{
 assert.equal(pansouBody('Python',['yunpanx']).src,'tg');assert.equal(pansouBody('Python',['pansearch']).src,'plugin');assert.equal(pansouBody('Python',['pansearch','yunpanx']).src,'all');assert.deepEqual(pansouBody('Python',['pansearch']).cloud_types,['quark']);
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

const candidates=['a','b','c','d'].map(title=>({title,url:'https://pan.quark.cn/s/'+title,code:'1234',datetime:'',summary:'',source:'',sourceUrl:''}));
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
