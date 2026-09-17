const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
let toastTimer;
function toast(message,error=false){const el=$('#toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,error?7000:3500);}
async function api(url,method='GET',body){const response=await fetch(url,{method,headers:body instanceof FormData?{}:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});const data=await response.json().catch(()=>({error:'登录状态可能已过期，请刷新页面重试。'}));if(!response.ok)throw new Error(data.error||'操作失败，请稍后重试。');return data;}
async function busy(button,action){if(button?.disabled)return;const text=button?.textContent;if(button){button.disabled=true;button.textContent='处理中…';}try{await action();}catch(err){toast(err.message,true);}finally{if(button){button.disabled=false;button.textContent=text;}}}
$$('[data-auto-submit]').forEach(el=>el.addEventListener('change',()=>el.form.requestSubmit()));
document.addEventListener('click',async event=>{
  const el=event.target.closest('button');if(!el)return;
  if(el.hasAttribute('data-copy')){try{await navigator.clipboard.writeText(el.dataset.copy);toast('提取码已复制');}catch{toast('复制失败，请长按提取码手动复制。',true);}}
  if(el.hasAttribute('data-remove-link')){el.closest('.link-row').remove();markDirty();}
  if(el.dataset.deleteResource&&confirm('确定删除这份资源？关联的链接、反馈和点击统计也会删除，无法撤销。'))await busy(el,async()=>{await api('/api/admin/resources/'+el.dataset.deleteResource,'DELETE');location.reload();});
  if(el.dataset.deleteCategory&&confirm('确定删除这个分类？已有资源的分类需要先调整。'))await busy(el,async()=>{await api('/api/admin/categories/'+el.dataset.deleteCategory,'DELETE');location.reload();});
  if(el.dataset.resolveReport)await busy(el,async()=>{await api('/api/admin/reports/'+el.dataset.resolveReport,'PATCH');location.reload();});
});
$$('[data-report]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();busy($('button[type=submit],button',form),async()=>{const data=Object.fromEntries(new FormData(form));await api('/api/reports','POST',{...data,resource_id:form.dataset.resource});form.reset();form.closest('details').open=false;toast('反馈已收到，谢谢你帮忙维护这份资源。');});}));
$('#add-link')?.addEventListener('click',()=>{if($$('.link-row').length>=8){toast('最多添加 8 个网盘入口',true);return;}$('#links-editor').append($('#link-template').content.cloneNode(true));markDirty();});
let dirty=false;
const resourceForm=$('#resource-form');
function markDirty(){dirty=true;$('#form-status').textContent='有未保存的修改';}
resourceForm?.addEventListener('input',markDirty);
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
resourceForm?.addEventListener('submit',event=>{event.preventDefault();busy($('button[type=submit]',resourceForm),async()=>{const data=Object.fromEntries(new FormData(resourceForm));data.featured=$('[name=featured]',resourceForm).checked;data.links=$$('.link-row').map(row=>({id:row.dataset.id,...Object.fromEntries($$('[data-field]',row).map(input=>[input.dataset.field,input.value]))}));const id=resourceForm.dataset.id;const result=await api('/api/admin/resources'+(id?'/'+id:''),id?'PUT':'POST',data);dirty=false;toast(data.status==='published'?'资源已发布':'资源已保存');$('#form-status').textContent='保存成功';if(!id)location.href='/admin/edit/'+result.id;});});
$('#category-form')?.addEventListener('submit',event=>{event.preventDefault();busy($('button',event.target),async()=>{await api('/api/admin/categories','POST',Object.fromEntries(new FormData(event.target)));location.reload();});});
$('#settings-form')?.addEventListener('submit',event=>{event.preventDefault();busy($('button',event.target),async()=>{await api('/api/admin/settings','PUT',Object.fromEntries(new FormData(event.target)));toast('设置已保存');location.reload();});});
$('#clear-demo')?.addEventListener('click',event=>{if(confirm('确定清空全部演示资源？你自己添加的资源不会删除。'))busy(event.target,async()=>{await api('/api/admin/demo','DELETE');toast('演示资料已清空');});});
function parseCSV(text){
  text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&cell.length)throw new Error('CSV 引号格式不正确');else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=ch;}
  if(quoted)throw new Error('CSV 有未闭合的引号');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);const header=rows.shift()?.map(x=>x.trim())||[];
  if(!header.includes('title')||new Set(header).size!==header.length)throw new Error('请使用模板列名，必须包含 title 且不能重复');
  if(rows.some(row=>row.length!==header.length))throw new Error('CSV 每行列数必须与表头一致');
  return rows.map(row=>Object.fromEntries(header.map((key,i)=>[key,row[i].trim()])));
}
let importRows=[];
$('#csv-file')?.addEventListener('change',async event=>{const file=event.target.files[0];$('#confirm-import').hidden=true;$('#import-preview').textContent='';importRows=[];if(!file)return;
  try{if(file.size>1024*1024)throw new Error('CSV 文件最大 1 MB');const rows=parseCSV(await file.text());const data=await api('/api/admin/import','POST',{rows,confirm:false});importRows=rows;const list=document.createElement('ol');for(const item of data.preview){const li=document.createElement('li');li.textContent=item.title+' · '+item.links+' 个网盘入口';list.append(li);}const p=document.createElement('p');p.textContent=`共 ${data.preview.length} 条，确认后导入为草稿。`;$('#import-preview').replaceChildren(p,list);$('#confirm-import').hidden=false;}catch(err){toast(err.message,true);}
});
$('#confirm-import')?.addEventListener('click',event=>busy(event.target,async()=>{const result=await api('/api/admin/import','POST',{rows:importRows,confirm:true});toast(`已导入 ${result.count} 条草稿`);event.target.hidden=true;importRows=[];$('#csv-file').value='';$('#import-preview').textContent='导入完成，可前往资源管理编辑并发布。';}));

$('#request-form')?.addEventListener('submit',event=>{event.preventDefault();const form=event.target;busy($('button[type=submit]',form),async()=>{await api('/api/requests','POST',Object.fromEntries(new FormData(form)));form.reset();$('#request-status').textContent='需求已收到！我们会查看并尽量补充，之后可以回到首页搜索。';toast('资源需求已提交');});});
document.addEventListener('click',event=>{const button=event.target.closest('[data-request-id]');if(button)busy(button,async()=>{await api('/api/admin/requests/'+button.dataset.requestId,'PATCH',{status:button.dataset.requestStatus});location.reload();});});

// Source selection stays in this browser; no credentials or upstream URLs accepted.
const sourceBoxes=$$('[data-search-source]');
try{const saved=JSON.parse(localStorage.getItem('shicang-search-sources'));if(Array.isArray(saved))sourceBoxes.forEach(box=>box.checked=saved.includes(box.dataset.searchSource));}catch{}
let networkRun=0;
function textNode(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
async function loadNetwork(){
 const root=$('#network-results');if(!root)return;const run=++networkRun;
 root.replaceChildren(textNode('p','搜索中…','muted'));
 try{const data=await api('/api/network-search','POST',{q:root.dataset.query,sources:sourceBoxes.filter(b=>b.checked).map(b=>b.dataset.searchSource)});if(run!==networkRun)return;
 if(data.local){location.replace('/?'+new URLSearchParams({q:root.dataset.query}));return;}
 const failures=data.sources.filter(s=>s.status==='error');root.replaceChildren();
 const heading=root.closest('section').querySelector('h2');heading.replaceChildren(document.createTextNode('搜索结果'),textNode('span',String(data.items.length)));
 const list=textNode('div','','resource-list');for(const item of data.items){
 const url=new URL(item.url);if(url.protocol!=='https:'||url.hostname!=='pan.quark.cn')continue;
 const row=textNode('a','','search-result');row.href=url.href;row.target='_blank';row.rel='noopener noreferrer nofollow';
 const top=textNode('div','','search-result-top'),date=new Date(item.datetime),valid=item.datetime&&!Number.isNaN(date.getTime());const time=textNode('time',valid?date.toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}):'时间未知');if(valid)time.dateTime=date.toISOString();top.append(textNode('h3',item.title),time);
 const bottom=textNode('div','','search-result-link');bottom.append(textNode('span',url.href));if(item.code)bottom.append(textNode('span','提取码：'+item.code,'result-code'));const arrow=textNode('span','↗');arrow.setAttribute('aria-hidden','true');bottom.append(arrow);row.append(top,bottom);list.append(row);
 }if(list.childElementCount)root.append(list);
 if(!data.items.length){const message=data.disabled?'暂无搜索结果，可在搜索设置中启用更多来源。':failures.length===data.sources.length?'搜索暂时不可用，请稍后重试。':'没有找到相关资源，可以提交资源需求。';const status=textNode('p',message,'muted');status.setAttribute('role','status');root.append(status);const retry=textNode('button','重新搜索','button');retry.addEventListener('click',loadNetwork);root.append(retry);}
 }catch(err){if(run!==networkRun)return;root.replaceChildren(textNode('p',err.message,'muted'));const retry=textNode('button','重试','button');retry.addEventListener('click',loadNetwork);root.append(retry);}
}
sourceBoxes.forEach(box=>box.addEventListener('change',()=>{try{localStorage.setItem('shicang-search-sources',JSON.stringify(sourceBoxes.filter(b=>b.checked).map(b=>b.dataset.searchSource)));}catch{}loadNetwork();}));
loadNetwork();
