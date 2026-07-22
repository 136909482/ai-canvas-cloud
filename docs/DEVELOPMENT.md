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

用户 Provider、endpoint、模型 ID 和 API Key 只允许存在于按 Origin 与可信用户隔离的浏览器加密 Vault。浏览器只能通过受控协议适配器直接调用 Provider，媒体结果再沿用 Cloud 资产上传和项目图 API 入云。平台 API 不接收 Key、endpoint、真实模型 ID 或任意 target URL。P8-5 Vault 尚未完成；现有 Vault/endpoint/脱敏代码是后续实现草稿，不得被 UI 暴露为已完成能力。

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

Admin 不提供官方 Provider、官方模型、积分调整或服务器任务入口。相关 URL 必须返回 404，不能保留空壳导航或表单。

## 浏览器本地生成边界

P8-5 及后续阶段的目标约束如下，当前不代表已完成：

- Provider、Key、模型和绑定进入同一版本化 IndexedDB Vault，按 Origin 和可信用户 ID 分区。
- 记住设备使用不可导出的 WebCrypto AES-GCM `CryptoKey`；仅本次会话只用内存。
- 登出清理内存明文；忘记设备删除密文、CryptoKey、绑定和本地任务缓存。
- 生产 endpoint 只允许 HTTPS，拒绝 URL 凭据和 fragment。
- 浏览器只实现受控 OpenAI Compatible/DashScope 协议，不接受任意脚本、Header/Body 模板或平台代理。
- 本地任务只存在内存或加密 IndexedDB；同步任务关页中断，异步任务可仅凭同设备加密 `remoteTaskId` 恢复。
- 云端节点最终只保存匿名本地模型引用；真实 Provider、endpoint、模型 ID、显示名和 Key 不进项目图或 Cloud API。

## 安全入口

`apps/api/src/security.ts` 统一处理 CORS、Origin、Cookie CSRF 和安全响应头；`apps/api/src/server.ts` 统一处理严格 JSON、结构上限、固定路由组和错误映射。请求日志只记录 request ID、方法、固定路由组、结果和耗时，不记录 query、动态资源 ID、Cookie、Authorization 或正文。

Redis Lua 原子窗口按认证、密码/邮件、资产/迁移 prepare、普通读写等固定类别限流。scope 在进入 Redis 前做 SHA-256。普通读在 Redis 故障时 fail-open；高风险认证和写请求 fail-closed 并返回可重试 `503 SERVICE_UNAVAILABLE`。已经删除的 Provider 测试和任务创建不再有独立限流类别。

API JSON 在领域服务前拒绝非法 UTF-8、重复键、非法 Unicode、非有限数值、超过 64 层或 100000 entries 的结构。迁移包另有路径、ZIP bomb、大小、压缩比和 canonical JSON 边界。共享 logger 对凭据、token、对象 key、签名 URL 和正文递归脱敏。

## 可观测性与部署

普通 API 与 Admin API 提供 liveness/readiness；API readiness 并行检查 PostgreSQL、Redis `PING` 和对象存储 `HeadBucket`。失败只返回 `connection_refused|timeout|authentication_failed|permission_denied|bucket_unavailable|unknown`。不存在 Worker health、Worker metrics、任务 backlog/running/retry/lease、Provider 请求或结果转存指标。

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
