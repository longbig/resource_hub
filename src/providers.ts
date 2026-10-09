import catalog from '../public/providers.json';
type Provider = {label:string;hosts:string[];path:string;params:string[];check:boolean;order:number;hash?:boolean};
export const providerCatalog:Record<string,Provider> = catalog;
export const providers = providerCatalog;
export const enabledProviderIds = Object.keys(providers).sort((a,b)=>providers[a].order-providers[b].order);
export function selectedProviders(id=''):string[] {
  const selected=id||'quark';
  return selected==='all' ? enabledProviderIds : Object.hasOwn(providers,selected) ? [selected] : [];
}
export function validLink(provider:string,raw:string):boolean {
  try {
    const p=providers[provider],u=new URL(raw);
    if(!p||u.protocol!=='https:'||u.username||u.password||u.port||!p.hosts.includes(u.hostname)||!new RegExp(p.path).test(u.pathname))return false;
    if(provider==='mobile'&&/^\/shareweb\/?$/.test(u.pathname))return /^#\/w\/i\/[a-z0-9_-]+(?:[?&].*)?$/i.test(u.hash);
    if(provider==='mobile'&&u.pathname==='/m/i')return !!u.search;
    if(provider==='tianyi'&&u.pathname==='/web/share')return /^[a-z0-9_-]+$/i.test(u.searchParams.get('code')||'');
    return true;
  }catch{return false;}
}
export function identifyProvider(raw:string):string|null {
  return enabledProviderIds.find(id=>validLink(id,raw))||null;
}
export function shareUrl(provider:string,raw:string):string|null {
  if(!validLink(provider,raw))return null;
  const p=providers[provider],u=new URL(raw);
  // Mobile /m/i links can put the share ID in a bare query string.
  if(!(provider==='mobile'&&u.pathname==='/m/i'))for(const key of [...u.searchParams.keys()])if(!p.params.includes(key))u.searchParams.delete(key);
  if(!p.hash)u.hash='';
  u.pathname=u.pathname.replace(/\/$/,'');
  return u.href;
}
export function shareIdentity(provider:string,raw:string):string {
  const u=new URL(raw);for(const key of ['pwd','password','pass_code','accessCode'])u.searchParams.delete(key);
  u.pathname=u.pathname.replace(/\/$/,'');
  // Aliases of a provider should identify the same share, but different providers must stay separate.
  return provider+':'+u.pathname+u.search+u.hash.replace(/[?#&](?:password|pwd)=[^&]*/g,'');
}
export function extractionCode(raw:string):string {
  const u=new URL(raw);
  const code=u.searchParams.get('pwd')||u.searchParams.get('password')||u.searchParams.get('pass_code')||u.searchParams.get('accessCode')||u.hash.match(/[?#&](?:password|pwd)=([a-z0-9]+)/i)?.[1]||'';
  return /^[a-z0-9]{1,12}$/i.test(code)?code:'';
}
