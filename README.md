# AI Canvas Cloud

AI Canvas Cloud 是 AI Canvas 的独立网站端仓库，面向长期运营的账号制 SaaS。用户登录后进入个人空间，项目图、任务和资产元数据保存在云端，图片与视频存入私有对象存储。

P0 至 P6 已完成账号、云端项目图、资产、服务端任务及本地/Cloud 目录包迁移闭环；P7-1 至 P7-9 的来源边界、部署隔离、安全、两账号 E2E、可观测性、备份恢复和 schema 兼容已落地；P8-2 与 P8-3 已完成独立管理端和结构化网站设置。后续生成能力已调整为浏览器本地 BYOK：用户 Provider、模型和 API Key 不进入平台服务器，生成结果仍保存到云端项目与私有对象存储。仓库采用 npm workspaces monorepo，实现顺序以 `docs/ROADMAP.md` 为准。

## 核心架构

- PostgreSQL 保存用户、工作区、项目、节点、连线、增量变更、检查点、任务和资产引用。
- 节点共有字段关系化，节点类型专属配置使用 JSONB。
- 日常自动保存提交节点/连线增量操作，不重写整份项目 JSON。
- `project_changes` 保存有序变更，`project_snapshots` 保存手动或定期完整检查点。
- OSS/S3 兼容私有对象存储保存图片、视频、缩略图和预览图。
- Redis 持久化队列和独立 Worker 执行图片、视频与 LLM 任务。
- 完整 `ProjectRecord` 只作为检查点、恢复及与本地 AI Canvas 的导入导出契约。

## 仓库边界

本仓库独立于本地 Web/Electron 项目 `136909482/ai-canvas`：

- `ai-canvas` 继续维护本地目录、Electron SQLite 和桌面交付。
- `ai-canvas-cloud` 负责账号、个人空间、单活跃会话与设备历史、云端图持久化、对象存储和服务端任务。
- 两端通过版本化 `ProjectRecord` 与目录包迁移数据，不共享运行时数据库或隐式同步本地文件。

## 长期文档

- `docs/DEVELOPMENT.md`：架构边界、安全约束和开发规则。
- `docs/PROJECT_STRUCTURE.md`：计划中的 monorepo 目录和依赖方向。
- `docs/DATA_MODEL.md`：PostgreSQL 混合图模型与事务不变量。
- `docs/API.md`：认证、项目图、资产、任务和迁移 API 契约。
- `docs/ROADMAP.md`：分阶段实现顺序和验收门槛。

## 本地开发

安装依赖：

```bash
npm install
```

复制 `.env.example` 为本地 `.env` 后，可启动本地依赖：

```bash
docker compose -f infra/local/docker-compose.yml up -d
```

如果需要本地测试账号，可只在本机 `.env` 中启用开发 seed：

```text
DEV_SEED_ADMIN=true
DEV_SEED_ADMIN_EMAIL=admin@example.com
DEV_SEED_ADMIN_PASSWORD=<local password with at least 10 characters>
```

该账号只是开发测试账号，不代表系统管理员权限；生产环境会强制禁用该 seed。

浏览器来源必须通过精确 origin allowlist。生产/staging 只填写实际 HTTPS Web origin，不要包含路径、凭据、query 或 fragment：

```text
WEB_PUBLIC_URL=https://cloud.example.com
WEB_ALLOWED_ORIGINS=https://cloud.example.com,https://studio.example.com
```

Provider BYOK 需要独立于 Better Auth 的 32 字节主密钥。值使用 `版本号:base64密钥`，轮换时同时保留旧版本并提高 active 版本；生产值只放部署密钥管理，不写入 Git：

```text
PROVIDER_CREDENTIAL_KEYS=1:<base64-32-byte-key>,2:<base64-32-byte-key>
PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION=2
```

常用开发入口：

```bash
npm run dev:start
npm run dev:status
npm run dev:restart
npm run dev:stop
```

`dev:start` 在后台统一启动 Web、API、Worker、Admin Web 和 Admin API，运行记录与脱敏日志只写入已忽略的 `.codex-run/`。`dev:stop`/`dev:restart` 在停止前核对 PID、Node 可执行文件、仓库工作目录证明、管理脚本路径、服务名和随机所有权标记；任一身份不一致都会拒绝停止，不会按进程名结束其他 Node 进程。需要单独前台调试时仍可使用：

```bash
npm run dev:web
npm run dev:api
npm run dev:worker
npm run dev:admin-web
npm run dev:admin-api
npm run db:migrate
```

当前真实命令：

```bash
npm run test
npm run lint
npm run dev:start
npm run dev:stop
npm run dev:restart
npm run dev:status
npm run db:roles:provision
npm run db:roles:check
npm run admin:bootstrap
npm run db:migrate:test
npm run db:migrate:compat
npm run build
npm run deploy:staging:check
npm run deploy:staging:gate
npm run deploy:staging:backup
npm run deploy:staging:restore:drill
```

### Staging 容器基线（P7-2）

`Dockerfile` 使用锁定的 Node/Nginx 基础镜像、`npm ci` 和显式 workspace 依赖顺序构建 `web`、`api`、`worker` 与一次性 `migrate` 制品。API、Worker 和迁移镜像以非 root `node` 用户运行，Web 以非 root Nginx 用户运行；运行镜像不复制 `.env`、开发 seed、源码凭据或运行时密钥。

staging 定义位于 `infra/deploy/staging`。先复制只含占位符的 `staging.env.example` 为未跟踪的 `staging.env`，再由部署密钥管理填入 staging 专属域名、PostgreSQL、Redis、Bucket、邮件 SMTP、Provider/BYOK 密钥、队列名和资源/凭据隔离标识：

```bash
cp infra/deploy/staging/staging.env.example infra/deploy/staging/staging.env
npm run deploy:staging:check
npm run deploy:staging:gate
docker compose --env-file infra/deploy/staging/staging.env -f infra/deploy/staging/docker-compose.yml build
docker compose --env-file infra/deploy/staging/staging.env -f infra/deploy/staging/docker-compose.yml --profile release run --rm migrate
docker compose --env-file infra/deploy/staging/staging.env -f infra/deploy/staging/docker-compose.yml up -d
```

`migrate` 是独立的一次性发布步骤；API/Worker 启动命令不执行迁移。Compose 使用独立的 staging PostgreSQL、Redis、MinIO Bucket、队列名、邮件/Provider/BYOK 配置和持久卷，Web 只通过同域反向代理访问 API。配置门禁会拒绝 staging/production 的 localhost、HTTP Web/Auth URL、默认 MinIO 凭据、占位认证密钥、开发管理员 seed、缺失来源白名单以及带有 local/production 标识的资源或凭据 ID。API 与 Worker readiness 都执行 PostgreSQL `SELECT 1`、Redis `PING` 和 S3 `HeadBucket`；任一依赖不可用时返回 `503` 与 `degraded`，并且只暴露稳定的脱敏分类。

schema 发布在每个 release train 内使用 `expand -> migrate -> contract` 单调顺序，长期元数据位于 `server/db/migrations/release-manifest.json`。每个迁移声明 release train、旧/新应用可读性、锁风险、statement timeout、回滚边界、前向修复和备份门槛；`npm run db:migrate:compat` 会校验 30 个迁移的 manifest、旧 schema + 新应用的可选列读取、新 schema + 旧应用的列读取，以及中断事务重跑。当前没有 contract migration；删除列/表必须先经过备份与独立发布窗口。

### Admin 安全底座（P8-2）

Admin Web 与 Admin API 分别运行在 `http://127.0.0.1:5174` 和 `http://127.0.0.1:8788`，不从普通网站导航暴露入口。Admin 使用独立 Origin allowlist、`ai_canvas_admin.*` Cookie、Better Auth Secret、非超级用户数据库角色和固定 `admin` schema；普通应用角色不能读取管理员身份、登录安全或审计表，Admin 角色也不能读取普通身份表。Admin Web 使用 Refine Core 组织审计资源与角色权限，页面为仓库自定义 React UI。

首次配置按顺序执行，所有密码和 Secret 只写入已忽略的本机 `.env`：

```bash
npm run db:migrate
npm run db:roles:provision
npm run db:roles:check
npm run admin:bootstrap
```

`db:roles:provision` 从 migration 连接创建相互独立的普通 API、Worker 和 Admin 运行角色并生成随机本机凭据，终端不打印凭据；后续迁移使用 `MIGRATION_DATABASE_URL`。Worker 只使用脚本写入未跟踪 `.env` 的 `WORKER_DATABASE_URL`，不能复用普通 API 连接。`admin:bootstrap` 必须在真实交互式 TTY 中输入管理员账号并确认密码，只允许管理员表为空时创建首个 `super_admin`，不接受长期环境变量 seed。管理员使用账号和密码登录；图片验证码默认关闭，`super_admin` 可在安全状态页开启，开启后登录页要求一次性 5 位验证码。安全状态页也可修改账号和密码，密码修改会撤销其他管理会话。所有写请求先校验精确 Admin Origin 与签名 CSRF 双提交 token，管理审计在应用层移除凭据/正文并由数据库触发器禁止 UPDATE/DELETE。

P8 后续不提供官方模型、积分、计费或平台代生成。用户在浏览器本地加密保存 Provider、endpoint、模型 ID 和 API Key，由 Web 端直接调用受控协议接口，再通过现有短期签名 URL 将媒体结果上传到私有对象存储。平台 API 不接收用户 Key 或任意 Provider target URL。旧服务器 BYOK、生成 Worker 和任务表将在显式 contract migration 中清理；Redis 保留用于 API 安全限流。

该定义是厂商无关的容器基线，不代表真实 staging 已配置域名/TLS、SMTP、Provider、密钥管理、备份或告警接收端；这些外部资源必须在部署前单独创建并填入密钥管理系统，不能提交到 Git。

### Cookie CSRF 与速率限制（P7-3）

staging/production 的浏览器写请求在读取 Cookie 或 body 前校验精确 `Origin`，拒绝 `Sec-Fetch-Site: cross-site`；登录、注册、验证/重置、退出和业务 Cookie 写路径共用该边界。Better Auth Cookie 固定使用 HttpOnly、SameSite=Lax 和 Path=/，protected 环境额外强制 Secure。API 位于受控反向代理后时显式设置 `API_TRUST_PROXY=true`，限流只采用代理追加链最右侧的合法 IP；API 可被公网直接访问时必须保持 false。

API 使用 Redis 原子窗口在多实例间共享认证、密码/邮件、Provider 测试、任务创建、资产/迁移 prepare 与普通读写限额。scope 进入 Redis 前做 SHA-256，不记录或返回 Cookie、账号或网络原值。超限返回 `429 RATE_LIMITED` 和秒级 `Retry-After`；Redis 不可用时普通读显式 fail-open，高风险认证及费用写路径返回可重试 `503 SERVICE_UNAVAILABLE`。readiness 使用同一 Redis 客户端执行 PING，连接恢复后无需重启 API。

### Web CSP、对象存储 CORS 与上传边界（P7-4）

staging Web 使用 Nginx 模板注入 `S3_PUBLIC_ORIGIN`，页面响应发送限制脚本、frame、表单、连接、图片/视频、Worker 和字体来源的 CSP，并启用 HSTS、Referrer-Policy、Permissions-Policy、nosniff、frame deny 和静态资源缓存。策略不使用 `unsafe-eval` 或任意公网媒体源；签名对象存储 URL 只允许配置的 public origin。

API 使用内部 `S3_ENDPOINT` 做健康检查和管理操作，使用独立的 `S3_PUBLIC_ENDPOINT` 签发浏览器 PUT/GET/multipart URL；运行时密钥只存在 API/Worker，浏览器上传使用 `credentials: omit`。staging MinIO bucket 默认 `anonymous none`，发布步骤配置仅允许 Web origin 的 GET/PUT/HEAD、受控请求头和 ETag 暴露。资产单文件上限 50 MiB，迁移包/JSON/深度/文件和 multipart 分片均有服务端固定上限，完成前重新校验对象大小、MIME 和 SHA-256。

### 安全攻击面回归矩阵（P7-5）

API 在进入认证或领域服务前拒绝超限正文、非法 UTF-8、重复 JSON 键、非法 Unicode、深层或超多 entries；请求日志只记录固定路由组，不记录 query、动态 ID、Cookie、Authorization 或正文。共享 logger 对 token、API Key、对象 key、签名 URL 和 Provider/body 字段递归脱敏，开发邮件同样不输出验证或重置链接。

受控安全 fixture 覆盖 SSRF/重定向/协议-host-端口绕过、Provider 任务 ID、路径穿越、ZIP bomb、data/blob URL、恶意 MIME、编码边界和跨 workspace 非披露语义。fixture 只使用注入网络适配器和 `.invalid` 域名，不访问任意公网地址，也不读取或快照本机 `.env` 凭据。

### 两账号云端 E2E 与授权矩阵（P7-6）

`apps/api/src/cloudE2E.integration.test.ts` 以随机 PostgreSQL schema、随机测试账号和独立 cookie/device 上下文运行真实 Cloud HTTP 流程。它覆盖项目、图并发冲突、checkpoint、Provider、任务、资产直传/读取、会话/设备、API 重启恢复和登录接管；跨账号访问项目/图/资产/任务/会话/设备统一按非披露 404 验证，B 不会得到 A 的签名 URL。测试结束时只清理自身 schema 与对象。

`server/modules/workspaces/authorization.integration.test.ts` 固化 owner/admin/editor/viewer 的读取、内容写入、管理和 ownership 四档服务端权限矩阵。个人空间首发 UI 不声明团队角色能力；真实 staging/隔离 CI 可直接调用同一 harness，不需要固定生产账号或生产数据。

### 加密备份与隔离恢复（P7-8）

staging `backup-scheduler` 默认每 24 小时使用 PostgreSQL 导出快照生成 custom dump，以 AES-256-GCM 加密后写入独立备份卷，并将同一恢复点的对象镜像写入独立 backup Bucket；manifest 只保存时间、大小、SHA-256 和聚合指纹，不包含数据库 URL、对象 key、账号正文或密钥。数据库文件和对象快照默认保留 30 天，26 小时没有成功备份会触发 `AiCanvasBackupMissing`。真实部署必须把 backup endpoint、加密密钥和持久卷替换为独立故障域和密钥管理服务。

手动创建恢复点和执行隔离恢复演练：

```bash
npm run deploy:staging:backup
# 将 staging.env 的 RESTORE_BACKUP_ID 设置为成功 manifest 中的 backupId
npm run deploy:staging:restore:drill
```

恢复命令只允许 `restore-*` PostgreSQL、Redis、Bucket、队列和资源 ID，并要求 `RESTORE_RESET_CONFIRMED=true`。它重建 restore-only 数据库、校验密文 SHA-256/GCM、运行当前迁移、把对象复制到 restore-only Bucket，并从 PostgreSQL 重新开放 queued task outbox；Redis 使用空的独立 AOF 实例，不把 Redis 当作灾备事实源。只读审计检查两工作区、项目图版本/sequence/change、checkpoint manifest、资产 hash/引用、任务/账本、迁移状态、软删除/GC 和对象存在性，缺失对象只报告并阻断，不修改资产状态。source guard 在演练前后比较聚合指纹，恢复容器本身不注入源数据库 URL。

当前基线 RPO 目标为 24 小时，告警窗口为 26 小时；每次演练输出实际 `rtoSeconds`，真实 staging 的 RTO 目标和责任人必须由部署运行手册结合数据量确认。恢复 Compose profile 不自动切流、不启动 Provider Worker，也不删除原 staging 或恢复卷。

历史 checkpoint 资产 manifest 维护命令默认只读预检；确认审计输出后才显式提交，每个 checkpoint 使用独立短事务：

```bash
npm run db:repair:checkpoint-assets
npm run db:repair:checkpoint-assets -- --apply --batch-size=100
```

资产维护命令同样默认只读，诊断数据库缺失对象和 `workspaces/` 受控前缀下的 bucket 孤立对象。确认 JSONL 预检结果后才可显式提交；默认宽限期为 168 小时：

```bash
npm run db:maintain:assets
npm run db:maintain:assets -- --apply --batch-size=100 --grace-hours=168
```

API 健康检查端点：

```text
GET /health/live
GET /health/ready
GET /api/v1/health/live
GET /api/v1/health/ready
GET /metrics
```

## 状态

P0 文档基线已完成。P1 第一批代码已落地：`apps/web` 使用临时 Cloud 内存适配器独立启动和构建；`apps/api` 和 `apps/worker` 提供配置校验、结构化日志和优雅关闭；`infra/local` 提供 PostgreSQL、Redis 和 MinIO 基础配置。

P2 第一批基础已落地并已切到 Better Auth：核心认证表使用 `"user"`、`"session"`、`"account"`、`"verification"`；`PostgreSQL AuthService` 通过 Better Auth 管理邮箱密码、签名 HttpOnly Cookie、会话恢复、邮箱验证和密码重置。产品策略为单活跃设备：密码验证成功后如检测到其他有效 session，接口返回 `409 ACTIVE_SESSION_EXISTS`，前端要求用户确认；确认接管后旧 session 失效，新设备成为唯一有效登录。`auth_devices` 独立保留当前与历史设备、首次登录和最近活跃时间，用户可在设备管理页删除非当前设备记录。前端首屏检查一次，并在页面可见时每 5 分钟心跳一次；业务请求返回未授权则立即退出，同一标签页的并发 session 检查会合并。Cloud 侧继续维护 personal workspace、成员关系、工作区用户状态和认证审计表。Web 匿名态已提供独立产品首页、顶部登录/注册入口、响应式品牌与备案信息区；认证表单以弹层承载，并保留 session 恢复、登录接管确认、账号菜单、设备管理、退出登录、邮箱验证、忘记密码和重置密码闭环。

P3 关系化项目图、增量保存、变更读取、手动/定期检查点、历史详情与恢复已落地。P4-1 至 P4-11 已建立资产、上传会话和引用表，接入 MinIO/S3 预签名直传、完成确认、completed 资产元数据读取和短期私有读取 URL；Web Cloud 平台层已接入创建上传会话、无 Cookie 直传、完成确认、`cloud-assets/<asset-id>` 定位符以及签名 URL 缓存刷新和 session 清理。项目图事务已从节点数据提取持久化 Cloud 资产 ID，按可信工作区校验 completed 状态，并在节点替换或删除时同步更新 `asset_references`。manual、periodic 和 pre-restore checkpoint 已保存资产 manifest；restore 会校验 manifest/record 一致性、资产可用性并重建当前节点引用。历史 checkpoint 可通过默认只读、显式提交的分批维护命令安全回填 manifest 或标记失效，且保留异常手动保存点指针。每个 personal workspace 默认拥有 20 GiB 云资产配额，API 可读取已用/预留/剩余容量，上传会话在事务内预留容量并拒绝并发超卖。资产维护命令按稳定游标分批诊断缺失/孤立对象，并只在宽限期结束、当前引用和有效 checkpoint manifest 均不再保护时幂等回收 pending 已过期、failed、quarantined 或已软删除对象；completed 资产不因暂时无引用被回收。

P5-1 已新增 `generation_tasks` 和 `task_attempts`，把任务状态、尝试、重试上限、可领取时间和 Worker 租约字段落到 PostgreSQL，并将 `asset_references.task_id` 收紧为同工作区任务 UUID 外键。共享契约和纯状态机已定义 queued/running/succeeded/failed/canceled 语义；任务 HTTP API、Redis 队列消费、Provider 凭据与用量账本仍按 `docs/ROADMAP.md` 后续切片推进。

P5-2 已新增 `provider_credentials`，使用带 workspace/provider AAD 的 AES-256-GCM 版本化 envelope 保存 BYOK；API 已提供 Provider 配置列表、写入和删除，只返回配置状态与末四位。服务端注册表当前只允许 `https://api.openai.com` 和 `https://dashscope.aliyuncs.com/compatible-mode/v1`，不提供任意 URL 代理。Provider 连接测试、实际调用和用量账本仍属于后续切片。

P5-3 已接入任务创建、列表、详情、取消和重试 API。任务服务从可信 session 解析 workspace，在 workspace 行锁下处理创建/命令幂等、项目节点归属、active Provider 配置和最多 5 个活跃任务，并用 `task_commands` 持久化 cancel/retry 幂等事实。当前 API 只建立可恢复的服务端任务状态，不消费 Redis 队列、不调用 Provider，也不把现有前端本地生成链路切到服务端；这些能力继续按 `docs/ROADMAP.md` 后续切片推进。

P5-4 已新增 `task_queue_outbox`。任务创建和显式重试在原 PostgreSQL 事务中写入稳定派发事实，Worker dispatcher 通过短期 claim、`FOR UPDATE SKIP LOCKED`、失败退避和稳定 BullMQ job ID 可靠发布到 Redis；API 不直接双写 Redis，消息不含请求正文、用户内容或 Provider 凭据。任务领取和租约恢复已在 P5-5 补齐，Provider 调用仍由后续节点接入。

P5-5 已新增 Worker 专用任务执行服务和 BullMQ Consumer 适配器。claim 原子完成 queued -> running、attempt 创建与 lease fencing；续租、进度、取消和失败收敛必须匹配 Worker/lease token，可重试失败和过期租约按 attempt 指数退避并事务化写入下一条延迟 outbox，达到上限则稳定失败。Worker 主进程已定期恢复过期租约；Consumer 已覆盖全局并发、心跳、取消和优雅关闭，但在 Provider processor 落地前保持未启用，避免误消费真实 queued 任务。

P5-6 已在 `server/modules/providers` 建立统一 Provider adapter 和连接测试。测试请求只由注册表的固定 HTTPS endpoint 生成，启用 `redirect: 'error'`、10 秒超时和 64 KiB 响应上限；注册表还维护精确结果域名 allowlist，拒绝 HTTP、内网、相似域名和任意客户端 target URL。`POST /api/v1/settings/providers/:providerId/test` 仅接受空对象，路由不接触明文凭据；领域服务在 owner/admin 授权后短期解密、调用 adapter，并只返回成功状态或脱敏错误分类。Provider processor 仍未启用。

P5-7 已由 `0013_provider_submission_fencing.sql` 为每个 `task_attempts` 行增加稳定 submission key、提交阶段和远端任务 ID。Worker 只有持有有效 lease 才能将 attempt 置为 `submitting` 或记录远端任务；恢复时若任务已有远端 ID 一律先轮询，未确认提交只有 adapter 明确声明支持幂等时才重用同一 key 自动提交，否则输出 `uncertain` 并要求后续调用方稳定失败为用户确认。

P5-8 已由 `0014_task_results_usage_ledger.sql` 增加每个成功任务唯一的用量账本。Worker 结果转存边界只接受 Provider 精确结果域名、拒绝重定向，并在 50 MiB 上限内校验 MIME、媒体魔数和 SHA-256 后写入私有对象存储；随后以当前 lease token 在一个 PostgreSQL 事务内写入 completed 资产、任务/节点引用、一次用量、attempt/task succeeded 与必要的 worker 图 change。预览节点只合并任务专属 `generationResults.<taskId>` 资产 ID，不覆盖用户位置或其他编辑；转存失败不会标记任务成功，重放不重复资产、节点或账本。P5-9 已启用首个受控同步图片 processor，其他 Provider 协议仍按后续切片接入。

P5-9 已开始，Worker 启用受控图片和视频能力：OpenAI `gpt-image-2` 同步文生图和图片编辑、阿里百炼 `wanx2.1-t2i-turbo` 异步文生图，以及阿里百炼 `wan2.7-t2v` 异步文生视频。前者分别使用固定 images generations/edits endpoint、受限参数与单张 base64 结果；编辑输入只会从 source node 的 completed 私有资产引用读取并 multipart 上传，绝不使用浏览器 URL。阿里任务使用固定提交/查询 endpoint，收到远端 ID 即以 lease fencing 持久化，恢复只轮询而不二次提交；视频结果在 MIME、魔数和大小校验后转存为私有资产。全部成功路径复用 P5-8 私有转存和图事务。限流、超时和网络故障可重试；认证、参数、未知模型、重定向及无效响应稳定失败。

P5-10 已完成，Cloud Web 的任务队列已改由服务端任务 API 驱动：创建、列表、详情、取消和重试均通过受控 Cloud API；Cloud runtime 不再运行浏览器 Provider。队列投影保存 server task ID、服务端 0-100 进度与脱敏状态，刷新后仍以服务端 queued/running 状态为准；任务终态会刷新项目图，并将 Worker 结果资产 ID 通过短期签名 URL 恢复到图片或视频节点，不保留 Provider 临时 URL 或浏览器密钥。非当前项目只后台读取 queued/running 摘要作为内存回切缓存，不触碰当前画布；回到该项目后立即合并缓存并再由服务端查询校准。任务面板会列出这些其他项目的活跃任务与项目名，并可按全部、进行中和已结束筛选；失败项显示服务端脱敏错误，其他项目只可取消。设置中心新增 Cloud 服务商入口，浏览器只短暂提交新 API Key 到既有 Provider 设置 API，成功、删除或关闭后清空输入，且绝不写回本地模型 profile 或任务快照。P5-10 阶段验收已验证页面关闭后的服务端持续执行、重新登录后的状态/结果/命令恢复，以及两账号任务读取和命令的非泄露式隔离；P5 总体验收已完成。
P5-11 已完成持久化、脱敏任务事件轮询：事件按项目游标恢复，终态通知以事件 UUID 幂等写入通知中心；API/Worker 重建、真实 Redis BullMQ 幂等和 Redis 实例级重启后的 AOF 恢复均已验收。SSE 仍留待后续阶段。
P7-7 指标与告警已接入：API `/metrics` 记录请求计数/延迟、错误、认证失败、限流、版本冲突、配额、迁移阶段、依赖状态和任务 gauge；Worker `/metrics` 记录 outbox、Consumer、lease recovery、重试、Provider 延迟和结果转存失败。`infra/deploy/staging/prometheus.yml` 与 `alerts.yml` 提供 staging 抓取和阈值，shared registry 拒绝 URL、邮箱、UUID、长值、正文和凭据等高基数或敏感标签。
API/Worker 重建与任务幂等恢复演练已通过；真实 Redis 客户端重连、BullMQ 固定 job ID 幂等和维护窗口实例级重启后的 AOF 恢复均已通过。

P6-1 已完成目录包与迁移契约冻结：`packages/contracts/src/migrationPackage.ts` 定义单项目 `packageSchemaVersion=1`、规范 JSON、UTF-8/ISO UTC 时间、稳定排序的 `manifest.json`、兼容本地的双快照 `ProjectRecord`、版本化 `graph.json`、逻辑资产 `assets.json` 和可选 `checkpoint.json`。纯校验器拒绝未知 schema、路径穿越/重复路径/符号链接、目录深度与包大小超限、异常压缩比、重复逻辑资产 ID、悬空资产引用及凭据、租户内部字段和持久化 URL；归档校验只接收解析器提供的条目元数据，不访问文件系统或解压。该切片没有数据库 schema 变更，也没有隐式上传行为。

P6-2 已完成 Import Prepare 预检会话：`migration_imports` 在 PostgreSQL 持久化已校验的单项目包、workspace 幂等指纹、配额估算、项目 ID 冲突快照、进度和过期状态；API 提供 prepare、状态恢复和幂等 cancel。prepare 从可信 session 取得 user/workspace，在 workspace 行锁内校验同键同内容、逐文件/规范 JSON SHA-256、当前资产配额和目标项目状态，只返回逻辑资产上传清单及 `copy`/`replace` 可用策略，不创建项目、节点、连线、资产、引用或配额 reservation。API/服务重建后可从 PostgreSQL 恢复，跨 workspace 项目 ID 只返回不泄漏归属的 `project_id_unavailable`。

P6-3 已完成迁移资产暂存上传：`migration_import_asset_uploads` 独立记录每个逻辑资产的单 PUT 或 S3 multipart 会话、分片恢复、hash/MIME/大小校验、失败重试、取消和过期状态；staging 对象由服务端生成 key，API 不接受或返回对象存储内部字段。上传完成只推进 import 到 `ready` 并计入 reservation，正式资产和项目图由 P6-4 commit 事务写入。

P6-4 已完成单项目 commit：copy 始终生成新项目 ID，replace 仅 owner/admin 可在 expected version/sequence 和显式确认下执行；事务内把 staging 资产物化为 completed assets，重映射图节点资产 UUID，通过 project-graph 写 `source=import` change 和引用，可选导入 checkpoint，并持久化 commit 指纹以支持重启后幂等恢复。

P6-5 已完成项目冲突策略收口：copy 为每次导入重新生成节点和连线 ID，并同步重写父级、端点和 import checkpoint，多个副本不会共享图实体 ID；replace 保留包内图 ID，但只接受 prepare 快照对应的 owner/admin 显式覆盖。commit 可在同 workspace 内复用 SHA-256、大小和 MIME 完全一致的 completed 资产，查询和映射均限定 workspace，禁止跨 workspace 复用；并发版本变化稳定返回 `PROJECT_VERSION_CONFLICT`，不执行隐式 merge。P6-6 导出和 P6-8 Web 适配仍待后续切片。

P6-6 已完成目录包导出：`migration_exports` 持久化项目 version/sequence 快照、资产 manifest、生成进度、取消/失败/过期状态和归档摘要；`POST /api/v1/projects/:projectId/exports/prepare` 异步生成兼容 P6-1 的 ZIP，`GET` 恢复状态，`GET /download` 只返回短期私有 URL，`POST /cancel` 幂等取消。导出在项目锁内冻结单一版本，Cloud asset UUID、object key、签名 URL、Provider 凭据不进入 `ProjectRecord` 或包内容；真实 PostgreSQL 测试已验证归档可被现有导入契约接受、版本推进不污染导出快照、失败不修改项目图。P6-8 Web 适配仍待后续切片。

P6-7 已完成迁移生命周期收口：导出失败/取消可在 3 次上限内 retry，retry_count 与阶段/文件/字节进度持久化；API 重启会恢复 prepared/generating 导出，启动维护会把过期导出和未提交 staging 对象交给延迟 GC。上传失败重试继续沿用 P6-3 的独立会话，已提交 `committed_asset_id` 的 staging 行不进入清理范围；取消在上传、校验、归档和提交边界检查，失败只记录固定错误码，不覆盖项目事实。
