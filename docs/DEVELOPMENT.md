# AI Canvas Cloud 开发指南

本文档定义网站端的长期架构边界。实现阶段、优先级和验收条件见 `ROADMAP.md`，数据库细节见 `DATA_MODEL.md`，HTTP 契约见 `API.md`。

## 产品边界

AI Canvas Cloud 是账号制、多设备访问的 AI 画布 SaaS。首发提供个人空间、云端项目、私有媒体资产和服务端生成任务，不提供实时多人编辑、离线云项目同步或复杂商业计费。

本仓库与本地版 `ai-canvas` 独立：

- 本地版继续使用目录 JSON/Electron SQLite 和本地 `images/`。
- Cloud 使用 PostgreSQL、Redis、Worker 和 OSS/S3。
- 两端通过版本化 `ProjectRecord` 与目录包显式迁移。
- 登录、退出或网络恢复不会自动上传本地工作区。

## 当前工程骨架

P1 第一批代码已经建立 npm workspaces monorepo：

- `apps/web`：Vite + React 画布前端，一次性迁移自本地版稳定画布代码，并替换为 Cloud 内存平台适配器。
- `apps/api`：HTTP 入口、配置校验、结构化日志、request ID、`/health/live`、`/health/ready` 和优雅关闭。
- `apps/worker`：后台 Worker 进程骨架、配置校验、结构化日志和优雅关闭。
- `packages/contracts`：API 错误码和健康检查响应契约。
- `packages/project-graph`：项目图纯操作和基础测试。
- `packages/shared`：共享环境读取、request ID 和日志工具。
- `infra/local`：PostgreSQL、Redis 和 MinIO 的 Docker Compose 基础配置。
- `server/db/migrations`：显式迁移文件和迁移检查入口。

当前 Web 适配器只用于 P1 独立启动和构建，不提供云端持久化事实来源；P3 会把它替换为版本化 Cloud API 图适配层。

## 目标拓扑

```text
Browser
  -> Web application
  -> Cloud API
       -> PostgreSQL
       -> Redis queue
       -> Private object storage
  -> Worker
       -> AI providers
       -> Private object storage
       -> PostgreSQL
```

前端和 API 优先部署在同一站点或同一主域，使用安全 Cookie 会话，减少跨站认证复杂度。API 与 Worker 独立扩缩容，生产数据库、Redis 和对象存储不得与 staging 共用实例或凭据。

## 认证与租户

首发采用邮箱、密码和服务端不透明会话：

- 密码使用 Argon2id 或同等级现代哈希。
- 数据库只保存会话 token 哈希，原始 token 只存在于 `HttpOnly`、`Secure`、`SameSite` Cookie。
- 注册事务同时创建用户、个人工作区和 owner 成员关系。
- 项目、节点、资产、任务、凭据和用量均以 `workspace_id` 为租户边界。
- 每个资源查询先带入成员授权条件，不先查询资源再做权限判断，避免 ID 枚举泄漏。
- 登录、注册、验证邮件和密码重置需要限流、一次性 token、过期控制和失败审计。

首发 UI 不展示工作区切换器，但数据模型保留 `workspace_members`，为后续团队空间提供稳定边界。

## 云端项目图

Cloud 当前画布不以完整项目 JSON 为日常事实来源：

- `projects` 保存项目元数据、当前版本和手动检查点。
- `project_nodes` 保存节点共有字段及 `data_json`/`presentation_json`。
- `project_edges` 保存连线端点、handle、类型和扩展数据。
- `generation_tasks` 与 `assets` 分别保存任务和媒体事实状态。
- `project_changes` 保存有序、幂等的图操作批次。
- `project_snapshots` 保存手动或定期完整检查点。

节点共有字段关系化，包括类型、坐标、尺寸、层级、父节点和行版本。不同节点的 prompt、模型参数、编辑配置等放入 JSONB，避免每增加节点类型就修改数据库 schema。可查询或需要外键约束的字段不得只藏在 JSONB 中。

## 保存与冲突

前端平台适配层维护最近确认的规范化图基线、server version 和 change sequence。自动保存对当前画布与基线做 ID 级 diff，生成 `upsertNode`、`deleteNode`、`upsertEdge`、`deleteEdge` 和必要的项目元数据操作。

操作批次携带 `baseVersion`、client batch ID 和幂等键。服务端事务必须：

1. 校验会话和工作区权限。
2. 锁定并校验项目当前版本。
3. 校验节点/连线 ID、端点、资产归属和输入大小。
4. 更新节点、连线和资产引用。
5. 追加连续的 `project_changes.sequence`。
6. 递增项目版本并提交。

版本不一致返回 `409 PROJECT_VERSION_CONFLICT`。首发提供重新加载云端版本和另存为副本，不自动合并两个设备的画布。

已有请求在途时，客户端只合并尚未提交的最新操作；删除操作不能被较旧 upsert 复活。页面关闭前可尝试 flush，但正确性不能依赖 `beforeunload` 请求一定成功。

## 手动保存与检查点

自动保存推进工作版本；手动保存先提交所有待处理增量，再创建 `manual` 检查点，并更新项目的 saved checkpoint 指针。

定期检查点按变更数量、时间或操作日志体积生成。检查点必须包含可恢复的 `{ canvas, taskQueue }` 或版本化 `ProjectRecord`，记录项目版本、schema 版本、字节数和引用资产集合，并通过反序列化和图约束校验后标记可用。只有成功检查点覆盖对应 sequence 后才允许裁剪更早变更。

历史恢复不回写旧行。恢复操作读取目标检查点，校验并生成新的当前版本、变更记录和审计事件。

## 图片与视频资产

媒体文件保存在私有 OSS/S3 兼容对象存储，PostgreSQL 只保存元数据。对象 key 使用不可变 ID，不包含邮箱或项目名称：

```text
workspaces/<workspace-id>/projects/<project-id>/uploads/<asset-id>.<ext>
workspaces/<workspace-id>/projects/<project-id>/generated/<yyyy-mm-dd>/<asset-id>.<ext>
workspaces/<workspace-id>/projects/<project-id>/edits/<asset-id>.<ext>
workspaces/<workspace-id>/projects/<project-id>/thumbnails/<asset-id>.<ext>
```

浏览器上传采用三步协议：创建上传会话、预签名直传、完成确认。完成接口校验对象存在、大小、MIME/魔数、哈希和工作区归属。只有 completed 资产可以进入节点或任务引用。

读取私有资产时，API 授权后返回短期签名 URL。前端可以缓存 URL，但必须处理过期刷新和退出登录清理。Provider 临时结果 URL 必须由 Worker 下载、校验并转存，不得写入节点、任务或检查点作为长期来源。

删除项目只做软删除。后台 GC 仅删除超过宽限期且不被当前图、任务或保留检查点引用的资产，并在真正删除前重新读取最新引用。

## 服务端任务

Cloud 以 `generation_tasks` 为任务事实来源，前端 task queue 是投影。API 只负责授权、校验、额度预占和入队，Worker 负责领取与续租、Provider 调用、限流重试、结果转存、用量和审计。

关闭浏览器后任务继续。Worker 重启不得造成永久 running、重复结果节点或重复扣费。任务完成产生的节点变化通过独立幂等批次进入 `project_changes`，不得基于过期检查点覆盖整个画布。

## Provider 密钥

首发优先 BYOK：

- 密钥在服务端使用版本化加密密钥或 KMS 包封加密。
- 读取接口只返回 Provider、状态和末四位提示，不返回原始密钥。
- 前端 bundle、日志、诊断、目录包和错误响应不得包含密钥。
- Provider 测试和运行统一走服务端白名单适配器。
- 任意 target URL 代理、内网地址、重定向绕过和非 HTTPS 生产端点必须拒绝。

## 导入与导出

导入分预检和提交两阶段：先读取 manifest、项目与资产清单，执行 schema 迁移、大小限制和引用检查；用户确认统计与冲突策略后上传资产，再在事务中把 `ProjectRecord` 拆为项目、节点、连线、任务和引用。失败时不产生半完成活动项目。

导出从关系化当前状态和手动检查点组装兼容 `ProjectRecord`/目录包。Provider API Key 始终清空。Cloud 导出必须能重新导入干净的本地 Web/Electron 工作区。

## 可观测性与安全

- 每个请求、任务和导入操作使用稳定 request/job ID。
- 日志只保存 ID、操作、耗时、结果和脱敏上下文，不保存用户正文、附件、Cookie、Authorization 或完整 Provider 响应。
- 健康检查区分 liveness 与 readiness；readiness 检查 PostgreSQL、Redis 和对象存储依赖。
- 生产启用 CSP、CORS allowlist、CSRF 防护、安全响应头、上传限制和分层速率限制。
- 数据库自动备份，对象存储启用版本/生命周期策略，并定期在隔离环境完成恢复演练。
- schema 迁移是独立发布步骤，应用启动不自动执行破坏性迁移。

## 验证规则

代码落地后，测试层次至少包括：

- 纯函数单测：图 diff、操作校验、ID、权限、状态机和引用提取。
- PostgreSQL 集成：事务、约束、并发版本、sequence、检查点与迁移。
- 对象存储集成：预签名上传、私有读取、跨租户拒绝和 GC。
- API 契约：认证、分页、幂等、错误码、输入上限和字段脱敏。
- 浏览器 E2E：两账号隔离、跨设备恢复、双标签冲突、资产上传和关闭页面后任务恢复。
- 灾难恢复：数据库与对象存储恢复后校验当前图、检查点和资产引用一致。

当前已验证命令：

```bash
npm run test
npm run lint
npm run db:migrate:test
npm run build
```

开发入口：

```bash
npm run dev:web
npm run dev:api
npm run dev:worker
```

每次新增或修改真实命令时，必须同步更新 README、AGENTS 和本文件。
