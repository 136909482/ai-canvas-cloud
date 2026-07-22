# AI Canvas Cloud 项目结构

本文档定义当前 monorepo 目录职责和依赖方向。目录只在真实需要时存在，不保留空占位。

## 当前目录

```text
apps/
  web/                 Vite + React 画布网站
  api/                 普通用户 HTTP、限流、安全边界和健康检查
  admin-web/           独立 Admin React 前端
  admin-api/           独立 Admin 认证、RBAC、网站设置和审计 HTTP

packages/
  contracts/           API 请求/响应、错误码和运行时 schema
  project-graph/       图操作、检查点与 ProjectRecord 纯转换
  shared/              前后端安全共享的纯工具、健康和指标基础

server/
  db/                  PostgreSQL 连接、迁移和 release manifest
  env/                 服务端环境文件读取
  modules/
    auth/              Better Auth、邮件、Cloud 工作区补齐和认证错误映射
    workspaces/        成员授权、存储用量和配额
    projects/          项目元数据、分页、归档/恢复和软删除
    project-graph/     图读取、增量事务、change 与资产引用同步
    project-snapshots/ 检查点、历史、restore 和 manifest 修复
    assets/            上传/读取、S3 适配、配额、对象诊断和 GC
    migrations/        目录包预检、暂存上传、commit、导出和恢复
    admin/             Admin 认证、验证码、RBAC、网站设置与脱敏审计

infra/
  local/               PostgreSQL、Redis、MinIO
  deploy/staging/      Compose、Web 反向代理、环境模板、监控与恢复基线

docs/                  长期架构、数据、API 和路线文档
scripts/               迁移、测试、部署门禁、备份恢复和受控维护入口
test-fixtures/          历史 ProjectRecord、目录包和兼容样本
```

仓库不存在 `apps/worker`、服务端 tasks/providers/official-credits 模块或服务器 Provider adapter package。浏览器 Provider/Vault 草稿只位于 `apps/web` 内，P8-5 完成前不暴露空壳 UI。

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
  -> packages/shared

apps/admin-web
  -> packages/contracts
  -> packages/shared

apps/admin-api
  -> server/modules/admin
  -> packages/contracts
  -> packages/shared
```

禁止反向依赖：

- `packages/contracts` 不依赖 React、Node 文件 API、数据库客户端或服务端配置。
- `packages/project-graph` 只包含图操作、schema 和纯转换，不执行 SQL 或网络请求。
- `server/` 不 import React、Zustand、IndexedDB、WebCrypto 浏览器对象或 Web 组件。
- `apps/web` 不 import `server/`、数据库驱动、Redis、对象存储管理 SDK 或 Admin 代码。
- `apps/api` 不读取 Admin 身份、登录安全或审计表。
- `apps/admin-api` 不直接修改项目图、资产、迁移或普通认证表。
- API 路由不得直接写数据库；跨表事务与授权查询必须由领域服务拥有。
- 平台 API 不接收 Provider Key、endpoint、真实模型 ID 或任意 target URL。

## Web 应用

`apps/web` 复用稳定画布体验，但只通过 Cloud 平台适配层访问持久化：

```text
src/
  api/                  固定 Cloud HTTP 客户端
  components/           应用级 UI
  features/             认证、迁移、生成草稿等编排
  nodes/                React Flow 节点 UI
  platform/cloud/       项目图与私有资产生命周期
  store/                Zustand 客户端状态
```

`platform/cloud` 维护图基线、version/sequence、ID 级 diff 和资产上传/签名 URL 缓存。组件和 store 不感知 object key、数据库表或对象存储凭据。session、账号或 workspace 变化时，平台层统一清理项目、画布、临时资产 URL 和会话内任务状态。

目录包迁移边界由 `api/migrations.ts`、`store/useMigrationStore.ts` 和 `components/MigrationCenterDialog.tsx` 组成。API 模块只调用固定路径；store 只保存服务端摘要和会话内包数据；组件负责显式选择、统计、上传、冲突确认和下载。它们不能推导租户、拼接 object key、持久化签名 URL 或把通知当作迁移事实。

P8-5 相关草稿边界位于 `features/settings/localVault.ts`、`providerEndpoint.ts`、`features/security/secretRedaction.ts` 和本地任务 store。Vault 模块独占 IndexedDB/WebCrypto 和明文生命周期；普通组件不能直接读写密文，也不能把 Key 放入 Zustand/localStorage/项目图。当前没有对外 Provider 设置入口，不能把草稿描述为已完成 Vault。

## 普通 API

`apps/api` 保持薄入口：

- 解析方法、路径、Cookie、Origin、request ID 和 JSON schema。
- 调用认证、限流和领域服务。
- 把领域错误映射为稳定 API 错误。
- 不编写跨表事务。
- 不调用 Provider 或任意公网 target URL。

`apps/api/src/security.ts` 负责 CORS、Cookie CSRF、安全响应头和来源边界；`server.ts` 负责严格 JSON、结构上限、固定路由组、日志和 HTTP 路由组合；`rateLimit.ts` 负责 Redis 原子窗口。Redis 只由普通 API 限流/readiness 使用，不进入项目、资产或迁移领域事务。

业务事务集中在 `server/modules`：

- `projects` 只处理项目元数据和生命周期。
- `project-graph` 是节点、连线、change、version/sequence 和当前节点资产引用的唯一写入口。
- `project-snapshots` 是 checkpoint 创建、读取、restore 和历史 manifest 修复的唯一入口。
- `assets` 集中处理上传会话、completed 校验、私有读取、配额和 GC。
- `migrations` 编排导入预检、暂存上传、commit 和导出，图/资产/checkpoint 写入仍调用对应领域 helper。
- `workspaces` 统一处理成员授权和配额锁。

普通 API 没有生成任务、Provider 设置、官方模型或积分路由。相关历史 URL 必须在路由分发前后稳定落到 404 测试，不得新增兼容空响应。

## Admin 应用

`apps/admin-web` 只调用独立 `admin-api`，不复用普通用户 Cookie、普通 Web Zustand store 或 Cloud Provider 草稿。Refine Core 只组织资源和权限，页面使用仓库自定义组件。普通网站不导航到 Admin；安全依赖独立认证、Origin、CSRF、可选验证码和 RBAC，而不是隐藏 URL。

`apps/admin-api` 负责管理员 HTTP、独立 Cookie/CSRF、验证码、RBAC、请求 schema 和错误映射。管理员认证、账号/密码修改、session 撤销由 `postgresAdminService.ts` 统一负责；网站设置和品牌资产由 `siteConfigService.ts` 负责。路由不能直接更新 Admin 身份表、密码哈希、站点修订或公开投影。

P8-2 与 P8-3 保留的 Admin 资源只有认证/安全、网站设置、网站资产和脱敏审计。官方 Provider、官方模型、积分和服务器任务管理页面、contracts、API 与领域模块均不存在；对应 URL 返回 404。

## 数据库与迁移

`server/db` 包含 PostgreSQL 连接、29 个有序迁移和 `release-manifest.json`。生产应用启动不自动迁移，发布流程显式运行 migrate。

`0029_remove_server_generation.sql` 是高风险 contract：删除旧生成任务/队列/用量、用户 Provider 密文、官方目录/积分和任务资产引用，不修改认证、工作区、项目图、检查点、普通资产、迁移或站点设置。`scripts/check-migrations.mjs` 可以在升级 fixture 中创建旧表以验证 contract 删除；这些引用是迁移历史测试，不是运行时模块。

数据库运行角色只有普通 API 和 Admin API。`scripts/provision-database-roles.mjs` 还会识别并删除旧 Worker 角色及旧环境键；`check-admin-role-isolation.mjs` 断言旧角色/表不存在。这些负向清理字符串可以保留，不得重新成为配置入口。

## 部署与运维

根 `Dockerfile` 只构建 `web`、`api`、`admin-web`、`admin-api`、一次性 `migrate` 和 `operations` 目标。所有应用目标非 root，镜像不复制 `.env`、测试 fixture、开发 seed、源码凭据或运行时密钥。

`infra/deploy/staging/docker-compose.yml` 只包含四项常驻应用以及 PostgreSQL、Redis、MinIO、迁移、备份/恢复和监控辅助服务。不存在 Worker 服务、Worker health、生成队列、Provider 密钥环或队列恢复。`S3_ENDPOINT` 供服务端管理/readiness，`S3_PUBLIC_ENDPOINT` 供浏览器签名 URL，Web 只接收无密钥的 `S3_PUBLIC_ORIGIN`。

`scripts/create-staging-backup.mjs`、`restore-staging-backup.mjs` 和 `audit-restored-state.mjs` 只用于备份与 restore profile，不进入 API/Web bundle。恢复 Redis 为空且只供 API 限流/readiness，不复制源 AOF 或重开生成 outbox。恢复审计只能报告一致性和缺失对象，不能修改项目、资产或 GC 状态。

`scripts/dev-process.mjs` 只启动和展示 Web、API、Admin Web、Admin API。停止/重启逻辑保留旧版受管 Worker 名称，只用于 P8-4 升级清理，并继续执行 PID、Node 可执行文件、工作目录、管理脚本和随机所有权标记核验。

## 测试放置

- 纯函数测试与被测模块同目录。
- API/数据库/对象存储集成测试放在对应 app 或 server module。
- 两账号 Cloud E2E 使用随机 schema、账号、cookie/device 上下文和对象前缀。
- 浏览器 E2E 放在仓库级测试目录或受控浏览器验证入口。
- 历史兼容样本统一放 `test-fixtures/`，已提交样本不得静默改写。
- 迁移测试可以引用旧 Worker/Provider/任务 schema，但最终必须断言 0029 contract 后全部删除。

`packages/shared/src/metrics.ts` 提供低基数指标 registry。普通 API 指标不包含任务 backlog、Worker lease、Provider 请求或转存失败；Prometheus 和告警只引用当前服务与当前指标。
