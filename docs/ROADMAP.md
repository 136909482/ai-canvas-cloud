# AI Canvas Cloud 开发路线

本文档是网站端唯一长期路线入口。阶段按依赖顺序推进，完成后直接更新状态，不创建重复的完成计划。

## 已确定架构

- 独立账号网站仓库，不把 Cloud 代码混入本地 Web/Electron 仓库。
- PostgreSQL 关系化保存项目、节点、连线、资产和权限；浏览器生成任务不写数据库。
- 节点类型专属数据使用 JSONB。
- 自动保存采用增量图操作和项目版本控制。
- `project_changes` 保存有序变更，`project_snapshots` 保存手动/定期完整检查点。
- 私有 OSS/S3 保存图片、视频、缩略图和预览图。
- Redis 只用于 API 分布式安全限流，不承载模型生成队列。
- 用户 Provider、模型和 API Key 只保存在浏览器加密 Vault，结果通过 Cloud 资产和项目图 API 入云。
- 完整 `ProjectRecord` 只用于检查点、恢复和与本地版导入导出。

## 执行顺序

1. P0：文档与契约基线。
2. P1：monorepo 和本地云基础设施。
3. P2：用户系统与个人空间。
4. P3：关系化项目图与增量保存。
5. P4：对象存储与资产治理。
6. P5：服务端模型网关与任务 Worker（历史实现，P8 清退）。
7. P6：本地/云端导入导出。
8. P7：staging、安全、可观测性和恢复演练。
9. P8：运营管理端、浏览器本地生成与旧服务端生成清退。
10. P9：生产灰度与正式上线。
11. P10：团队与协作。

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
- `0023_user_numbers.sql` 已为历史账号按注册顺序回填 `10001` 起的唯一用户编号，新注册账号自动递增；注册、登录和 session 用户摘要返回 `userNumber`，账号菜单与账号设置页展示该编号，但认证和资源授权仍使用 Better Auth 内部 `user.id`。
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

## P5：模型网关与任务 Worker（P5-1 至 P5-11 已完成）

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

- `0008_provider_credentials.sql` 建立了初始工作区 Provider 凭据表；`0022_user_provider_credentials.sql` 已将当前唯一边界切换为 `(user_id, provider_id)`；`0024_provider_website_urls.sql` 增加可空官网展示字段并为旧行稳定回填。表保存供应商名称、协议类型、官网链接、公开 HTTPS API base URL、AES-256-GCM envelope、key version、末四位、状态和创建/更新用户，不保存明文；旧 `workspace_id` 仅作为迁移前密文的可空 AAD 兼容字段。
- `server/modules/providers` 已建立 OpenAI/阿里百炼注册表、精确 base URL 和 endpoint allowlist，以及版本化密钥环。新密文 AAD 绑定 user/provider，跨账号复制密文不能解密；旧 workspace AAD 行可继续读取，用户更新密钥后转为 user scope。新凭据用 active version 加密，旧版本只要仍在 keyring 即可读取，为后续后台重加密留出轮换路径。
- `GET/PUT/DELETE /api/v1/settings/providers` 已接入。所有作用域来自可信 session；每个已认证用户只能读取、写入、测试和删除自己的脱敏配置。响应包含供应商名称、官网链接、API 请求地址、状态与末四位，不返回 API Key、密文、key version、workspace/user 或 Worker 内部字段；Cloud 设置页按四行纵向编辑这四项。同一用户的多个项目复用配置，同一工作区其他用户不能看到或使用。
- 官网链接只用于信息展示，连接测试和 Worker 调用绝不使用它。API base URL 按协议规范化为公开 HTTPS 地址，拒绝 HTTP、凭据 URL、非标准端口、query/fragment、本机、私网和相似子域绕过；连接测试与 Worker 只在该 base URL 下访问协议固定 endpoint，不接受任务覆盖 target URL。
- 已覆盖 registry 绕过、AES-GCM 随机 envelope、AAD 篡改、密钥轮换、API 不回显、真实 PostgreSQL 密文落库、同工作区两用户隔离和同用户跨项目/工作区复用。该切片当时未接任务 API；任务 API 已在 P5-3 补齐，Redis Worker 和用量账本继续拆分为后续切片。

P5-3 说明：

- `POST/GET /api/v1/tasks`、`GET /api/v1/tasks/:taskId`、`POST /api/v1/tasks/:taskId/cancel` 和 `/retry` 已接入可信 session。创建/命令要求 owner/admin/editor，读取允许成员；响应只返回可恢复任务摘要，不暴露 workspace/user、request JSON、租约、远端任务 ID 或 Provider 凭据。列表按 `(created_at, id)` keyset 分页并支持项目/状态过滤。
- 创建任务在 workspace 行锁下复用创建幂等键、校验活动项目和 source/preview node、按任务发起用户共享锁确认 active BYOK 配置，并限制同 workspace 最多 5 个 queued/running 任务；当前计费枚举仍保留 `workspace_key` 兼容值，但凭据归属是 user scope。参数对象限制为 256 KiB/12 层，并拒绝任何层级的凭据、Authorization 和 target/base/api URL/endpoint 字段。成功插入才递增 `projects.task_count`，任一失败不修改当前图、version/sequence 或 change。
- `0009_task_commands.sql` 持久化 cancel/retry 幂等命令，以 `(workspace_id, idempotency_key)` 唯一并通过复合外键绑定同租户任务。命令在 workspace/任务锁下与状态更新同事务提交；queued 取消直接终止，running 取消只记录请求，failed 且未达上限才能重试。重放不重复转换，跨任务/命令复用同键稳定冲突。
- 已覆盖请求纯校验、API session actor/字段不泄漏、真实 PostgreSQL 创建/命令幂等、节点与两工作区隔离、running cancel、failed retry、并发上限和 9 迁移连续升级。Redis 队列、Worker claim/租约恢复、Provider 实际调用、结果资产转存、图结果提交、状态事件和用量账本继续拆分为后续切片；前端可在下一切片先接只读任务中心与创建后的服务端状态恢复，但不能把任务 API 视为已执行 Provider。

后续执行节点（按顺序推进，状态只在本节维护）：

### P5-4：可靠入队与 Outbox（已完成）

- 新增任务队列 outbox；任务创建和显式重试在原数据库事务中写入派发事实，不直接双写 PostgreSQL 与 Redis。
- 使用 BullMQ 持久队列；Worker dispatcher 领取、发布和确认 outbox，使用稳定 job ID 抵抗崩溃后的重复发布。
- Redis 暂时不可用时 queued 任务和未发布 outbox 继续保留，恢复后按退避时间自动补发；队列消息只携带任务和派发 ID，不携带请求正文、凭据或用户内容。
- 验收：API 提交后在 Redis 不可用、dispatcher 中断、发布成功但确认前崩溃等情况下，任务最终只产生一个可幂等消费的队列作业。

P5-4 说明：

- `0012_task_queue_outbox.sql` 已建立同租户任务复合外键、workspace 派发键唯一约束、短期 claim tuple、失败退避、发布确认和 pending 索引；升级时会把既有 queued 任务按下一 attempt 编号前向回填，不改动 running 或终态任务。
- 任务创建和显式 retry 已在原 PostgreSQL 事务内写入 `run:<task-id>:<attempt-number>` 派发事实；请求重放通过原任务/命令幂等与 outbox 唯一键共同保证不重复插入。API 不直接连接或写 Redis，因此数据库提交与队列暂时不可用之间不存在丢任务窗口。
- `server/modules/tasks` 已提供带 `FOR UPDATE SKIP LOCKED` 的 outbox dispatcher：多 Worker 可并发领取不同派发，claim 过期后可恢复；BullMQ job ID 固定为 outbox UUID，发布成功但数据库确认前崩溃时重复发布仍由队列 job ID 和后续任务状态共同收敛。失败只保存脱敏、截断的基础设施错误，并按指数退避重新开放。
- `apps/worker` 已接入 BullMQ publisher、dispatcher 单飞循环、Worker 实例 ID、队列/批次/claim/退避配置与优雅关闭；消息仅含 outbox/task UUID。任务消费适配、领取和租约恢复已在 P5-5 补齐，Provider 调用仍属于后续节点。
- 已覆盖纯退避和配置单测、Worker 在途派发关闭、Redis URL/TLS 解析、真实 PostgreSQL 事务/失败恢复/多 dispatcher 竞争、12 迁移连续升级与 queued 存量回填；真实 BullMQ 幂等发布测试已通过。测试在其他环境 Redis 不可用或凭据不匹配时仍会明确跳过，不把环境错误当作通过。

### P5-5：Worker 领取、租约与恢复（已完成）

- 建立 Worker 专用任务执行领域服务，原子完成 queued -> running、attempt 创建、租约续期、取消收敛、条件状态转换和 lease token 防陈旧提交。
- 增加过期租约扫描、lane 并发、指数退避、最大尝试次数和优雅关闭恢复。
- 验收：多 Worker 竞争只产生一个有效 attempt，进程或 Redis 重启不产生永久 running。

P5-5 说明：

- `server/modules/tasks/execution` 已建立 Worker 专用领域服务。claim 使用 `UPDATE ... WHERE status='queued' AND available_at<=now()` 原子领取任务，在同一事务递增 attempt、写入 lease owner/token/expiry 并创建 running `task_attempts`；队列消息中的 ID 只用于定位，不能绕过数据库状态条件。
- 续租、单调进度和任务收敛都要求 task ID、Worker ID 与 lease token 同时匹配，且已过期租约不能被续活。陈旧 Worker 的进度、失败或取消写入返回未收敛，不覆盖新 attempt。
- 可重试失败在同一事务完成 attempt failed、任务 running -> queued、清理租约、推进 `available_at` 并创建下一 attempt 的延迟 outbox；不可重试或达到上限进入 failed。已请求取消的 running 任务统一收敛为 canceled，不再重排。
- Worker runtime 已接入过期租约定期扫描，按 `FOR UPDATE SKIP LOCKED` 处理并发恢复：有剩余 attempt 的任务指数退避后重排，达到上限进入 failed，带取消请求的任务进入 canceled。恢复与 outbox 写入共享事务，不产生永久 running 或无派发 queued。
- `apps/worker` 已提供 BullMQ Consumer 和任务作业处理器：队列级全局并发约束当前唯一 default lane；处理期间按配置心跳续租、上报进度、感知取消并在优雅关闭时可重试重排。P5-9 已接入受控同步图片 processor，主进程启用 Consumer；能力矩阵在任务创建时拒绝未启用的 Provider/model/kind，避免现有 queued 任务被错误领取。
- 已覆盖 Worker 配置边界、作业错误分类、取消、fencing 丢失、关闭重排、不完整处理器保护、真实 PostgreSQL 并发 claim/attempt/进度/取消/失败/延迟 outbox/过期恢复，以及全量回归；真实 Redis Consumer 用例已通过。

### P5-6：Provider 执行网关与连接测试（已完成）

- 定义同步/异步 Provider adapter，集中管理能力矩阵、固定 endpoint、结果域名、超时、重定向、错误分类和日志脱敏。
- 实现 `POST /settings/providers/:providerId/test`；API 路由不接触明文，执行凭据只由 Provider 领域模块在内部短期解密。
- 验收：任意 URL、内网地址、相似域名、非 HTTPS 和重定向绕过全部被拒绝，响应和日志不包含密钥或完整 Provider 正文。

P5-6 说明：

- `server/modules/providers/adapter` 已提供统一 Provider adapter 边界及同步/异步提交类型，注册表集中保存固定测试 endpoint、业务 endpoint 和结果域名 allowlist。
- `POST /api/v1/settings/providers/:providerId/test` 只接受 owner/admin 的空 JSON 对象；路由不解密或传递明文凭据，领域服务才会短期解密后调用 adapter。
- 测试请求固定为 HTTPS、`redirect: 'error'`、10 秒超时和 64 KiB 流式响应上限；网络、超时、重定向、认证、上游拒绝和响应过大以脱敏稳定分类映射，日志不写入密钥、Authorization、请求正文或完整 Provider 响应。

### P5-7：防重复 Provider 提交（已完成）

- 为 attempt 保存确定性 submission key、提交阶段和远端任务 ID；恢复时优先继续轮询已有远端任务。
- 只有 adapter 明确支持幂等提交时才自动重放不确定请求，否则稳定失败为需用户确认的提交结果不确定错误。
- 验收：Worker 在网络提交前后任意时点崩溃，不会盲目产生第二次付费请求。

P5-7 说明：

- `0013_provider_submission_fencing.sql` 为 `task_attempts` 新增稳定 submission key、提交阶段和远端任务 ID，并将升级时当前 attempt 的既有任务远端 ID 前向迁入 submitted 状态；迁移测试覆盖约束、索引和升级回填。
- `server/modules/tasks/execution` 仅在 Worker/lease token fencing 仍有效时准备提交或记录远端 ID。已有远端 ID 一律优先返回 poll；未确认提交只有 adapter 显式声明幂等时才返回 submit，否则返回 uncertain，供 processor 收敛为不可自动重试的提交结果不确定错误。
- 当前注册表中所有 Provider 均明确为不支持幂等提交；P5-9 已为 OpenAI `gpt-image-2` 同步文生图启用 Consumer，其他能力继续由矩阵拒绝。升级后回退旧应用必须停止 claim、lease recovery 和 Consumer，重新升级由新 Worker 接续持久化提交状态。

### P5-8：结果资产、用量与项目图事务（已完成）

- 新增 `usage_ledger`；Worker 下载、限流校验并转存 Provider 临时结果到私有对象存储，建立任务资产引用。
- 以任务幂等键完成资产、attempt、用量、任务状态和必要项目图 change；只合并任务拥有的结果字段，不覆盖用户后续位置或编辑。
- 验收：对象转存失败时任务不标记 succeeded，重放不重复创建资产、节点或用量记录。

P5-8 说明：

- `0014_task_results_usage_ledger.sql` 已建立 `usage_ledger`，以 `(task_id)` 唯一约束一项成功任务只记一次用量，并通过 workspace/task 和 task/attempt 外键保持同租户、同 attempt 的归属；账本只保存受限的数值用量摘要，不保存 Provider 正文、URL 或凭据。
- `server/modules/tasks/resultTransfer` 已提供 Worker 可调用的 Provider 临时结果转存边界：结果 URL 必须命中 Provider 精确 HTTPS 主机 allowlist，下载拒绝重定向，Provider `429` 映射为稳定可重试的限流分类，限制 50 MiB，校验 MIME、媒体魔数和 SHA-256 后才写入私有对象存储；任务/结果序号派生稳定 asset ID 和对象 key，重试不会换用新的结果定位符。
- Worker 在持有当前 lease token 时通过 `settleSuccess` 在单一 PostgreSQL 事务内校验工作区配额、建立 completed 结果资产和 task/node `asset_references`、写入一次用量、结束 attempt、将任务收敛为 succeeded，并在 preview node 仍活动且项目未归档时追加 source=`worker` 的图 change。节点只合并标准资产对象构成的 `generationResults.<taskId>`，因此检查点 manifest 仍能提取并保护结果；不修改位置、尺寸、其他数据或用户后续编辑。预览节点已被删除或项目已归档时任务和任务资产仍可成功收敛，但不重建节点或写图变更。
- 已覆盖转存 URL/响应验证、稳定对象定位、任务结果原子成功、账本/引用/图 change 幂等重放和用户节点字段保留；Provider 协议 processor 仍在 P5-9 才会启用。

### P5-9：图片、编辑与视频 Provider 能力接入（已完成）

- 先接入一个同步图片生成闭环，再接图片编辑、阿里百炼异步轮询和视频任务；每种能力独立声明输入、输出、超时和取消语义。
- 验收：每种能力覆盖成功、限流、超时、取消、不可重试失败和 Worker 恢复。

当前说明：

- 已启用 OpenAI `gpt-image-2` 的同步文生图和图片编辑：文生图只调用固定 `POST /v1/images/generations`；编辑调用固定 `POST /v1/images/edits`，其输入只能从 source node 的 completed 私有资产引用读取并以 multipart 上传。两者都只接受受限参数和单张 base64 图片响应，不接受自定义 endpoint、URL 或浏览器密钥。
- 已启用阿里百炼 `wanx2.1-t2i-turbo` 异步文生图和 `wan2.7-t2v` 异步文生视频：分别只向固定 `POST /api/v1/services/aigc/text2image/image-synthesis` 与 `POST /api/v1/services/aigc/video-generation/video-synthesis` 提交受限参数，并通过固定 `GET /api/v1/tasks/:remoteTaskId` 轮询。视频只接受 `720P`/`1080P`、`16:9`/`9:16` 和 5/10 秒。提交返回的受限远端 ID 必须立刻经 `recordProviderSubmission` 写入当前 attempt；恢复时 `prepareProviderSubmission` 返回 poll，绝不重复提交付费任务。结果 URL 仍必须经过 Provider 精确 HTTPS allowlist、私有转存校验和 P5-8 成功事务。
- Worker 在有效 lease 内先写 P5-7 submission stage，再根据任务 `created_by_user_id` 短期解密发起用户自己的 BYOK、调用 Provider、转存校验后的图片或视频，并复用 P5-8 成功事务。Provider `429`/超时/网络错误会作为可重试失败收敛；认证、受限参数、未知 model、重定向、超限或无效响应为不可重试失败；取消信号不会继续解密凭据或调用 Provider。P5-9 验收范围的同步图片、编辑、异步图片与视频能力均已落地。

### P5-10：Web 服务端任务投影与切换（已完成）

- Web 接入服务端任务创建、列表、详情、取消、重试和刷新恢复，服务端状态成为唯一事实来源。
- Cloud 模式关闭浏览器 Provider 执行；任务成功后通过 changes/图读取和私有资产 API 恢复结果，checkpoint 保存脱敏任务投影及对应资产 manifest。
- 阶段验收已覆盖：关闭页面后服务端任务继续；重新登录后由同一可信会话作用域恢复状态、结果和可执行操作；两账号之间的任务列表、读取、取消和重试均保持非泄露式隔离。

当前说明：

- Cloud Web 已新增固定 `/tasks` client，覆盖创建、分页列表、详情、取消与重试；请求只携带服务端允许的 Provider/model、脱敏参数、项目/node ID 与幂等键，不携带浏览器 API Key、Provider URL、结果 URL、对象 key 或远端任务 ID。
- `TaskQueueRunner` 在 Cloud runtime 只提交未绑定服务端 ID 的本地排队投影并轮询项目任务列表，绝不调用浏览器 Provider 执行器。服务端任务 ID、0-100 progress、状态和脱敏错误同步回队列；恢复后的 queued/running server task 保持 server-owned，不能被旧本地恢复逻辑再次提交。失败重试与活跃任务取消通过服务端命令端点执行。
- 已增加跨项目活跃任务缓存：非当前且未归档项目按轮转顺序只查询 `queued/running` 摘要，缓存也只保留活跃服务端任务，避免轮询完整历史。切回项目后先按项目 ID 合并缓存并更新当前节点投影，再以该项目完整任务查询校准；后台摘要从不写入当前项目画布，终态继续以项目图和当前项目查询恢复。
- 任务面板合并当前项目投影与上述跨项目活跃缓存，可按全部、进行中和已结束筛选，并在失败项显示服务端脱敏错误；其他项目条目只显示项目名称、状态和进度并提供服务端取消，当前项目结果才提供画布定位、重试和本地移除，避免跨项目画布或快照误写。
- 任务第一次进入终态时刷新项目图。Cloud platform 从 Worker 写入的 `generationResults.<taskId>.assets` 读取标准 asset ID，复用既有私有签名 URL 缓存填充图片/视频节点；不保存 Provider 临时 URL。检查点/项目快照仍只保留脱敏任务投影，不包含凭据或对象存储 key。
- 设置中心的 Cloud 服务商入口已支持用户新增、编辑、测试和删除自定义服务商，统一保存显示名称、公开 HTTPS base URL 与服务端加密 API Key；模型管理只选择服务商，不再维护服务商详情。新 API Key 只在表单临时输入中存在，模型配置仅保存 `modelId -> providerId`，绝不进入任务投影、项目图或快照。
- 个人 workspace 保留为后端隐式项目/资产/任务/配额容器，注册时自动创建；Cloud Web 已移除 workspace 名称、选择保存位置和个人空间展示，登录后直接进入项目体验。未来团队协作可继续复用既有 workspace 授权边界，当前普通用户无需理解或操作该概念。

### P5-11：任务事件、通知与 P5 验收（已完成）

- 已新增 `generation_task_events` 迁移与 `generation_tasks` 触发器：创建、状态、进度和终态事件在同一事务持久化，迁移为既有任务回填当前状态；事件只保存工作区授权所需关联、脱敏错误和稳定 UUID/sequence 游标，不保存 request JSON、凭据、lease、attempt、远端 ID、结果 URL 或对象 key。
- 已接入 `GET /api/v1/tasks/events` 轮询接口，支持项目/任务过滤、`after` 游标、分页 `hasMore` 和可信 session 工作区授权；事件丢失后可从游标继续，任务列表/详情仍是状态事实来源。
- Web `TaskQueueRunner` 已按项目保存事件游标，将 terminal 事件以事件 UUID 幂等写入通知中心；重复轮询、断线重试和页面恢复不会重复计数。SSE、心跳和断线恢复协议仍不在本阶段首发范围内。
- 已增加统一进程内 metrics registry 与 Prometheus 文本渲染；API `/metrics` 提供 queued backlog、running、expired lease 和 retryable failure 聚合 gauge，Worker 记录任务重试、租约过期恢复、Provider 请求耗时和结果转存失败。指标标签限制为固定低基数枚举，不包含 workspace、task、URL 或凭据。
- API/Worker 服务对象重建、过期 lease 恢复、远端任务轮询、结果/账本幂等和转存失败不成功收敛已加入自动化演练并通过；真实 Redis 下的 BullMQ 稳定 job ID、重复发布和客户端断开重连测试也已通过。维护窗口在独立验收队列完成 Redis 实例级重启，确认 AOF 恢复、重复发布不产生第二个作业，业务队列和 PostgreSQL 活跃任务保持为空。
- 验收：本节全部 P5 验收标准已满足，P5 完成并进入 P6；SSE、心跳和断线恢复协议留待后续阶段。

验收标准：

- 关闭浏览器后任务继续，重新登录恢复状态和结果。
- API、Worker 或 Redis 重启不产生永久 running、重复结果和重复扣费。
- 对象转存失败时任务不标记 succeeded。
- Worker 图更新使用幂等 change batch，不覆盖用户后续移动/编辑。
- 任意 URL、内网地址和重定向绕过被拒绝。
- 日志和诊断不含 API Key、Authorization、附件或完整响应。

## P6：本地与云端迁移

### P6-1：目录包与迁移契约（已完成）

- `packages/contracts/src/migrationPackage.ts` 已冻结 `packageSchemaVersion=1`、单项目包布局和可选 checkpoint 格式：`manifest.json`、`project.json`、`graph.json`、`assets.json` 与 `checkpoint.json`。
- manifest 包含 package/source platform、项目 ID/version/sequence、payload 文件数量、总字节数、内容 SHA-256 和逐文件 SHA-256；JSON 使用规范排序，时间使用 ISO UTC，资产只携带逻辑 ID 与受控相对路径。
- 纯校验器覆盖未知 schema、路径穿越/重复路径/符号链接、压缩比、目录深度、文件/总包上限、重复逻辑资产 ID、悬空图引用、非规范 JSON 和凭据/Authorization/object key/签名 URL/租户内部字段泄漏。
- 首发只支持单项目包；归档安全检查只接收条目元数据，不访问文件系统或解压。本切片没有新增数据库 schema，因此不运行 `db:migrate:test`。

### P6-2：Import Prepare 预检会话（已完成）

- `0016_migration_imports.sql` 已建立独立迁移导入生命周期表，持久化 validated package JSON、workspace 幂等指纹、冲突快照、文件/字节进度、固定错误字段和过期时间；状态预留 prepared、uploading、validating、ready、committing、completed、failed、canceled、expired。
- `POST /api/v1/migrations/imports/prepare`、`GET /api/v1/migrations/imports/:importId` 和 `POST /api/v1/migrations/imports/:importId/cancel` 已接入可信 session。prepare/cancel 要求 owner/admin/editor，读取允许当前成员；客户端 user/workspace 字段不参与授权。
- prepare 校验 P6-1 全部契约、规范 JSON 字节/SHA-256、逐文件摘要、配额和项目 ID 状态；workspace + idempotency key 同内容返回同一 import，不同内容返回 `IMPORT_CONFLICT`。跨 workspace ID 碰撞只返回不泄漏归属的 unavailable 冲突。
- prepare 只写 `migration_imports`，不创建项目图、资产、引用或配额 reservation；GET/cancel 和过期收敛可在 API 重启后从 PostgreSQL 恢复。真实 PostgreSQL 两工作区隔离、API session actor 和 18 迁移顺序升级已验证。

### P6-3：资产暂存与上传完成（已完成）

- `0017_migration_import_asset_uploads.sql` 建立每个 logical asset 的独立暂存会话，保存服务端 staging key、multipart provider upload ID、分片计划/已完成 ETag、状态、retryCount 和过期时间；暂存 reservation 纳入 workspace 用量，不写正式 assets。
- 提供单 PUT 和 S3 multipart 两种上传模式，支持断点恢复、分片确认、最终 MIME/大小/SHA-256 校验、失败重试、幂等完成、取消和对象清理。API 只返回短期签名 URL，不接受或返回 object key、provider upload ID 或凭据。
- 真实 PostgreSQL fake storage 集成覆盖单 PUT、multipart resume、错误 hash、重试、跨 workspace 隔离、取消清理和 reservation；API actor 路由测试已覆盖。正式资产、引用和项目图由已完成的 P6-4 commit 事务创建。

### P6-4：单项目 Commit（已完成）

- 新增 `0018_migration_import_commit.sql`，持久化 commit idempotency key/fingerprint、策略、目标 project、完成时间和 logical asset 到正式 asset UUID 的映射。
- `POST /api/v1/migrations/imports/:importId/commit` 支持 copy/replace。copy 始终创建新 project；replace 仅 owner/admin，必须携带 prepare 快照版本/sequence 和显式确认；冲突返回 `PROJECT_VERSION_CONFLICT`，不自动 merge。
- 单事务锁定 workspace/import/目标 project，物化 completed staging assets，重写图中的逻辑资产 ID，复用 project-graph 写节点/连线、引用和 `source=import` change，可选写 import checkpoint；失败整体回滚，重复相同请求返回稳定结果。真实 PostgreSQL copy/replace、幂等、跨 workspace 和两账号权限已验证。

### P6-5：项目冲突策略（已完成）

- copy 每次生成新 project、node 和 edge ID，用统一映射重写父级、连线端点、change operations 与 import checkpoint；两个副本的图实体 ID 相互隔离。replace 保留包内实体 ID，仅 owner/admin 可在 prepare expected version/sequence 仍匹配且显式确认时执行，不实现隐式 merge。
- commit 通过 assets 领域 helper 在可信 workspace 内按 completed、未删除、SHA-256、字节数和 MIME 安全复用资产；相同内容的重复导入不新增正式资产或存储用量，跨 workspace 同 hash 不能复用。
- 真实 PostgreSQL 集成已覆盖 copy 结构映射、重复导入、checkpoint 映射、replace ID 语义、两账号角色、跨 workspace hash 隔离和 prepare 后并发编辑冲突；冲突事务不留下新资产、引用、change 或 committed 映射。

### P6-6：目录包导出（已完成）

- 新增 `0019_migration_exports.sql` 和独立导出生命周期；`prepare/status/download/cancel` API 使用可信 session/workspace，保存项目 version/sequence 快照、关系图、saved checkpoint、资产 manifest、归档进度、失败/取消/过期状态和幂等指纹，不复用 `generation_tasks`。
- `POST /api/v1/projects/:projectId/exports/prepare` 在项目锁内冻结单一版本，后台生成兼容 P6-1 的 ZIP；Cloud asset UUID 转为不含租户内部字段的逻辑资产 ID，object key、签名 URL、Provider 凭据不进入 `project.json` 或归档。归档写入私有对象存储后，download 只签发 5 分钟 URL。
- API/进程重启可从 PostgreSQL 恢复 prepared/generating 导出；取消和失败不会修改项目图、资产引用或 checkpoint。真实 PostgreSQL 集成覆盖 version 冻结、契约重导入、私有下载、幂等、跨 workspace 和失败不变性，19 个迁移顺序升级已验证。

### P6-7：进度、取消、重试与清理（已完成）

- `0020_migration_lifecycle_retry.sql` 为导出增加 retry_count 和 retryable 索引；failed/canceled 导出支持 owner/admin/editor 最多 3 次 retry，保留冻结 payload，不重读新 project version。状态响应持久化阶段、文件/字节进度、retryCount、固定错误码和过期时间。
- API 重启从 PostgreSQL 恢复 prepared/generating 导出；取消在上传、校验、归档和 commit 边界收敛，重复 cancel/retry 保持幂等结果。P6-3 资产上传继续支持失败重试和断点恢复。
- 启动维护和延迟 GC 清理过期 import、failed/canceled/expired staging/归档对象；已完成上传、completed import 和带 `committed_asset_id` 的 staging 行不进入清理范围。真实 PostgreSQL 已覆盖导出 retry、上传重试/取消、24 个迁移升级和 API actor retry 路由。

### P6-8：Web 迁移中心（已完成）

- Cloud Web 顶部工具栏新增显式迁移中心，不在登录或工作区初始化时自动上传本地数据。浏览器读取 `.zip` 目录包后提交 prepare 预检，展示来源版本/sequence、文件与字节统计、资产上传进度和服务端状态，再由用户显式 commit。
- 项目冲突只展示服务端允许的 copy/replace 策略。replace 固定显示 prepare 返回的目标 expected version/sequence，并要求单独勾选确认；`PROJECT_VERSION_CONFLICT` 提供重新加载云端项目或改为复制新项目，不做客户端 merge。
- 小文件和 multipart 资产使用服务端短期签名 URL 直传，分片按真实 ETag 确认；重新选择相同 package ID 可继续既有上传会话的缺失分片。导出按当前图 version/sequence prepare，轮询生成状态后获取短期私有下载 URL，并支持 cancel/retry。
- 最近 import ID 与 export project/export ID 只保存在浏览器迁移索引中；页面刷新或重新登录后重新向服务端读取状态，账号切换先清空内存摘要，目录包正文和媒体不进入持久化 store。通知中心只接收预检/完成摘要，迁移会话、资产和项目图仍分别以服务端领域状态为事实来源。

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

### P7-1：API 来源边界与安全响应头（已完成）

- API 配置新增 `WEB_ALLOWED_ORIGINS` 精确 allowlist；只接受无凭据、path、query 和 fragment 的 HTTP(S) origin，默认回退到 `WEB_PUBLIC_URL`。同一列表传给 API CORS 边界和 Better Auth trusted origins，避免认证与业务路由使用两套来源事实。
- 所有 API 响应统一携带 `nosniff`、frame deny、referrer、permissions、COOP/CORP 和 API 专用 `default-src 'none'` CSP；staging/production 额外发送一年 HSTS。页面资源 CSP 仍由后续 Web CDN/反向代理节点配置，本节点不把 API CSP 当作页面 CSP。
- 允许来源的预检返回 204、精确 `Access-Control-Allow-Origin`、credentials、固定 methods/headers 和 10 分钟 max-age；携带不受信 `Origin` 的读写请求在认证或领域服务前返回 `403 ACCESS_DENIED`，不回显来源、不读取 Cookie、不产生业务副作用。无 Origin 的健康检查、受控服务端客户端和测试仍可访问。
- 配置纯测试和真实 HTTP 路由测试已覆盖 allowlist 规范化、非法 URL、允许预检、拒绝恶意来源及 staging 安全头。分层速率限制、Web 页面 CSP、CSRF 缺失 Origin 强制策略、staging 独立资源和安全攻击矩阵留在后续 P7 节点。

### P7-2：staging 隔离基线与可部署制品（已完成）

- 根 `Dockerfile` 按锁文件和显式 workspace 依赖顺序生成 Web、API、Worker 与一次性 migration 制品；API/Worker/迁移以非 root Node 用户运行，Web 以非 root Nginx 用户运行，镜像不包含 `.env`、开发 seed、源码凭据或运行时密钥，Web bundle 只包含公开静态配置。
- `infra/deploy/staging/docker-compose.yml` 提供可执行的厂商无关 staging 基线，`staging.env.example` 只含键名和占位符。资源、队列、邮件 SMTP、Provider/BYOK 凭据标识和持久卷均带 staging 隔离边界，不复用 local/production；真实外部域名、TLS、邮件、Provider、密钥管理、备份和告警由部署环境提供。
- 共享配置门禁在 staging/production 启动时拒绝 localhost、HTTP Web/Auth、默认 MinIO 凭据、占位 Better Auth secret、开发管理员 seed、缺失来源白名单和跨环境资源/凭据 ID；SMTP 是 protected 环境唯一邮件传输，验证/重置链接不写日志。迁移位于 `release` profile 的独立一次性步骤，API/Worker 启动不自动迁移。
- API readiness 使用 PostgreSQL、Redis 和 S3 Bucket 检查，依赖停止返回 `503 degraded`；Worker 健康检查验证 Redis 连接。`npm run deploy:staging:check`、相关配置测试和受影响 workspace 构建已落地，Docker 实际启动仍需在具备 Docker 的空环境执行。

验收：同一 staging 定义可从空卷重复部署；停掉 PostgreSQL、Redis 或对象存储时 readiness 明确 degraded；任一 staging 凭据或资源标识与 production/local 复用时配置门禁失败。

### P7-3：Cookie CSRF 与分层速率限制（已完成）

- staging/production 的 Cookie 写请求必须携带允许的 `Origin`，并拒绝 cross-site `Sec-Fetch-Site`；登录、注册、密码重置、邮箱验证、退出和普通业务写路径共用同一前置边界，不把客户端 user/workspace 当作授权依据。
- 确认生产 Cookie 使用 Secure、HttpOnly、受控 SameSite、固定 Path 和正确代理 HTTPS 语义；未携带 Cookie 的健康检查、受控 Worker/运维入口不套用浏览器 CSRF 假设。
- 使用 Redis 建立多实例一致的分层限流：认证尝试、密码/邮件、Provider 测试、任务创建、资产/迁移 prepare 与普通读写分别配置窗口和上限。键只使用服务端可信的账号/workspace/session 或受控网络标识，不在日志和响应暴露原始敏感标识。
- 超限统一返回 `429 RATE_LIMITED`、稳定 retryability 和非敏感 `Retry-After`；Redis 故障策略按路由风险显式 fail-open/fail-closed，不能无声放行高风险认证与费用写路径。

验收：同账号换 IP、同 IP 多账号、并发突发、窗口恢复、Redis 重启和两 API 实例共享限额均有自动化覆盖；跨站表单/fetch 不能触发 Cookie 写操作。

实现结果：API 前置边界已在 staging/production 强制 Cookie/认证写请求的允许 Origin，并拒绝 cross-site Fetch Metadata；Better Auth Cookie 显式固定 Secure（protected）、HttpOnly、SameSite=Lax 和 Path=/。Redis Lua 原子窗口按八类路由分层，环境隔离 key 只保存 scope SHA-256；超限返回稳定 `429 RATE_LIMITED`/`Retry-After`，普通读故障 fail-open，其余写与高风险路径 fail-closed。自动化覆盖同 session 换 IP、同 IP 多 session、并发突发、窗口恢复、Redis 重连恢复、两客户端共享限额、前置无副作用拒绝和跨站 Cookie 写拒绝；真实 Redis 集成使用根 `.env` 的 `REDIS_URL`，不可用时按现有集成测试约定跳过且不输出地址或凭据。

### P7-4：Web 页面 CSP、对象存储 CORS 与上传边界（已完成）

- Web CDN/反向代理发送页面级 CSP、HSTS、frame-ancestors、Referrer-Policy、Permissions-Policy 和静态资源缓存策略；策略按实际 Vite chunk、图片/视频 blob、私有签名 URL 和 API connect 来源收敛，不使用宽泛 `*`、`unsafe-eval` 或任意公网媒体源。
- staging Bucket 保持私有，CORS 只允许 staging Web origin、PUT/GET/HEAD 和实际所需请求头，并暴露 multipart ETag；不允许匿名 list/read/write，不把 object key 或永久凭据送入浏览器。
- API 和对象存储共同约束单文件/总包大小、MIME、SHA-256、multipart 分片数、签名 URL TTL、请求体大小和 JSON 深度；错误 MIME、缺失对象和签名过期不得产生 completed asset 或引用。
- 用真实浏览器验证图片/视频展示、单 PUT、multipart、迁移上传和导出下载在 CSP/CORS 下可用，并确认恶意第三方 origin 无法读取或上传。

验收：浏览器控制台无非预期 CSP/CORS 例外；允许源全链路可用，不允许源、匿名请求、错误 MIME 和超限载荷稳定拒绝。

实现结果：staging Nginx 以非 root template entrypoint 渲染页面 CSP、HSTS、frame deny、Referrer/Permissions/nosniff 和静态资源缓存；脚本仅允许 self，媒体/连接仅允许 self、blob/data 与配置的 `S3_PUBLIC_ORIGIN`。API 管理/健康检查使用内部 `S3_ENDPOINT`，签名上传/读取使用独立 HTTPS `S3_PUBLIC_ENDPOINT`，protected 配置要求它与 `S3_PUBLIC_ORIGIN` 同源。MinIO release step 保持 bucket 私有，按 Web allowlist 配置 GET/PUT/HEAD CORS、必要请求头和 ETag 暴露。资产完成严格复核对象 MIME、大小和 SHA-256；迁移固定 8 MiB 分片、最多 256 parts，并与 manifest 总大小、JSON/请求体上限和短期签名 TTL 共同生效。自动化已覆盖页面/Compose 约束、public/private presign endpoint、严格 MIME 拒绝和既有真实对象存储上传读取；真实外部 storage domain/TLS/CORS DNS 仍需部署环境提供。

### P7-5：安全攻击面回归矩阵（已完成）

- 建立表驱动安全测试，覆盖 SSRF、重定向、DNS/端口/协议绕过、ID 枚举、路径穿越、ZIP bomb、恶意 MIME、超大 JSON、深层对象、data/blob URL、重复字段和 Unicode/编码边界。
- 对项目、节点、资产、任务、Provider、迁移、导出、会话和设备 ID 做不存在/本 workspace/其他 workspace 三态验证；禁止通过状态码、错误详情、耗时或列表差异泄漏其他租户资源。
- 对日志、metrics、诊断、通知和 API 错误做敏感字段扫描，覆盖 Cookie、Authorization、API Key、重置/验证 token、对象 key、签名 URL、附件正文和完整 Provider 响应。
- 固定恶意样本进入受控 test fixture；测试不得访问任意公网目标或把真实本地 `.env` 凭据写入快照和失败输出。

实现结果：新增表驱动攻击样本，覆盖 Provider/result URL 的协议、凭据、host、端口、重定向和任务 ID 绕过，迁移路径穿越、大小/压缩比、大小写重复路径、深层 JSON、data/blob URL、重复对象键、非法 UTF-8/Unicode 代理项、恶意 MIME 和超限响应。API 在领域服务前拒绝重复键、无效 UTF-8、超过 64 层/100000 entries 的 JSON 和路由请求体上限；修复了尾部高代理项被误判为合法 Unicode 的绕过。请求日志仅记录固定路由组，共享 logger 对 Cookie、Authorization、token、API Key、对象 key、签名 URL 和 Provider/body 字段递归脱敏，开发邮件不记录验证/重置链接，底层对象存储错误不进入 API details。既有真实 PostgreSQL/MinIO 集成与 API 两账号 stub 覆盖项目、图节点引用、资产、任务、Provider、迁移、导出、会话和设备的可信 actor/workspace 作用域；跨 workspace 与不存在资源统一使用非披露错误，不在本节点提前实现浏览器两账号 E2E。

验收：攻击矩阵在单测/API/真实 PostgreSQL/对象存储层稳定通过，发现的每个绕过都先补回归再修复，不以 WAF 代替应用边界。

### P7-6：两账号云端 E2E 与授权矩阵（已完成）

- 使用两个真实测试账号、独立浏览器上下文和不同设备 ID，覆盖注册/验证/登录接管、项目 CRUD、图保存/冲突、检查点恢复、资产上传读取、任务创建恢复、Provider 设置和迁移导入导出。
- A 的项目、节点、资产、任务、检查点、Provider、会话、设备和迁移 ID 在 B 下必须统一不可见/不可写；copy/replace、归档项目、后台任务和签名 URL 也保持 workspace 隔离。
- 覆盖页面刷新、重新登录、双标签并发、API/Worker 重启和关闭浏览器后任务/迁移恢复；测试清理只删除自己创建的命名空间，不依赖固定生产数据。
- 建立 owner/admin/editor/viewer 的 API 授权矩阵测试；首发个人空间未开放的角色 UI 不伪装完成，但服务端角色边界必须可验证。

实现结果：新增 `apps/api/src/cloudE2E.integration.test.ts`，使用随机 schema、随机 `.invalid` 测试账号、独立 `BrowserContext` cookie jar、不同 device ID 和真实 PostgreSQL/MinIO，覆盖注册、session 刷新、项目 CRUD/归档、图保存与双标签版本冲突、checkpoint、Provider 配置、任务创建与跨账号命令、资产 presigned PUT/完成/读取、会话/设备删除、API 重启后的 session/task 恢复和同账号登录接管。测试只删除自身 schema、workspace 产生的对象和随机命名空间，不依赖固定生产数据。

新增真实 PostgreSQL owner/admin/editor/viewer 授权矩阵：读取允许四种成员角色，普通内容写允许 owner/admin/editor，管理操作允许 owner/admin，仅 owner 操作只允许 owner；workspace 外用户统一返回 `RESOURCE_NOT_FOUND`。现有真实服务集成继续覆盖迁移导入/导出、任务 Worker、对象存储和两 workspace 资源边界；本节点不伪造个人空间未开放的角色 UI。仓库不引入 Playwright 或云厂商 SDK，staging 浏览器上下文执行仍由部署/隔离 CI 运行器调用同一 HTTP harness。

验收：两账号 E2E 在 staging 和隔离 CI 环境可重复运行，任何跨租户成功响应、可用签名 URL 或差异化泄漏均阻断发布。

### P7-7：指标、告警与脱敏诊断（已完成）

- 已补齐认证失败/限流、API 延迟与错误、项目版本冲突、任务 backlog/running/retry/lease、Worker/Provider/转存失败、迁移阶段、存储配额及 PostgreSQL/Redis/对象存储连接指标；API 与 Worker 均提供受控 Prometheus 抓取端点。
- 指标标签只使用固定低基数枚举，禁止 workspace/user/project/task/request ID、URL、邮箱和错误正文；request/task/import/export ID 只进入受控脱敏日志用于单次链路定位。
- 已建立 `infra/deploy/staging/prometheus.yml` 与 `alerts.yml` 告警规则和阈值，覆盖服务不可用、错误率、延迟、积压、租约恢复、转存失败、配额异常和依赖连接耗尽；每条规则包含内网排查入口和恢复判据。
- 已通过 API/Worker readiness 依赖 down/up 受控故障注入验证 degraded -> ok 恢复，不向 Provider 发起请求，告警和诊断不携带用户内容或密钥。

验收：关键故障能在预定窗口内触发并自动恢复告警；仅凭 request/task ID 可定位链路类别，不需要查看用户正文或凭据。

### P7-8：备份、对象生命周期与隔离恢复演练（已完成）

- staging 已建立 24 小时 PostgreSQL 同快照指纹/custom dump、AES-256-GCM 加密、SHA-256 manifest、30 天数据库/对象保留和独立 backup Bucket；主 Bucket 启用版本、非当前版本保留和 multipart 中止，临时上传/迁移继续使用数据库 TTL 与延迟 GC，正式当前资产不自动过期。
- restore profile 强制使用 restore-only PostgreSQL、Bucket、Redis、队列和资源 ID；恢复校验密文、运行当前迁移、复制对象、重开 queued outbox，并由前后 source guard 确认原 staging 未被写入。
- 只读审计覆盖两工作区、项目当前图、version/sequence/changes、checkpoint manifest、资产 hash/引用、任务/账本、迁移状态、软删除/GC 和对象存在性；缺失对象只报告并阻断，不静默修改资产。
- 基线 RPO 为 24 小时、告警窗口为 26 小时，每次演练输出实际 `rtoSeconds`；Pushgateway/Prometheus 覆盖备份缺失和最新失败，日志/manifest/指标不包含数据库 URL、对象 key、密钥或用户正文。真实独立故障域、KMS 轮换、Alertmanager 接收端和经数据量验证的 RTO 仍由外部 staging 提供。

验收：从备份恢复的两个账号仍保持隔离且核心项目/资产/任务一致；恢复演练可重复，原 staging 在全过程保持可用且未被写入。

### P7-9：schema 发布、兼容窗口与前向修复（已完成）

- 已将 24 个迁移登记到 `server/db/migrations/release-manifest.json`，phase 按 `expand -> migrate -> contract` 单调推进；每项声明旧/新应用兼容性、锁风险、statement timeout、回滚/前向修复和备份门槛。当前没有 contract migration，0020 additive retry 列由新 API 可选读取，旧 Worker 可读取新 schema；0023 additive 用户编号列由旧应用忽略；0024 nullable additive 官网展示列由旧应用忽略，新应用在迁移后使用稳定回填值。
- `npm run db:migrate:compat` 已覆盖旧 schema + 新应用、新 schema + 旧应用、迁移事务中断回滚/重跑和连续 `schema_migrations`；Worker claim/submission/lease 窗口要求先停 Consumer，再运行恢复/前向修复，应用启动不自动迁移。
- 破坏性或不可逆变更必须以 P7-8 加密备份和隔离恢复为回滚门槛；`check-schema-release.mjs` 拒绝未登记迁移、phase 倒退、缺失兼容声明和没有备份门槛的 DROP SQL。发布/回退只使用仓库真实命令。

验收：20 个既有迁移和后续迁移可从空库及旧版本升级；模拟失败不会留下未知 schema 版本、永久锁或无法前向修复的数据。

### P7-10：staging 全链路与发布门禁（已落地门禁，待真实 staging 验证）

- 从空 staging 部署并完成迁移、账号、项目图、资产、Provider、任务 Worker、迁移导入导出、通知、维护和恢复演练；验证 Web 不依赖 Vite proxy、本地路径，且 Provider Key 不进入静态 bundle、服务端请求、日志或项目数据。P8 自定义模式中用户主动保存在浏览器加密 Vault 的 Key 不属于 bundle 泄漏。
- 新增 `scripts/staging-release-gate.mjs` 与 `npm run deploy:staging:gate`：先构建全部 production workspace，再校验 protected staging 配置、非 root/显式迁移制品、CSP/告警边界和 Web bundle 的 localhost/Vite proxy/Provider 密钥/本地路径泄漏；可选对 Web/API/Worker readiness 和只读清理审计报告执行无敏感正文的在线门禁。
- 统一执行单测、集成、两账号 E2E、安全矩阵、迁移检查、生产构建、依赖故障和备份恢复；固定发布阻断项与允许的环境性跳过条件。
- 检查 CSP/CORS/CSRF/限流/对象存储权限、指标告警、日志脱敏和资源隔离；清理测试资源后确认无孤立正式资产、永久 running、重复扣费或不可回收 staging 对象。
- P7 完成状态只在全部门禁有可复现证据后更新；未配置真实邮件、域名/TLS、备份或告警接收端时必须保持未完成，不用本地 fake 代替 staging 验收。

验收：满足本节总验收标准后才进入 P8 管理端与浏览器本地生成，任何跨租户、凭据泄漏、恢复不一致或发布不可回退问题均阻断进入 P8。

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

## P8：运营管理端与浏览器本地生成

P8 已取消官方模型、积分、计费和平台代生成路线。平台只提供账号、项目图、资产存储和管理能力；用户自己的 Provider、模型和 API Key 只保存在浏览器，生成结果通过既有资产上传与项目图 API 写入云端。

固定顺序：保留已完成管理能力 -> 清理官方/服务器生成路径 -> 浏览器 Vault -> 浏览器协议适配与结果入云 -> 本地任务恢复与双设备验收 -> 用户管理与运营闭环。

### P8-1：NAS、健康诊断与开发进程（已完成）

- PostgreSQL、Redis 和私有对象存储使用真实 readiness 检查并返回稳定脱敏错误分类。
- 统一开发进程管理只停止本仓库拥有的进程。
- Redis 后续只用于 API 安全限流，不再承载生成任务队列。

### P8-2：独立 Admin 安全底座（已完成）

- Admin Web 与 Admin API 使用独立 Origin、Cookie、Auth Secret、数据库角色和 `admin` schema。
- 管理员使用账号和密码登录；图片验证码默认关闭，可由 `super_admin` 开启。
- 固定 RBAC、CSRF、登录限流、session 撤销和不可修改脱敏审计已落地。

### P8-3：结构化网站设置（已完成）

- 网站品牌、文案、链接、主题和功能开关使用版本化结构配置。
- Logo/Favicon 通过受控直传、文件内容校验和不可变修订发布。
- 公开 Web 只读取最小发布投影，失败时使用内置安全默认值。

### P8-4：清理官方与服务器生成路径（已完成）

- 删除未提交的官方 Provider、官方模型、积分和平台任务代码、页面、契约、配置与文档。
- 停止旧服务器 BYOK 写入和任务创建；移除 Provider 密文、生成 Worker、BullMQ 队列和生成任务 API。
- 保留 Redis 服务用于 API 限流；不再恢复或备份生成队列。
- 整理 P8 迁移：`0026` 只保留网站设置，`0027`/`0028` 保留；`0029` contract migration 删除旧 Provider/任务表、函数、资产任务引用和授权，并把活动站点配置前向发布为不含旧官方模式开关的新修订。
- `0029` 可在旧对象已部分删除的开发库上幂等重跑；迁移测试覆盖隔离 schema、连续重跑、事务回滚和 release manifest 兼容边界。

验收：

- `npm run test` 285/285、`npm run lint`、`npm run build`、`npm run db:migrate:test`、`npm run db:migrate:compat`、`npm run db:roles:check` 和 `git diff --check` 通过。
- `dev:restart` 只启动 Web、API、Admin Web、Admin API；普通/Admin readiness 正常，Redis 分布式限流从未认证响应收敛到 429，Worker 健康端口和进程管理入口不存在。
- 普通与 Admin 的 Provider、官方模型、积分和服务器任务 URL 均返回 404；数据库不存在旧表、函数、任务资产引用、Worker 角色或失效环境键。
- 真实浏览器完成普通 Web 与 Admin 桌面/390px 检查；项目加载、资产上传、Admin 登录和网站设置正常，无控制台错误、横向溢出或控件重叠。

### P8-5：浏览器本地 Vault（已完成）

- Provider、endpoint、API Key、模型和绑定关系进入同一个版本化 IndexedDB Vault，按 Origin 与可信用户 ID 隔离。
- 默认使用不可导出的 WebCrypto AES-GCM Key 加密并保存到当前浏览器，不提供 persistence 或单独删除入口；清除当前网站数据会由浏览器删除密文、CryptoKey、绑定和本地任务缓存。
- 登出清空内存明文但保留按账号隔离的设备密文；同一账号再次登录可恢复，其他浏览器或设备必须重新配置。
- 旧本地配置一次性迁入 Vault，成功后删除旧明文缓存。
- 生产 endpoint 强制 HTTPS，拒绝 URL 凭据和 fragment；连接测试由浏览器直连。

验收：

- `npm run test` 286/286 通过，覆盖设备保存串行化、可信用户与内部 persistence 陈旧回写隔离、两个独立 `IDBFactory` 不隐式同步，以及两账号与 Cloud 敏感信息边界。
- `npm run lint`、`npm run build`、`npm run db:migrate`、`npm run db:migrate:test`、`npm run db:migrate:compat`、`npm run db:roles:check` 和 `git diff --check` 通过；29 个迁移与 release manifest 一致。
- `dev:restart` 只启动 Web、API、Admin Web、Admin API；真实浏览器完成桌面与 390px 登录、项目加载、资产上传和 Vault 设备保存行为验证，无控制台错误、横向溢出或控件重叠。
- IndexedDB 只保存密文和不可导出 Key；localStorage、项目图、Cloud API 请求、诊断和日志不保存或携带私有 Provider、endpoint、模型 ID 或 API Key。

### P8-6：浏览器生成与结果入云（已完成）

- 首期只支持受控的 OpenAI Compatible 与阿里 DashScope chat/image/video adapter；允许自定义 endpoint 和模型 ID，不支持任意脚本或请求模板。
- 浏览器读取 Vault 并调用第三方 Provider，平台 API 不接收 Key、endpoint、真实模型 ID 或任意 target URL。
- Base64/二进制结果转换为 Blob；结果 URL 必须允许浏览器 CORS 下载，或由用户使用自己的固定 CORS 网关。
- 媒体沿用创建上传会话、签名 URL 直传、完成确认和项目图领域写入；聊天文本通过正常图增量保存。
- 云端节点只保存匿名 `local:<uuid>` 引用，不保存真实 Provider、endpoint、模型 ID 或显示名。

验收：

- `npm run test` 296/296 通过，覆盖固定协议 adapter、Provider 私有诊断、生成资产入云、匿名模型引用、Vault 加密往返、工作区配置脱敏和双设备隔离。
- `npm run lint`、`npm run build`、`npm run db:migrate`、`npm run db:migrate:test`、`npm run db:migrate:compat`、`npm run db:roles:check` 和 `git diff --check` 通过；29 个迁移与 release manifest 一致。
- `dev:restart` 只启动 Web、API、Admin Web、Admin API；真实浏览器完成桌面与 390px 登录、项目加载、资产上传和 Vault 设备保存行为验证，无控制台错误、横向溢出或控件重叠。
- Cloud 请求契约验证不携带用户 Provider、endpoint、真实模型 ID、API Key、remote task ID 或上游错误；图片/视频结果通过私有资产上传进入当前项目，聊天文本通过图增量保存。

### P8-7：本地任务恢复与双设备绑定（已完成）

- 生成任务只保存在内存或加密 IndexedDB，不写 PostgreSQL。
- 同步任务关闭页面即中断；异步 Provider 已取得 remote task ID 时，同一设备可重新打开并继续轮询。
- 新设备缺少匿名模型引用时明确显示不可用，并允许用户手动绑定本机 Provider/模型；不得自动按名称或 ID 替换。
- 项目导入导出不携带 Provider 配置、Key 或本地任务缓存。

验收：

- `npm run test` 297/297 通过，覆盖 IndexedDB v1→v2 升级、任务密文与 Origin/用户/项目 AAD、两账号/两设备隔离、网站数据清除边界、同步任务中断、remote task 恢复、项目持久化/导出排除任务缓存和原匿名引用手动绑定。
- `npm run lint`、完整 TypeScript/Vite 构建和 `git diff --check` 通过；本阶段没有 PostgreSQL schema、数据库角色或 Cloud HTTP contract 变更，因此未重复运行数据库迁移门禁。
- 真实浏览器在同一 Cloud 项目完成“设备模型保存 → 新设备配置不同名称/ID 模型仍不自动替换 → 手动选择后绑定”流程；两个独立 `IDBFactory` 覆盖清除网站数据后的空设备边界；390px 无横向溢出或控件重叠，控制台 0 error。
- 两个独立 `IDBFactory` 验证 Vault、任务密文和不可导出 Key 不隐式同步；Cloud 图、项目持久化、checkpoint、迁移包和 API 契约均不携带任务缓存、remote task ID 或私有 Provider 配置。

### P8-8：用户管理、运营与最终安全验收

- Admin 可查询用户、验证状态、工作区和存储用量，但不读取项目正文、Prompt、资产内容或本地 Provider 配置。
- 支持带原因的封禁、解封和 session 撤销，并写不可修改脱敏审计。
- 仪表盘只展示注册、活跃、存储、认证安全和基础设施健康聚合。
- 完成全量测试、迁移/角色检查、依赖审计、两账号与双设备 E2E、桌面/390px 浏览器检查和 staging 恢复演练后进入 P9。

当前进展（未完成）：

- 用户列表、用户详情、封禁、解封、session 撤销、脱敏管理审计和最小聚合仪表盘已落地；普通 API readiness 检查 PostgreSQL、Redis 与对象存储，Admin API readiness 只检查其实际依赖的 PostgreSQL 与对象存储。
- `npm run test` 309/309（110 个测试文件）、`npm run lint`、完整构建、数据库角色 provision/check、schema release 校验、生产依赖高危审计、生产源码凭据格式扫描和 `git diff --check` 已通过；29 个迁移与 release manifest 一致，本阶段没有 schema 变更，因此未机械重复数据库迁移门禁。
- `dev:restart` 只启动 Web、API、Admin Web、Admin API；真实浏览器已完成 Admin 登录、Dashboard、用户搜索/详情、封禁后登录拒绝、解封、重新登录、session 撤销和审计记录检查，桌面与 390px 无横向溢出或控件重叠。普通用户最终保持 active，测试 session 已撤销。
- 当前缺少 `infra/deploy/staging/staging.env`，本机也没有可用 Docker CLI/daemon，无法真实执行 staging 配置门禁和隔离恢复演练；该外部验收补齐前 P8-8 保持未完成，P8-9 不启动。

## P9：生产灰度与正式上线

交付物：

- 正式域名、HTTPS、Web CDN、API、Admin、PostgreSQL、Redis、对象存储和邮件服务。
- 部署平台密钥管理和环境隔离。
- 邀请制/灰度开关、用户存储配额和紧急停写开关。
- 最小运营诊断能力。
- 用户协议、隐私政策、数据导出与账号删除流程。
- 面向中国大陆运营时的备案、内容安全和适用合规检查。
- 发布、回滚、故障公告和责任人流程。

上线门槛：

- 两个真实账号在不同浏览器完成全链路隔离验证。
- 生产域名的浏览器生成不依赖 Vite 开发代理；用户 Key 只存在当前设备 Vault，Cloud 请求不携带 Provider 配置。
- 数据库自动备份与恢复演练通过，对象存储具备误删恢复策略。
- 同设备异步任务恢复、浏览器中断处理、失败重试和结果上传幂等通过。
- 回滚应用能够读取发布前数据，不可逆迁移不与首发应用同时发布。

## P10：团队与协作（P9 后评估）

个人空间稳定运营后，再根据真实需求评估团队邀请、角色 UI、只读分享、评论、项目锁定和实时多人编辑。实时协作需要单独选择操作日志、服务端串行命令或 CRDT 协议，不在个人云空间阶段提前实现。
