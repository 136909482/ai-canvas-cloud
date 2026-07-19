# AI Canvas Cloud 开发指南

本文档定义网站端的长期架构边界。实现阶段、优先级和验收条件见 `ROADMAP.md`，数据库细节见 `DATA_MODEL.md`，HTTP 契约见 `API.md`。

## 产品边界

AI Canvas Cloud 是账号制 AI 画布 SaaS。首发提供个人空间、单活跃会话与设备历史、云端项目、私有媒体资产和服务端生成任务，不提供多设备同时在线编辑、实时多人编辑、离线云项目同步或复杂商业计费。

本仓库与本地版 `ai-canvas` 独立：

- 本地版继续使用目录 JSON/Electron SQLite 和本地 `images/`。
- Cloud 使用 PostgreSQL、Redis、Worker 和 OSS/S3。
- 两端通过版本化 `ProjectRecord` 与目录包显式迁移。
- 登录、退出或网络恢复不会自动上传本地工作区。

## 当前工程骨架

P1 第一批代码已经建立 npm workspaces monorepo：

- `apps/web`：Vite + React 画布前端，一次性迁移自本地版稳定画布代码；当前通过 Cloud 平台适配层访问认证、项目元数据和项目图 API。
- `apps/api`：HTTP 入口、配置校验、结构化日志、request ID、`/health/live`、`/health/ready` 和优雅关闭。
- `apps/worker`：后台 Worker 进程骨架、配置校验、结构化日志和优雅关闭。
- `packages/contracts`：API 错误码、认证/工作区和项目元数据请求响应契约，以及 P6 目录包迁移契约与纯校验器。
- `packages/project-graph`：项目图纯操作和基础测试。
- `packages/shared`：共享环境读取、request ID 和日志工具。
- `server`：服务端领域模块 workspace package，当前包含 P2 Better Auth 适配、Cloud 工作区授权，以及 P3 项目元数据 PostgreSQL 服务。
- `infra/local`：PostgreSQL、Redis 和 MinIO 的 Docker Compose 基础配置。
- `infra/deploy/staging`：厂商无关的 staging Compose、Web 反向代理和只含占位符的环境模板；生产应用使用同一配置门禁但必须使用独立生产资源。
- `server/db/migrations`：显式迁移文件和迁移检查入口。

Web 平台适配层已从 P1 临时内存项目适配推进到 P3 Cloud API 适配：项目列表、创建、读取、重命名、归档/恢复、软删除和图 GET/PATCH 走 Cloud API；前端仍不直接访问 PostgreSQL、Redis、对象存储管理凭据或服务端模块。

P2 第一批已经建立用户/工作区迁移、认证共享契约和最小认证 HTTP 路由骨架。当前认证实现已切到 Better Auth，由 Better Auth 管理邮箱密码、密码哈希、签名 HttpOnly Cookie、session、邮箱验证 token 和密码重置 token。同账号只允许一个有效 session：密码验证成功但检测到其他设备在线时返回 `ACTIVE_SESSION_EXISTS`，前端显示接管确认；确认后旧 session 失效。独立 `auth_devices` 设备历史不随 session 删除，设备管理页识别常见浏览器和系统，展示首次登录与最近活跃时间，并允许删除非当前设备记录。前端首屏恢复一次 session，可见页面每 5 分钟执行一次心跳，业务 API 返回未授权时立即回登录页，同一标签页并发检查复用一个在途请求。Cloud 侧在注册、登录和会话恢复时幂等确保 personal workspace、owner 成员关系和工作区用户状态存在。登录成功后才初始化画布工作区；账号菜单、登录接管确认、设备管理、退出登录、邮箱验证、忘记密码和重置密码闭环保持不变。

匿名产品首页使用完整首屏画布场景、深色产品能力区和品牌 Footer；尚未落地的项目/社区页面不提前暴露空导航，帮助、协议、企业主体和备案信息在没有真实内容时不得伪造可点击链接或备案号。生产发布前必须把 Footer 中的待补充企业主体、联系方式、用户协议、隐私政策、账号注销说明及备案信息替换为经确认的真实内容。

P3-1 至 P3-14 已建立关系化项目图 schema、项目元数据服务、规范化图读取、增量图事务、有序 changes 读取、Web 端大批量图操作拆批、服务端 manual/periodic checkpoint、Web 手动保存检查点入口、checkpoint 摘要列表、按版本读取 checkpoint record、checkpoint restore、Web 冲突处理最小闭环和非重叠冲突自动追平。API 只把 session 解析出的用户/当前工作区作为 `ProjectActor` 传给领域服务，领域服务再次通过 `workspace_members` 校验角色，并在所有项目 SQL 中同时限定 `project_id` 与 `workspace_id`。图批次锁定项目，按操作后节点集合校验父级、环和连线端点，支持节点/连线 upsert/软删除、关联边清理、幂等重试、version/sequence 推进和 `409 PROJECT_VERSION_CONFLICT`。P4-7 已把节点资产引用纳入同一图事务：只识别规范化 asset UUID 与 `cloud-assets/<asset-id>` 定位符，按可信 session 工作区校验 completed 状态，并在节点替换或删除时同步替换/删除 `asset_references`。P4-8 已让 manual/periodic/pre-restore checkpoint 保存资产 manifest，并在 restore 前校验 manifest/record、资产租户和状态，恢复关系图后同事务重建节点引用。P4-9 已提供历史 manifest 的只读预检和分批前向修复：复用同一图资产提取与 PostgreSQL 资产锁模块，安全差异回填 manifest，不安全记录标记失效，且不改动 record、当前图或手动保存指针。`GET /changes` 按 `after` 返回有序变更批次，不暴露 workspace、actor 或幂等键。manual 更新 `saved_snapshot_id`，periodic 只作为历史恢复点保留；`GET /revisions` 按 keyset 分页返回不含 `record_json` 的摘要，`GET /revisions/:version` 返回该版本最新 checkpoint 的完整 record；`POST /revisions/:version/restore` 校验 expected version/sequence 后执行上述资产与图恢复事务并递增 version/sequence。Web Cloud 适配层已接入项目元数据、图读取、ID 级 diff 自动保存、超过 500 个操作时的顺序拆批，并在手动保存成功保存图后创建 manual checkpoint、在自动保存成功后按 sequence 增量和时间间隔尝试创建 periodic checkpoint；遇到版本冲突时会读取远端 changes，若远端和本地待提交操作未触碰同一节点/连线，则推进 baseVersion/sequence 后重试本地操作；仍冲突或触碰同一实体时保留本地工作副本并显示重新加载云端版本、另存为副本和稍后处理入口。三方合并和服务端任务投影仍未接入。

## 目标拓扑

```text
Browser
  -> Web application
  -> Cloud API
       -> PostgreSQL
       -> Redis queue
       -> Private object storage
  -> Worker
       -> AI providers
       -> Private object storage
       -> PostgreSQL
```

前端和 API 优先部署在同一站点或同一主域，使用安全 Cookie 会话，减少跨站认证复杂度。API 与 Worker 独立扩缩容，生产数据库、Redis 和对象存储不得与 staging 共用实例或凭据。

## 认证与租户

首发采用邮箱、密码和服务端不透明会话：

- 邮箱密码、密码哈希、session token、签名 Cookie、邮箱验证和密码重置验证值优先交给 Better Auth 管理，不再维护自研密码哈希或自研 session token 表。
- 浏览器会话使用 Better Auth 的 `better-auth.session_token` HttpOnly Cookie；生产环境必须配置稳定且足够长的 `BETTER_AUTH_SECRET`，并通过 HTTPS 使用 Secure Cookie。
- 同账号只允许一个活跃登录设备。登录密码验证成功但检测到其他有效 session 时，服务端删除本次临时 session 并返回 `ACTIVE_SESSION_EXISTS`；只有用户明确确认接管后才撤销旧 session，旧设备随后不能继续保存、生成或读取资源。设备历史独立保留，不随 session 撤销删除。前端首屏检查一次 session，可见页面每 5 分钟心跳一次，窗口聚焦或页面重新可见只在距上次检查已满 5 分钟时触发；API 返回未授权时立即处理，同一标签页并发检查必须合并，鼠标和键盘操作不得产生额外 session 请求。
- 邮箱验证和密码重置链接面向浏览器使用 `WEB_PUBLIC_URL` 生成；任何环境的日志都不得打印 token 或完整链接。开发邮件服务只记录发送被抑制及过期时间，自动化测试通过注入邮件服务消费受控 fixture，生产环境未接入真实邮件服务时应让发送流程失败以暴露配置问题。
- 本地开发可以通过 `DEV_SEED_ADMIN=true`、`DEV_SEED_ADMIN_EMAIL` 和仅写入本机 `.env` 的 `DEV_SEED_ADMIN_PASSWORD` 创建测试账号；该 seed 在 production 强制禁用，且不授予额外系统管理员权限。
- 注册事务同时创建用户、个人工作区和 owner 成员关系。
- 项目、节点、资产、任务、凭据和用量均以 `workspace_id` 为租户边界。
- 服务端领域模块访问工作区资源时必须复用工作区授权服务；非成员请求返回不泄漏存在性的 `RESOURCE_NOT_FOUND`，成员角色不足返回 `ACCESS_DENIED`。
- 每个资源查询先带入成员授权条件，不先查询资源再做权限判断，避免 ID 枚举泄漏。
- 登录、注册、验证邮件和密码重置需要限流、一次性验证值、过期控制和失败审计；能复用 Better Auth 的能力时优先复用，不在 Cloud 侧重复造一套。

首发 UI 不展示工作区切换器，但数据模型保留 `workspace_members`，为后续团队空间提供稳定边界。

## 云端项目图

Cloud 当前画布不以完整项目 JSON 为日常事实来源：

- `projects` 保存项目元数据、当前版本和手动检查点。
- `project_nodes` 保存节点共有字段及 `data_json`/`presentation_json`。
- `project_edges` 保存连线端点、handle、类型和扩展数据。
- `generation_tasks` 与 `assets` 分别保存任务和媒体事实状态。
- `project_changes` 保存有序、幂等的图操作批次。
- `project_snapshots` 保存手动或定期完整检查点。

节点共有字段关系化，包括类型、坐标、尺寸、层级、父节点和行版本。不同节点的 prompt、模型参数、编辑配置等放入 JSONB，避免每增加节点类型就修改数据库 schema。可查询或需要外键约束的字段不得只藏在 JSONB 中。

## 保存与冲突

前端平台适配层维护最近确认的规范化图基线、server version 和 change sequence。自动保存对当前画布与基线做 ID 级 diff，生成 `upsertNode`、`deleteNode`、`upsertEdge`、`deleteEdge` 和必要的项目元数据操作。

操作批次携带 `baseVersion`、client batch ID 和幂等键。服务端事务必须：

1. 校验会话和工作区权限。
2. 锁定并校验项目当前版本。
3. 校验节点/连线 ID、端点、资产归属和输入大小。
4. 更新节点、连线和资产引用。
5. 追加连续的 `project_changes.sequence`。
6. 递增项目版本并提交。

版本不一致返回 `409 PROJECT_VERSION_CONFLICT`。客户端收到冲突后会读取 `GET /changes`；当远端变更与本地待提交操作未触碰同一节点或连线时，客户端只推进 baseVersion/sequence 并重试本地操作，远端内容保留在服务端等待后续刷新恢复。无法安全追平时，首发冲突 UI 会保留本地工作副本，提供重新加载云端版本、另存为副本和稍后处理，不自动做三方合并。

已有请求在途时，客户端只合并尚未提交的最新操作；删除操作不能被较旧 upsert 复活。页面关闭前可尝试 flush，但正确性不能依赖 `beforeunload` 请求一定成功。

当前 Web Cloud 适配层维护每个项目最近确认的 version/sequence 和画布基线。刷新页面后可从 Cloud API 恢复节点和连线；换账号、登出或 session 失效时会清理项目、画布、任务、模板和临时资产 URL 缓存。Cloud API 已能按 sequence 读取 `project_changes`，当前客户端已支持非重叠 changes 的 baseVersion 追平；三方合并和用户可视化选择仍后续接入。自动保存会把超过 500 个图操作的 diff 拆成多个 PATCH 批次，删除节点按旧层级子到父、节点 upsert 按新父级先父后子、连线 upsert 放在节点之后，避免中间批次破坏拓扑约束。手动保存会先保存当前图，再用确认后的 version/sequence 创建 manual checkpoint；自动保存成功后会按 sequence 增量和时间间隔创建 periodic checkpoint。媒体资产和当前节点引用已持久化到 Cloud；任务队列仍在 P5 前作为浏览器会话内投影。

## 手动保存与检查点

自动保存推进工作版本；手动保存先提交所有待处理增量，再创建 `manual` 检查点，并更新项目的 saved checkpoint 指针。同一标签页的手动保存采用单飞：首个保存未完成时后续触发复用同一请求链，保存按钮保持禁用；当前 sequence 已成功手动保存时，后续点击在客户端直接跳过。服务端在项目行锁内再次复用同一 version/sequence 的有效 manual checkpoint，跨标签页或重试也不得重复插入。

定期检查点按变更数量、时间或操作日志体积生成。检查点必须包含可恢复的 `{ canvas, taskQueue }` 或版本化 `ProjectRecord`，记录项目版本、schema 版本、字节数和引用资产集合，并通过反序列化和图约束校验后标记可用。只有成功检查点覆盖对应 sequence 后才允许裁剪更早变更。

历史恢复不回写旧行。恢复操作读取目标检查点，校验并生成新的当前版本、变更记录和审计事件。

## 图片与视频资产

媒体文件保存在私有 OSS/S3 兼容对象存储，PostgreSQL 只保存元数据。对象 key 使用不可变 ID，不包含邮箱或项目名称：

```text
workspaces/<workspace-id>/projects/<project-id>/uploads/<asset-id>.<ext>
workspaces/<workspace-id>/projects/<project-id>/generated/<yyyy-mm-dd>/<asset-id>.<ext>
workspaces/<workspace-id>/projects/<project-id>/edits/<asset-id>.<ext>
workspaces/<workspace-id>/projects/<project-id>/thumbnails/<asset-id>.<ext>
```

浏览器上传采用三步协议：创建上传会话、预签名直传、完成确认。完成接口校验对象存在、大小、MIME/魔数、哈希和工作区归属。只有 completed 资产可以进入节点或任务引用。

P4-1 至 P4-11 当前已落数据库、领域契约、本地 MinIO 预签名上传会话、完成确认、私有读取、Web 资产读写生命周期、当前图资产引用事务、checkpoint asset manifest、历史 manifest 前向修复、工作区存储配额和受控资产 GC：`assets`、`asset_uploads` 和 `asset_references` 是资产治理事实表，`POST /api/v1/assets/uploads` 只允许服务端从可信 session 推导工作区和用户，写入 pending 资产与上传会话后返回短期 S3 兼容 `PUT` URL；Web 平台层已经把图片导入、视频上传、生成结果、编辑、裁切和缩略图写入接到该接口，随后以不携带站点 Cookie 的跨域请求直传对象存储，只有直传成功才调用 `POST /api/v1/assets/uploads/:uploadId/complete`。完成接口会从 MinIO/S3 反查真实对象大小、MIME 和可选 SHA-256，通过后才把 asset 标记 completed。`GET /api/v1/assets/:assetId` 与 `/url` 先校验当前 session 的工作区成员关系，再按同一 `workspace_id` 读取 completed 资产并签发 5 分钟 S3 兼容 `GET` URL；跨工作区和已删除资产统一隐藏，非 completed 资产不签发。Web 平台层使用 `cloud-assets/<asset-id>` 作为客户端定位符，不把 object key 或签名 URL 写入持久化资产字段；解析时按资产 ID 缓存 URL，在剩余有效期不足 30 秒时刷新，同一资产的并发请求复用一个在途请求。图、checkpoint、历史修复和 GC 复用同一资产租户边界和锁规则；节点 upsert/delete 同步引用，checkpoint 保存 manifest，restore 校验并重建引用，GC 在删除前取得资产排他锁并用新语句快照复查当前引用和有效 checkpoint manifest。换账号、退出登录、session 失效或工作区切换会清空缓存，清理前发出的在途请求也不能重新写回新会话缓存。本地 MinIO 明确允许 `localhost:5173` 与 `127.0.0.1:5173` 开发源直传；生产对象存储必须只允许正式 Web 源。OSS 接入时优先替换对象存储适配层，不改前端持久化契约。

P5-1 已建立任务持久化底座：PostgreSQL `generation_tasks` 是任务事实来源，`task_attempts` 保存每次 Provider 尝试；共享契约只暴露可恢复的任务摘要，不暴露 workspace、创建者、租约 token、Worker owner 或 Provider 远端任务 ID。服务端纯状态机统一约束 queued -> running、running -> queued/succeeded/failed/canceled、failed -> queued，并禁止 succeeded/canceled 再次运行。P5-4 已把任务创建/重试与 `task_queue_outbox` 派发事实放入同一数据库事务，并由 Worker dispatcher 使用短期 claim、失败退避和稳定 BullMQ job ID 可靠发布。P5-5 已建立原子 claim、attempt、lease fencing、续租、进度、取消、失败重排和过期恢复；Provider processor 尚未接入，主进程当前不启动 Consumer，queued 仍不能描述为 Provider 已开始执行。

P5-2 已建立 Provider 配置服务。OpenAI 和阿里百炼的 base URL、显示名称及允许 endpoint 由 `server/modules/providers` 注册表拥有；用户输入必须精确命中固定 HTTPS allowlist，禁止 HTTP、凭据 URL、非标准端口、查询、fragment、相似子域和任意自定义 host。BYOK 使用 AES-256-GCM，AAD 绑定 workspace ID 与 Provider ID，envelope 记录 key version；API 进程从 `PROVIDER_CREDENTIAL_KEYS` 载入所有仍需解密的版本，并使用 `PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION` 加密新值。轮换必须先部署包含新旧密钥的 keyring，再切 active version，待后台重加密完成后才能移除旧版本。

P5-6 的 Provider adapter 集中声明同步/异步调用的公共边界、固定测试 endpoint 和结果域名 allowlist。连接测试只能向注册表生成的 HTTPS URL 发起 `GET`，使用 `redirect: 'error'`、10 秒 AbortController 超时和 64 KiB 流式响应上限；不解析或记录 Provider 正文。网络、超时、重定向、认证、上游拒绝和响应过大被归为稳定脱敏分类，日志仅记录 Provider ID、分类、可重试性、HTTP 状态（成功时）和耗时。`POST /settings/providers/:providerId/test` 必须以可信 session 的 owner/admin 身份调用，且仅接受空 JSON 对象；API 路由不解密 API Key，Provider 领域服务只在内部短期解密并立即调用 adapter。

P5-7 将 Provider 提交建模为 Worker lease 内的受控状态机。每个 attempt 在 claim 时获得由 task ID 确定的 submission key，并记录 `ready`、`submitting`、`submitted`、`polling` 或 `uncertain` 阶段及可空远端任务 ID。网络调用前必须先持久化 `submitting`；收到远端 ID 后同时写入 attempt 和任务，后续恢复优先返回 `poll`，不再提交第二个付费请求。没有远端 ID 的 `submitting`/`uncertain` 恢复只有 `ProviderAdapter.supportsIdempotentSubmission(providerId)` 明确为 true 时可重用原 key；否则返回 `uncertain`，调用方必须收敛为不可自动重试的 `PROVIDER_SUBMISSION_UNCERTAIN`。当前注册表所有 Provider 均明确为不支持，P5-9 接入实际协议时才能逐个放开。旧 Worker 不认识 `submission_key`，数据库升级到 `0013` 后如需应用回退必须停用 Consumer、lease recovery 和所有 claim 路径；前向恢复使用新 Worker，迁移已把既有 attempt 回填 key，并将当前 attempt 的既有 `generation_tasks.remote_task_id` 迁入 submitted 状态。

P5-8 的结果下载只能由 Worker 的 `server/modules/tasks/resultTransfer` 边界执行：URL 先按 Provider 注册表的精确 HTTPS 结果主机 allowlist 校验，再以 `redirect: 'error'` 下载，Provider `429` 单独归为稳定可重试的限流分类，限制 50 MiB、校验 MIME 和媒体魔数、计算 SHA-256 后写入私有对象存储。临时结果 URL、Provider 正文和凭据不写入任务、节点、检查点、账本或日志。结果数据库收敛必须匹配当前 task/Worker/lease token，并在一笔事务中完成配额校验、completed 资产、task/node 引用、一次 `usage_ledger`、attempt/task succeeded 和必要 worker 图 change；无有效 lease、取消请求、转存失败或事务失败均不得把任务标记 succeeded。图更新只合并 preview node 的 `generationResults.<taskId>`，不得重建删除的节点、修改位置/尺寸或覆盖用户其他字段。

P5-9 当前启用 OpenAI `gpt-image-2` 同步文生图和图片编辑 processor，以及阿里百炼 `wanx2.1-t2i-turbo` 异步文生图和 `wan2.7-t2v` 异步文生视频 processor。它们都必须先通过 `prepareProviderSubmission` 持久化 submission stage，再从 Provider 领域服务短期取用同工作区凭据；OpenAI 编辑输入只从 source node 的 completed 私有资产引用读取，并向注册表固定 edits endpoint 以 multipart 上传，绝不读取浏览器 URL。阿里任务只使用注册表固定的提交和 task query endpoint；视频只接受 `720P`/`1080P`、`16:9`/`9:16` 与 5/10 秒，远端 ID 返回后立刻以当前 lease 写入 attempt/task，恢复只能轮询该 ID，不得二次提交。成功结果直接进入私有对象存储和 `settleSuccess`，不经浏览器。Provider `429`、超时和网络故障为可重试任务失败，认证、模型/参数不支持、重定向、超限和无效响应为不可重试失败。取消或 shutdown signal 后 processor 不得继续读取凭据、调用 Provider 或提交成功结果。Worker 进程现在启动 BullMQ Consumer，并在关闭时先 abort 活跃 Consumer 再断开队列、数据库和对象存储资源。

首发每个 personal workspace 使用 20 GiB（`21474836480` 字节）云资产配额；个人空间与用户一一对应，但授权和统计始终以可信 session 的 `workspace_id` 为边界。`GET /api/v1/workspaces/current/usage` 返回 completed/failed/quarantined 的已用量、pending 上传预留量、总计、配额和剩余容量。创建上传会话先在事务中锁定 workspace 行，再查幂等键和最新资产总量；同一幂等请求只复用原预留，不同并发上传会串行校验，不能共同越过配额。完成上传只把 pending 预留转为 completed 已用量，不增加总占用。软删除资产立即退出逻辑配额统计，物理对象仍由后续宽限期 GC 负责；failed/quarantined 在被清理前继续计入用量。

历史 checkpoint 修复命令默认执行只读 keyset 分批预检。显式 `--apply` 后，每个 checkpoint 在独立短事务中重新读取并以 `FOR UPDATE ... SKIP LOCKED` 锁定 snapshot，再按项目所属可信工作区对派生资产加共享锁。规范空 manifest、合法但错误的 manifest 和重复/乱序 UUID 可回填为 record 派生值；record 或 manifest 结构损坏、跨工作区/缺失/已删除资产以及 pending、failed、quarantined 资产会保持或变为 `is_valid=false`。已经失效的 checkpoint 不会被重新启用或改写，`projects.saved_snapshot_id` 即使指向异常手动保存点也保持原值，等待用户后续显式手动保存替换。命令只输出 checkpoint/project ID、动作、原因分类和计数，不输出资产 ID、workspace ID 或资产状态细节。

读取私有资产时，API 授权后返回短期签名 URL。前端可以缓存 URL，但必须处理过期刷新和退出登录清理。Provider 临时结果 URL 必须由 Worker 下载、校验并转存，不得写入节点、任务或检查点作为长期来源。

删除项目只做软删除。后台 GC 仅删除超过宽限期且不被当前图、任务或保留检查点引用的资产，并在真正删除前重新读取最新引用。

## 服务端任务

Cloud 以 `generation_tasks` 为任务事实来源，前端 task queue 是投影。API 只负责授权、校验、额度预占和入队，Worker 负责领取与续租、Provider 调用、限流重试、结果转存、用量和审计。

API 创建和显式重试不直接双写 Redis，而是在原事务中追加 `task_queue_outbox`。Worker dispatcher 通过 `FOR UPDATE SKIP LOCKED` 短期领取未发布行并写入 BullMQ，发布失败按指数退避重新开放；Redis 消息仅包含 outbox/task ID。BullMQ 作业出现重复投递时，后续任务领取仍必须依赖 PostgreSQL 条件状态与 lease token 收敛，不能把队列 ACK 当作任务完成事实。

Worker claim 在一个事务中条件更新 queued 任务、递增 attempt、写 lease tuple 并创建 `task_attempts`；多 Worker 对同一任务竞争时只有一个条件更新成功。续租和所有运行态写入都携带 Worker ID 与不可猜测 lease token，过期 token 不能续活或覆盖后续 attempt。可重试失败、租约过期和优雅关闭重排会同时结束当前 attempt、清理 lease、设置下一 `available_at` 并写同时间窗口的 outbox；达到上限或不可重试时进入 failed，取消请求优先进入 canceled。

关闭浏览器后任务继续。Worker 重启不得造成永久 running、重复结果节点或重复扣费。任务完成产生的节点变化通过独立幂等批次进入 `project_changes`，不得基于过期检查点覆盖整个画布。

## Provider 密钥

首发优先 BYOK：

- 密钥在服务端使用版本化 AES-256-GCM envelope；生产后续可把同一接口替换为 KMS 包封加密。
- 读取接口只返回 Provider、固定 base URL、状态和末四位提示，不返回原始密钥或密文。
- 前端 bundle、日志、诊断、目录包和错误响应不得包含密钥。
- Provider 测试和运行统一走服务端白名单适配器。
- 任意 target URL 代理、内网地址、重定向绕过和非 HTTPS 生产端点必须拒绝。
- Provider 凭据写入/删除要求 owner/admin，普通成员只能读取脱敏配置状态；Worker 内部解密接口不接受浏览器调用。

## 任务 API 边界

- 任务 HTTP 写入只接受可信 session actor；客户端提交的 workspace/user 字段无效，项目、source/preview node 和任务都必须在领域服务内按 workspace 重新授权。
- 创建、取消和重试要求 owner/admin/editor，读取允许成员。跨工作区资源与不存在统一处理，不在错误中暴露其他租户任务、节点或 Provider 配置。
- 创建幂等、活跃任务上限和命令幂等都在 workspace 行锁保护下计算；任务状态更新和 `task_commands` 插入共享事务，API 路由不得直接写表。
- 浏览器参数不得包含 Provider 密钥、Authorization 或任意 target/base/api URL/endpoint。创建只确认白名单 Provider 配置存在，不解密 BYOK；解密只属于后续 Worker 内部执行路径。
- P5-5 已提供 BullMQ Consumer、数据库 claim 和租约续期能力；P5-9 已为受控 OpenAI 同步图片和阿里百炼异步图片/视频 processor 启动 Consumer，并由创建阶段能力矩阵拒绝其余 Provider/model/kind。P5-10 当前已让 Cloud Web 以服务端任务状态驱动队列投影，浏览器 Provider 执行链路不再在 Cloud runtime 启动。

P5-10 当前在 Cloud runtime 启用服务端任务投影：Web 只通过 `/api/v1/tasks` 创建、分页读取、详情、取消和重试，并用本地队列保存 server task ID、服务端 0-100 progress 与脱敏状态作为 UI 投影；不提交 API Key、Authorization、Provider/base/target URL、对象 key、结果 URL 或远端 ID。`TaskQueueRunner` 轮询当前项目任务，未绑定 server ID 的本地 queued 项只提交一次，同一 ID 的 queued/running 项在刷新和项目快照恢复后继续由服务端拥有，不能落回浏览器 Provider 执行器。非当前项目只按轮转顺序查询 `queued/running` 摘要并写入会话内缓存，回到项目时先按项目 ID 合并缓存、同步该项目节点状态，再由完整查询校准；后台摘要不得写入当前画布，终态不进入跨项目缓存。任务面板合并当前项目任务与跨项目活跃缓存，可按全部、进行中和已结束筛选，并显示失败项的服务端脱敏错误；其他项目条目只显示项目名、状态、进度并允许服务端取消，当前项目才允许定位结果、重试或移除，避免跨项目图和快照误写。终态首次到达时重新读取项目图；Cloud platform 只从 `generationResults.<taskId>.assets` 的标准 asset ID 取得短期签名 URL，填充图片/视频节点，失败不阻断图加载。浏览器的取消/重试都调用服务端任务命令。Cloud 服务商设置只经既有 `/api/v1/settings/providers` 固定路径调用；API Key 只保留在组件临时输入，更新成功、移除或关闭后清空，且不得流入 `ProviderProfileConfig`、Zustand 持久化、任务投影、项目图或快照。P5-10 阶段验收已确认：关闭页面不影响独立 Worker 的任务执行；重新登录后必须由可信 user/workspace 作用域重新枚举任务并恢复图结果与服务端命令；另一账号的列表为空，按 ID 读取、取消或重试均统一返回 `RESOURCE_NOT_FOUND`，不得泄露任务存在性。
P5-11 在上述投影旁增加持久化脱敏任务事件：`generation_tasks` 触发器在同一事务写入 created/status/progress/terminal 事件，`GET /api/v1/tasks/events` 按工作区、项目或任务和单调游标读取。`TaskQueueRunner` 为每个项目保存事件游标，轮询恢复后仅将 terminal 事件投影到通知中心；通知以事件 UUID 去重，即使重复轮询、断线重试或页面恢复也不会重复计数。事件消费不改变任务、资产或项目图事实，终态仍通过任务列表和项目图恢复结果。P5-11 暂不启动 SSE。
P7-7 的指标底座位于 `packages/shared/src/metrics.ts`，提供进程内 counter、gauge 和 histogram，并统一渲染 Prometheus 文本格式；registry 只接受固定低基数 label 名称，并拒绝 URL、邮箱、UUID、长值及换行。API `/metrics` 记录请求计数/延迟、错误、认证失败、限流、版本冲突、配额、迁移阶段、PostgreSQL/Redis/对象存储依赖和任务 backlog/running/lease/retry；Worker `/metrics` 记录 outbox、Consumer、lease recovery、重试、Provider 延迟和结果转存失败。`infra/deploy/staging/prometheus.yml` 与 `alerts.yml` 提供实际可加载的 staging 抓取和告警阈值。告警、健康检查和日志只保留固定枚举、状态和 Error 类型，不写 workspace/user/project/task/request ID、URL、邮箱、正文或密钥。
重启演练已加入直接相关集成测试：API 任务服务对象重建后从 PostgreSQL 恢复任务/事件/命令，Worker 执行服务重建后继续 lease recovery、远端任务轮询和结果幂等收敛，Redis 发布客户端断开并重连后复用稳定 BullMQ job ID。维护窗口已在独立验收队列中完成 Redis 实例级重启，确认 AOF 恢复、固定 job ID 重复发布不重复和业务队列无遗留；若其他环境的 `REDIS_URL` 不可用或凭据被拒绝，测试仍按环境约定跳过。

## 导入与导出

P6-1 冻结了单项目目录包的 `packageSchemaVersion=1`。包使用 UTF-8 规范 JSON、带毫秒的 ISO UTC 时间和稳定升序；`manifest.json` 记录 `packageId`、`sourcePlatform`、项目 ID/version/sequence、payload 文件数量、总字节数、内容 SHA-256 和每个 payload 文件的字节数/SHA-256。固定 payload 文件为 `project.json`（兼容本地双快照 `ProjectRecord`）、`graph.json`（版本化关系图）、`assets.json`（逻辑资产 ID 与受控媒体路径），可选 `checkpoint.json` 保存单个迁移检查点。

资产清单只允许逻辑 asset ID、规范相对 ASCII 路径、允许 MIME、大小、SHA-256、尺寸和资产类型；不允许 Provider/API Key、Authorization、object key、签名/上传 URL、workspace/user 内部字段、完整响应或媒体 blob 元数据之外的内部字段。纯校验器在解压前拒绝未知 schema、绝对路径、路径穿越、重复路径、符号链接、异常压缩比、超深目录、超限文件/包、重复逻辑资产 ID、悬空图引用和非规范 JSON。校验器只接收归档解析器给出的条目元数据，不访问文件系统、数据库或对象存储。

后续导入仍分 prepare、资产上传和 commit 两阶段：先读取 manifest、项目与资产清单，执行 schema 迁移、大小限制和引用检查；用户确认统计与冲突策略后上传资产，再在事务中把 `ProjectRecord` 拆为项目、节点、连线、任务和引用。失败时不产生半完成活动项目。

P6-2 已实现 prepare 状态持久化。`server/modules/migrations` 从可信 session actor 授权 owner/admin/editor 后，先使用 P6-1 纯校验器，再由服务端重新计算规范 `project.json`、`graph.json`、`assets.json`、可选 checkpoint 的 UTF-8 字节数和 SHA-256，并校验 manifest 文件摘要集合的内容摘要。客户端提交的 user/workspace、object key、URL 或凭据字段会被拒绝或不参与作用域。

P6-3 的暂存上传继续由 `server/modules/migrations` 编排，但不复用正式 `assets` 上传表。每个 logical asset 都有独立的 `migration_import_asset_uploads` 会话；服务端生成 staging key，S3 multipart 的 provider upload ID 和已确认 ETag 只保存在数据库。小文件使用 presigned PUT，大文件按 8 MiB 分片签名，完成时重新校验对象 MIME、大小和 SHA-256。上传会话只更新 import 的上传进度和 reservation，不能写项目图、正式资产或引用；失败、取消和过期不会留下可被 commit 误认的 completed asset。

P6-4 commit 通过 `server/modules/migrations` 编排事务，但图写入、资产物化、引用重建和 import checkpoint 分别调用 project-graph、assets 和 project-snapshots 的事务 helper。copy 始终创建新 project ID；replace 必须由 owner/admin 携带 prepare 的版本/sequence 快照和显式确认。逻辑资产 ID 在事务内映射为新 Cloud UUID，所有失败路径回滚正式资源和 change；commit request 指纹持久化后可从 PostgreSQL 重启恢复并幂等返回。

P6-5 在同一 commit 边界内收口 copy/replace 冲突语义。copy 每次重新生成节点和连线 ID，并同步重写父级、edge 端点、change operations 和 import checkpoint；replace 保留包内实体 ID，只在目标实际 version/sequence 仍等于 prepare 快照时提交，不做自动 merge。资产领域 helper 只在可信 workspace 内按 completed、未删除、SHA-256、大小和 MIME 查找可复用资产并持有共享锁；其他 workspace 的相同 hash 不可见，未命中才物化当前 staging 对象。

P6-6 导出由 `server/modules/migrations` 独立编排，不复用 `generation_tasks`。prepare 在项目行锁内冻结当前 version/sequence、关系化图、saved checkpoint 和 completed 资产元数据，写入 `migration_exports` 后异步生成固定 ZIP；进程启动会把未完成 generating 行恢复为 prepared 并继续。生成器将 Cloud asset UUID 转为不含租户内部字段的逻辑 ID/包内路径，写入后重新通过 P6-1 package contract 校验；任何资产缺失、hash 变化、归档失败或取消都只更新导出状态，不改项目图、资产引用或 checkpoint。download 从可信 workspace 解析归档并签发短期私有 URL，响应不包含 object key。

P6-7 为导入/导出建立独立 retry 和延迟 GC 边界。导出失败或取消由 owner/admin/editor 在 3 次上限内原子重置为 prepared，保留最初冻结 payload 和 version/sequence；API 重启先把未完成 generating 恢复，再继续后台处理。迁移资产上传的失败重试重新建立 staging 会话，已完成或 `committed_asset_id` 非空的行永不进入 staging GC；过期 import/上传和失败/取消归档只在宽限期后由维护方法删除对象。上传、校验、归档和 commit 边界都检查 cancel request，日志/错误响应只使用操作 ID、阶段和固定错误码。

P6-8 的 Cloud Web 迁移入口位于顶部工作台和 `MigrationCenterDialog`。`apps/web/src/api/migrations.ts` 只调用固定 migration/project export 路径，并在浏览器内解析服务端兼容 ZIP 的 stored/Deflate 条目；JSON 与归档条目元数据必须继续交给服务端 P6-1 校验，浏览器解析结果不是可信输入。资产通过短期签名 URL 直传，multipart 必须读取对象存储返回的真实 ETag 后逐片确认。Zustand 只保存当前服务端摘要和会话内包字节，localStorage 只保存最近 import/export ID；刷新、重新登录或换账号后先清空内存，再以可信 session 重新 GET 状态。Web 继续使用轮询，不启用 SSE；通知只展示摘要，不替代 migration、asset 或 project graph 事实来源。

prepare 在短事务中锁定 workspace，按 `(workspace_id, idempotency_key)` 读取既有请求；同键同指纹返回原 import，同键不同指纹返回 `IMPORT_CONFLICT`。新请求读取当前已用/预留量并对 package 媒体总量执行保守配额校验，然后记录同 workspace 项目冲突、跨 workspace/软删除 ID 不可用或旧来源 ID 不兼容。prepare 不预留容量、不创建 upload、asset、project、node、edge、reference、change 或 checkpoint；P6-3/P6-4 必须再次校验配额和目标版本。

`migration_imports` 是重启恢复来源。GET 允许当前 workspace 成员，cancel 要求写角色并对 prepared 等非终态幂等收敛为 canceled；过期操作在读取/命令边界持久化为 expired。响应只返回逻辑资产上传清单、聚合估算、冲突类型和允许策略，不返回 validated package 正文、workspace/user、对象 key、签名 URL 或永久凭据。

导出从关系化当前状态和手动检查点组装兼容 `ProjectRecord`/目录包。Provider API Key 始终清空。Cloud 导出必须能重新导入干净的本地 Web/Electron 工作区。

## 可观测性与安全

- 每个请求、任务和导入操作使用稳定 request/job ID。
- 日志只保存 ID、操作、耗时、结果和脱敏上下文，不保存用户正文、附件、Cookie、Authorization 或完整 Provider 响应。
- 健康检查区分 liveness 与 readiness；readiness 检查 PostgreSQL、Redis 和对象存储依赖。
- P7-1/P7-3/P7-4/P7-5/P7-6 已在 API 和 Web 入口启用 `WEB_ALLOWED_ORIGINS` 精确 CORS/Origin 边界、Cookie CSRF 检查、页面 CSP、统一安全响应头、表驱动攻击面回归和双账号 Cloud HTTP E2E。protected 环境的 Cookie 写请求和认证写入口必须携带允许 Origin，cross-site Fetch Metadata 在读取 Cookie/body 或进入领域服务前拒绝。API 的 `default-src 'none'` CSP 与 Web Nginx 页面 CSP 分层生效，不能互相替代。
- 数据库自动备份，对象存储启用版本/生命周期策略，并定期在隔离环境完成恢复演练。
- schema 迁移是独立发布步骤，应用启动不自动执行破坏性迁移。

### P7-2 制品与部署边界

根 `npm run build` 按 `shared -> contracts/project-graph -> server -> apps` 的依赖顺序构建，避免新环境依赖旧的 `dist`。`Dockerfile` 以锁定版本的基础镜像和 `npm ci` 构建 `web`、`api`、`worker` 与 `migrate` 目标；运行层只复制编译产物、生产依赖和必要迁移脚本，不复制 `.env`、测试 fixture、开发 seed 或源码密钥。API/Worker 以 `node` 非 root 用户启动，Web 以非 root Nginx 用户提供静态文件。

`infra/deploy/staging/docker-compose.yml` 只编排独立的 staging 资源。`migrate` 位于 `release` profile，发布顺序是构建制品、运行一次迁移、再启动 API/Worker/Web；API/Worker `CMD` 不调用迁移。staging/production 的 API/Worker 配置必须显式设置 `DEPLOYMENT_ENV`、资源 ID、凭据 ID、命名空间和独立 Provider/BYOK/SMTP 配置，门禁拒绝 localhost、HTTP Web/Auth、默认 MinIO 凭据、占位认证密钥、开发 seed 或缺少 `WEB_ALLOWED_ORIGINS`。运行时密钥只从部署环境注入，不进入镜像层、Web bundle、日志、健康检查或 Git。

`npm run deploy:staging:check` 只读取部署环境变量并输出环境名称，不输出任何值；占位模板预期会失败。`npm run deploy:staging:gate` 依次执行全量单测/集成/两账号 E2E、迁移检查、schema 兼容检查、production workspace 构建，再校验 staging 制品、迁移 release profile、Web bundle 的 localhost/Vite proxy/Provider 密钥/本地路径泄漏、CSP 与告警配置；传入 `--web-url`、`--api-url`、`--worker-url` 可追加 readiness 探测，传入 `--audit-file` 可阻断孤立正式资产、永久 running、重复扣费和不可回收 staging 对象。门禁输出只包含稳定事件名、计数和 HTTP 状态，不输出 URL、响应正文或环境值。API readiness 同时检查 PostgreSQL、Redis 和 S3 Bucket，Worker `/health/ready` 同时检查 PostgreSQL、Redis 和对象存储，任一依赖停止时返回 degraded；Compose 仅在内网启动 Prometheus，读取 `infra/deploy/staging/prometheus.yml` 和 `alerts.yml`。真实 staging 的域名/TLS、SMTP、Provider 凭据、BYOK 密钥、Alertmanager/通知接收端、备份和生命周期仍是外部部署责任，不在仓库内伪造。

### P7-9 schema 发布兼容

`server/db/migrations/release-manifest.json` 是每个 SQL 迁移的长期发布契约：版本/名称必须与文件一一对应，phase 只能按 `expand -> migrate -> contract` 前进；每项声明 `oldAppReadable`、`newAppReadable`、`oldAppWithNewSchema`、锁风险、statement timeout、回滚边界、前向修复和 `backupRequired`。`scripts/check-schema-release.mjs` 拒绝缺失/倒退/未声明迁移和未设置备份门槛的破坏性 SQL。当前 20 个迁移没有 contract 阶段，0020 的 `retry_count` 是 additive；API 对该列使用 `to_jsonb` 可选读取，旧 schema 上默认重试次数为 0，旧 Worker 可读取新 schema 未知列。

发布顺序是：先备份并运行向后兼容 migration，再发布可读新旧 schema 的 API/Worker，观察 metrics/readiness 后才允许后续 contract。`npm run db:migrate:compat` 在随机 PostgreSQL schema 验证旧 schema + 新应用读取、新 schema + 旧应用读取、迁移事务中断回滚后重跑和最终连续 schema_migrations；失败事务不会留下版本记录或半成品约束。Worker 涉及 task claim/submission/lease 的迁移窗口必须先停 Consumer、保留 recovery 边界，再按恢复后的 outbox 重新启动；应用启动不自动迁移。

不可逆数据/约束变更的回滚路径是 P7-8 加密备份恢复或显式前向修复，不执行猜测性 down migration。锁风险和 timeout 只作为发布门禁与排查依据，不写入日志正文；实际生产回滚、停 Worker 窗口、备份责任人和 contract 迁移需由外部发布系统批准。

### P7-3 Cookie 与限流边界

`apps/api/src/security.ts` 在 protected 环境对所有非安全方法拒绝 `Sec-Fetch-Site: cross-site`，并要求携带 Cookie 的写请求以及登录、注册、密码/邮箱认证写入口具有精确 allowlist Origin。无 Cookie 的 readiness 和受控服务端入口不套用浏览器 CSRF 假设。Better Auth 的默认 Cookie 属性显式固定为 HttpOnly、SameSite=Lax、Path=/，staging/production 同时固定 Secure；部署层通过 HTTPS `BETTER_AUTH_URL` 表达外部协议，不依据客户端伪造的转发头降低 Cookie 安全属性。

`apps/api/src/rateLimit.ts` 使用 Redis `INCR/EXPIRE/TTL` Lua 窗口，按认证尝试、密码/邮件、Provider 测试、任务创建、资产 prepare、迁移 prepare、普通读和普通写分层。每个请求先使用受控网络 scope；Cookie 经认证服务成功解析后，再使用服务端返回的 user/workspace scope，且同一请求复用该 session 查询。所有 scope 仅以 SHA-256 摘要进入环境隔离的 Redis key。`API_TRUST_PROXY` 默认 false；仅当 API 网络入口被受控反向代理完全隔离时设为 true，此时只接受代理追加链最右侧的合法 IP。不得把 query/body 中的 user/workspace 或原始 Cookie 用作 key、指标标签或日志字段。

超限固定返回 `429 RATE_LIMITED`、`retryable=true` 和非敏感秒级 `Retry-After`。普通读在 Redis 故障时 fail-open；认证、邮件、Provider 测试、任务/资产/迁移以及普通写全部 fail-closed，并返回 `503 SERVICE_UNAVAILABLE`，不得继续读取请求体或产生业务副作用。API readiness 复用限流 Redis 客户端 PING；Redis 重连后窗口服务自动恢复，多 API 实例共享同一环境命名空间。

### P7-4 Web 与对象存储边界

`infra/deploy/staging/web.nginx.conf` 由 Nginx unprivileged 镜像的 template entrypoint 渲染，`S3_PUBLIC_ORIGIN` 只作为 CSP 的精确图片、视频和连接来源。脚本只允许 `'self'`，禁止 `unsafe-eval`、任意 frame 和任意表单提交；`index.html` 不缓存，Vite hashed assets 使用长期缓存。API 代理设置 8 MiB 请求体上限，避免绕过 API JSON body 限制。

`S3_ENDPOINT` 是 API/Worker 到对象存储的内部管理地址；`S3_PUBLIC_ENDPOINT` 只用于签名 URL，protected 环境必须是 HTTPS 且与 `S3_PUBLIC_ORIGIN` 同源。MinIO `create-bucket` release step 设置 bucket CORS，仅允许 `WEB_ALLOWED_ORIGINS`、GET/PUT/HEAD、Content-Type 与必要 `x-amz-*` header，暴露 ETag，且保持匿名访问关闭。API/Worker 永不把管理凭据下发到 Web。

### P7-5 安全攻击面回归

API JSON 入口统一在领域服务前执行字节上限、严格 UTF-8、重复对象键、有限数值、合法 Unicode、最多 64 层和最多 100000 entries 校验。迁移 canonical JSON 在相同 Unicode/重复键边界上继续执行自身更严格的 schema、路径、条目、压缩比和总大小限制。受控攻击 fixture 只使用注入 fetch/对象存储和 `.invalid` 域名，不访问任意公网目标，也不读取根 `.env` 值。

Provider 请求端点和结果下载地址由注册表固定；协议、host、端口、凭据、重定向、任务 ID 与 data/blob/file URL 绕过必须在网络调用前拒绝。下载成功后仍按响应字节上限、允许 MIME 和文件 magic 校验，恶意 MIME 不得写入私有对象存储。

API 请求日志只记录 request ID、方法和固定路由组，不记录 query、动态资源 ID、Cookie、Authorization 或正文。共享 JSON logger 递归脱敏凭据、token、对象 key、签名 URL 与 Provider/body 字段；API 错误只返回稳定错误码和必要的非敏感恢复字段，底层存储/Provider 原文不进入 details。资源访问仍先解析可信 session actor，再按 workspace 查询；不存在和其他 workspace 资源使用相同非披露语义。

### P7-6 两账号 E2E 与授权

`apps/api/src/cloudE2E.integration.test.ts` 使用随机 PostgreSQL schema、真实 PostgreSQL/MinIO、随机 `.invalid` 账号、独立 cookie jar 和不同 device ID 运行 HTTP E2E。测试覆盖注册、session 刷新、项目 CRUD/归档、图保存/双标签冲突、checkpoint、Provider 配置、任务创建/恢复、资产 presigned 上传/完成/读取、会话/设备边界、API 重启和登录接管；失败清理只删除自身 schema 与对象。该 harness 可由 staging 或隔离 CI 的浏览器上下文调用，不引入 Playwright 或真实生产账号。

`server/modules/workspaces/authorization.integration.test.ts` 在真实 PostgreSQL 验证 owner/admin/editor/viewer：读取四角色可用，内容写入为 owner/admin/editor，管理为 owner/admin，ownership 仅 owner；其他 workspace 或不存在的资源统一返回 `RESOURCE_NOT_FOUND`。个人空间 UI 不伪装尚未开放的团队角色能力。

### P7-8 备份、生命周期与隔离恢复

`Dockerfile` 的 `operations` 非 root 目标只包含生产依赖、PostgreSQL client、固定 MinIO client、迁移和恢复脚本。`backup-scheduler` 默认每 24 小时在 PostgreSQL `REPEATABLE READ READ ONLY` 事务中导出 snapshot ID，使聚合指纹与 `pg_dump` 使用同一数据库快照；dump 以 AES-256-GCM 加密，manifest 记录密文 SHA-256/大小、聚合指纹和对象 snapshot prefix，数据库文件和 backup Bucket 默认保留 30 天。Pushgateway 仅接收成功/失败时间、耗时和加密字节数；26 小时无成功结果或最新一次失败触发 staging 告警。加密密钥、数据库 URL、对象凭据、对象 key 和用户正文不进入参数日志、manifest、指标或 Git。

主资产 Bucket 启用版本；当前正式对象不由 Bucket lifecycle 自动过期，非当前版本保留 30 天，未完成 multipart 1 天后中止。临时资产上传继续由 `asset_uploads.expires_at` 和 168 小时延迟 GC 管理，迁移上传/导出由 24 小时会话、过期状态和延迟对象清理管理；有效 completed 资产、当前引用和有效 checkpoint manifest 始终优先于生命周期清理。backup Bucket 的 `snapshots/` 当前/非当前对象独立按备份保留期过期。

`deploy:staging:restore:drill` 只允许 hostname、数据库/Bucket/Redis/队列和资源 ID 均为 `restore-*` 的目标，并要求显式 reset 确认。恢复顺序是：记录源库只读 guard、重建 restore-only PostgreSQL、校验并解密 dump、执行 `pg_restore`、运行当前迁移、在 restore-only 数据库重新开放 queued task outbox、复制对象到 restore-only Bucket、执行只读一致性/对象存在性审计、再次验证源库 guard。审计覆盖两工作区、项目 version/sequence/change、节点/连线计数、checkpoint manifest、资产 hash/引用、任务/attempt/账本、迁移状态、软删除/GC 保护和 queued outbox；缺失对象只计数并失败，不写回 `deleted`。原 staging PostgreSQL 凭据不注入 restore 容器，恢复 Redis 为空且使用独立 AOF；Redis 只承载可重建队列，不属于数据库备份。

基线 RPO 为 24 小时、告警窗口 26 小时；RTO 不伪造固定值，每次成功演练输出实际 `rtoSeconds`。真实 staging 必须把 backup storage/卷部署到独立故障域，在外部密钥管理保存并轮换 `BACKUP_ENCRYPTION_KEY`，配置 Alertmanager 接收端、备份责任人和经数据量验证的 RTO 目标。恢复 profile 不自动切流、不启动可能调用 Provider 的 Worker，也不清理原 staging 或演练卷。

资产上传只接受固定图片/视频 MIME、文件名和 50 MiB 单文件；完成确认重新读取对象 metadata，缺失或不匹配的 MIME、大小和声明 SHA-256 一律返回校验错误，不得标记 completed。迁移上传固定 8 MiB part size、最多 256 parts，manifest 的文件/总大小、压缩比、JSON 深度/entries 和 API 请求 body 上限共同生效；签名 URL 为短期且完成前不创建正式资产或引用。

## 验证规则

代码落地后，测试层次至少包括：

- 纯函数单测：图 diff、操作校验、ID、权限、状态机和引用提取。
- PostgreSQL 集成：事务、约束、并发版本、sequence、检查点与迁移。
- 对象存储集成：预签名上传、私有读取、跨租户拒绝和 GC。
- API 契约：认证、分页、幂等、错误码、输入上限和字段脱敏。
- 浏览器 E2E：两账号隔离、单设备登录接管与设备历史删除、双标签冲突、资产上传和关闭页面后任务恢复。
- 灾难恢复：数据库与对象存储恢复后校验当前图、检查点和资产引用一致。

当前真实命令：

```bash
npm run test
npm run lint
npm run db:migrate:test
npm run db:migrate:compat
npm run build
npm run deploy:staging:check
npm run deploy:staging:gate
npm run deploy:staging:backup
npm run deploy:staging:restore:drill
```

历史 checkpoint 资产 manifest 维护：

```bash
npm run db:repair:checkpoint-assets
npm run db:repair:checkpoint-assets -- --apply --batch-size=100
```

资产对象诊断与 GC（默认只读；提交模式默认保留 168 小时宽限期）：

```bash
npm run db:maintain:assets
npm run db:maintain:assets -- --apply --batch-size=100 --grace-hours=168
```

该命令先按数据库资产稳定游标诊断对象缺失，再按对象 key 稳定游标扫描 bucket 的 `workspaces/` 前缀。只有严格符合服务端 key 结构、数据库无对应行且超过宽限期的对象可作为 bucket 孤立对象删除；数据库侧只有 pending 已过期、failed、quarantined 或已软删除资产在超过宽限期、无 `asset_references`、无有效 checkpoint manifest 引用时才进入 GC。completed 资产即使暂时无引用也只保留，缺失对象只输出诊断，不因缺失本身静默改库；仅本来已满足 GC 条件的缺失对象会幂等收敛为 deleted。每个数据库候选使用独立短事务，先锁资产再用新的 SQL 语句复查保护引用；S3 删除成功但数据库提交失败时，下次运行会在对象已不存在的情况下完成状态收敛。

`npm run db:migrate:test` 不写入业务 schema；它在当前 PostgreSQL 数据库创建随机隔离 schema，按顺序执行全部迁移、验证关键表/约束/索引和拒绝路径，然后回滚测试事务并删除隔离 schema。该命令需要可连接的 `DATABASE_URL`。

开发入口：

```bash
npm run dev:web
npm run dev:api
npm run dev:worker
npm run db:migrate
npm run deploy:staging:check
```

每次新增或修改真实命令时，必须同步更新 README、AGENTS 和本文件。
