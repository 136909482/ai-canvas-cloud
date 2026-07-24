# AI Canvas Cloud 开发指南

本文档定义网站端的当前长期架构边界。阶段状态和验收见 `ROADMAP.md`，数据库细节见 `DATA_MODEL.md`，HTTP 契约见 `API.md`。

## 产品边界

AI Canvas Cloud 是账号制 AI 画布 SaaS。平台提供账号、个人空间、云端项目图、私有媒体资产、显式目录包迁移和独立 Admin，不提供 Electron、本地 SQLite、本地 File System Access API、官方模型、积分、计费、Provider 代理或服务器代生成。

本仓库与本地版 `ai-canvas` 独立：

- 本地版维护目录 JSON、Electron SQLite、本地 `images/` 和桌面交付。
- Cloud 使用 PostgreSQL 保存关系化业务状态，使用 OSS/S3 兼容私有对象存储保存媒体。
- Redis 只用于普通 API 的分布式安全限流和 readiness，不保存生成队列或业务事实。
- 两端只通过版本化 `ProjectRecord` 和目录包显式迁移。
- 登录、退出或网络恢复不会自动上传本地工作区。

用户 Provider、endpoint、模型 ID、API Key、本机模型绑定和可恢复异步任务只允许存在于按 Origin 与可信用户隔离的浏览器加密 Vault。平台 API 不接收 Key、endpoint、真实模型 ID、remote task ID 或任意 target URL。浏览器只实现固定 OpenAI Compatible/DashScope chat/image/video 协议，结果通过 Cloud 资产和项目图 API 入云。

## 当前拓扑

```text
Browser
  -> Web application
  -> Cloud API
       -> PostgreSQL
       -> Redis (rate limiting and readiness only)
       -> Private object storage

Admin Browser
  -> Admin Web
  -> Admin API
       -> PostgreSQL admin schema
       -> Private object storage for site assets
```

常驻进程只有 Web、API、Admin Web 和 Admin API。迁移、备份、恢复和资产维护以一次性脚本或受控 operations 容器运行。不存在生成 Worker、BullMQ Consumer、服务器任务 dispatcher、服务器 Provider 调用或 Worker readiness。

## 工程骨架

- `apps/web`：Vite + React 画布前端，通过 Cloud 平台适配层访问认证、项目图、资产和迁移 API。
- `apps/api`：普通用户 HTTP、Cookie/CORS/CSRF、Redis 限流、健康检查和稳定错误映射。
- `apps/admin-web`：Refine Core 组织资源的独立自定义 React 管理端。
- `apps/admin-api`：独立管理员认证、CSRF、可选验证码、RBAC、网站设置和审计 HTTP 入口。
- `packages/contracts`：API 请求/响应、错误码和运行时 schema。
- `packages/project-graph`：图操作、检查点和 `ProjectRecord` 纯转换。
- `packages/shared`：前后端安全共享的纯工具、健康与指标基础。
- `server/modules`：认证、工作区、项目图、检查点、资产、迁移和 Admin 领域服务。
- `server/db/migrations`：显式 SQL 迁移与 release manifest。
- `infra/local`：PostgreSQL、Redis 和 MinIO 本地依赖。
- `infra/deploy/staging`：厂商无关的 staging Compose、Nginx、安全门禁、监控和备份恢复基线。

Web 不 import `server/`、数据库驱动、Redis 或对象存储管理 SDK。API 路由只解析 HTTP、可信会话和运行时 schema，再调用领域服务；不得直接修改项目图、资产、迁移或 Admin 表。

## 认证与租户

普通用户认证由 Better Auth 管理邮箱密码、密码哈希、签名 HttpOnly Cookie、session、邮箱验证和密码重置。Cloud 在注册、登录和会话恢复后幂等确保 personal workspace、owner membership 和 workspace user state 存在。

- 同账号只允许一个有效 session；接管前返回 `ACTIVE_SESSION_EXISTS`，确认后撤销旧 session。
- `auth_devices` 保存设备历史，不把浏览器生成的 device ID 当作认证凭据。
- 生产 Cookie 使用 HttpOnly、Secure、SameSite=Lax 和固定 Path。
- 所有资源访问先从可信 session 解析用户，再通过 `workspace_members` 校验角色和状态。
- 普通用户 `status=disabled` 时不能登录、恢复 session 或通过 workspace 授权；登录流程若刚创建临时 session，会先删除该 session 再返回拒绝。
- 客户端提交的 `user_id`、`workspace_id` 不参与授权。
- 其他 workspace 与不存在资源使用相同的非披露语义。
- 密码、Cookie、session/reset/verification token、完整邮件链接和用户正文不得进入日志。

Admin 使用独立 Better Auth Secret、`ai_canvas_admin.*` Cookie、Origin allowlist、数据库角色和固定 `admin` schema。普通 Cookie 不能登录 Admin，普通 API 角色没有 `admin` schema USAGE，Admin 角色不能读取普通身份表。管理员身份、登录验证码、账号/密码修改和 session 撤销统一由 `server/modules/admin/postgresAdminService.ts` 负责，路由不能直接写认证表。

## 云端项目图

当前画布不以完整项目 JSON 为日常事实来源：

- `projects` 保存项目元数据、当前 version/sequence 和 saved checkpoint 指针。
- `project_nodes` 保存关系化共有字段以及版本化 `data_json`/`presentation_json`。
- `project_edges` 保存端点、handle、类型和低频数据。
- `project_changes` 保存有序、幂等的操作批次。
- `project_snapshots` 保存 manual、periodic、import 和 pre-restore 检查点。
- `assets` 与 `asset_references` 保存媒体元数据和当前/检查点保护关系。

生成任务不是 PostgreSQL 事实。`0029_remove_server_generation.sql` 已删除旧生成任务、attempt、command、event、outbox、usage ledger、Provider 凭据、官方目录/积分表及任务资产引用列。检查点中的 `taskQueue.tasks` 只保留历史 `ProjectRecord` 结构兼容，不代表 Cloud 服务端任务恢复能力。

## 保存与冲突

Web 平台适配层维护最近确认的规范化图基线、server version 和 change sequence。自动保存做 ID 级 diff，生成节点/连线 upsert/delete 操作；每批携带 `baseVersion`、client/batch ID 和幂等键。

图操作事务必须：

1. 校验可信会话和 workspace 权限。
2. 锁定项目并校验当前 version。
3. 校验节点父级/环、连线端点、输入上限和 completed 资产归属。
4. 应用节点/连线变更并同步 `asset_references`。
5. 追加连续 `project_changes.sequence`。
6. 递增项目 version/sequence 后一起提交。

版本不一致返回 `409 PROJECT_VERSION_CONFLICT`。客户端只对不触碰相同节点/连线的远端 changes 推进基线并重试；无法安全追平时保留本地工作副本，提供重新加载、另存副本和稍后处理，不自动猜测性三方合并。删除不能被较旧 upsert 复活，正确性不得依赖 `beforeunload` 一定成功。

## 检查点

手动保存先 flush 增量，再由服务端从当前关系化节点/连线组装 manual checkpoint；客户端不上传整份 `record_json`。periodic checkpoint 只进入历史恢复列表。检查点记录 version、sequence、schema、字节数和排序去重的资产 manifest。

恢复事务校验 expected version/sequence、record/manifest 一致性和 completed 资产，先创建 pre-restore 检查点，再替换当前关系图、重建引用、追加 restore change 并递增版本。任一失败整体回滚。只有完整检查点通过恢复校验后，才允许裁剪更早 change。

## 资产与对象存储

媒体文件保存在私有 OSS/S3 兼容对象存储，PostgreSQL 只保存元数据。对象 key 由服务端不可变 ID 构成，不包含邮箱、项目名称或原始本地路径。

浏览器上传固定为：创建上传会话、无 Cookie 预签名直传、完成确认。完成确认重新读取对象并校验大小、MIME/魔数、可选 SHA-256 和 workspace 归属；只有 completed 资产可进入项目图。Web 长期只保存 `cloud-assets/<asset-id>`，签名 URL 按过期时间缓存并在 session/workspace 变化时清理。

资产 GC 采用软删除、宽限期、排他锁和新语句快照复查。仍被当前节点或有效 checkpoint manifest 引用的资产不能删除。completed 资产即使暂时无引用也只诊断不回收；对象缺失不得静默改写业务状态。

## 导入导出

目录包导入必须先执行纯校验、prepare、资产暂存上传，再以单个数据库事务 commit。copy 生成新的项目/节点/连线 ID；replace 仅 owner/admin 在 expected version/sequence 和显式确认下可用，不自动 merge。资产内容复用始终限定同一可信 workspace。

导出从冻结的关系化项目版本组装 `ProjectRecord` 和目录包，归档写入私有对象存储后才签发短期下载 URL。包中不得包含 object key、签名 URL、租户内部字段、Provider 配置、Key 或浏览器本地任务缓存。迁移会话以 PostgreSQL 为恢复事实，不依赖 Redis。

## P8 管理端与网站设置

P8-2 Admin 安全底座和 P8-3 网站设置保留：

- 管理员角色固定为 `super_admin|operator|support|auditor`。
- 图片验证码默认关闭，只能由 `super_admin` 开启。
- 首个 `super_admin` 只能通过交互式 `admin:bootstrap` 创建。
- 所有 Admin 写请求校验精确 Origin、Fetch Metadata 和签名 CSRF 双提交 token。
- `admin.audit_events` 追加式保存脱敏审计，数据库触发器禁止 UPDATE/DELETE。
- 网站设置使用不可变修订、current 指针、受控品牌资产和 `public.site_config_publications` 最小公开投影。

P8-8 用户运营遵循最小权限与最小披露：

- `dashboard.read` 对 `super_admin|operator|support|auditor` 开放；运营概览只返回注册、活跃、存储、认证安全和 PostgreSQL/对象存储健康聚合，不返回用户明细。
- `user.read/user.write` 只对 `super_admin|support` 开放。用户列表使用稳定 keyset 分页，只返回用户编号、邮箱、名称、验证/状态、创建/更新时间和最近 session 时间；详情只增加 workspace 与存储摘要。
- 封禁、解封和用户 session 撤销必须携带受长度限制的原因。封禁幂等删除已有 session，并在更新状态后再次删除竞态迟到的 session；解封不恢复旧 session；独立 session 撤销不改变用户状态。
- 用户状态变更、session 删除和对应 `admin.audit_events` 在同一事务完成。审计只保存目标用户 ID、前后状态、原因、撤销数量和哈希请求来源，不保存用户正文或凭据。
- Admin 数据库角色只读取指定用户列、session 时间、workspace 成员关系及资产存储聚合列，只能更新用户 `status/updated_at` 和删除 session；不能读取密码、session token、项目节点正文或资产 object key。
- Admin API/Web/审计不读取项目正文、Prompt、资产内容、object key、session token、浏览器 Vault 或 Provider 配置。

Admin 不提供官方 Provider、官方模型、积分调整或服务器任务入口。相关 URL 必须返回 404，不能保留空壳导航或表单。

## 浏览器本地生成边界

P8-5 Vault 的当前不变量：

- Provider 配置、按 `providerProfileId` 索引的 Key 凭据、模型条目和匿名绑定进入同一 `schemaVersion=2` Vault；`cipherVersion=1` 使用 WebCrypto AES-256-GCM、96 位随机 IV 和 128 位认证标签。Provider 配置不得含 API Key；模型条目以 `modelEntryId` 为唯一身份，运行时再解析 Provider 与上游 `modelId`。
- 记住设备使用不可导出的 `CryptoKey`。AAD 固定绑定 cipher/schema version、当前 Origin 和可信 session 用户 ID；IndexedDB 记录按可信用户 ID 分区，跨 Origin 或跨用户不能解密。
- Provider 与模型配置固定使用设备持久化，不向用户提供 persistence 或单独删除入口。Vault 保存与本地任务写入共用 FIFO 操作队列。
- 登出、session 失效和换账号清空内存明文，但保留当前浏览器中按账号隔离的设备密文；同一账号再次登录可恢复，其他浏览器或设备必须重新配置。不支持加密 IndexedDB 时必须显示错误，不得静默退化为明文或临时保存模式。
- 清除当前网站数据会由浏览器删除密文、CryptoKey、模型绑定和本地任务缓存。所有异步回写必须仍匹配同一可信用户、同一内部 persistence 和同一状态代次。
- 当前内测环境没有历史数据，不实现旧 `ai-canvas-settings`、Vault 或任务缓存的迁移、回滚或兼容读取；遇到旧密文记录时拒绝使用，需清除网站数据后重新配置。workspace 文件及 workspace/localStorage 缓存始终通过脱敏转换移除 Provider、endpoint、Key 与绑定。
- 项目图、checkpoint、目录包、Cloud API 请求、日志、指标、诊断和 Admin 均不保存真实 Provider 配置；不同浏览器设备的 IndexedDB/`CryptoKey` 相互独立，登录与云端项目加载不会同步 Vault。
- endpoint 配置校验在 production 强制 HTTPS，并拒绝 URL 凭据和 fragment。
- 服务商模型发现仅允许浏览器直连受控 OpenAI Compatible `GET /v1/models`：固定 Bearer/Accept 请求头、`credentials=omit`、`redirect=error`、`referrerPolicy=no-referrer`、`cache=no-store`、CORS 模式、15 秒超时和 2 MiB 流式响应上限；平台不新增发现 API、Provider 代理或任意路径探测。开发环境的私网 HTTP 直连仍受浏览器 Private Network Access 限制，目标服务必须自行正确配置 CORS 与 `Access-Control-Allow-Private-Network`。
- 导入确认前，Provider 草稿、Key、发现结果和勾选只存在组件内存；确认通过单次 store 状态变更和单次加密 Vault 写入同时落下 Provider、凭据槽和模型。reconcile 精确按 `(providerProfileId, modelId)` 更新仅 `source=discovered` 条目，保留用户显示名、分类和启用编辑；上游缺失标为 `missing`，重现恢复 `available`，手工条目不参与。
- 设置页固定以服务商为主视图：仅服务商可出现在主列表；模型只在当前服务商的详情区域显示、创建和编辑。手工创建模型时必须归属当前服务商，UI 不提供独立模型中心、按类别激活服务商或发现流程 feature flag。

P8-6 的当前不变量：

- 只实现受控 OpenAI Compatible 与阿里 DashScope chat/image/video 协议；请求路径、Header 和 Body 由适配器固定，不接受任意脚本或请求模板。
- 浏览器从 Vault 取出明文后直连 Provider，不使用 Vite/Cloud Provider 代理。生产 endpoint 必须 HTTPS、无 URL 凭据和 fragment；浏览器不能直连时由用户配置自己的固定 CORS 网关。
- Base64/二进制/结果 URL 统一转换为 Blob。Cloud 模式下上传失败会使任务失败，不把 Provider 临时 URL 写入项目；成功后只保存私有 Cloud 资产引用。
- Cloud 图在 diff/分批写入前把 `modelEntryId` 替换为 `local:<uuid>`，删除 Provider/profile/endpoint/Key、真实模型 ID、remote task、运行状态和上游错误；同设备加载时用 Vault 解析。
- 新设备缺少绑定时保留匿名引用，显示“此设备未绑定的模型”并禁止执行，不按名称或 ID 自动替换。
- 图像、聊天和视频节点固定使用“服务商 → 模型”两级选择。候选必须类别匹配、模型与服务商均已启用、模型仍可用且 endpoint/Key 有效；相同上游 `modelId` 在不同服务商下仍是不同 `modelEntryId` 路由，不得按名称合并。
- 节点持续显示未绑定、已删除、上游缺失或停用的当前引用，但禁止执行。用户为 `local:<uuid>` 明确选择本机模型时，只写入该匿名引用到 `modelEntryId` 的 Vault 绑定，节点字段保持匿名值；运行时经绑定解析该模型及其所属服务商/Key，绝不回退到默认或第一个模型。
- 生成资产文件名只使用本地 task ID；项目图、Cloud API、日志和 session 诊断不记录真实模型、Provider、endpoint 或 Key。

P8-7 的当前不变量：

- IndexedDB 数据库版本为 2；配置 Vault 与本地任务缓存分别使用 `schemaVersion=2`，共享 `cipherVersion=1` 和同一不可导出设备 `CryptoKey`。任务 AAD 额外绑定项目 ID，任务密文按可信用户/项目分区。
- 当前项目任务队列写入加密 IndexedDB。任务写入与 Vault 保存共用 FIFO 队列；陈旧用户或内部持久化上下文不能回写。
- 刷新或关闭页面会把未取得 remote task ID 的运行中同步任务标记为已中断，必须由用户重试；只有仍为 running 且已有受控异步 `remoteTaskId` 的任务会在同一设备恢复轮询。
- 项目图、workspace/project 持久化、checkpoint、目录包、Cloud API、PostgreSQL、日志和诊断均不携带本地任务缓存。删除项目删除其设备任务缓存；登出只清内存，清除当前网站数据删除当前 Origin 的全部设备任务密文。
- 新设备保留未解析的 `local:<uuid>` 并禁止执行。用户必须在对应节点明确选择当前设备同类型模型；该选择写入原匿名引用的 Vault 绑定，不按名称、显示名或真实 ID 自动猜测。

## 安全入口

`apps/api/src/security.ts` 统一处理 CORS、Origin、Cookie CSRF 和安全响应头；`apps/api/src/server.ts` 统一处理严格 JSON、结构上限、固定路由组和错误映射。请求日志只记录 request ID、方法、固定路由组、结果和耗时，不记录 query、动态资源 ID、Cookie、Authorization 或正文。

Redis Lua 原子窗口按认证、密码/邮件、资产/迁移 prepare、普通读写等固定类别限流。scope 在进入 Redis 前做 SHA-256。普通读在 Redis 故障时 fail-open；高风险认证和写请求 fail-closed 并返回可重试 `503 SERVICE_UNAVAILABLE`。已经删除的 Provider 测试和任务创建不再有独立限流类别。

API JSON 在领域服务前拒绝非法 UTF-8、重复键、非法 Unicode、非有限数值、超过 64 层或 100000 entries 的结构。迁移包另有路径、ZIP bomb、大小、压缩比和 canonical JSON 边界。共享 logger 对凭据、token、对象 key、签名 URL 和正文递归脱敏。

## 可观测性与部署

普通 API 与 Admin API 提供独立 liveness/readiness。普通 API readiness 并行检查 PostgreSQL、Redis `PING` 和对象存储 `HeadBucket`；Admin API readiness 只检查 PostgreSQL 与对象存储。失败只返回 `connection_refused|timeout|authentication_failed|permission_denied|bucket_unavailable|unknown`。不存在 Worker health、Worker metrics、任务 backlog/running/retry/lease、Provider 请求或结果转存指标。

普通 API `/metrics` 只暴露请求、错误、认证/限流、项目冲突、配额、迁移阶段、依赖状态和数据库连接池等低基数指标。Prometheus 与告警基线只抓取现有服务；标签禁止 workspace/user/project/request ID、URL、邮箱、正文和凭据。

`Dockerfile` 以非 root 用户构建/运行 Web、API、Admin Web、Admin API、migrate 和 operations。staging Compose 不包含 Worker 服务、生成队列、Provider 凭据或 Worker 数据库配置。迁移位于 `release` profile，应用启动不自动迁移。

## 备份、恢复与 0029 contract

备份 scheduler 使用 PostgreSQL 一致快照、AES-256-GCM 加密、SHA-256 manifest 和独立 backup Bucket。恢复演练只允许 restore-only PostgreSQL/Redis/Bucket/资源 ID；Redis 从空实例启动，不恢复生成队列。只读审计覆盖账号隔离、项目图、checkpoint、资产、迁移、软删除/GC 和对象存在性，不再审计任务、账本或 queued outbox。

`0029_remove_server_generation.sql` 是 29 个迁移中的 contract 阶段：

- 删除 `generation_tasks`、attempt、command、event、outbox、usage ledger 和 `provider_credentials`。
- 删除官方 Provider/模型/积分表、公开投影和相关函数。
- 删除 `asset_references.task_id`，恢复节点引用必填约束。
- 若活动站点配置仍含旧 `officialModeEnabled`，保留原不可变历史并前向发布无该字段的新当前修订。
- 不删除认证、项目图、检查点、资产、迁移或站点设置数据。
- 执行前必须有加密 contract 前备份，并停止旧 API/Worker。
- 回滚只能恢复备份并协调部署旧应用，不能原地重建已删除凭据或任务。
- 前向修复是停止全部旧进程、幂等重跑 0029、清理旧角色/环境键，再仅部署当前四项应用。

开发角色脚本只创建普通 API 和 Admin API 角色，同时删除旧 Worker 角色及旧 Worker/Provider 密钥环环境键；终端不得打印任何生成的密码或连接值。

## 验证规则

常规改动至少运行相关单测、Lint、TypeScript 构建和数据库迁移测试。认证、权限、项目图、资产、浏览器 Vault 或本地任务改动还必须运行相应集成、两账号隔离和双设备 E2E。数据库 schema 变更必须包含显式迁移、升级测试和回滚/前向修复说明。

当前全部真实 npm 脚本：

```bash
npm run dev:web
npm run dev:api
npm run dev:admin-web
npm run dev:admin-api
npm run dev:start
npm run dev:stop
npm run dev:restart
npm run dev:status
npm run test
npm run lint
npm run build
npm run db:migrate
npm run db:roles:provision
npm run db:roles:check
npm run admin:bootstrap
npm run db:migrate:test
npm run db:migrate:compat
npm run db:repair:checkpoint-assets
npm run db:maintain:assets
npm run deploy:staging:check
npm run deploy:staging:gate
npm run deploy:staging:backup
npm run deploy:staging:restore:drill
npm run format:check
```

统一开发进程入口只启动 Web、API、Admin Web 和 Admin API。`dev:stop`/`dev:restart` 仅为升级清理识别旧版受管 Worker，`dev:start`/`dev:status` 不暴露 Worker。每次新增或修改真实命令时，必须同步更新 README、AGENTS 和本文件。
