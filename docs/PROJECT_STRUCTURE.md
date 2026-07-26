# AI Canvas Cloud 项目结构

本文档只定义 monorepo 目录职责、模块所有权和依赖方向。架构规则见 [`DEVELOPMENT.md`](DEVELOPMENT.md)，阶段状态不得写入本文件。

## 目录

```text
apps/
  web/                 Vite + React 画布、Cloud 客户端、浏览器 Vault 与本地生成
  api/                 普通用户 HTTP、安全、限流和健康检查
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
    projects/          项目元数据与生命周期
    project-graph/     图增量事务、change 和当前资产引用
    project-snapshots/ checkpoint、历史、restore 和 manifest 修复
    assets/            上传、读取、S3、配额、诊断和 GC
    generation-telemetry/ 脱敏生成 attempt 校验、幂等收口与授权
    migrations/        目录包预检、暂存、commit 和导出
    admin/             Admin 认证、RBAC、用户运营、设置和审计

infra/
  local/               PostgreSQL、Redis、MinIO
  deploy/staging/      Compose、Nginx、监控、备份和恢复基线

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
- `src/features/settings`：Vault、Provider/模型配置、发现和匿名模型绑定。
- `src/features/generateQueue`：浏览器任务动作、执行、调度、Provider adapter、结果入云和加密快照恢复。`orchestrator.ts` 只负责创建/重试/取消等用户动作，`taskExecution.ts` 负责 Provider 执行与恢复，`taskCanvasState.ts` 负责聚合画布节点状态，`taskQueueSnapshot.ts` 负责纯快照清洗和版本兼容；执行层与动作层共同依赖状态层，不得反向依赖 React 组件。
- `src/components/TaskQueue*`：任务中心按钮、面板、任务行和无界面 Runner；组件只订阅 store 或调用生成任务公开动作，不实现 Provider 协议、缓存迁移或结果持久化。
- `src/nodes`：React Flow 节点 UI，只通过 store 和平台层访问状态。
- `src/store`：会话内客户端状态，不直接访问服务端基础设施凭据。

IndexedDB/WebCrypto 明文边界集中在 Vault 与任务快照模块。普通组件不得直接读写密文、临时结果 Blob 或 `CryptoKey`。session、用户或项目变化时，平台层统一清理不再可信的内存状态与临时资产 URL。

### API 与领域服务

`apps/api` 和 `apps/admin-api` 保持薄入口：解析请求、校验会话/schema/安全策略、调用领域服务、映射稳定错误。`server/modules` 是事务和授权查询的唯一所有者。

- `project-graph` 独占节点、连线、change、version/sequence 和当前节点资产引用写入。
- `project-snapshots` 独占 checkpoint 与 restore。
- `assets` 独占上传确认、私有读取、配额与 GC。
- `migrations` 编排导入导出，但复用图、资产和 checkpoint 领域 helper。
- `admin` 只能通过受限服务读取普通用户最小投影、发布加密 SMTP/站点配置并写脱敏审计。
- `mail` 是 API 与 Admin API 共用的受控 SMTP 执行层；它不读取 HTTP 请求或数据库，主密钥只由两个服务器入口注入。

普通 API 没有 Provider、官方模型、积分或服务器任务路由；历史 URL 保持 404。

### 数据库与部署

`server/db/migrations` 保存有序 SQL 和 `release-manifest.json`。应用启动不自动迁移，发布显式运行 migrate。数据库运行角色只有普通 API 和 Admin API；旧 Worker 角色只允许出现在清理与兼容测试中。

根 `Dockerfile` 构建 Web、API、Admin Web、Admin API、migrate 和 operations。staging Compose 不包含 Worker、生成队列、Provider 密钥环或队列恢复。

## 测试放置

- 纯函数测试与被测模块同目录，命名 `*.test.ts`。
- 真实 PostgreSQL、Redis 或对象存储测试命名 `*.integration.test.ts`。
- API/领域集成测试放在对应 app 或 server module。
- 两账号和双设备 E2E 使用独立账号、cookie/device 上下文和对象前缀。
- 浏览器 E2E 使用仓库级受控浏览器验证入口。
- 历史兼容样本统一放 `test-fixtures/`，不得静默改写已提交样本。
- 迁移测试可构造旧 Worker/Provider schema，但必须断言 contract 后对象已删除。

测试选择和验证层级见 [`DEVELOPMENT.md`](DEVELOPMENT.md)。
