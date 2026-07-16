# AI Canvas Cloud 开发路线

本文档是网站端唯一长期路线入口。阶段按依赖顺序推进，完成后直接更新状态，不创建重复的完成计划。

## 已确定架构

- 独立账号网站仓库，不把 Cloud 代码混入本地 Web/Electron 仓库。
- PostgreSQL 关系化保存项目、节点、连线、任务、资产和权限。
- 节点类型专属数据使用 JSONB。
- 自动保存采用增量图操作和项目版本控制。
- `project_changes` 保存有序变更，`project_snapshots` 保存手动/定期完整检查点。
- 私有 OSS/S3 保存图片、视频、缩略图和预览图。
- Redis 持久化队列与独立 Worker 执行模型任务。
- 完整 `ProjectRecord` 只用于检查点、恢复和与本地版导入导出。

## 执行顺序

1. P0：文档与契约基线。
2. P1：monorepo 和本地云基础设施。
3. P2：用户系统与个人空间。
4. P3：关系化项目图与增量保存。
5. P4：对象存储与资产治理。
6. P5：服务端模型网关与任务 Worker。
7. P6：本地/云端导入导出。
8. P7：staging、安全、可观测性和恢复演练。
9. P8：生产灰度与正式上线。

不得把真实用户数据写入尚未完成权限隔离、版本冲突、备份恢复和资产私有化的环境。

## P0：文档与契约基线（本批完成）

交付物：

- 仓库定位与本地版边界。
- 开发、安全和数据一致性规则。
- monorepo 目录和依赖方向。
- PostgreSQL 混合图数据模型。
- 首发 HTTP API 资源与错误契约。
- 分阶段实现路线和验收门槛。

完成标准：长期文档互相一致，未声明不存在的代码、命令或部署能力。

## P1：工程骨架与本地云环境（进行中，第一批已落地）

交付物：

- npm workspaces monorepo，建立 `apps/web`、`apps/api`、`apps/worker` 和必要 packages。（已落地）
- TypeScript、Lint、格式化、测试和生产构建基础配置。（已落地）
- 本地 PostgreSQL、Redis、MinIO 和邮件捕获服务。（PostgreSQL、Redis、MinIO 已落地；邮件捕获待后续需要时接入）
- API/Worker 配置校验、结构化日志、request ID 和优雅关闭。（已落地）
- 数据库迁移工具、空库初始化、迁移状态检查。（迁移执行器、迁移文件与迁移检查已落地；真实数据库事务模块随 P2 auth 初步接入）
- `/health/live` 与 `/health/ready`。（已落地）
- `.env.example`，不包含真实密钥。（已落地）
- CI 执行 lint、单测、迁移测试和构建。

第一批说明：

- `apps/web` 已从本地版一次性迁移 React/Vite 画布、节点、store、主题、模型协议和必要测试。
- 未复制 Electron、release、dist、桌面 SQLite、本地目录持久化和 File System Access 平台实现。
- Web 第一批曾使用临时 Cloud 内存 adapter 独立启动和构建；当前项目元数据和关系图读写已接入 Cloud API 图适配层。
- Vite 开发配置不提供任意 target URL Provider 代理。

验收标准：

- 新开发者按 README 可从空环境启动 Web、API、Worker 和本地依赖。
- 空 PostgreSQL 可以迁移到当前版本，重复检查不产生漂移。
- API readiness 能准确反映数据库、Redis 和对象存储不可用。
- 前端 bundle 和日志中不存在服务端密钥。
- 实际脚本落地后同步更新 README、AGENTS 和 DEVELOPMENT。

## P2：用户系统与个人空间（第一批基础已落地）

交付物：

- 注册、登录、退出和会话恢复。
- 邮箱验证、重发、忘记密码与重置密码。（已落地最小闭环；真实邮件供应商待后续）
- 单设备登录接管确认、持久设备历史、主动删除旧设备记录和账号删除申请。
- 注册事务自动创建 personal workspace 和 owner membership。
- 认证/工作区授权中间件。（基础授权服务和当前工作区 API 已落地）
- 密码、会话和认证操作限流与审计。
- 匿名产品首页、登录、注册、验证和重置 UI。（响应式首页、顶部认证入口、认证弹层、邮箱验证提示、忘记密码和密码重置 UI 已落地）

第一批说明：

- Better Auth 核心表 `"user"`、`"session"`、`"account"`、`"verification"`，以及 Cloud 侧 `workspaces`、`workspace_members`、`workspace_user_state` 和 `auth_audit_events` 迁移已落地。
- 认证、用户摘要、工作区摘要、会话摘要和注册/登录/验证/重置请求的共享契约已落地。
- 认证纯逻辑已包含邮箱规范化、密码长度校验、不透明 token 生成、token 哈希、一次性 token 状态判断和个人工作区默认命名。
- `server` 已纳入 workspace package，`apps/api` 已接入 `POST /api/v1/auth/register`、`POST /api/v1/auth/login`、`GET /api/v1/auth/session` 和 `POST /api/v1/auth/logout` 的最小路由骨架、AuthService 注入和 HttpOnly session Cookie 写入/清理。
- PostgreSQL AuthService 已接入 API 启动入口：注册和登录委托 Better Auth 的 `signUpEmail` / `signInEmail`；会话恢复委托 `getSession`；退出登录委托 `signOut`；邮箱验证重发和 token 消费委托 `sendVerificationEmail` / `verifyEmail`；忘记密码和密码重置委托 `requestPasswordReset` / `resetPassword`；浏览器使用 Better Auth 签名 HttpOnly Cookie `better-auth.session_token`。
- Cloud 侧在注册、登录和会话恢复时幂等确保 personal `workspaces`、owner `workspace_members` 和 `workspace_user_state` 存在，避免后续团队空间与项目授权返工。
- `server/modules/workspaces` 已提供基础授权服务，按 session 用户、workspace ID、成员角色和工作区状态校验访问；非成员访问按不泄漏存在性的 `RESOURCE_NOT_FOUND` 处理。
- `GET /api/v1/workspaces/current` 已接入，返回当前 session 的工作区摘要。
- 前端已接入独立匿名产品首页、顶部登录/注册入口和认证弹层；弹层继续承载登录、注册、邮箱验证链接消费、忘记密码和密码重置，登录后再初始化画布工作区。首页品牌 Footer 已预留帮助、法律、企业主体和备案位置，但真实企业信息、协议页面和备案号仍属于 P8 上线前交付，不得以占位内容对外发布。账号菜单、活跃会话展示、其他设备下线、退出登录、未验证提示和重发验证邮件保持已接入状态。
- 会话策略为同账号单活跃设备：新设备登录检测到旧 session 时先提示用户确认，确认后旧设备失效；`auth_devices` 独立保留当前与历史设备，设置中心展示首次登录和最近活跃信息，并允许删除非当前设备记录。前端首屏恢复一次 session，可见页面每 5 分钟心跳一次，业务 API 返回未授权时立即清理登录态。生产真实邮件供应商、账号删除申请、浏览器级两账号隔离 E2E、登录接管与设备历史 E2E 和更完整限流审计待后续批次接入。

验收标准：

- 用户 A/B 自动获得不同个人空间且无法互读。
- 并发注册重试不产生重复用户或工作区。
- token 只能使用一次，过期和并发消费安全失败。
- 退出和撤销后会话立即不可用。
- 新登录成功后，同账号旧设备会话立即不可用。
- Cookie 的 HttpOnly、Secure、SameSite、Path 和过期符合环境配置。

## P3：关系化项目图与增量保存（P3-1 至 P3-14 已落地）

交付物：

- `projects`、`project_nodes`、`project_edges`、`project_changes`、`project_snapshots` schema、迁移、约束和索引。
- 项目摘要列表、创建、加载、重命名、复制、归档、恢复和软删除。
- Cloud 前端适配层和全局唯一 ID 工厂。
- CanvasSnapshot 与关系图的拆分/组装。
- ID 级图 diff 与版本化操作批次。
- 事务写入、幂等键、项目 version 和 change sequence。
- 自动保存 latest-wins 操作合并。
- `409` 冲突 UI、重新加载和另存副本。
- 手动检查点、定期检查点、操作日志保留和历史恢复。
- 项目/节点搜索索引的异步派生。

P3-1 至 P3-4 说明：

- `0003_project_graph.sql` 已建立 `projects`、`project_nodes`、`project_edges`、`project_changes` 和 `project_snapshots`，包含工作区项目索引、项目内节点/连线外键、变更 sequence/batch/幂等约束、检查点约束，以及 `workspace_user_state` 的同工作区项目外键；`0004_project_snapshot_scope.sql` 进一步保证项目只能引用自己的 saved snapshot。
- 项目摘要 contracts、PostgreSQL 领域服务和项目元数据 HTTP API 已落地：活动/归档列表、创建、读取、重命名、归档、恢复和软删除。所有作用域从可信 session 解析，写操作要求 owner/admin/editor，跨工作区读取统一返回 `RESOURCE_NOT_FOUND`。
- 规范化图读取、增量图 PATCH 和 `GET /changes` 已落地。操作批次在锁定项目的单事务内校验 `baseVersion`、节点父级/环、连线端点和幂等键，更新节点/连线软删除状态与计数，追加连续 `project_changes`，再递增 version/sequence；重复请求返回原结果，双标签同版本提交只有一个成功。changes 读取通过 session/workspace 授权，按 sequence 返回不含 workspace、actor 和幂等键的有序批次。
- 服务端 manual/periodic checkpoint 已落地。`POST /projects/:projectId/checkpoints` 要求 expected version/sequence 与当前项目一致，锁定项目后从关系化节点/连线组装 schemaVersion 1 的 `record_json`，写入有效 `project_snapshots`；manual 更新 `projects.saved_snapshot_id`，periodic 只作为历史恢复点保留；跨工作区隐藏、归档拒绝、冲突返回 `PROJECT_VERSION_CONFLICT`。
- checkpoint 摘要列表已落地。`GET /projects/:projectId/revisions` 通过 session/workspace 授权后按 `createdAt DESC, id DESC` keyset 分页返回摘要和大小，不返回完整 `record_json`。
- checkpoint 详情已落地。`GET /projects/:projectId/revisions/:version` 按项目版本读取该版本最新 checkpoint，返回完整 schemaVersion 1 record，用于恢复预览和 restore 事务。
- checkpoint restore 已落地。`POST /projects/:projectId/revisions/:version/restore` 要求 expected version/sequence 与当前项目一致，锁定项目后读取目标有效 checkpoint，先创建 `pre_restore` 检查点，再替换当前节点/连线关系图、追加 `source="restore"` 的 `project_changes` 并递增 version/sequence；P4-8 已补充资产 manifest 校验和节点引用重建，任务状态仍随 P5 扩展。
- Web 手动保存入口已接入 manual checkpoint：手动保存先通过 Cloud 图保存链路 flush 当前画布，再使用已确认的 version/sequence 调用 `POST /checkpoints`；同一标签页的重复保存触发复用一个在途 Promise，保存按钮在持久化期间禁用，当前 sequence 已保存时客户端不再发请求。服务端锁定项目后复用同一 version/sequence 的有效 manual checkpoint，防止跨标签页和重试重复插入。Web 自动保存成功后会按 sequence 增量和时间间隔尝试创建 periodic checkpoint，未达到阈值时跳过。
- Web 冲突处理最小闭环和非重叠增量追平已落地：Cloud 适配器把 `PROJECT_VERSION_CONFLICT` 转成可识别的项目版本冲突，冲突时读取 `GET /changes`，若远端 changes 与本地待提交操作未触碰同一节点/连线，则推进 baseVersion/sequence 后重试；仍冲突或触碰同一实体时，store 按项目保留冲突状态和本地工作副本，画布提示提供重新加载云端版本、另存为副本和稍后处理。
- 已覆盖领域单测、API session 作用域测试、真实 PostgreSQL 两工作区隔离、原子回滚、幂等、父级环、关联边清理和并发版本冲突集成测试，以及从空 schema 顺序升级并校验关键约束的迁移测试。
- Web Cloud 适配层已接入活动/归档项目列表、创建、读取、重命名、归档/恢复、软删除、图 GET/PATCH、React Flow 与关系图映射、稳定序列化、ID 级 diff、version/sequence 基线、自动保存，以及超过 500 个图操作时按拓扑安全顺序拆分为多个 PATCH 批次；刷新页面后可从 Cloud API 恢复画布，换账号、登出或 session 失效会清理前端项目/画布/任务/模板和临时资产缓存。
- 当前节点资产引用已在 P4-7 接入图事务，checkpoint asset manifest 与 restore 引用重建已在 P4-8 接入；冲突三方合并、搜索和服务端任务持久化仍属于后续切片，当前不能视为已完成。

验收标准：

- 注册 -> 创建项目 -> 编辑 -> 自动保存 -> 退出 -> 重新登录后完整恢复。
- 移动单节点只更新该节点、项目元数据和一个 change batch，不重写整份项目 JSONB。
- 节点新增/更新/删除和连线新增/更新/删除均有契约与数据库集成测试。
- 两标签基于同一版本保存只能一个成功，失败方保留本地待处理内容。
- A 直接请求 B 的 project/node/edge ID 得到不泄漏存在性的拒绝。
- 最新有效检查点加后续 changes 可以重建当前关系图。
- 检查点损坏时不会裁剪仍需恢复的操作日志。
- 历史 ProjectRecord fixture 可无损拆分并组装回语义等价格式。

## P4：对象存储与资产治理（P4-1 至 P4-11 已落地）

交付物：

- `assets`、`asset_uploads`、`asset_references` schema。
- 预签名上传、直传、完成确认和短期读取 URL。
- MIME/魔数、大小、尺寸、哈希和允许类型校验。
- 上传图、生成结果、编辑、裁剪、缩略图和预览图统一对象存储。
- 前端签名 URL 缓存、过期刷新和退出清理。
- 工作区存储用量与配额。
- 孤立对象扫描、缺失对象诊断、宽限期和幂等 GC。

P4-1 说明：

- 本批先建立资产治理数据库底座：`assets` 保存工作区内不可变对象元数据和状态，`asset_uploads` 保存短期上传会话、期望元数据、幂等键和完成状态，`asset_references` 保存项目节点或任务对资产的当前引用。
- 所有资产表都以 `workspace_id` 为租户边界；资产可绑定 `origin_project_id`，但授权仍必须通过 session 用户和 `workspace_members` 校验工作区。对象 key 不包含邮箱、项目名称或用户可读路径。
- `asset_references` 要求同一引用唯一，节点引用通过 `(project_id, node_id)` 复合外键绑定到当前项目图；任务引用先预留 `task_id` 文本，待 P5 `generation_tasks` 落地后补外键。
- 本批只落 schema、契约类型和领域输入校验；对象存储实际完成确认、短期读取 URL、前端 URL 缓存和 GC 仍属于后续 P4 切片。

P4-2 说明：

- `POST /api/v1/assets/uploads` 已接入 API。路由从 HttpOnly session 解析用户和工作区，服务端用 `workspace_members` 校验 owner/admin/editor，不接受客户端提交 `user_id` 或 `workspace_id`。
- `server/modules/assets` 已提供 PostgreSQL 上传会话服务：创建 pending `assets` 和 `asset_uploads`，按工作区/项目/资产 ID 生成对象 key，并以 `(workspace_id, idempotency_key)` 做幂等。复用幂等键但文件元数据不同会返回稳定冲突；上传会话过期或非 pending 后不重新签发上传 URL。
- 当前对象存储适配使用 S3 兼容协议和 path-style URL，面向本地 MinIO 试跑；后续接入 OSS 时保留资产领域服务和 API 契约，只替换对象存储适配或配置。
- 本批返回短期预签名 `PUT` URL、必带上传 headers 和过期时间，不返回对象存储永久凭据、object key、workspace ID 或 secret。

P4-3 说明：

- `POST /api/v1/assets/uploads/:uploadId/complete` 已接入 API。路由仍从 HttpOnly session 解析用户和工作区，服务端按 workspace scope 查找上传会话，跨工作区或不存在统一返回 `RESOURCE_NOT_FOUND`。
- 完成确认不相信浏览器声明。服务端先确认上传会话仍为 pending 且未过期，再通过对象存储适配器对 MinIO/S3 对象执行 `HEAD`，校验真实对象大小和 MIME；请求创建上传会话时提供 `sha256` 的，还会读取对象流计算 SHA-256 并比对。
- 校验通过后，服务端在 PostgreSQL 事务中把 `asset_uploads.status` 和 `assets.status` 更新为 `completed`；已 completed 的会话重复 complete 可幂等返回当前 completed 元数据。
- 对象不存在返回 `409 ASSET_NOT_READY`；会话过期返回 `409 ASSET_UPLOAD_EXPIRED`；大小、MIME 或 SHA-256 不匹配返回 `422 ASSET_VALIDATION_FAILED`。该切片尚未把失败对象标记 quarantined，也未接入读取、前端缓存和 GC。

P4-4 说明：

- `GET /api/v1/assets/:assetId` 和 `GET /api/v1/assets/:assetId/url` 已接入 API。两条路由只使用可信 session 的当前工作区，不接受客户端指定 workspace/user；当前工作区任意有效成员可以读取 completed 资产元数据并取得 5 分钟短期签名 `GET` URL。
- 资产查询始终同时限定 `workspace_id`、未软删除状态和资产 ID。跨工作区、已删除或不存在统一返回 `404 RESOURCE_NOT_FOUND`；pending、failed 或 quarantined 不签发 URL 并返回 `409 ASSET_NOT_READY`。
- S3/MinIO 适配器使用私有 bucket 的对象 key 生成 path-style 预签名 GET；API 只返回 `assetId`、URL 和过期时间，不返回 object key、workspace ID、access key、secret 或持久公共地址。
- 本批已覆盖签名 URL 单测、API session actor 与两账号非泄漏测试，以及 PostgreSQL 18 隔离 schema 中 owner/viewer 读取、pending 拒绝和跨工作区拒绝。前端 URL 缓存/过期刷新、资产引用事务、检查点 manifest、配额和 GC 仍属于后续 P4 切片。

P4-5 说明：

- Web Cloud 平台层已建立 `cloud-assets/<asset-id>` 客户端定位符。该值只携带不可变资产 ID，不复用对象存储 object key，也不把签名 URL 当作持久化资产路径。
- `resolveWorkspaceAssetUrl` 对 Cloud 定位符调用 `GET /api/v1/assets/:assetId/url`，按资产 ID 缓存签名 URL；剩余有效期不足 30 秒时刷新，同一资产的并发首次读取或刷新复用一个在途请求，并校验响应 asset ID、URL 和过期时间。
- 项目切换可以清理运行时 URL；换账号、退出登录、session 失效或工作区切换会重置整份 session 缓存。缓存使用 generation 隔离，清理前发出的在途请求即使稍后成功，也不能把旧 session 的签名 URL 写回新会话缓存。
- 本批已覆盖定位符解析、有效期复用、到期刷新、并发单飞、响应校验和登出清理竞态单测。该切片尚未替换浏览器会话内临时写入，Cloud 上传入口、图资产引用事务、检查点 manifest、配额和 GC 仍属于后续 P4 切片。

P4-6 说明：

- Web `writeWorkspaceAsset` 已从标签页内存对象切换为 Cloud 三步上传：调用 `POST /assets/uploads` 创建 pending 会话，使用响应 method/headers 把 Blob 直传私有 MinIO/S3，再调用 `/complete` 让服务端 HEAD/哈希校验并提交 completed 状态。直传失败不会执行完成确认。
- 平台层从既有 `projects/<project-id>/<category>` 客户端路径推导项目、资产类型和引用用途；图片导入、视频上传、生成结果、编辑、裁切、迁移媒体与缩略图继续复用原组件/store 接口。完成后返回 `cloud-assets/<asset-id>`，并把资产 ID、项目 ID、类型、文件名和 MIME 作为持久化元数据，不保存 object key、上传 URL 或永久凭据。
- 对象存储直传明确使用 `credentials: omit`、`redirect: error` 和 `cache: no-store`，站点 Cookie 与 Authorization 不会发送给 MinIO/S3。缩略图恢复会创建新的不可变资产，并继续绑定原项目；对象 key 按 upload/generated/edit/crop/thumbnail/preview/video 分类。
- 本地 MinIO Compose 已限制允许 `http://localhost:5173` 和 `http://127.0.0.1:5173` 两个开发源跨域直传。生产部署仍需配置正式 Web 源 allowlist，不能照搬开发 CORS。
- 本批已覆盖路径分类、请求元数据、无 Cookie 直传、失败不 complete 的 Web 单测，并通过真实 PostgreSQL 18 + MinIO 的创建会话、预签名 PUT、完成校验和签名 GET 全链路集成测试。图资产引用事务、checkpoint manifest、配额和 GC 仍属于后续 P4 切片。

P4-7 说明：

- 项目图领域层已从节点数据递归提取规范化 `assetId`、`cloud-assets/<asset-id>`、缩略图和预览定位符；签名 URL、object key、第三方 URL 以及 data/blob URL 不作为资产身份。现有 `asset_references` 外键与唯一索引足够，本批没有新增无意义迁移。
- 图批次仍先按项目行锁、幂等键和 `baseVersion` 串行化；资产 ID 只按可信 session 的当前 `workspace_id` 查询，必须未删除且为 completed。跨工作区、已删除或不存在统一隐藏为 `RESOURCE_NOT_FOUND`，pending、failed 和 quarantined 返回 `ASSET_NOT_READY`。
- 节点 upsert 在同一 PostgreSQL 事务中全量替换该节点旧引用，节点 delete 同步删除引用；任一引用校验或 SQL 失败都会回滚节点、连线、项目计数、version/sequence、`project_changes` 和引用。已接受批次的幂等重试仍返回原结果，不重复插入引用。
- 本批已覆盖资产引用提取纯函数、图领域变更单测、API 错误契约，以及真实 PostgreSQL 的 completed/pending/failed/quarantined、跨工作区非泄漏、节点替换/删除、原子回滚和幂等重试集成测试。checkpoint asset manifest、restore 引用重建、配额和 GC 继续拆分为后续 P4 切片。

P4-8 说明：

- manual、periodic 和 pre-restore checkpoint 已从节点 record 提取排序去重的 Cloud asset UUID 集合并写入现有 `asset_manifest_json`；创建新 checkpoint 前按可信 session 工作区重新验证所有资产未删除且 completed。现有列与约束足够，本批没有新增 schema 迁移。
- manual checkpoint 去重同时要求 version、sequence 和 manifest 完全一致，避免复用 P4-8 前缺少资产集合的旧检查点。目标 restore 会重新从 `record_json` 提取资产 ID，与 manifest 交叉校验，并对目标资产加共享锁；manifest 损坏、缺失或与 record 不一致时拒绝恢复。
- restore 通过校验后先创建带当前资产 manifest 的 `pre_restore`，再替换节点/连线并全量重建项目节点 `asset_references`；资产校验、pre-restore、关系图、引用、change 和 version/sequence 共享一个 PostgreSQL 事务。pending/failed/quarantined 拒绝，跨工作区与不存在统一隐藏且不产生半完成恢复。
- 本批已覆盖 manifest 归一化纯函数、checkpoint 保存/去重、pre-restore manifest、节点引用恢复、不可用资产、manifest/record 不一致、跨工作区非泄漏和原子回滚测试。历史存量 checkpoint manifest 批量修复、配额与 GC 继续作为后续 P4 切片。

P4-9 说明：

- 历史 checkpoint manifest 前向修复已落地。纯评估函数从 `record_json.canvas.nodes` 调用 `server/modules/project-graph` 的节点运行时校验与资产引用提取器，生成规范化、排序、去重的 Cloud asset UUID manifest；不读取或相信签名 URL、object key、workspace/user 字段、第三方 URL、data URL 或 blob URL。
- `npm run db:repair:checkpoint-assets` 默认执行只读 keyset 分批预检；只有显式 `--apply` 才提交。提交时每个 checkpoint 使用独立短事务和 `FOR UPDATE ... SKIP LOCKED`，重新读取行后按所属项目的可信 workspace 对派生资产加共享锁，避免单个长事务锁住全部 `project_snapshots`。每行输出 JSONL 审计动作和非泄漏原因分类，可幂等重跑。
- 规范空 manifest、合法但错误的 manifest 和重复/乱序 UUID 在派生资产全部属于同工作区、未删除且 completed 时回填。record 或 manifest 结构损坏、跨工作区/缺失/已删除资产以及 pending、failed、quarantined 资产不会被修复为有效状态，而是保持或调整 `is_valid=false`；跨工作区和缺失统一为 `asset_unavailable` 诊断，不泄漏其他租户资产是否存在。
- 修复不重写 `record_json`，不改变项目 version/sequence、`project_changes`、当前节点/连线或 `asset_references`。既有无效 checkpoint 不自动重新启用或改写；`saved_snapshot_id` 指向安全可修复或异常 checkpoint 时都保留原指针，不静默丢失用户手动保存点，用户后续显式手动保存可生成新有效点并自然替换。
- 现有 `asset_manifest_json`、`is_valid` 和项目内 `saved_snapshot_id` 外键足够，本批没有新增 schema 迁移。已覆盖纯函数、命令参数、真实 PostgreSQL 的只读预检、批处理、安全回填、跨工作区/缺失/非 completed、损坏数据、手动保存指针、当前图原子不变和幂等重跑测试。工作区存储用量/配额已在 P4-10 落地，GC 继续保持为后续独立切片。

P4-10 说明：

- 每个首发 personal workspace 默认获得 20 GiB 云资产配额；当前个人空间与用户一一对应，但所有统计和授权仍以 session 解析的可信 `workspace_id` 为边界。`0006_workspace_storage_quota.sql` 把列默认值设为 `21474836480`，并前向回填历史 personal workspace 的占位 `0`；旧应用忽略该值即可回退，真实数据不做破坏性回滚。
- `GET /api/v1/workspaces/current/usage` 已落地，返回 completed/failed/quarantined 已用量、pending 预留量、总量、配额和剩余量。查询先验证成员关系，只汇总当前 workspace 未软删除资产，不接受客户端 workspace/user 参数，也不暴露对象 key、资产 ID 或其他租户统计。
- 新上传会话在事务内先锁定 workspace 行，再读取幂等键和最新用量。安全幂等重试复用原 pending 预留；新请求只有在“已用 + 预留 + 本次大小”不超过配额时才插入 asset/upload。并发请求依次观察前一笔预留，超限稳定返回 `409 QUOTA_EXCEEDED`，不产生数据库行或预签名 URL；完成上传只把预留转为已用，不重复计数。
- 已覆盖 20 GiB 默认值和历史升级迁移、用量纯函数、API session actor/错误详情、真实 PostgreSQL 状态统计、两账号隔离、幂等预留、刚好用满、超限原子拒绝和并发不超卖，并回归真实 MinIO 全链路。软删除资产立即退出逻辑配额；物理对象宽限期、孤立/缺失对象诊断与幂等 GC 已在 P4-11 落地。

P4-11 说明：

- `npm run db:maintain:assets` 已提供默认只读的资产维护预检，按数据库资产稳定 keyset 游标诊断 completed 资产缺失对象，再按对象 key 稳定游标扫描 bucket 的 `workspaces/` 受控前缀。只有严格匹配服务端 workspace/project/用途/asset UUID key 结构的对象才可能进入孤立对象 GC；其他前缀或受控前缀内的非规范 key 均不删除。
- 默认宽限期为 168 小时，可在受控范围内显式调整。没有数据库记录的规范 bucket 对象必须超过宽限期才可删除；数据库侧只允许 pending 已过期、failed、quarantined 或已软删除资产进入候选，completed 资产即使暂时无引用也保留。候选还必须没有 `asset_references`、没有同工作区有效 checkpoint manifest 引用；pending 从上传会话过期后才开始计算宽限期。P5 尚未落地的任务只通过现有引用表契约预留，不在本切片另建任务 GC。
- 显式 `--apply` 对每个数据库候选使用独立短事务和 `FOR UPDATE ... SKIP LOCKED`。取得资产排他锁后，再用新的 SQL 语句快照复查当前引用和有效 checkpoint manifest，避免与图/checkpoint 的 completed 资产共享锁竞态；被当前图、后续任务引用或保留 checkpoint 保护的对象不删除。completed 资产对象缺失只诊断，不静默把仍受保护的资产标记 deleted。
- S3 与 PostgreSQL 无法共享事务，收敛顺序固定为锁后复查、幂等删除对象、提交 `status='deleted'`/`deleted_at`。删除失败会回滚数据库；对象已删除但数据库提交失败时，下次运行会识别对象不存在并完成状态收敛，已收敛状态可幂等重跑。GC 不改变 record、项目 version/sequence、changes、当前图、引用或 `saved_snapshot_id`。
- 现有 `assets.status/deleted_at/object_key`、`asset_references` 和 `project_snapshots.asset_manifest_json/is_valid` 足够，本批没有新增 schema 迁移。已覆盖纯函数、命令参数、分批游标、PostgreSQL 引用/checkpoint 保护、跨工作区 manifest 不误保护、共享锁竞态、删除失败、幂等重跑、当前图/version/sequence/change 不变，以及真实 MinIO 的私有读取、HEAD、列表和幂等删除。

验收标准：

- Bucket 私有，B 不能读取或完成 A 的资产上传。
- 上传中断不会产生可被节点引用的 completed 资产。
- 重新登录和签名 URL 过期后资产仍可恢复。
- 复制项目可共享不可变资产；删除原项目不误删副本引用。
- 节点、任务和检查点不持久化新 data URL 或第三方临时 URL。
- GC 在删除前重新验证当前图、任务和保留检查点引用。

## P5：模型网关与任务 Worker（P5-1 至 P5-3 已落地）

交付物：

- `generation_tasks`、`task_attempts`、`provider_credentials`、`usage_ledger` schema。
- 服务端 Provider 适配器及目标白名单。
- BYOK 加密写入、末四位展示和连接测试。
- 创建、取消、查询、重试和状态事件。
- Worker 租约、并发 lane、限流、超时、退避和恢复。
- 同步/异步 Provider 调用和轮询。
- 结果校验、对象转存、结果节点更新和幂等用量。
- 前端任务列表以服务端状态为准。

P5-1 说明：

- `0007_generation_tasks.sql` 已建立 `generation_tasks` 和 `task_attempts`。任务表以 workspace/project 为租户边界，source/preview node 必须属于同一项目；保存 image/video kind、Provider/model 标识、计费模式、版本化请求/结果 JSON、queued/running/succeeded/failed/canceled 状态、进度、尝试上限、可领取时间、取消请求、租约和时间戳。任务尝试表按同一 workspace/task 外键保存每次 Provider、状态、远端请求 ID、可重试分类、用量摘要和脱敏错误。
- `asset_references.task_id` 已从 P4 的预留文本列收紧为 UUID，并新增 `(workspace_id, task_id)` 到 `generation_tasks` 的级联外键。0007 在转换前明确拒绝任何无法归属的历史 task 引用，不静默删除或猜测租户；升级测试验证该拒绝路径原子回滚。现有节点引用不受影响。
- 共享 contracts 已定义任务创建请求、可恢复摘要和列表/详情响应；响应不暴露 workspace/user、Worker lease、远端任务 ID 或内部请求 JSON。`server/modules/tasks` 已提供纯状态机和进度归一化，允许 claim、过期恢复、失败重试和终态完成，禁止 succeeded/canceled 重新运行。
- 本批没有接入任务 HTTP 路由、Redis 队列、Worker claim、Provider 凭据、Provider 调用或用量账本，也不修改前端本地队列。已覆盖状态机/契约单测、7 迁移连续升级、遗留引用拒绝，以及真实 PostgreSQL 的两工作区、项目节点、任务尝试、任务资产引用和级联清理约束。

P5-2 说明：

- `0008_provider_credentials.sql` 已建立工作区 Provider 凭据表，以 `(workspace_id, provider_id)` 唯一，保存固定 HTTPS base URL、AES-256-GCM envelope、key version、末四位、状态和创建/更新用户；数据库约束 envelope 必需字段、算法和 JSON/关系 key version 一致性，不保存明文。
- `server/modules/providers` 已建立 OpenAI/阿里百炼注册表、精确 base URL 和 endpoint allowlist，以及版本化密钥环。加密 AAD 绑定 workspace/provider，跨租户复制密文不能解密；新凭据用 active version 加密，旧版本只要仍在 keyring 即可读取，为后续后台重加密留出轮换路径。
- `GET/PUT/DELETE /api/v1/settings/providers` 已接入。所有作用域来自可信 session；成员可读脱敏状态，只有 owner/admin 可写或删除。响应只含末四位，不返回 API Key、密文、key version、workspace 或 Worker 内部字段；跨工作区删除不影响其他租户。
- Provider base URL 当前只允许 `https://api.openai.com` 和 `https://dashscope.aliyuncs.com/compatible-mode/v1`，拒绝 HTTP、凭据 URL、非标准端口、query/fragment、相似子域、自定义 host 和内网地址。本批未实现连接测试、重定向处理或真实 Provider 调用，`POST /test` 仍不可用。
- 已覆盖 registry 绕过、AES-GCM 随机 envelope、AAD 篡改、密钥轮换、API 不回显、角色限制、真实 PostgreSQL 密文落库与两工作区隔离，以及 8 迁移连续升级。该切片当时未接任务 API；任务 API 已在 P5-3 补齐，Redis Worker 和用量账本继续拆分为后续切片。

P5-3 说明：

- `POST/GET /api/v1/tasks`、`GET /api/v1/tasks/:taskId`、`POST /api/v1/tasks/:taskId/cancel` 和 `/retry` 已接入可信 session。创建/命令要求 owner/admin/editor，读取允许成员；响应只返回可恢复任务摘要，不暴露 workspace/user、request JSON、租约、远端任务 ID 或 Provider 凭据。列表按 `(created_at, id)` keyset 分页并支持项目/状态过滤。
- 创建任务在 workspace 行锁下复用创建幂等键、校验活动项目和 source/preview node、共享锁确认 active BYOK 配置并限制同 workspace 最多 5 个 queued/running 任务；当前只开放 workspace_key。参数对象限制为 256 KiB/12 层，并拒绝任何层级的凭据、Authorization 和 target/base/api URL/endpoint 字段。成功插入才递增 `projects.task_count`，任一失败不修改当前图、version/sequence 或 change。
- `0009_task_commands.sql` 持久化 cancel/retry 幂等命令，以 `(workspace_id, idempotency_key)` 唯一并通过复合外键绑定同租户任务。命令在 workspace/任务锁下与状态更新同事务提交；queued 取消直接终止，running 取消只记录请求，failed 且未达上限才能重试。重放不重复转换，跨任务/命令复用同键稳定冲突。
- 已覆盖请求纯校验、API session actor/字段不泄漏、真实 PostgreSQL 创建/命令幂等、节点与两工作区隔离、running cancel、failed retry、并发上限和 9 迁移连续升级。Redis 队列、Worker claim/租约恢复、Provider 实际调用、结果资产转存、图结果提交、状态事件和用量账本继续拆分为后续切片；前端可在下一切片先接只读任务中心与创建后的服务端状态恢复，但不能把任务 API 视为已执行 Provider。

验收标准：

- 关闭浏览器后任务继续，重新登录恢复状态和结果。
- API、Worker 或 Redis 重启不产生永久 running、重复结果和重复扣费。
- 对象转存失败时任务不标记 succeeded。
- Worker 图更新使用幂等 change batch，不覆盖用户后续移动/编辑。
- 任意 URL、内网地址和重定向绕过被拒绝。
- 日志和诊断不含 API Key、Authorization、附件或完整响应。

## P6：本地与云端迁移

交付物：

- 工作区/单项目 prepare、资产上传、commit 两阶段导入。
- manifest、schema、大小、引用和配额预检。
- 项目 ID 冲突的副本/替换策略。
- `ProjectRecord` 到关系图的事务拆分。
- 关系图与检查点到兼容目录包的导出。
- 大文件进度、取消、重试和临时对象清理。

验收标准：

- 本地 Web 目录包和 Electron 导出包可导入 Cloud。
- 项目、任务、原图、缩略图、预览图和视频引用完整。
- 登录不自动迁移，上传前必须展示统计并取得确认。
- 任一资产缺失时不产生半完成活动项目。
- Cloud 导出可重新导入干净的本地 Web/Electron 工作区。
- Provider API Key 不进入任何导出包。

## P7：staging、安全与运行保障

交付物：

- 独立 staging 域名、数据库、Redis、Bucket、邮件和 Provider 凭据。
- 两账号云端 E2E 与授权矩阵。
- CSP、CORS、CSRF、安全响应头、上传限制和速率限制。
- SSRF、ID 枚举、恶意 MIME、超大 JSON/data URL 和日志泄密测试。
- 指标与告警：认证失败、API 延迟/错误、版本冲突、任务积压、Worker/转存失败、存储和数据库连接。
- PostgreSQL 自动备份、对象存储版本/生命周期和隔离恢复演练。
- schema 发布和回滚/前向修复流程。

验收标准：

- A 无法通过项目、节点、资产、任务、搜索、审计或导入候选访问 B 数据。
- staging 可从空环境部署、迁移、创建数据、备份并恢复到隔离环境。
- 告警通过 request/task ID 定位，不依赖查看用户正文或密钥。
- 所有单测、集成、E2E、安全回归、迁移和生产构建通过。

## P8：生产灰度与正式上线

交付物：

- 正式域名、HTTPS、Web CDN、API、Worker、PostgreSQL、Redis、对象存储和邮件服务。
- 部署平台密钥管理和环境隔离。
- 邀请制/灰度开关、用户配额和紧急停用 Provider 开关。
- 最小运营诊断能力。
- 用户协议、隐私政策、数据导出与账号删除流程。
- 面向中国大陆运营时的备案、内容安全和适用合规检查。
- 发布、回滚、故障公告和责任人流程。

上线门槛：

- 两个真实账号在不同浏览器完成全链路隔离验证。
- 生产域名模型调用不依赖 Vite 开发代理或浏览器密钥。
- 数据库自动备份与恢复演练通过，对象存储具备误删恢复策略。
- 关闭页面任务继续、服务重启恢复、失败重试和用量幂等通过。
- 回滚应用能够读取发布前数据，不可逆迁移不与首发应用同时发布。

## P9：团队与协作（P8 后评估）

个人空间稳定运营后，再根据真实需求评估团队邀请、角色 UI、只读分享、评论、项目锁定和实时多人编辑。实时协作需要单独选择操作日志、服务端串行命令或 CRDT 协议，不在个人云空间阶段提前实现。
