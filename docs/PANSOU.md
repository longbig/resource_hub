# PanSou 接入

## 源码与本地改动

上游：https://github.com/fish2018/pansou

下载提交：`6d2f65d284c166e522fd0137e4e80b93c576bd1d`。源码位于 `vendor/pansou`，保留上游 MIT LICENSE。上游项目简介与 LICENSE 对盈利用途的表述不一致；商业发布前应向作者确认。

本地补丁：

- `main.go` 使用 HOST 环境变量指定监听地址，本地限定 `127.0.0.1`，容器内使用 `0.0.0.0`。
- PanSearch 插件查询已移除原先固定的 `pan=quark` 限制，查询多网盘结果，再由 PanSou 的 `cloud_types` 筛选用户选择的类型。本地与容器缓存目录已更名，避免沿用旧的仅夸克缓存。
- 其他 Go 源码保持上游版本。升级时请检查并保留这些改动。

## 单项目运行

项目包含 Hono 网站、数据库迁移、PanSou 源码和容器配置。对用户只提供一个网站地址，PanSou API 不对外代理开放。

本地需要 Node.js 22+、Go 1.24.9+。当前机器已在 `.tools/go` 安装 Go，不改系统 PATH。其他机器可安装 Go 或设置 `PANSOU_GO` 指向 Go 可执行文件。

```sh
npm install
npm run db:init
npm run dev
```

这个命令编译并启动 PanSou（127.0.0.1:8888）和网站（127.0.0.1:8787）。Ctrl+C 同时关闭两者。日志和可丢弃的搜索缓存位于 `.runtime`；资源与用户需求仍在 D1，与搜索缓存分开。更新 Go 源码或来源配置后重启即可。

只调试网页可用 `npm run dev:web`，此时不会自动启动 PanSou。

## 搜索链路

1. 空首页显示搜索框与网盘类型按钮，不加载资源列表；默认选择夸克，点击其他类型会用当前输入关键词搜索。
2. 搜索先展示 D1 中已发布且链接启用的对应网盘资源，始终请求网络搜索，命中本站资源不会中止网络搜索。
3. 浏览器请求本站 `/api/network-search`，服务端查询匹配的本站链接，用于与网络结果去重。重复分享链接只保留本站版本，包括分页之外的匹配资源。
4. 根据 `config/search-sources.json` 中的白名单，将勾选项转换为 PanSou 的 `channels`、`plugins`、`src`，将选中的网盘 ID 传给 `cloud_types`。使用 `/api/search` 的 `res: all`，以正文辅助判断标题之外的关键词匹配。
5. 校验返回结构、来源、对应网盘分享域名和路径，与本站链接去重后，网络结果最多显示 60 条，展示在本站结果之后。所有外部文本作为纯文本渲染。

当前启用三个插件（pansearch、hunhepan、quarksoo）与两个频道（yunpanx、yunpanshare）。用户可以在搜索设置中勾选并在浏览器保存偏好。增加来源只需改 JSON，但插件名必须在上游存在，修改后重启或重新部署。

网盘配置集中在 `public/providers.json`，发布、CSV 导入自动根据链接识别网盘。支持 PanSou 的 11 种 HTTP 网盘分享，不开放磁力或 ed2k 协议。

延续首条有效结果置顶策略：按对应网盘类型调用检测，遇到首条有效即停止。PikPak 与光鸭目前没有上游检测支持，保留结果并跳过检测请求。

外部结果不写入你的资源表，不会替换成你的拉新链接。展示来源与提取码。搜索源不代表整个互联网，链接有效性未逐一验证。

## 缓存、限流和状态

- 本站资源始终在前，网络缓存命中前也检查 D1；缓存键包含对应的本站链接，避免资源库更新后继续展示重复链接。
- 未命中搜索及网络点击仍只记录对应网盘在本站无匹配的情况；已有本站资源时追加网络结果不会产生未命中记录。
- 同 IP 每 10 分钟最多 30 次网络搜索，计数指纹按时间窗口哈希，不保存原始 IP。
- Worker 对非空结果缓存 5 分钟；PanSou 还有内部异步缓存。首次搜索可能只有部分结果，稍后重试可能补全。
- 前端忽略旧请求返回，避免切换来源后旧结果覆盖新结果。
- PanSou 接口异常显示暂不可用；来源状态“已查询”只表示请求已交给 PanSou，并不证明每个第三方来源健康。上游不返回可靠的逐来源失败状态。
- PanSou 本地日志和缓存可能含搜索关键词；不会作为资源数据备份导出。

## Cloudflare 部署

同一 `wrangler.jsonc` 配置 Worker + D1 + PanSouContainer。Worker 通过内部绑定访问容器，不需要另购 VPS，不开放通用 `/api/search` 代理。

容器配置最多 1 个 basic 实例，空闲 5 分钟休眠。容器重启会丢失搜索缓存，不影响 D1 中的资源或反馈。首次冷启动会增加等待时间。

需要支持 Containers 的 Cloudflare 账号和相应计费；**不是原先纯 Worker 的免费运行方案**。正式部署需 Docker 构建 linux/amd64 镜像。现有机器没有 Docker，因此尚未验证容器镜像构建和云端运行。

```sh
npm run check
npm test
npm run build            # 只检查 Worker 打包，不构建/发布容器
npm run build:container  # 需要 Docker，构建 PanSou 镜像
npm run deploy          # 配置好域名、D1、Access 后，一起部署
```

不要把 `--containers-rollout=none` 用于首次正式部署；它仅用于本地 Worker dry-run。

官方部署说明：https://developers.cloudflare.com/containers/get-started/
计费：https://developers.cloudflare.com/containers/pricing/
