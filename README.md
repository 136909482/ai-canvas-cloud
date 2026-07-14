# AI Canvas Cloud

AI Canvas Cloud 是 AI Canvas 的独立网站端仓库，面向长期运营的账号制 SaaS。用户登录后进入个人空间，项目图、任务和资产元数据保存在云端，图片与视频存入私有对象存储。

当前阶段只建立长期架构文档，尚未开始业务代码和工程脚手架。实现顺序以 `docs/ROADMAP.md` 为准。

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

## 状态

第一批提交仅包含文档。实际命令、依赖和部署说明必须在对应脚手架落地并验证后再加入，README 不提前声明不存在的能力。

