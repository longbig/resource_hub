import { identifyProvider, shareIdentity, shareUrl } from './providers';

export function sourceIdentity(raw:string):string|null {
  const provider=identifyProvider(raw),url=provider&&shareUrl(provider,raw);
  if(!provider||!url)return null;
  // A shared subdirectory is a different source from its parent or siblings.
  const subdir=provider==='quark'?new URL(raw).hash.match(/^#\/list\/share\/([a-z0-9_-]+)(?:[/?#]|$)/i)?.[1]:undefined;
  return shareIdentity(provider,url)+(subdir?'#/list/share/'+subdir:'');
}

export const activeProcessedSource=`SELECT p.source_identity,p.resource_id,p.target_url,r.title
 FROM processed_search_resources p JOIN resources r ON r.id=p.resource_id AND r.status='published'
 WHERE EXISTS (SELECT 1 FROM links l WHERE l.resource_id=r.id AND l.status='active' AND l.url=p.target_url)`;

export async function processedSources(db:D1Database){
  const rows=(await db.prepare(activeProcessedSource).all<{source_identity:string}>()).results;
  return new Set(rows.map(row=>row.source_identity));
}
