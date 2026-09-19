> 当前部署采用 Worker + D1 + PanSou Container，不开通 R2，不提供图片上传。域名为 shicangpan.site，Worker 名为 resource-hub。下文历史图片存储步骤不适用于当前版本。
>
> GitHub 自动部署：主分支 main，构建命令 `npm run check`，部署命令 `npx wrangler deploy`。首次 D1 迁移已执行；新增迁移后在部署前执行 `npx wrangler d1 migrations apply DB --remote --env=""`。Cloudflare Workers Builds 负责构建 Dockerfile，电脑不需要 Docker。

# 部署到自己的 Cloudflare 账号

## 需要用户提供的信息

1. 已托管到 Cloudflare 的域名，例如 `resources.example.com`。
2. Cloudflare 登录授权：在你自己的浏览器中完成 `npx wrangler login`，不要在聊天中发送密码或 API Token。
3. 允许登录后台的邮箱地址。
4. 第一批真实资源的标题、介绍、夸克分享地址与提取码。网盘账号登录凭证不需要。
5. 可选的公开联系邮箱。

## 创建资源

```sh
npx wrangler login
npx wrangler d1 create shicang-resources
npx wrangler r2 bucket create shicang-media
```

把实际 D1 ID 写入 `wrangler.jsonc` 顶层 `d1_databases`。本地配置留在 `env.local`，不要用于线上。

确认 R2 已在账号中启用；如控制台要求开通计费，由账号持有人在控制台完成。本站只将封面与预览图存入 R2，不托管网盘资源文件。

## 配置后台登录

在 Cloudflare Zero Trust → Access → Applications 创建 Self-hosted 应用，保护以下地址：

- `resources.example.com/admin`
- `resources.example.com/admin/*`
- `resources.example.com/api/admin/*`

将策略设为仅允许指定管理员邮箱，选择邮箱验证码或你已有的身份提供方。确认后台根路径、全部子路径及写入接口均受保护，不能只保护 HTML 页面。

从 Access 应用复制 Application Audience (AUD)，填写：

```json
{
  "ENVIRONMENT": "production",
  "SITE_NAME": "拾藏资源库",
  "SITE_ORIGIN": "https://resources.example.com",
  "ACCESS_TEAM_DOMAIN": "https://你的团队.cloudflareaccess.com",
  "ACCESS_AUD": "应用的 AUD",
  "ADMIN_EMAILS": "your-email@example.com"
}
```

`SITE_ORIGIN` 不带末尾斜杠。多个邮箱用逗号分隔。Worker 验证 Access JWT 签名、issuer、audience、到期时间及邮箱，即使绕过外层策略也会拒绝未授权后台请求。公开资源页面不要求登录。

在顶层增加正式路由：

```json
"routes": [{ "pattern": "resources.example.com", "custom_domain": true }]
```

保持 `workers_dev:false`、`preview_urls:false`。生产环境没有免登录开关。

## 部署与验收

```sh
npm run deploy
```

部署脚本先检查配置、类型，再执行远端数据库迁移和代码发布。不要把 `scripts/seed.sql` 导入生产；生产从空资源库开始，在后台创建分类并发布自己的资料。

上线后检查：

- 未登录时公开页面可读，后台和 `/api/admin/export` 必须登录；其他未授权邮箱不能使用后台。
- 发布一条自己可分享的测试资料，手机与电脑均能打开；验证提取码、跳转和反馈。
- 草稿公网返回 404，下架后原资源页和原跳转入口都停止访问。
- 确认后台设置里的公开联系邮箱；正式页面不残留演示资料。
- 用目标用户的手机网络测试首屏和网盘跳转速度。Cloudflare 不等于在所有地区都有同样的访问速度。

## 备份与恢复

完整数据库 SQL 备份：

```sh
npx wrangler d1 export DB --remote --output ./backup-YYYY-MM-DD.sql
```

备份文件不要提交公共仓库。后台 JSON 导出也包含未公开资源与反馈，按私人数据保管。

恢复时优先创建独立数据库，导入 SQL 并检查条数后再切换绑定，避免直接覆盖在线数据库：

```sh
npx wrangler d1 execute RESTORE_DATABASE_NAME --remote --file ./backup-YYYY-MM-DD.sql
```

R2 图片另用 Cloudflare 控制台或 S3 兼容备份工具复制到私人备份位置。数据库只保存图片 key，不包含图片二进制。

## 费用与后续扩展

动态请求计入 Workers 用量，D1 按行读写和存储计算，R2 有存储和操作用量。上线前检查账号当前免费额度和限额，设置用量提醒。当前阶段不需要 KV、Redis、Queues、独立服务器或 MySQL。

随着资源数量和访问量增长，再增加带正确失效策略的公开 HTML 缓存、中文索引、分批后台任务和独立统计存储。批量导入先限制为 15 条，避免单次 Worker/D1 操作过重。

## PanSou 搜索版补充（必须先读）

项目已加入 PanSou 容器。正式部署前需 Docker 和 Cloudflare Containers 权限及计费配置；同一项目部署 Worker 与容器，无需额外 VPS。`npm run build` 仅打包 Worker，容器镜像另用 `npm run build:container` 验证。当前机器未安装 Docker，尚未完成镜像构建和云端联调。完整步骤与运行边界见 [PANSOU.md](PANSOU.md)。

### 后台简化与未命中搜索记录更新

发布资源和 CSV 导入现在只填写 `title`、`url`，保存或确认导入后直接发布。后台 `/admin/search-misses` 查看本站未命中的搜索词、次数与首次/最近时间；网络搜索请求不重复计数，刷新搜索页会增加一次。记录保存在 D1 的 `search_misses` 表。旧分类和失效反馈数据保留在数据库备份中，相关页面和接口已移除。

更新线上 Worker 前先执行 `npx wrangler d1 migrations apply DB --remote`，应用 `0003_search_misses.sql`；`npm run deploy` 已包含此步骤。仅运行 Cloudflare 自动构建部署时也需要先应用迁移。

网络结果点击记录更新：上线前应用 `0004_network_result_clicks.sql`。未命中搜索页面支持 CSV 全量导出，按关键词及被点击的链接展开。点击记录包含资源标题、链接、次数和时间，不记录用户身份。同次搜索中同一条结果只记一次；仅展示结果不记点击。点击使用一小时有效的服务器凭据，过期或浏览器未成功上报时不会计入，也不影响打开网盘。

### 保留平台上的 Access 配置

生产环境的 `ACCESS_AUD` 与 `ACCESS_TEAM_DOMAIN` 在 Worker 设置中的“变量和机密”管理，不放在构建环境变量中，也不写入仓库。`wrangler.jsonc` 顶层设置 `keep_vars: true`，确保 GitHub 自动部署保留平台普通变量。也可使用 Worker Secret。已丢失的变量需在平台重新设置并部署一次；此设置不会恢复历史值。
