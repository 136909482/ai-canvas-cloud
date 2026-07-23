# AI Canvas Cloud

AI Canvas Cloud 是 AI Canvas 的独立账号网站端，面向长期运营。用户登录后进入个人空间，项目图和资产元数据保存在 PostgreSQL，图片与视频保存在 OSS/S3 兼容私有对象存储。仓库采用 npm workspaces monorepo，实现顺序以 `docs/ROADMAP.md` 为准。

平台不提供官方模型、积分、计费、Provider 代理或服务器代生成。用户 Provider、endpoint、模型 ID、API Key、本机模型绑定和可恢复异步任务只允许保存在当前浏览器的本地加密 Vault。浏览器通过受控 OpenAI Compatible/DashScope 协议直连 Provider，媒体结果转为 Blob 后通过既有资产上传和项目图 API 入云。

## 核心架构

- PostgreSQL 保存认证、工作区、项目、节点、连线、增量变更、检查点、资产、迁移会话和 Admin 数据。
- 节点共有字段关系化，节点类型专属配置和低频展示属性使用 JSONB。
- 自动保存提交节点/连线增量操作；`project_changes` 保存有序变更，`project_snapshots` 保存完整检查点。
- OSS/S3 兼容私有对象存储保存图片、视频、缩略图、预览图和迁移归档；数据库不保存媒体 blob。
- Redis 只用于 API 分布式安全限流和 readiness，不保存生成队列或业务事实。
- Web、API、Admin Web、Admin API 是仅有的常驻应用；迁移和运维脚本是按需运行的一次性入口。
- 完整 `ProjectRecord` 只用于检查点、恢复及与本地 AI Canvas 的显式导入导出。

## 浏览器本地 Vault

Vault 配置文档和本地任务缓存当前均使用 `schemaVersion=1`、`cipherVersion=1`，IndexedDB 数据库版本为 2。首次保存时，浏览器生成不可导出的 AES-256-GCM `CryptoKey`，以 96 位随机 IV 加密独立文档；AAD 绑定 cipher/schema version、当前 Origin、可信 session 用户 ID，任务缓存还绑定项目 ID。密文或 Key 跨 Origin、跨账号、跨项目复制后不能解密。

- Provider 与模型配置保存后固定写入当前浏览器的加密设备 Vault，不提供 persistence 或单独删除入口。
- 登出、session 失效或换账号会立即清空内存明文，但保留按账号隔离的设备密文；同一账号再次登录可恢复，其他浏览器或设备必须重新配置。
- 用户清除当前网站数据时，浏览器会一并删除 IndexedDB 中的密文、CryptoKey、模型绑定和本地任务缓存；异步完成只允许回写同一可信用户和同一内部状态代次。
- 旧 `ai-canvas-settings` 明文只迁移一次；加密设备保存成功后才删除旧缓存，失败时保留旧值供重试。

workspace 配置与 workspace/localStorage 缓存会主动移除 Provider、endpoint、模型绑定和 Key；项目图、检查点、迁移包、Cloud API 请求、日志、指标和诊断也不保存这些私有 Provider 配置。两个浏览器设备拥有相互独立的 IndexedDB 与 CryptoKey，不会通过登录或项目同步隐式同步 Vault。

云端项目图只保存 `local:<uuid>` 匿名模型引用；同设备从 Vault 解析，新设备缺少绑定时显示不可用，用户必须明确选择本机同类型模型完成绑定，不会按名称或 ID 自动替换。本地任务队列写入按用户/项目隔离的加密 IndexedDB。页面关闭会中断无 remote task ID 的同步执行，已取得 remote task ID 的受控异步任务可在同一设备重新打开后继续轮询。任务缓存不进入项目图、checkpoint、目录包或 Cloud API。

生成结果 URL 必须允许浏览器 CORS 下载；无 CORS Provider 由用户使用自己的固定目标网关，平台不接收任意 target URL、Header/Body 模板或 Key。

## 仓库边界

本仓库独立于本地 Web/Electron 项目 `136909482/ai-canvas`：

- `ai-canvas` 维护本地目录、Electron SQLite 和桌面交付。
- `ai-canvas-cloud` 维护账号、个人空间、云端项目图、私有对象存储、迁移和独立 Admin。
- 两端只通过版本化 `ProjectRecord` 与目录包迁移数据，不共享运行时数据库，不隐式上传本地文件。
- Cloud 运行时不得依赖另一个仓库的源码路径。

## 长期文档

- `docs/DEVELOPMENT.md`：当前架构边界、安全约束和开发规则。
- `docs/PROJECT_STRUCTURE.md`：monorepo 目录职责和依赖方向。
- `docs/DATA_MODEL.md`：PostgreSQL 数据模型、事务不变量和迁移边界。
- `docs/API.md`：当前 HTTP 请求、响应和错误契约。
- `docs/ROADMAP.md`：唯一阶段状态和验收记录。

## 本地开发

安装依赖并复制 `.env.example` 为本地 `.env`：

```bash
npm install
docker compose -f infra/local/docker-compose.yml up -d
```

本地测试账号只可在未提交的 `.env` 中启用：

```text
DEV_SEED_ADMIN=true
DEV_SEED_ADMIN_EMAIL=admin@example.com
DEV_SEED_ADMIN_PASSWORD=<local password with at least 10 characters>
```

该账号不是系统管理员，production 会强制禁用开发 seed。浏览器来源使用精确 origin allowlist：

```text
WEB_PUBLIC_URL=https://cloud.example.com
WEB_ALLOWED_ORIGINS=https://cloud.example.com,https://studio.example.com
```

平台环境不得配置 Worker 数据库连接、生成队列名、Provider 凭据密钥环或官方 Provider 密钥环。用户 Provider 配置不进入 `.env`、服务端进程、日志或 Git。

常用开发入口：

```bash
npm run dev:start
npm run dev:status
npm run dev:restart
npm run dev:stop
```

`dev:start` 只后台启动 Web、API、Admin Web 和 Admin API。运行记录与脱敏日志写入已忽略的 `.codex-run/`；`dev:stop` 和 `dev:restart` 会核对 PID、Node 可执行文件、仓库工作目录、管理脚本、服务名和随机所有权标记。为兼容 P8-4 升级，它们可以停止旧版受管 Worker，但 `start` 与 `status` 不再创建或展示 Worker。

单服务前台调试：

```bash
npm run dev:web
npm run dev:api
npm run dev:admin-web
npm run dev:admin-api
```

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

## 数据库发布

生产应用启动不自动迁移。首次本地配置按顺序执行：

```bash
npm run db:migrate
npm run db:roles:provision
npm run db:roles:check
npm run admin:bootstrap
```

`db:roles:provision` 从 migration 连接创建相互隔离的普通 API 与 Admin API 角色，并将随机本机凭据写入未跟踪 `.env`，终端不打印凭据。它同时删除旧 Worker 角色和失效环境键。Admin 角色对普通用户数据只拥有用户最小列、session 时间、workspace 成员关系和存储聚合列的读取权限，只能更新用户 `status/updated_at` 并删除用户 session；不能读取密码、session token、项目节点正文或资产 object key。`db:roles:check` 验证角色非超级用户、Admin/public 列级权限隔离、P8-4 旧表已删除且旧 Worker 角色不存在。

迁移元数据位于 `server/db/migrations/release-manifest.json`。当前共有 29 个迁移；`0029_remove_server_generation.sql` 是高风险 contract migration，删除旧用户 Provider 密文、服务器生成任务/事件/队列/用量表、官方目录/积分表、相关函数与资产任务引用，并把仍含旧官方模式开关的活动站点配置前向发布为无该字段的新修订。执行前必须完成加密数据库备份并停止旧 API/Worker。回滚只能协调恢复 contract 前备份并部署旧应用；不能在现库猜测重建已删除凭据。前向修复是保持旧进程停止、重跑幂等 contract、删除残余旧角色/环境配置，再仅部署浏览器生成架构。

## Staging 基线

`Dockerfile` 构建非 root Web、API、Admin Web、Admin API、一次性 migrate 和 operations 制品。`infra/deploy/staging/docker-compose.yml` 只编排这四项常驻应用及 PostgreSQL、Redis、MinIO、迁移、备份/恢复和监控辅助服务；不存在 Worker 服务或生成队列。

```bash
cp infra/deploy/staging/staging.env.example infra/deploy/staging/staging.env
npm run deploy:staging:check
npm run deploy:staging:gate
docker compose --env-file infra/deploy/staging/staging.env -f infra/deploy/staging/docker-compose.yml build
docker compose --env-file infra/deploy/staging/staging.env -f infra/deploy/staging/docker-compose.yml --profile release run --rm migrate
docker compose --env-file infra/deploy/staging/staging.env -f infra/deploy/staging/docker-compose.yml up -d
```

配置门禁拒绝 protected 环境中的 localhost/HTTP 公网入口、默认 MinIO 凭据、占位认证密钥、开发 seed、缺失 origin allowlist 和跨环境资源标识。Redis 故障时普通读按既定策略 fail-open，高风险认证和写请求 fail-closed；Redis 仍是 API 限流与 readiness 依赖。

## 健康与安全

普通 API 提供：

```text
GET /health/live
GET /health/ready
GET /api/v1/health/live
GET /api/v1/health/ready
GET /metrics
```

普通 API 与 Admin API 提供相互独立的 live/ready 路径。普通 API readiness 检查 PostgreSQL、Redis 和对象存储；Admin API readiness 只检查 PostgreSQL 与对象存储。失败只返回稳定脱敏分类。平台 API 不接收用户 Provider Key、endpoint、真实模型 ID 或任意 target URL，日志、指标、错误、前端 bundle 和 Git 均不得包含密码、Token、对象存储密钥或 Provider Key。

Admin Web 与 Admin API 默认运行在 `http://127.0.0.1:5174` 和 `http://127.0.0.1:8788`。它们使用独立 Origin、Cookie、Better Auth Secret、数据库角色和固定 `admin` schema；P8-2 安全底座与 P8-3 网站设置保留，官方 Provider、模型和积分入口已删除。

Admin 运营概览对四种管理员角色开放 `dashboard.read`，只返回注册、活跃、存储、认证安全及 PostgreSQL/对象存储健康聚合。用户查询和写操作只对 `super_admin`、`support` 开放 `user.read/user.write`；列表使用稳定 keyset 分页并只返回最小用户字段，详情只补充 workspace 与存储摘要。封禁、解封和 session 撤销必须填写原因，幂等写入不可修改的脱敏审计；封禁会清理现有及竞态迟到的 session，解封不会恢复旧 session，`disabled` 用户不能登录、恢复 session 或访问 workspace。Admin 不读取项目正文、Prompt、资产内容、object key、session token 或浏览器 Provider 配置。
