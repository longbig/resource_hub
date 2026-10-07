import { selectedProviders } from './providers';
import type {Resource} from './types';
// Shared by the page and API so fallback always uses the corresponding local drive inventory.
export async function localSearch(db:D1Database,q:string,provider='',category='',page=1) {
  const ids=selectedProviders(provider),filters=["r.status='published'","l.status='active'",`l.provider IN (${ids.map(()=>'?').join(',')})`];
  const args:unknown[]=[...ids];
  if(category){filters.push('r.category_id=?');args.push(category);}
  for(const term of q.split(/\s+/).filter(Boolean).slice(0,5)) {
    filters.push("(r.title LIKE ? ESCAPE '\\' OR r.summary LIKE ? ESCAPE '\\' OR r.tags LIKE ? ESCAPE '\\')");
    const pattern='%'+term.replace(/[\\%_]/g,'\\$&')+'%';args.push(pattern,pattern,pattern);
  }
  filters.push("l.id=(SELECT id FROM links WHERE resource_id=r.id AND provider=l.provider AND status='active' ORDER BY position,id LIMIT 1)");
  const from=' FROM resources r JOIN links l ON l.resource_id=r.id LEFT JOIN categories c ON r.category_id=c.id WHERE '+filters.join(' AND ');
  const [list,counts]=await Promise.all([
    db.prepare('SELECT r.*,c.name category_name,l.id share_id,l.url share_url,l.code share_code,l.provider share_provider'+from+' ORDER BY r.updated_at DESC,r.id,l.provider LIMIT 12 OFFSET ?').bind(...args,(page-1)*12).all<Resource>(),
    db.prepare('SELECT l.provider,count(*) n'+from+' GROUP BY l.provider').bind(...args).all<{provider:string;n:number}>()
  ]);
  return {items:list.results,total:counts.results.reduce((n,r)=>n+r.n,0),missingProviders:ids.filter(id=>!counts.results.some(r=>r.provider===id))};
}
