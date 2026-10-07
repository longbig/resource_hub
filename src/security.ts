import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './types';

export { providerCatalog, enabledProviderIds, providers, validLink } from './providers';
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export const adminAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const hostname = new URL(c.req.url).hostname;
  if (c.env.ENVIRONMENT === 'local' && ['localhost','127.0.0.1','[::1]'].includes(hostname)) {
    c.set('admin','local-preview'); return next();
  }
  if (!c.env.ACCESS_AUD || !c.env.ACCESS_TEAM_DOMAIN || !c.env.ADMIN_EMAILS) return c.json({ error: '后台尚未配置访问权限，请先完成 Cloudflare Access 设置。' }, 503);
  try {
    const domain = c.env.ACCESS_TEAM_DOMAIN.replace(/\/$/,'');
    if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)) throw new Error('domain');
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) throw new Error('token');
    let jwks = jwksCache.get(domain);
    if (!jwks) { jwks = createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`)); jwksCache.set(domain, jwks); }
    const { payload } = await jwtVerify(token, jwks, { issuer: domain, audience: c.env.ACCESS_AUD, algorithms: ['RS256'] });
    const email = String(payload.email || '').toLowerCase();
    if (!c.env.ADMIN_EMAILS.toLowerCase().split(',').map(x => x.trim()).includes(email)) throw new Error('email');
    c.set('admin', email); return next();
  } catch { return c.json({ error: '请使用获授权的管理员账号登录。' },403); }
};
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c,next) => {
  if (['POST','PUT','PATCH','DELETE'].includes(c.req.method)) {
    const expected = c.env.SITE_ORIGIN || new URL(c.req.url).origin;
    if (c.req.header('origin') !== expected || c.req.header('sec-fetch-site') === 'cross-site') return c.json({error:'请求来源不匹配，请从本站重新操作。'},403);
  }
  return next();
};
