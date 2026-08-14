# AI Canvas Cloud 项目结构

本文档只定义 monorepo 目录职责、模块所有权和依赖方向。架构规则见 [`DEVELOPMENT.md`](DEVELOPMENT.md)，阶段状态不得写入本文件。

## 目录

```text
apps/
  web/                 Vite + React 画布、Cloud 客户端、浏览器 Vault 与本地生成
  api/                 普通用户 HTTP、安全、限流、健康检查与渐进 Fastify adapter
  admin-web/           独立 Admin React 控制台
  admin-api/           独立 Admin 认证、RBAC、运营、设置和审计 HTTP

packages/
  contracts/           HTTP 请求/响应、错误码和运行时 schema
  project-graph/       图操作、检查点与 ProjectRecord 纯转换
  shared/              前后端均可使用的纯工具、健康和指标基础

server/
  db/                  PostgreSQL 连接、迁移和 release manifest
  env/                 服务端环境读取
  modules/
    auth/              Better Auth、动态认证邮件、设备和认证错误映射
    mail/              SMTP 公网校验、TLS 传输与版本化凭据加解密
    workspaces/        成员授权、存储用量和配额
    settings/          用户在工作区内的非敏感画布偏好
    projects/          项目元数据与生命周期
    project-graph/     图增量事务、change 和当前资产引用
    project-snapshots/ checkpoint、历史、restore 和 manifest 修复
    assets/            上传、读取、动态加密 S3 配置、配额、诊断和 GC
    generation-telemetry/ 脱敏生成 attempt 校验、幂等收口与授权
    announcements/      站内通知发布生命周期、用户时间线和已读回执
    community/           公开资料、投稿、审核状态机、撤回和举报
    migrations/        目录包预检、暂存、commit 和导出
    admin/             Admin 认证、RBAC、用户运营、设置和审计

infra/
  local/               PostgreSQL、Redis、MinIO
  deploy/staging/      Compose、Nginx、监控、备份和恢复基线
  deploy/production/   宝塔入口、轻量 Compose 和生产环境变量模板

docs/                  5 份长期参考文档
scripts/               测试、迁移、进程、部署和受控维护入口
test-fixtures/          ProjectRecord、目录包和兼容样本
```

仓库没有 `apps/worker`、服务端 tasks/providers/official-credits 模块或服务器 Provider adapter。`generation-telemetry` 只接收不可执行的有限生命周期元数据；浏览器 Vault、任务缓存、受控 Provider 适配和设备模型绑定只属于 `apps/web`。

## 依赖方向

```text
apps/web -------> packages/contracts
       \--------> packages/project-graph
        \-------> packages/shared

apps/api -------> server/modules
       \--------> packages/contracts/project-graph/shared

apps/admin-web --> packages/contracts/shared
apps/admin-api --> server/modules/admin
              \-> packages/contracts/shared
```

禁止反向依赖：

- `packages/contracts` 不依赖 React、Node 文件 API、数据库客户端或服务端配置。
- `packages/project-graph` 不执行 SQL、网络请求或对象存储操作。
- `server` 不 import React、Zustand、IndexedDB、浏览器 WebCrypto 或 Web 组件。
- `apps/web` 不 import `server`、数据库驱动、Redis、对象存储管理 SDK 或 Admin 代码。
- `apps/api` 不读取 Admin 身份、登录安全或审计表。
- `apps/admin-api` 不直接修改项目图、资产、迁移或普通认证表。
- HTTP 路由不直接写数据库；授权和跨表事务由领域模块拥有。

## 所有权边界

### Web

- `src/api`：固定 Cloud HTTP 客户端，不拼接对象 key 或任意 Provider target。
- `src/platform/cloud`：项目图基线、version/sequence、diff、资产上传和签名 URL 缓存。
- `src/features/settings`：Vault、Provider/模型配置、发现、匿名模型绑定，以及 `custom-http-image-v1` Manifest 的严格校验、导入导出和显式保存；自定义 Manifest 与 Key 不得进入普通 React/Zustand 持久化之外的非加密存储。
- `src/features/public`：帮助中心、问题反馈、用户协议、隐私政策及默认站内路径解析；只读取公开站点配置，不访问认证态或服务端基础设施。
- `src/features/generateQueue`：浏览器任务动作、执行、调度、按协议能力注册的 Provider adapter、结果入云和加密快照恢复。`orchestrator.ts` 只负责创建/重试/取消等用户动作，`taskExecution.ts` 负责 Provider 执行与恢复，`taskCanvasState.ts` 负责聚合画布节点状态，`taskQueueSnapshot.ts` 负责纯快照清洗和版本兼容；执行层与动作层共同依赖状态层，不得反向依赖 React 组件。
- `src/components/TaskQueue*`：任务中心按钮、面板、任务行和无界面 Runner；组件只订阅 store 或调用生成任务公开动作，不实现 Provider 协议、缓存迁移或结果持久化。
- `src/nodes`：React Flow 节点 UI，只通过 store 和平台层访问状态。
- `src/store`：会话内客户端状态，不直接访问服务端基础设施凭据。

IndexedDB/WebCrypto 明文边界集中在 Vault 与任务快照模块。普通组件不得直接读写密文、临时结果 Blob 或 `CryptoKey`。session、用户或项目变化时，平台层统一清理不再可信的内存状态与临时资产 URL。

`src/api/image` 拥有浏览器图片 Provider 协议执行器。OpenAI Compatible 可按配置执行同步或标准异步任务，DashScope 使用内置固定协议，`custom-http-image-v1` 只解释已校验的声明式 Manifest；执行器不得接受绝对目标 URL、任意 Header、JavaScript/表达式或凭据模板变量。Provider 私密配置和远程任务状态不得穿过 Cloud 客户端边界。

### API 与领域服务

`apps/api` 和 `apps/admin-api` 保持薄入口：解析请求、校验会话/schema/安全策略、调用领域服务、映射稳定错误。`server/modules` 是事务和授权查询的唯一所有者。

`apps/api/src/routeInventory.ts` 与 `apps/admin-api/src/routeInventory.ts` 分别是公共和 Admin HTTP 方法、路径、`operationId` 与路由组的事实清单；OpenAPI 构建必须与对应 Fastify 路由双向一致。`apps/api/src/fastify` 按 `system/auth/workspaces/settings/announcements/telemetry/assets/migrations/projects` 拆分公共路由，`apps/admin-api/src/fastify` 按 `system/auth-security/dashboard-audit/users/announcements/site/smtp/object-storage/community` 拆分后台路由，其中 `system` 还承载受权限保护的单机更新状态与请求入口；两个 Fastify server factory 都独立处理未匹配请求和静态站点。`serverOptions.ts` 只描述入口依赖，`serverLifecycle.ts` 只管理 Fastify 关闭钩子。`packages/contracts/src/httpSchema.ts` 与 `packages/contracts/src/adminHttpSchema.ts` 只通过服务端子路径导出 TypeBox Schema，不进入 Contracts 根导出或 Web bundle。

- `project-graph` 独占节点、连线、change、version/sequence 和当前节点资产引用写入。
- `project-snapshots` 独占 checkpoint 与 restore。
- `assets` 独占上传确认、私有读取、配额、无引用资产扫描与 GC；普通 API 执行引用复查和对象删除。
- `migrations` 编排导入导出，但复用图、资产和 checkpoint 领域 helper。
- `announcements` 独占公告草稿/发布/下线生命周期、用户时间线查询和幂等已读回执；HTTP 路由与 React 组件不直接写公告表。
- `settings` 独占非敏感画布偏好的校验、成员授权与 `workspace_user_state.ui_state_json` 字段级合并；不得接收 Provider Vault 或客户端身份字段。
- `admin` 只能通过受限服务读取普通用户最小投影、发布加密 SMTP/站点配置并写脱敏审计；资产清理只通过内部密钥调用普通 API 并接收聚合结果，Admin 数据库角色不得读取 object key。
- `mail` 是 API 与 Admin API 共用的受控 SMTP 执行层；它不读取 HTTP 请求或数据库，主密钥只由两个服务器入口注入。

普通 API 只注册当前路由清单，不提供 Provider 代理、官方模型、积分或服务器任务路由。

`server/modules/community/` 独占公开昵称、投稿资格、帖子状态机（含作者编辑重审）、撤回和举报；`apps/api/src/fastify/routes/community.ts` 提供资料、投稿、编辑、我的投稿、撤回和举报路由。`apps/admin-api/src/fastify/routes/community.ts` 提供审核和举报处理路由。Web 在设置页个人资料分页管理用户昵称，社区投稿分页展示投稿须知和我的投稿（可编辑/撤回），并在有稳定 Cloud asset ID 的图片节点工具栏提供投稿入口。社区复用 `auth`、`workspaces` 和 `assets` 的授权与资产能力，不直接修改项目图；Admin 只读审核所需的最小社区字段，不读取 Provider Vault、项目正文或对象 key，社区列表不依赖浏览器本地生成任务。

`server/modules/admin/systemUpdateService.ts` 只负责 Admin 权限、固定 Docker Hub release 查询（或部署时固定的同源 Registry V2 查询）、受限请求文件和审计，不执行宿主机命令。`infra/deploy/single-host/install-update-service.sh` 安装 systemd path/service，`update-worker.sh` 是唯一 root 执行入口并只调用固定 `deploy.sh`。Admin 容器与宿主机只通过 `secrets/update/` 中的 UUID 请求和有限状态字段通信，Docker Socket 与任意命令参数都不进入应用容器。

### 数据库与部署

`server/db/migrations` 当前保存单一 `0001_current_schema.sql` 基线和 `release-manifest.json`。应用启动不自动迁移，发布显式运行 migrate。数据库运行角色只有普通 API 和 Admin API；正式运营后的 schema 变更只追加新迁移。

根 `Dockerfile` 构建 Web、API、Admin Web、Admin API、migrate、release、operations 和单机 `single-host-app`。后者把两个已构建前端与两个 API 放进同一镜像，运行时仍以普通应用和后台应用两个容器隔离。staging Compose 不包含 Worker、生成队列、Provider 密钥环或队列恢复。托管 production Compose 只常驻四个应用容器；`infra/deploy/single-host` 则常驻普通应用、后台应用、PostgreSQL 和 Redis，并由宿主机 systemd 按受限请求执行更新，worker 不作为容器常驻服务。单机程序镜像默认在开发电脑的 Docker Desktop 构建并发布到 Docker Hub，也可导出后由服务器加载归档；GitHub Actions 只运行质量检查。

### 账户注销与维护

`server/modules/admin/accountDeletionService.ts` 承担管理员注销事务与审计；它不放入 HTTP 路由。`server/modules/admin/accountErasureMaintenance.ts` 仅由应用数据库角色和对象存储实现调用，供 `scripts/maintain-account-erasures.mjs` 的 `db:maintain:accounts` 命令执行到期清理。Admin API 只编排预检和注销请求，不读取项目正文或对象键。

## 测试放置

- 纯函数测试与被测模块同目录，命名 `*.test.ts`。
- 真实 PostgreSQL、Redis 或对象存储测试命名 `*.integration.test.ts`。
- API/领域集成测试放在对应 app 或 server module。
- 两账号和双设备 E2E 使用独立账号、cookie/device 上下文和对象前缀。
- 浏览器 E2E 使用仓库级受控浏览器验证入口。
- 当前版本的目录包和快照样本统一放 `test-fixtures/`，不得静默改写已提交样本。

测试选择和验证层级见 [`DEVELOPMENT.md`](DEVELOPMENT.md)。
