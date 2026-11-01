import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

try{
 const [command,...args]=process.argv.slice(2);
 const configPath=process.env.AUTOMATION_CONFIG||resolve(new URL('../.runtime/automation/client.json',import.meta.url).pathname);
 const config=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')):{};
 const origin=new URL(process.env.AUTOMATION_SITE_ORIGIN||config.origin||'https://shicangpan.site');
 if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))throw Error('自动化接口必须使用 HTTPS，或本机预览地址。');
 const token=process.env.AUTOMATION_API_TOKEN||config.token;
 if(!token)throw Error('请设置 AUTOMATION_API_TOKEN，或提供 .runtime/automation/client.json。');
 const options={};
 for(let i=0;i<args.length;i+=2){if(!/^--[a-z]+$/.test(args[i])||!args[i+1]||Object.hasOwn(options,args[i].slice(2)))throw Error('参数格式错误。');options[args[i].slice(2)]=args[i+1];}
 let path,body;
 if(command==='list'){
  if(Object.keys(options).some(k=>!['provider','limit','cursor'].includes(k)))throw Error('list 仅支持 --provider、--limit、--cursor。');
  path='/api/automation/resources?'+new URLSearchParams(options);
 }else if(command==='complete'){
  if(!options.file||Object.keys(options).length!==1)throw Error('用法：complete --file result.json');
  const contents=readFileSync(options.file,'utf8');if(Buffer.byteLength(contents)>16384)throw Error('结果文件不能超过 16 KB。');
  body=JSON.stringify(JSON.parse(contents));path='/api/automation/resources/complete';
 }else throw Error('用法：list [--provider quark] [--limit 50] [--cursor ...]，或 complete --file result.json');
 const response=await fetch(new URL(path,origin.origin),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body,redirect:'error',signal:AbortSignal.timeout(30000)});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'接口返回 HTTP '+response.status);
 process.stdout.write(JSON.stringify(data,null,2)+'\n');
}catch(error){process.stderr.write((error instanceof Error?error.message:'自动化请求失败')+'\n');process.exitCode=1;}
