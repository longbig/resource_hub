import { Container } from '@cloudflare/containers';
import sources from '../config/search-sources.json';
export class PanSouContainer extends Container {
 defaultPort=8888;
 sleepAfter='5m';
 envVars={PORT:'8888',HOST:'0.0.0.0',GIN_MODE:'release',AUTH_ENABLED:'false',CHANNELS:sources.filter(s=>s.kind==='channel').map(s=>s.id).join(','),ENABLED_PLUGINS:sources.filter(s=>s.kind==='plugin').map(s=>s.id).join(','),CACHE_ENABLED:'true',CACHE_PATH:'/tmp/pansou-cache',ASYNC_PLUGIN_ENABLED:'true',ASYNC_RESPONSE_TIMEOUT:'10',PLUGIN_TIMEOUT:'10',ASYNC_MAX_BACKGROUND_WORKERS:'3',ASYNC_MAX_BACKGROUND_TASKS:'12',ASYNC_LOG_ENABLED:'false'};
}
