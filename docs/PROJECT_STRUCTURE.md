# AI Canvas Cloud 项目结构

本文档定义 monorepo 目录和依赖方向。目录应在对应路线阶段真正需要时创建，不保留空占位目录。

## 当前与目标目录

```text
apps/
  web/                 Vite + React 画布网站
  api/                 HTTP 入口、路由、中间件和健康检查
  worker/              持久化队列消费者与后台任务
  admin-web/           Refine Core + 自定义 React 运营管理前端（P8-2 已建立）
  admin-api/           独立管理员认证、CSRF、MFA、RBAC 与管理 HTTP 入口（P8-2 已建立）

packages/
  contracts/           API 请求/响应、错误码和运行时 schema
  project-graph/       图 diff、操作批次、检查点与 ProjectRecord 适配
  provider-adapters/   图片、视频和 LLM Provider 协议（P5 建立）
  shared/              前后端安全共享的纯类型和工具

server/
  db/                  PostgreSQL schema、迁移、事务与查询
  modules/
    auth/              Better Auth 适配、邮件服务边界、Cloud 工作区补齐、认证错误映射（P2 建立）
    workspaces/        工作区、成员、权限、存储用量和配额授权（P2/P4 建立）
    projects/          项目元数据、列表分页、归档/恢复和软删除（P3 建立）
    project-graph/     云端图读取、节点/连线增量事务和变更日志读取（P3 建立）
    project-snapshots/ 手动/定期检查点、历史摘要/详情、restore 与历史 manifest 修复（P3/P4 建立）
    assets/            资产上传/读取、MinIO/S3 适配、配额协作、对象诊断和受控 GC（P4 建立）
    migrations/        本地/Cloud 导入导出会话、预检、归档生成、状态与事务编排（P6-2/P6-6 建立）
    tasks/             任务状态机、任务 HTTP、尝试/命令与提交防重复持久化边界（P5-1/P5-3/P5-7 建立）
    providers/         Provider 注册表、BYOK 加解密、配置持久化、执行 adapter 与幂等能力声明（P5-2/P5-6/P5-7 建立）
    admin/             Admin Better Auth、MFA、RBAC 与追加式脱敏审计；后续扩展站点/官方目录/积分/用户运营
  shared/              仅服务端使用的配置、日志和基础设施适配（后续按需建立）

infra/
  local/               PostgreSQL、Redis、MinIO
  deploy/
    staging/            Dockerfile 目标使用的 staging Compose、Web 反向代理和占位环境模板（P7-2 建立）
                        生产部署不在仓库伪造平台定义，复用同一配置门禁但必须使用独立资源和凭据

docs/                  长期架构、数据、API 和路线文档
scripts/               迁移、测试及默认只读的受控数据库维护入口
test-fixtures/          历史 ProjectRecord、目录包和 API 兼容样本
```

## 依赖方向

```text
apps/web
  -> packages/contracts
  -> packages/project-graph
  -> packages/shared

apps/api
  -> server/modules
  -> packages/contracts
  -> packages/project-graph
  -> packages/provider-adapters

apps/worker
  -> server/modules/tasks
  -> server/modules/assets
  -> server/modules/project-graph
  -> packages/provider-adapters

apps/admin-web
  -> packages/contracts
  -> packages/shared

apps/admin-api
  -> server/modules/admin
  -> server/modules/auth（只通过受控用户管理能力）
  -> packages/contracts
  -> packages/provider-adapters
```

禁止反向依赖：

- `packages/contracts` 不依赖 React、Node 文件 API、数据库客户端或服务端配置。
- `packages/project-graph` 只包含图操作、schema 和纯转换，不执行 SQL 或网络请求。
- `server/` 不 import React 组件、Zustand store 或浏览器对象。
- `apps/web` 不 import `server/`、数据库驱动、Redis 或对象存储管理 SDK。
- Provider adapter 不直接修改项目图；结果通过 tasks/project-graph 领域服务提交。
- `apps/admin-api` 不直接修改项目图、资产、任务或普通认证表；用户封禁、session 撤销、积分和官方目录操作通过对应领域服务。
- `apps/api` 不读取 Admin 认证/MFA/审计表，也不解密官方 Provider Key。

## P8 应用与权限方向

`apps/admin-web` 使用 Refine Core 组织资源、权限和数据请求，但页面组件保持仓库自定义设计。它只调用独立 `admin-api`，不复用普通用户 API Cookie，不 import 普通 Web Zustand store，也不接触数据库或 Provider 密钥。管理端不从普通网站导航暴露入口，真实安全依赖独立认证、MFA 和授权，而不是隐藏 URL。

`apps/admin-api` 负责管理员 HTTP、Cookie/CSRF、MFA 门禁、RBAC、请求 schema 和错误映射。站点设置、官方 Provider/模型、积分、用户状态和审计实现在 `server/modules/admin`；用户 session 撤销通过普通 auth 模块公开的受控管理能力，不能由路由直接 SQL。官方 Provider 连接测试只能使用已保存 revision 的固定 endpoint 和 adapter，不能接受请求体 target URL。

数据库角色至少区分 migration、普通 API、Worker 和 Admin API。普通 API 只可读取已发布站点配置、官方模型公开投影和积分所需业务表；Worker 只可读取任务绑定的官方 revision/密文并写任务领域结果；Admin API 可管理 `admin` schema 和经领域服务批准的用户/工作区字段。Admin 认证表和审计表不授予普通 API/Worker 读取权限。

`apps/web` 的 P8 客户端新增三条内部边界：generation mode 只决定模型来源和任务分流；本地 Vault 独占 IndexedDB/WebCrypto 和明文生命周期；现有 Cloud platform adapter 继续独占资产上传和图增量。组件不能自行读写 IndexedDB 密文、拼接官方 endpoint 或把本地 Key 放入 Zustand 持久化。

`apps/worker` 的 P8 官方执行不再按任务创建用户读取 `provider_credentials`。它根据任务冻结的官方 model/provider revision 读取固定 endpoint，并用独立官方密钥环短期解密当前有效 Provider secret。chat/image/video processor 都只能通过 tasks 领域服务完成状态、积分、结果资产和项目图事务。

P8 contract 清退后，`server/modules/providers` 的用户 BYOK 持久化职责删除；可复用的协议 adapter、URL 校验和结果安全能力迁入/保留在不依赖用户凭据表的服务端 Provider 边界。浏览器自定义 adapter 留在 Web 客户端，服务端不得为其新增任意 URL 代理。

## Web 应用

`apps/web` 复用本地 AI Canvas 的稳定画布体验，但只做一次性基线迁移，之后独立演进。建议内部边界：

```text
src/
  app/                  路由、会话门禁和应用组合
  components/           应用级 UI
  features/             项目、资产、任务和设置编排
  nodes/                React Flow 节点 UI
  platform/cloud/       Cloud API 与画布快照适配
  store/                Zustand 客户端状态
  styles/               主题与全局样式
```

`platform/cloud` 维护图基线、版本、sequence、ID 级 diff 和私有资产生命周期。Cloud 私有资产写入由平台层编排上传会话、无 Cookie 对象存储直传和完成确认，读取使用 `cloud-assets/<asset-id>` 客户端定位符并按过期时间缓存/刷新签名 URL；session 或工作区变化时统一清理。组件和 store 不感知 object key、PostgreSQL 表或对象存储凭据。

P6-8 的浏览器迁移边界由 `api/migrations.ts`、`store/useMigrationStore.ts` 和 `components/MigrationCenterDialog.tsx` 组成。API 模块封装固定 prepare/status/upload/commit/export 路径及 ZIP 条目读取；store 只保存服务端摘要、当前会话包数据和可恢复操作 ID；组件负责显式选择、统计、进度、冲突确认、轮询和短期下载。它们不得复用资产、推导 workspace、拼接对象 key、持久化签名 URL，或把通知摘要当作迁移事实来源。

P1 第一批使用内存 Cloud adapter 让画布独立启动和构建；P3 已把项目元数据和关系图读写接入 Cloud API。Web 仍不访问本地目录、Electron、SQLite、File System Access API、数据库、Redis 或对象存储管理凭据。P2 匿名首页、认证门禁和认证弹层位于 `features/auth`：`PublicHome` 负责未登录产品入口和触发登录/注册，`AuthGate` 负责 session 恢复、登录/注册切换、单设备接管确认及成功后的应用切换，`AccountMenu` 和 `DeviceSettingsPanel` 负责账号入口与设备历史管理，`deviceIdentity` 只在浏览器本地维护非认证设备 ID。该目录只通过 Cloud API 调用认证、会话、设备历史、邮箱验证、忘记密码和重置密码接口，不直接访问 Better Auth 数据库表或服务端密钥。

## 服务端领域模块

`server` 作为 npm workspace package 供 `apps/api` 和 `apps/worker` 引用，但仍保持服务端专用边界，不被 `apps/web` 依赖。API 路由只解析 HTTP、Cookie 和请求 schema，再调用 `server/modules` 中的领域服务；跨表事务、凭据解密、任务状态机和授权查询不得写在路由文件里。

P7-2/P7-4 的部署制品边界由根 `Dockerfile` 管理：`api`、`worker` 和 `migrate` 目标只包含各自 dist、生产依赖和必要迁移脚本，运行用户为非 root；`web` 目标只包含 Vite 静态产物和不含密钥的 Nginx CSP/CORS 代理模板。`infra/deploy/staging/docker-compose.yml` 通过独立服务、Bucket、队列名、邮件/Provider/BYOK 资源标识和命名卷表达 staging 隔离；迁移服务必须显式以 `release` profile 执行，应用启动不自动迁移。`S3_ENDPOINT` 只供服务端管理和 readiness，`S3_PUBLIC_ENDPOINT` 只供签名 URL，Web 只收到不含密钥的 `S3_PUBLIC_ORIGIN`。

P7-8 的 `operations` 镜像和 `scripts/create-staging-backup.mjs`、`restore-staging-backup.mjs`、`audit-restored-state.mjs` 只用于备份与 restore profile，不进入 API/Web bundle。备份 scheduler 读取源 PostgreSQL/S3 和独立 backup storage，但 restore 容器只读取加密 backup、backup Bucket 和 restore-only PostgreSQL/S3 标识；`source-guard` 是唯一读取源数据库的演练服务，且只运行只读聚合指纹。Redis 恢复不复制源 AOF，而是在独立空 Redis 前先从恢复库重开 queued outbox。恢复审计只能报告一致性和缺失对象，不能修改项目、资产、任务或 GC 状态。

## API 应用

`apps/api` 保持薄入口：

- 解析 HTTP、Cookie、请求 ID 和 schema。
- 调用认证及领域服务。
- 把领域错误映射为稳定 API 错误。
- 不在路由文件中编写跨表事务。
- 不直接调用任意 Provider target URL。

P7-1/P7-3/P7-4/P7-5/P7-6 的 `apps/api/src/security.ts` 是 HTTP 来源、Cookie CSRF 与 API 响应头边界，`apps/api/src/server.ts` 统一承担严格 JSON 解析、结构上限和固定路由组日志；`apps/api/src/cloudE2E.integration.test.ts` 是随机 schema/账号/cookie/device 的 Cloud HTTP 双账号 harness，`server/modules/workspaces/authorization.integration.test.ts` 固化真实 PostgreSQL 角色矩阵；`infra/deploy/staging/web.nginx.conf` 是 Web HTML/静态资源的页面 CSP、缓存和 API 代理边界。`packages/shared` 提供重复 JSON 键检测和结构化日志递归脱敏，`server/securityRegression.test.ts` 使用完全受控的 URL、路径、ZIP/MIME 和编码 fixture 固定攻击矩阵。Provider/对象存储网络调用仍由 `server/modules` 的 allowlist、redirect error、字节/MIME/magic 边界负责；React/store 不接触 Redis、对象存储管理凭据或这些服务端校验器。

业务事务集中在 `server/modules`。项目节点、连线、变更和当前节点资产引用只能通过 `server/modules/project-graph` 的同一套领域规则修改；该模块提供纯资产引用提取和 PostgreSQL 引用同步能力，但不接触对象存储凭据。检查点只能通过 `server/modules/project-snapshots` 创建、列出和恢复；该模块复用项目图资产规则生成 manifest、在 restore 事务中重建引用，并为历史 manifest 提供只读预检与逐 checkpoint 短事务修复服务。`scripts/repair-checkpoint-asset-manifests.mjs` 只编排该领域服务和输出脱敏 JSONL 审计，不另写字段扫描或资产授权规则。`server/modules/workspaces` 统一负责成员授权、用量统计和 workspace 配额锁；`server/modules/assets` 在创建上传会话的同一事务调用该能力，并集中治理上传、读取、受控对象 key 解析、缺失/孤立对象诊断与 GC。`scripts/maintain-assets.mjs` 默认只读，只编排资产维护领域服务；显式 apply 仍按单资产短事务和稳定对象 key 游标执行。P5-1 起，`server/modules/tasks` 是任务状态转换、attempt submission fencing 和 P5-8 结果资产/账本/worker 图事务的唯一入口；其 `resultTransfer` 只接受 providers 注册表批准的结果 URL，并将已验证媒体交给 `assets` 的私有对象存储适配器。P5-2 起，`server/modules/providers` 独占白名单、BYOK 加解密、凭据持久化和幂等提交能力声明，API/Worker 不得自行拼接 Provider URL、直接读取密文字段或自行判断重放安全性。访问任何工作区资源前，领域模块必须先校验 session 用户的成员关系、角色和工作区状态。

P5-3 的任务 HTTP 路由只解析 session、路径、query 和 JSON，再把创建、分页、取消/重试幂等及 workspace 并发上限交给 `server/modules/tasks`；`apps/api` 不得直接写 `generation_tasks` 或 `task_commands`。Provider 配置存在性由 tasks 调用 providers 的共享锁校验，API 创建路径不解密 BYOK；实际解密和调用只属于后续 Worker 内部路径。

P6-2 起，`server/modules/migrations` 是导入预检、暂存上传和 commit 状态的唯一入口。API 只传入 session 解析出的 actor、原始包元数据、logical asset 路径和显式 copy/replace 版本确认；该模块复用 contracts 纯校验、workspace 授权、对象存储适配器和存储用量边界，在短事务中处理幂等、配额、项目冲突、multipart 分片恢复、资产 UUID 映射和状态恢复。prepare 只能写 `migration_imports`，资产上传只能写 `migration_import_asset_uploads` 与 staging 对象；commit 通过 project-graph、assets 和 project-snapshots 的事务 helper 写正式项目图、资产、引用、change 和可选 checkpoint。P6-5 的 copy 图实体映射由 migrations 编排并同时传给当前图与 checkpoint，completed 资产哈希复用查询归 assets 模块所有且必须带 `workspace_id`；API、React 和 store 不得自行复用资产或推导租户。
P6-2 起，`server/modules/migrations` 是导入预检、暂存上传、commit 和导出状态的唯一入口。API 只传入 session 解析出的 actor、原始包元数据、logical asset 路径、显式 copy/replace 版本确认或导出 expected version/sequence；该模块复用 contracts 纯校验、workspace 授权、对象存储适配器和存储用量边界，在短事务中处理幂等、配额、项目冲突、multipart 分片恢复、资产 UUID 映射、归档生成和状态恢复。prepare 只能写 `migration_imports` 或 `migration_exports` 的冻结 payload，资产上传只能写 `migration_import_asset_uploads` 与 staging 对象；commit 通过 project-graph、assets 和 project-snapshots 的事务 helper 写正式项目图、资产、引用、change 和可选 checkpoint。P6-5 的 copy 图实体映射由 migrations 编排并同时传给当前图与 checkpoint，completed 资产哈希复用查询归 assets 模块所有且必须带 `workspace_id`；P6-6 导出生成器只读取冻结 payload 并通过对象存储写私有归档，API、React 和 store 不得自行复用资产、拼装归档或推导租户。

## Worker 应用

`apps/worker` 负责进程生命周期、BullMQ 连接、dispatcher、Consumer 适配、并发和优雅关闭。同步图片 processor 根据任务的 `created_by_user_id` 和 `provider_id` 读取任务发起人自己的 Provider 凭据与协议类型，并只在该 Provider 已保存的公开 HTTPS base URL 下调用 OpenAI Compatible 固定端点；任务参数不能提交或覆盖 URL。既有 `aliyun_dashscope` 异步图片/视频路径继续持久化远端 ID并使用固定 task query endpoint。结果转存、计量和图更新只能通过服务端领域模块完成；Worker 不能持有前端状态，也不能用旧快照覆盖当前项目。

P5-10 的 `apps/web/src/api/generationTasks.ts` 是浏览器任务 HTTP 边界；`TaskQueueRunner` 与 `TaskQueueButton` 只处理服务端任务投影。`apps/web/src/api/providerSettings.ts`、`useCloudProviderStore` 与 `CloudProviderSettingsPanel` 管理当前账号自定义服务商的脱敏列表和一次性密钥输入。模型管理只维护模型和 Cloud Provider ID 绑定，不新增、删除或编辑服务商，也不把 URL/Key 写入工作区模型配置。`platform/cloud/cloudPlatform.ts` 仍只通过标准 asset ID 恢复私有媒体。

Cloud Web 不提供 workspace 选择器、切换器或个人 workspace 名称展示。`ProjectBootstrap` 和 `cloudPlatform` 仍从可信 session/API 恢复默认 workspace ID，用于项目、资产、任务和配额请求；这是平台适配层内部状态，不进入普通账号的信息架构。账号菜单直接展示用户身份，空状态直接创建项目，存储页只展示容量与项目用量。

## 数据库与迁移

`server/db` 包含：

- schema 定义和命名约束。
- 按版本排序的显式迁移。
- 事务辅助和参数化查询。
- 集成测试数据库初始化。
- 迁移状态检查和前向修复说明。

生产应用启动不自动执行迁移。迁移由发布流程单独运行并在兼容窗口内保持新旧应用可读。

`server/db/migrations/release-manifest.json` 和 `scripts/check-schema-release.mjs` 维护迁移发布 phase、旧/新应用兼容性、锁风险、timeout、回滚/前向修复和备份门槛；`scripts/schema-release.test.mjs` 使用随机 PostgreSQL schema 验证旧 schema + 新应用、新 schema + 旧应用和中断重跑。当前不存在 contract migration，删除/收缩字段必须经过独立备份与发布窗口。

## 共享契约

`packages/contracts` 是前后端协议的唯一来源，至少包含：

- 认证会话和用户摘要。
- 工作区和项目摘要。
- 图读取与图操作批次。
- 分页游标。
- 资产上传/读取。
- 任务状态和进度。
- 稳定错误码。
- P6 单项目目录包 manifest、ProjectRecord、关系图、资产清单和 checkpoint 契约。

`packages/contracts/src/migrationPackage.ts` 是 P6-1 的无副作用边界：它只定义版本化目录包类型、规范 JSON/UTF-8/ISO UTC 规则、归档条目安全限额和跨文件纯校验，不依赖 Node 文件 API、解压库、数据库、对象存储或浏览器。归档读取器必须先提供路径、压缩/解压大小、条目类型和可选 SHA-256 元数据；后续 API/Worker 只能在该校验通过后进入上传或事务流程。目录包首发只允许一个项目，工作区多项目包留待后续切片。

运行时 schema 与 TypeScript 类型必须由同一来源派生，不能只写编译期 interface 后在服务端手工校验。

## 测试放置

- 纯函数测试与被测模块同目录。
- API/数据库/对象存储集成测试放在对应 app 或 server module。
- 浏览器 E2E 放在仓库级测试目录，并使用独立账号、工作区和对象前缀。
- 历史兼容样本统一放 `test-fixtures/`，已提交旧样本不得静默改写为当前格式。

P5-11 的 `generation_task_events` 由数据库触发器与 `server/modules/tasks` 的 `listEvents` 负责持久化和授权读取；`apps/web/src/api/generationTasks.ts` 只消费固定轮询路径，`TaskQueueRunner` 按项目维护游标并把终态事件交给 `useNotificationStore` 的事件 ID 幂等入口。事件不是任务状态、资产或项目图的替代事实来源，SSE 尚未接入。

`packages/shared/src/metrics.ts` 是 API 与 Worker 共用的进程内指标实现，registry 对 label 名称和值执行低基数/脱敏门禁；`apps/api` 通过 `/metrics` 暴露请求、错误、认证/限流、冲突、配额、迁移、依赖和任务 gauge，`apps/worker/src/observability.ts` 通过内网 `/metrics` 暴露 outbox、Consumer、lease、Provider 和结果转存指标，并提供依赖 readiness。`infra/deploy/staging/prometheus.yml` 与 `alerts.yml` 是厂商无关抓取/告警基线。指标不改变领域事务，也不携带租户、任务、对象存储或 Provider 敏感字段。
