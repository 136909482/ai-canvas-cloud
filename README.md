# AI Canvas Cloud

AI Canvas Cloud 是 AI Canvas 的独立网站端仓库，面向长期运营的账号制 SaaS。用户登录后进入个人空间，项目图、任务和资产元数据保存在云端，图片与视频存入私有对象存储。

P0 至 P4 基线已经落地，当前进入 P5 服务端模型网关与任务 Worker，P5-1 至 P5-3 已完成任务持久化底座、Provider 白名单与加密 BYOK，以及任务创建/查询/取消/重试 API。仓库采用 npm workspaces monorepo，包含迁移后的 React/Vite 画布前端、API/Worker、服务端领域模块、共享 packages、本地云依赖配置和迁移检查。实现顺序以 `docs/ROADMAP.md` 为准。

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
- `ai-canvas-cloud` 负责账号、个人空间、单活跃会话与设备历史、云端图持久化、对象存储和服务端任务。
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

如果需要本地测试账号，可只在本机 `.env` 中启用开发 seed：

```text
DEV_SEED_ADMIN=true
DEV_SEED_ADMIN_EMAIL=admin@example.com
DEV_SEED_ADMIN_PASSWORD=<local password with at least 10 characters>
```

该账号只是开发测试账号，不代表系统管理员权限；生产环境会强制禁用该 seed。

Provider BYOK 需要独立于 Better Auth 的 32 字节主密钥。值使用 `版本号:base64密钥`，轮换时同时保留旧版本并提高 active 版本；生产值只放部署密钥管理，不写入 Git：

```text
PROVIDER_CREDENTIAL_KEYS=1:<base64-32-byte-key>,2:<base64-32-byte-key>
PROVIDER_CREDENTIAL_ACTIVE_KEY_VERSION=2
```

常用开发入口：

```bash
npm run dev:web
npm run dev:api
npm run dev:worker
npm run db:migrate
```

当前已验证命令：

```bash
npm run test
npm run lint
npm run db:migrate:test
npm run build
```

历史 checkpoint 资产 manifest 维护命令默认只读预检；确认审计输出后才显式提交，每个 checkpoint 使用独立短事务：

```bash
npm run db:repair:checkpoint-assets
npm run db:repair:checkpoint-assets -- --apply --batch-size=100
```

资产维护命令同样默认只读，诊断数据库缺失对象和 `workspaces/` 受控前缀下的 bucket 孤立对象。确认 JSONL 预检结果后才可显式提交；默认宽限期为 168 小时：

```bash
npm run db:maintain:assets
npm run db:maintain:assets -- --apply --batch-size=100 --grace-hours=168
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

P2 第一批基础已落地并已切到 Better Auth：核心认证表使用 `"user"`、`"session"`、`"account"`、`"verification"`；`PostgreSQL AuthService` 通过 Better Auth 管理邮箱密码、签名 HttpOnly Cookie、会话恢复、邮箱验证和密码重置。产品策略为单活跃设备：密码验证成功后如检测到其他有效 session，接口返回 `409 ACTIVE_SESSION_EXISTS`，前端要求用户确认；确认接管后旧 session 失效，新设备成为唯一有效登录。`auth_devices` 独立保留当前与历史设备、首次登录和最近活跃时间，用户可在设备管理页删除非当前设备记录。前端首屏检查一次，并在页面可见时每 5 分钟心跳一次；业务请求返回未授权则立即退出，同一标签页的并发 session 检查会合并。Cloud 侧继续维护 personal workspace、成员关系、工作区用户状态和认证审计表。Web 匿名态已提供独立产品首页、顶部登录/注册入口、响应式品牌与备案信息区；认证表单以弹层承载，并保留 session 恢复、登录接管确认、账号菜单、设备管理、退出登录、邮箱验证、忘记密码和重置密码闭环。

P3 关系化项目图、增量保存、变更读取、手动/定期检查点、历史详情与恢复已落地。P4-1 至 P4-11 已建立资产、上传会话和引用表，接入 MinIO/S3 预签名直传、完成确认、completed 资产元数据读取和短期私有读取 URL；Web Cloud 平台层已接入创建上传会话、无 Cookie 直传、完成确认、`cloud-assets/<asset-id>` 定位符以及签名 URL 缓存刷新和 session 清理。项目图事务已从节点数据提取持久化 Cloud 资产 ID，按可信工作区校验 completed 状态，并在节点替换或删除时同步更新 `asset_references`。manual、periodic 和 pre-restore checkpoint 已保存资产 manifest；restore 会校验 manifest/record 一致性、资产可用性并重建当前节点引用。历史 checkpoint 可通过默认只读、显式提交的分批维护命令安全回填 manifest 或标记失效，且保留异常手动保存点指针。每个 personal workspace 默认拥有 20 GiB 云资产配额，API 可读取已用/预留/剩余容量，上传会话在事务内预留容量并拒绝并发超卖。资产维护命令按稳定游标分批诊断缺失/孤立对象，并只在宽限期结束、当前引用和有效 checkpoint manifest 均不再保护时幂等回收 pending 已过期、failed、quarantined 或已软删除对象；completed 资产不因暂时无引用被回收。

P5-1 已新增 `generation_tasks` 和 `task_attempts`，把任务状态、尝试、重试上限、可领取时间和 Worker 租约字段落到 PostgreSQL，并将 `asset_references.task_id` 收紧为同工作区任务 UUID 外键。共享契约和纯状态机已定义 queued/running/succeeded/failed/canceled 语义；任务 HTTP API、Redis 队列消费、Provider 凭据与用量账本仍按 `docs/ROADMAP.md` 后续切片推进。

P5-2 已新增 `provider_credentials`，使用带 workspace/provider AAD 的 AES-256-GCM 版本化 envelope 保存 BYOK；API 已提供 Provider 配置列表、写入和删除，只返回配置状态与末四位。服务端注册表当前只允许 `https://api.openai.com` 和 `https://dashscope.aliyuncs.com/compatible-mode/v1`，不提供任意 URL 代理。Provider 连接测试、实际调用和用量账本仍属于后续切片。

P5-3 已接入任务创建、列表、详情、取消和重试 API。任务服务从可信 session 解析 workspace，在 workspace 行锁下处理创建/命令幂等、项目节点归属、active Provider 配置和最多 5 个活跃任务，并用 `task_commands` 持久化 cancel/retry 幂等事实。当前 API 只建立可恢复的服务端任务状态，不消费 Redis 队列、不调用 Provider，也不把现有前端本地生成链路切到服务端；这些能力继续按 `docs/ROADMAP.md` 后续切片推进。
