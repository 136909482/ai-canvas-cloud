# AI Canvas Cloud

AI Canvas Cloud 是 AI Canvas 的独立网站端仓库，面向长期运营的账号制 SaaS。用户登录后进入个人空间，项目图、任务和资产元数据保存在云端，图片与视频存入私有对象存储。

当前处于 P1 工程骨架阶段。仓库已经建立 npm workspaces monorepo，包含迁移后的 React/Vite 画布前端、API/Worker 进程骨架、共享 packages、本地云依赖配置和基础迁移检查。实现顺序以 `docs/ROADMAP.md` 为准。

## 核心架构

- PostgreSQL 保存用户、工作区、项目、节点、连线、增量变更、检查点、任务和资产引用。
- 节点共有字段关系化，节点类型专属配置使用 JSONB。
- 日常自动保存提交节点/连线增量操作，不重写整份项目 JSON。
- `project_changes` 保存有序变更，`project_snapshots` 保存手动或定期完整检查点。
- OSS/S3 兼容私有对象存储保存图片、视频、缩略图和预览图。
- Redis 持久化队列和独立 Worker 执行图片、视频与 LLM 任务。
- 完整 `ProjectRecord` 只作为检查点、恢复及与本地 AI Canvas 的导入导出契约。

## 仓库边界

本仓库独立于本地 Web/Electron 项目 `136909482/ai-canvas`：

- `ai-canvas` 继续维护本地目录、Electron SQLite 和桌面交付。
- `ai-canvas-cloud` 负责账号、个人空间、多设备访问、云端图持久化、对象存储和服务端任务。
- 两端通过版本化 `ProjectRecord` 与目录包迁移数据，不共享运行时数据库或隐式同步本地文件。

## 长期文档

- `docs/DEVELOPMENT.md`：架构边界、安全约束和开发规则。
- `docs/PROJECT_STRUCTURE.md`：计划中的 monorepo 目录和依赖方向。
- `docs/DATA_MODEL.md`：PostgreSQL 混合图模型与事务不变量。
- `docs/API.md`：认证、项目图、资产、任务和迁移 API 契约。
- `docs/ROADMAP.md`：分阶段实现顺序和验收门槛。

## 本地开发

安装依赖：

```bash
npm install
```

复制 `.env.example` 为本地 `.env` 后，可启动本地依赖：

```bash
docker compose -f infra/local/docker-compose.yml up -d
```

常用开发入口：

```bash
npm run dev:web
npm run dev:api
npm run dev:worker
```

当前已验证命令：

```bash
npm run test
npm run lint
npm run db:migrate:test
npm run build
```

API 健康检查端点：

```text
GET /health/live
GET /health/ready
GET /api/v1/health/live
GET /api/v1/health/ready
```

## 状态

P0 文档基线已完成。P1 第一批代码已落地：`apps/web` 使用临时 Cloud 内存适配器独立启动和构建；`apps/api` 和 `apps/worker` 提供配置校验、结构化日志和优雅关闭；`infra/local` 提供 PostgreSQL、Redis 和 MinIO 基础配置。
