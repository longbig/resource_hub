export type Bindings = {
  PANSOU_CONTAINER?: DurableObjectNamespace;
  DB: D1Database; MEDIA: R2Bucket; ASSETS: Fetcher;
  ENVIRONMENT: string; SITE_NAME: string; SITE_ORIGIN: string;
  ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; ADMIN_EMAILS: string;
};
export type Category = { id: string; name: string; description: string; position: number; count?: number };
export type Resource = {
  id: string; title: string; summary: string; body: string; category_id: string | null;
  category_name?: string; tags: string; cover_key: string; format: string; size: string;
  status: 'draft' | 'published' | 'archived'; featured: number; demo: number;
  created_at: string; updated_at: string; clicks?: number; share_id?:string; share_url?:string; share_code?:string;
};
export type Link = { id: string; resource_id: string; provider: string; url: string; code: string; status: string; position: number };
export type AppEnv = { Bindings: Bindings; Variables: { admin: string } };
