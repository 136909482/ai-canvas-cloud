# AI Canvas Cloud 开发指南

本文档定义网站端的长期架构边界。实现阶段、优先级和验收条件见 `ROADMAP.md`，数据库细节见 `DATA_MODEL.md`，HTTP 契约见 `API.md`。

## 产品边界

AI Canvas Cloud 是账号制 AI 画布 SaaS。首发提供个人空间、单活跃会话、云端项目、私有媒体资产和服务端生成任务，不提供多设备同时在线编辑、实时多人编辑、离线云项目同步或复杂商业计费。

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
- `packages/contracts`：API 错误码、认证/工作区和项目元数据请求响应契约。
- `packages/project-graph`：项目图纯操作和基础测试。
- `packages/shared`：共享环境读取、request ID 和日志工具。
- `server`：服务端领域模块 workspace package，当前包含 P2 Better Auth 适配、Cloud 工作区授权，以及 P3 项目元数据 PostgreSQL 服务。
- `infra/local`：PostgreSQL、Redis 和 MinIO 的 Docker Compose 基础配置。
- `server/db/migrations`：显式迁移文件和迁移检查入口。

Web 平台适配层已从 P1 临时内存项目适配推进到 P3 Cloud API 适配：项目列表、创建、读取、重命名、归档/恢复、软删除和图 GET/PATCH 走 Cloud API；前端仍不直接访问 PostgreSQL、Redis、对象存储管理凭据或服务端模块。

P2 第一批已经建立用户/工作区迁移、认证共享契约和最小认证 HTTP 路由骨架。当前认证实现已切到 Better Auth：API 路由通过注入的 `AuthService` 调用 Better Auth 的 `signUpEmail`、`signInEmail`、`getSession`、`signOut`、`listSessions`、`revokeSession`、`sendVerificationEmail`、`verifyEmail`、`requestPasswordReset` 和 `resetPassword`，由 Better Auth 管理邮箱密码、密码哈希、签名 HttpOnly Cookie、session 表、活跃会话列表、会话撤销、邮箱验证 token 和密码重置 token。首发产品策略为同账号单活跃会话：新登录成功后撤销该账号其他 session；前端首屏恢复一次 session，可见页面每 5 分钟执行一次心跳，窗口重新聚焦或页面重新可见只在距上次检查已满 5 分钟时触发，业务 API 返回未授权时立即清理前端 Cloud 会话缓存并回登录页，同一标签页并发 session 检查只复用一个在途请求。持续鼠标和键盘操作不再触发额外 session 请求；同一设备双标签或旧请求仍依赖版本号和冲突兜底防覆盖，但不承诺多设备同时编辑。Cloud 侧在注册、登录和会话恢复时幂等确保 personal workspace、owner 成员关系和工作区用户状态存在，并提供工作区授权模块校验 session 用户、workspace ID、成员角色和工作区状态。Web 匿名态先展示独立产品首页，顶部只保留品牌及登录/注册入口；认证表单通过可关闭弹层承载，邮箱验证和密码重置链接会直接打开对应模式。登录成功后才初始化画布工作区，账号菜单、活跃会话展示、其他设备下线、退出登录、未验证提示、重发验证邮件、忘记密码和重置密码闭环保持不变。真实邮件发送供应商、账号删除申请、浏览器级两账号隔离 E2E 和更完整限流审计待后续批次接入。

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
- 同账号首发只允许一个活跃登录设备。注册或登录创建新 session 后，服务端撤销该用户其他 session；旧设备不能继续保存、生成或读取资源。前端首屏检查一次 session，可见页面每 5 分钟心跳一次，窗口聚焦或页面重新可见只在距上次检查已满 5 分钟时触发；API 返回未授权时立即处理，同一标签页并发检查必须合并，鼠标和键盘操作不得产生额外 session 请求。
- 邮箱验证和密码重置链接面向浏览器使用 `WEB_PUBLIC_URL` 生成；开发/测试环境可把链接打印到日志，生产环境未接入真实邮件服务时不得打印 token 或完整链接，且应让发送流程失败以暴露配置问题。
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

P5-1 已建立任务持久化底座：PostgreSQL `generation_tasks` 是任务事实来源，`task_attempts` 保存每次 Provider 尝试；共享契约只暴露可恢复的任务摘要，不暴露 workspace、创建者、租约 token、Worker owner 或 Provider 远端任务 ID。服务端纯状态机统一约束 queued -> running、running -> queued/succeeded/failed/canceled、failed -> queued，并禁止 succeeded/canceled 再次运行。当前 Worker 仍只是进程生命周期骨架；在后续任务领域服务和 Redis claim 落地前，不得把浏览器内队列描述为服务端持久队列，也不得让 Worker 直接执行任意 Provider URL。

P5-2 已建立 Provider 配置服务。OpenAI 和阿里百炼的 base URL、显示名称及允许 endpoint 由 `server/modules/providers` 注册表拥有；用户输入必须精确命中固定 HTTPS allowlist，禁止 HTTP、凭据 URL、非标准端口、查询、fragment、相似子域和任意自定义 host。BYOK 使用 AES-256-GCM，AAD 绑定 workspace ID 与 Provider ID，envelope 记录 key version；API 进程从 `PROVIDER_CREDENTIAL_KEYS` 载入所有仍需解密的版本，并使用 `PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION` 加密新值。轮换必须先部署包含新旧密钥的 keyring，再切 active version，待后台重加密完成后才能移除旧版本。

首发每个 personal workspace 使用 20 GiB（`21474836480` 字节）云资产配额；个人空间与用户一一对应，但授权和统计始终以可信 session 的 `workspace_id` 为边界。`GET /api/v1/workspaces/current/usage` 返回 completed/failed/quarantined 的已用量、pending 上传预留量、总计、配额和剩余容量。创建上传会话先在事务中锁定 workspace 行，再查幂等键和最新资产总量；同一幂等请求只复用原预留，不同并发上传会串行校验，不能共同越过配额。完成上传只把 pending 预留转为 completed 已用量，不增加总占用。软删除资产立即退出逻辑配额统计，物理对象仍由后续宽限期 GC 负责；failed/quarantined 在被清理前继续计入用量。

历史 checkpoint 修复命令默认执行只读 keyset 分批预检。显式 `--apply` 后，每个 checkpoint 在独立短事务中重新读取并以 `FOR UPDATE ... SKIP LOCKED` 锁定 snapshot，再按项目所属可信工作区对派生资产加共享锁。规范空 manifest、合法但错误的 manifest 和重复/乱序 UUID 可回填为 record 派生值；record 或 manifest 结构损坏、跨工作区/缺失/已删除资产以及 pending、failed、quarantined 资产会保持或变为 `is_valid=false`。已经失效的 checkpoint 不会被重新启用或改写，`projects.saved_snapshot_id` 即使指向异常手动保存点也保持原值，等待用户后续显式手动保存替换。命令只输出 checkpoint/project ID、动作、原因分类和计数，不输出资产 ID、workspace ID 或资产状态细节。

读取私有资产时，API 授权后返回短期签名 URL。前端可以缓存 URL，但必须处理过期刷新和退出登录清理。Provider 临时结果 URL 必须由 Worker 下载、校验并转存，不得写入节点、任务或检查点作为长期来源。

删除项目只做软删除。后台 GC 仅删除超过宽限期且不被当前图、任务或保留检查点引用的资产，并在真正删除前重新读取最新引用。

## 服务端任务

Cloud 以 `generation_tasks` 为任务事实来源，前端 task queue 是投影。API 只负责授权、校验、额度预占和入队，Worker 负责领取与续租、Provider 调用、限流重试、结果转存、用量和审计。

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
- P5-3 的 queued 任务尚未接入 Redis/Worker。前端可以读取和恢复服务端任务列表，但在 Worker 落地前不能把排队成功展示为 Provider 已开始执行。

## 导入与导出

导入分预检和提交两阶段：先读取 manifest、项目与资产清单，执行 schema 迁移、大小限制和引用检查；用户确认统计与冲突策略后上传资产，再在事务中把 `ProjectRecord` 拆为项目、节点、连线、任务和引用。失败时不产生半完成活动项目。

导出从关系化当前状态和手动检查点组装兼容 `ProjectRecord`/目录包。Provider API Key 始终清空。Cloud 导出必须能重新导入干净的本地 Web/Electron 工作区。

## 可观测性与安全

- 每个请求、任务和导入操作使用稳定 request/job ID。
- 日志只保存 ID、操作、耗时、结果和脱敏上下文，不保存用户正文、附件、Cookie、Authorization 或完整 Provider 响应。
- 健康检查区分 liveness 与 readiness；readiness 检查 PostgreSQL、Redis 和对象存储依赖。
- 生产启用 CSP、CORS allowlist、CSRF 防护、安全响应头、上传限制和分层速率限制。
- 数据库自动备份，对象存储启用版本/生命周期策略，并定期在隔离环境完成恢复演练。
- schema 迁移是独立发布步骤，应用启动不自动执行破坏性迁移。

## 验证规则

代码落地后，测试层次至少包括：

- 纯函数单测：图 diff、操作校验、ID、权限、状态机和引用提取。
- PostgreSQL 集成：事务、约束、并发版本、sequence、检查点与迁移。
- 对象存储集成：预签名上传、私有读取、跨租户拒绝和 GC。
- API 契约：认证、分页、幂等、错误码、输入上限和字段脱敏。
- 浏览器 E2E：两账号隔离、新登录踢旧设备、双标签冲突、资产上传和关闭页面后任务恢复。
- 灾难恢复：数据库与对象存储恢复后校验当前图、检查点和资产引用一致。

当前已验证命令：

```bash
npm run test
npm run lint
npm run db:migrate:test
npm run build
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
```

每次新增或修改真实命令时，必须同步更新 README、AGENTS 和本文件。
