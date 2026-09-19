import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const missing=[];
if(!config.vars.SITE_ORIGIN?.startsWith('https://'))missing.push('SITE_ORIGIN：正式 HTTPS 域名');
// Access values are managed in Cloudflare; keep dashboard variables on deployment.
if(!config.keep_vars)missing.push('keep_vars：必须开启以保留平台上的 Access 配置');
if(!config.vars.ADMIN_EMAILS)missing.push('ADMIN_EMAILS：后台允许登录的邮箱');
if(config.d1_databases[0].database_id.startsWith('00000000'))missing.push('database_id：你创建的 D1 数据库 ID');
if(!config.routes?.length)missing.push('routes：正式自定义域名');
if(config.vars.ENVIRONMENT!=='production')missing.push('ENVIRONMENT 必须为 production');
if(missing.length){console.error('上线配置尚未完成：\n'+missing.map(x=>'  - '+x).join('\n')+'\n请按照 docs/DEPLOY.md 配置后再部署。');process.exit(1);}
if(spawnSync('docker',['info'],{stdio:'ignore'}).status!==0){console.error('部署包含 PanSou 容器，需要先安装并启动 Docker。');process.exit(1);}
for(const args of [['run','check'],['exec','wrangler','--','d1','migrations','apply','DB','--remote'],['exec','wrangler','--','deploy']]){
 const result=spawnSync('npm',args,{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
}
