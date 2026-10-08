// Parse locally; clipboard text is never submitted or fetched as a URL.
export function parseQuarkShare(text) {
  if(typeof text!=='string'||!text.trim())return null;
  if(text.length>10000)throw new Error('分享文案过长，请只粘贴一条分享。');
  const links=new Map();
  for(const match of text.matchAll(/https?:\/\/[^\s<>"'「」『』《》“”]+/gi)) {
    const raw=match[0].replace(/[，。；！？、：,;!?）)\]】]+$/u,'');
    try {
      const url=new URL(raw);
      if(url.protocol!=='https:'||url.hostname!=='pan.quark.cn'||url.username||url.password||url.port||!/^\/s\/[a-z0-9]+\/?$/i.test(url.pathname))continue;
      const normalized=new URL('https://pan.quark.cn'+url.pathname.replace(/\/$/,''));
      const pwd=url.searchParams.get('pwd');if(pwd&&/^[a-z0-9]{1,12}$/i.test(pwd))normalized.searchParams.set('pwd',pwd);
      const prior=links.get(normalized.pathname);
      if(!prior||(!prior.searchParams.has('pwd')&&normalized.searchParams.has('pwd')))links.set(normalized.pathname,normalized);
    }catch{/* Non-share URLs in the text are ignored. */}
  }
  if(!links.size)return null;
  if(links.size>1)throw new Error('发现多个夸克分享链接，请每次只粘贴一条分享。');
  const url=[...links.values()][0];
  const code=text.match(/(?:提取码|访问码|密码)\s*[:：]\s*([a-z0-9]{1,12})(?![a-z0-9])/i)?.[1];
  if(!url.searchParams.has('pwd')&&code)url.searchParams.set('pwd',code);
  const header=text.match(/夸克网盘分享了\s*[:：]?\s*([「“『《"'])/);
  let title='';
  if(header){
    const open=header[1],close=({'「':'」','“':'”','『':'』','《':'》','"':'"',"'":"'"})[open];
    const start=header.index+header[0].length;let depth=1;
    for(let i=start;i<text.length;i++){
      if(open!==close&&text[i]===open)depth++;
      if(text[i]===close&&--depth===0){title=text.slice(start,i).trim();break;}
    }
  }
  return {title,url:url.href};
}
