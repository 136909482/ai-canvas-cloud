# AI Canvas Cloud 项目结构

本文档定义 monorepo 目录和依赖方向。目录应在对应路线阶段真正需要时创建，不保留空占位目录。

## 当前与目标目录

```text
apps/
  web/                 Vite + React 画布网站
  api/                 HTTP 入口、路由、中间件和健康检查
  worker/              持久化队列消费者与后台任务

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
    tasks/             任务状态机、任务 HTTP 领域服务与任务/尝试/命令持久化边界（P5-1/P5-3 建立）
    providers/         Provider 注册表、BYOK 加解密、配置持久化与调用边界（P5-2 建立）
  shared/              仅服务端使用的配置、日志和基础设施适配（后续按需建立）

infra/
  local/               PostgreSQL、Redis、MinIO
  deploy/              staging/production 部署定义（P7 建立）

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
```

禁止反向依赖：

- `packages/contracts` 不依赖 React、Node 文件 API、数据库客户端或服务端配置。
- `packages/project-graph` 只包含图操作、schema 和纯转换，不执行 SQL 或网络请求。
- `server/` 不 import React 组件、Zustand store 或浏览器对象。
- `apps/web` 不 import `server/`、数据库驱动、Redis 或对象存储管理 SDK。
- Provider adapter 不直接修改项目图；结果通过 tasks/project-graph 领域服务提交。

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

P1 第一批使用内存 Cloud adapter 让画布独立启动和构建；P3 已把项目元数据和关系图读写接入 Cloud API。Web 仍不访问本地目录、Electron、SQLite、File System Access API、数据库、Redis 或对象存储管理凭据。P2 匿名首页、认证门禁和认证弹层位于 `features/auth`：`PublicHome` 负责未登录产品入口和触发登录/注册，`AuthGate` 负责 session 恢复、登录/注册切换、单设备接管确认及成功后的应用切换，`AccountMenu` 和 `DeviceSettingsPanel` 负责账号入口与设备历史管理，`deviceIdentity` 只在浏览器本地维护非认证设备 ID。该目录只通过 Cloud API 调用认证、会话、设备历史、邮箱验证、忘记密码和重置密码接口，不直接访问 Better Auth 数据库表或服务端密钥。

## 服务端领域模块

`server` 作为 npm workspace package 供 `apps/api` 和 `apps/worker` 引用，但仍保持服务端专用边界，不被 `apps/web` 依赖。API 路由只解析 HTTP、Cookie 和请求 schema，再调用 `server/modules` 中的领域服务；跨表事务、凭据解密、任务状态机和授权查询不得写在路由文件里。

## API 应用

`apps/api` 保持薄入口：

- 解析 HTTP、Cookie、请求 ID 和 schema。
- 调用认证及领域服务。
- 把领域错误映射为稳定 API 错误。
- 不在路由文件中编写跨表事务。
- 不直接调用任意 Provider target URL。

业务事务集中在 `server/modules`。项目节点、连线、变更和当前节点资产引用只能通过 `server/modules/project-graph` 的同一套领域规则修改；该模块提供纯资产引用提取和 PostgreSQL 引用同步能力，但不接触对象存储凭据。检查点只能通过 `server/modules/project-snapshots` 创建、列出和恢复；该模块复用项目图资产规则生成 manifest、在 restore 事务中重建引用，并为历史 manifest 提供只读预检与逐 checkpoint 短事务修复服务。`scripts/repair-checkpoint-asset-manifests.mjs` 只编排该领域服务和输出脱敏 JSONL 审计，不另写字段扫描或资产授权规则。`server/modules/workspaces` 统一负责成员授权、用量统计和 workspace 配额锁；`server/modules/assets` 在创建上传会话的同一事务调用该能力，并集中治理上传、读取、受控对象 key 解析、缺失/孤立对象诊断与 GC。`scripts/maintain-assets.mjs` 默认只读，只编排资产维护领域服务；显式 apply 仍按单资产短事务和稳定对象 key 游标执行。P5-1 起，`server/modules/tasks` 是任务状态转换规则入口；P5-2 起，`server/modules/providers` 独占白名单、BYOK 加解密和凭据持久化，API/Worker 不得自行拼接 Provider URL 或直接读取密文字段。访问任何工作区资源前，领域模块必须先校验 session 用户的成员关系、角色和工作区状态。

P5-3 的任务 HTTP 路由只解析 session、路径、query 和 JSON，再把创建、分页、取消/重试幂等及 workspace 并发上限交给 `server/modules/tasks`；`apps/api` 不得直接写 `generation_tasks` 或 `task_commands`。Provider 配置存在性由 tasks 调用 providers 的共享锁校验，API 创建路径不解密 BYOK；实际解密和调用只属于后续 Worker 内部路径。

## Worker 应用

`apps/worker` 负责进程生命周期、队列连接、并发和优雅关闭。任务领取、租约、重试、结果转存、计量和图更新由服务端领域模块完成。Worker 不能持有前端状态，也不能用旧快照覆盖当前项目。

## 数据库与迁移

`server/db` 包含：

- schema 定义和命名约束。
- 按版本排序的显式迁移。
- 事务辅助和参数化查询。
- 集成测试数据库初始化。
- 迁移状态检查和前向修复说明。

生产应用启动不自动执行迁移。迁移由发布流程单独运行并在兼容窗口内保持新旧应用可读。

## 共享契约

`packages/contracts` 是前后端协议的唯一来源，至少包含：

- 认证会话和用户摘要。
- 工作区和项目摘要。
- 图读取与图操作批次。
- 分页游标。
- 资产上传/读取。
- 任务状态和进度。
- 稳定错误码。

运行时 schema 与 TypeScript 类型必须由同一来源派生，不能只写编译期 interface 后在服务端手工校验。

## 测试放置

- 纯函数测试与被测模块同目录。
- API/数据库/对象存储集成测试放在对应 app 或 server module。
- 浏览器 E2E 放在仓库级测试目录，并使用独立账号、工作区和对象前缀。
- 历史兼容样本统一放 `test-fixtures/`，已提交旧样本不得静默改写为当前格式。
