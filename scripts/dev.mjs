import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import net from 'node:net';
const root=resolve(new URL('..',import.meta.url).pathname);process.chdir(root);
const sources=JSON.parse(readFileSync('config/search-sources.json','utf8'));
const freePort=port=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(Error(`端口 ${port} 已占用，请关闭旧预览后重试。`)));s.listen(port,'127.0.0.1',()=>s.close(resolve));});
await freePort(8787);await freePort(8888);
mkdirSync('.runtime',{recursive:true});
const go=process.env.PANSOU_GO|| (existsSync('.tools/go/bin/go')?resolve('.tools/go/bin/go'):'go');
const binary=resolve('.runtime/pansou');
const built=spawnSync(go,['build','-C','vendor/pansou','-o',binary,'.'],{stdio:'inherit',env:{...process.env,GOPATH:resolve('.tools/gopath'),GOCACHE:resolve('.tools/go-cache'),GOMAXPROCS:'4'}});
if(built.error||built.status!==0){console.error('PanSou 构建失败，请安装 Go 1.24.9 或更新版本，或设置 PANSOU_GO。');process.exit(1);}
let stopping=false,worker;
const log=openSync('.runtime/pansou.log','a');
const pansou=spawn(binary,[],{stdio:['ignore',log,log],env:{...process.env,PORT:'8888',HOST:'127.0.0.1',GIN_MODE:'release',AUTH_ENABLED:'false',CHANNELS:sources.filter(s=>s.kind==='channel').map(s=>s.id).join(','),ENABLED_PLUGINS:sources.filter(s=>s.kind==='plugin').map(s=>s.id).join(','),CACHE_ENABLED:'true',CACHE_PATH:resolve('.runtime/pansou-quark-cache'),ASYNC_PLUGIN_ENABLED:'true',ASYNC_RESPONSE_TIMEOUT:'10',PLUGIN_TIMEOUT:'10',ASYNC_MAX_BACKGROUND_WORKERS:'3',ASYNC_MAX_BACKGROUND_TASKS:'12',ASYNC_LOG_ENABLED:'false'}});
function stop(code=0){if(stopping)return;stopping=true;worker?.kill('SIGTERM');pansou.kill('SIGTERM');setTimeout(()=>process.exit(code),1200);}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());pansou.on('exit',code=>{if(!stopping){console.error('PanSou 已退出，请查看 .runtime/pansou.log');stop(code||1);}});
let ready=false;for(let i=0;i<60&&!stopping;i++){try{const r=await fetch('http://127.0.0.1:8888/api/health',{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
if(!ready){console.error('PanSou 启动超时，请查看 .runtime/pansou.log');stop(1);}else{console.log('PanSou 已启动，网站将使用本项目内的搜索服务。');worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--env','local','--ip','127.0.0.1','--port','8787'],{stdio:'inherit'});worker.on('exit',code=>stop(code||0));}
