import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['src/providers.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {identifyProvider,validLink,selectedProviders,shareUrl,shareIdentity,extractionCode}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const examples={quark:'https://pan.quark.cn/s/abc',baidu:'https://pan.baidu.com/s/1abc?pwd=abcd',aliyun:'https://www.alipan.com/s/abc',uc:'https://drive.uc.cn/s/abc',xunlei:'https://pan.xunlei.com/s/abc','123':'https://www.123865.com/s/abc-def',tianyi:'https://cloud.189.cn/web/share?code=abc',mobile:'https://yun.139.com/shareweb/#/w/i/abc','115':'https://115cdn.com/s/abc#password=abcd',pikpak:'https://mypikpak.com/s/abc',guangya:'https://www.guangyapan.com/s/abc'};
test('11 种网盘分享可自动识别，默认仅搜索夸克',()=>{
  for(const [id,url] of Object.entries(examples)){assert.equal(identifyProvider(url),id);assert.ok(shareUrl(id,url));}
  assert.deepEqual(selectedProviders(),['quark']);assert.deepEqual(selectedProviders('baidu'),['baidu']);assert.deepEqual(selectedProviders('toString'),[]);
});
test('拒绝伪造域名、登录页、凭据和端口，并清除跳转参数',()=>{
  for(const [id,url] of Object.entries(examples)){
    const u=new URL(url);u.hostname+='\.evil.example';assert.equal(validLink(id,u.href),false);
    assert.equal(validLink(id,url.replace('https:','http:')),false);
  }
  for(const url of ['https://pan.baidu.com/login','https://me@pan.baidu.com/s/abc','https://pan.baidu.com:123/s/abc','https://cloud.189.cn/web/share?redirect=abc','https://yun.139.com/shareweb/#/login'])assert.equal(identifyProvider(url),null);
  assert.equal(shareUrl('baidu',examples.baidu+'&redirect=https://evil.example'),examples.baidu);
});
test('特殊分享标识、别名和提取码在规范化与去重中保留',()=>{
  const a='https://caiyun.139.com/m/i?AAABBB',b='https://caiyun.139.com/m/i?CCCDDD';
  assert.equal(shareUrl('mobile',a),a);assert.notEqual(shareIdentity('mobile',a),shareIdentity('mobile',b));
  assert.notEqual(shareIdentity('mobile',examples.mobile),shareIdentity('mobile',examples.mobile+'def'));
  assert.equal(shareIdentity('aliyun',examples.aliyun),shareIdentity('aliyun',examples.aliyun.replace('www.alipan.com','aliyundrive.com')));
  assert.equal(extractionCode(examples['115']),'abcd');assert.equal(shareIdentity('115',examples['115']),shareIdentity('115',examples['115'].replace('abcd','1234')));
});
