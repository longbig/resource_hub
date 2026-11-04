import test from 'node:test';
import assert from 'node:assert/strict';
import {parseQuarkShare} from '../public/share-text.js';
const sample='我用夸克网盘分享了「PS」，点击链接即可保存。打开「夸克网盘APP」，无需下载在线播放视频，畅享原画5倍速，支持电视投屏。\n链接：https://pan.quark.cn/s/44d64b4b3e15';
test('原生夸克文案提取资源标题，不误识别 APP 名称',()=>{
 assert.deepEqual(parseQuarkShare(sample),{title:'PS',url:'https://pan.quark.cn/s/44d64b4b3e15'});
 assert.equal(parseQuarkShare(sample.replace('「PS」','“PS 教程”')).title,'PS 教程');
 assert.equal(parseQuarkShare(sample.replace('「PS」','「PS「进阶」教程」')).title,'PS「进阶」教程');
});
test('新版给你分享文案提取标题，忽略分享口令和 APP 名称',()=>{
 const text='我用夸克网盘给你分享了「200套大学生毕业答辩精选PPT模板」，点击链接或复制整段内容，打开「夸克网盘APP」即可获取。\n/~f83d3c54dO~:/\n链接：https://pan.quark.cn/s/809ef5cf0dc3';
 const expected={title:'200套大学生毕业答辩精选PPT模板',url:'https://pan.quark.cn/s/809ef5cf0dc3'};
 assert.deepEqual(parseQuarkShare(text),expected);
 assert.deepEqual(parseQuarkShare(text.replace('夸克网盘给你分享了','夸克网盘 给你 分享了： ')),expected);
});
test('链接末尾标点、单独链接与提取码不会破坏分享地址',()=>{
 assert.deepEqual(parseQuarkShare('链接：https://pan.quark.cn/s/abc。\n提取码：1a2b'),{title:'',url:'https://pan.quark.cn/s/abc?pwd=1a2b'});
 assert.equal(parseQuarkShare('https://pan.quark.cn/s/abc?pwd=abcd&redirect=https://evil.example\n提取码：9999').url,'https://pan.quark.cn/s/abc?pwd=abcd');
 assert.equal(parseQuarkShare('https://pan.quark.cn/s/abc https://pan.quark.cn/s/abc?pwd=abcd').url,'https://pan.quark.cn/s/abc?pwd=abcd');
});
test('拒绝伪造域名、账号密码、非分享路径与多份分享，保持人工确认流程',()=>{
 for(const url of ['https://pan.quark.cn.evil.example/s/abc','https://me@pan.quark.cn/s/abc','https://pan.quark.cn/login','http://pan.quark.cn/s/abc','https://pan.quark.cn:8443/s/abc','javascript:alert(1)'])assert.equal(parseQuarkShare('我用夸克网盘分享了「PS」\n链接：'+url),null);
 assert.throws(()=>parseQuarkShare('https://pan.quark.cn/s/abc https://pan.quark.cn/s/def'),/多个/);
 assert.throws(()=>parseQuarkShare('a'.repeat(10001)),/过长/);
 assert.equal(parseQuarkShare(''),null);
});
