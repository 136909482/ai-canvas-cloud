# AGENTS.md

本文档为在 AI Canvas Cloud 仓库工作的自动化开发协作者提供约束。

默认使用中文回复用户，每次回复称呼用户为“琨哥”，除非用户明确要求其他语言。

## 仓库定位

本仓库是 AI Canvas 的独立账号网站端，面向长期运营。它不承载 Electron、本地 File System Access API 或本地 SQLite 工作区实现。

本地 Web/Electron 产品位于 `136909482/ai-canvas`。两仓库通过版本化 `ProjectRecord` 和目录包迁移，不直接共享数据库，不隐式上传本地文件，也不让 Cloud 运行时依赖另一个仓库的源码路径。

长期文档入口：

- `README.md`
- `docs/DEVELOPMENT.md`
- `docs/PROJECT_STRUCTURE.md`
- `docs/DATA_MODEL.md`
- `docs/API.md`
- `docs/ROADMAP.md`

不要创建完成态计划、单次复盘或重复架构文档。需要长期保留的结论写回上述入口。

## 核心技术决策

- 数据库使用 PostgreSQL。
- 当前项目图以 `projects`、`project_nodes`、`project_edges`、`generation_tasks`、`assets` 和引用表为事实来源。
- 节点共有字段关系化，节点类型专属配置和低频展示属性使用 JSONB。
- 自动保存提交节点/连线增量操作；`project_changes` 保存有序变更。
- `project_snapshots` 保存手动或定期检查点，不接受每次拖拽的整份项目写入。
- 图片和视频保存在 OSS/S3 兼容私有对象存储，PostgreSQL 不保存媒体 blob。
- Redis 持久化队列和独立 Worker 执行模型任务。
- 新建实体使用 UUID/ULID 等跨设备唯一 ID。

## 边界规则

- React 组件和 Zustand store 不得直接访问 PostgreSQL、Redis、对象存储管理凭据或 Provider 密钥。
- 前端只能通过 Cloud API 和客户端平台适配层访问持久化能力。
- API 路由与 Worker 不得绕过项目图领域模块直接修改节点、连线、变更日志或资产引用。
- 所有资源访问从可信会话解析用户，再以 `workspace_id` 和成员关系授权；不得相信客户端提交的 `user_id`。
- Provider 代理只允许配置的协议、主机和端点，不得提供任意 target URL 公网代理。
- 密码、会话 token、重置 token、API Key 和对象存储密钥不得写入日志、诊断、前端 bundle 或 Git。
- 本地目录包导入必须先预检、迁移和校验，再事务化拆分；登录本身不得触发本地数据上传。

## 数据一致性

- 图操作批次必须携带 `baseVersion` 和幂等键，在单个数据库事务中更新当前图、项目版本、`project_changes` 和资产引用。
- 版本不一致返回稳定的 `409 PROJECT_VERSION_CONFLICT`，首发不自动合并。
- Worker 完成任务只更新任务、结果资产和必要节点，通过幂等变更进入项目图，不得用过期快照覆盖当前项目。
- 完整检查点通过恢复校验后才能裁剪更早操作日志。
- 删除项目和资产采用软删除与延迟 GC；仍被当前状态或保留检查点引用的资产不得删除。

## 工程与验证

在脚手架落地前，不得在文档中声明不存在的 npm 命令。每增加一个真实命令，必须同步更新 README 和开发指南。

当前真实命令：

- `npm run dev:web`
- `npm run dev:api`
- `npm run dev:worker`
- `npm run test`
- `npm run lint`
- `npm run db:migrate`
- `npm run db:migrate:test`
- `npm run build`

代码落地后，常规改动至少验证：

- 相关单元测试
- Lint
- TypeScript 构建
- 数据库迁移测试

认证、权限、项目图、资产或任务改动还必须运行相应集成测试和两账号隔离 E2E。数据库 schema 变更必须包含显式迁移、升级测试和回滚/前向修复说明。

## 文档维护

- 路线状态只在 `docs/ROADMAP.md` 维护。
- 当前架构不变量写入 `docs/DEVELOPMENT.md`。
- 表、约束和事务语义写入 `docs/DATA_MODEL.md`。
- HTTP 请求/响应和错误码写入 `docs/API.md`。
- 目录职责和依赖方向写入 `docs/PROJECT_STRUCTURE.md`。
- 实现与文档不一致时，修正实现或同步更新长期文档，不保留两套相互冲突的事实。
