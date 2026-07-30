# AI Canvas Cloud

AI Canvas Cloud 是 AI Canvas 的独立账号网站端。它提供账号、个人空间、云端项目图、私有媒体资产、目录包迁移和独立 Admin；用户 Provider、endpoint、模型 ID、API Key 与可恢复生成任务只保存在当前浏览器的加密设备存储中，不进入 Cloud。

仓库使用 npm workspaces，常驻应用只有 Web、API、Admin Web 和 Admin API。当前阶段与剩余工作以 [`docs/ROADMAP.md`](docs/ROADMAP.md) 为准。

## 快速开始

使用 Node.js 20 或更高版本。安装依赖，复制 `.env.example` 为未跟踪的 `.env`，再启动本地 PostgreSQL、Redis 和 MinIO：

```bash
npm install
docker compose -f infra/local/docker-compose.yml up -d
npm run db:migrate
npm run db:roles:provision
npm run db:roles:check
```

启动或管理四个开发服务：

```bash
npm run dev:start
npm run dev:status
npm run dev:restart
npm run dev:stop
```

也可以单独前台启动：

```bash
npm run dev:web
npm run dev:api
npm run dev:admin-web
npm run dev:admin-api
```

默认地址为 Web `http://127.0.0.1:5173`、API `http://127.0.0.1:8787`、Admin Web `http://127.0.0.1:5174`、Admin API `http://127.0.0.1:8788`。后台进程记录和脱敏日志位于已忽略的 `.codex-run/`。

HTTP 接入层迁移期间，本地 `.env.example` 默认让普通 API 与 Admin API 都使用 `fastify`；开发 OpenAPI UI 分别位于 `http://127.0.0.1:8787/docs` 和 `http://127.0.0.1:8788/docs`。服务在缺少 adapter 配置时仍以 `legacy` 作为受控回退，生产和 staging 的部署模板也继续默认 `legacy`，必须完成性能、多实例和 staging 门禁后再分别切换；非法值会阻止启动。

本地需要自动创建普通开发账号时，在未跟踪的 `.env` 中设置 `DEV_SEED_ADMIN=true`、`DEV_SEED_ADMIN_USERNAME`、`DEV_SEED_ADMIN_EMAIL` 和 `DEV_SEED_ADMIN_PASSWORD`；默认用户名为 `admin_user`。该账号属于普通用户体系，与独立 Admin 账号完全隔离。

后台管理 SMTP 时，把 `AUTH_EMAIL_TRANSPORT` 设为 `managed`，并在 API 与 Admin API 的服务器环境中提供同一份 `SMTP_CREDENTIAL_KEYS`（版本到 32 字节 Base64 密钥的 JSON）和 `SMTP_CREDENTIAL_ACTIVE_KEY_VERSION`。主密钥不能在后台填写；首次发布 managed 配置前可保留旧 `SMTP_*` 环境变量作为回退，确认测试邮件和认证邮件成功后再移除旧密码。

后台管理 OSS 时，API 与 Admin API 必须使用同一份 `OBJECT_STORAGE_CREDENTIAL_KEYS` 和 `OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION`。通用生产部署可保留环境 `S3_*` 作为首次启动和故障回退；单机安装使用 `OBJECT_STORAGE_ENVIRONMENT_FALLBACK=false`，允许服务先启动，再由超级管理员在“对象存储”中通过真实读写删除测试后发布加密配置，AccessKey 不会回显。已有资产时 Bucket、Region、Endpoint 和路径样式会锁定，只允许轮换 RAM AccessKey 与调整签名访问地址。

超级管理员可在“对象存储”中先扫描、再确认清理超过 7 天的无引用资产。当前画布或有效 checkpoint 仍引用的资产不会删除，后台只显示文件数量和容量，不显示用户、项目或 object key。API 与 Admin API 还必须共享至少 32 字符的 `ASSET_MAINTENANCE_TOKEN`；单机安装与旧版本升级会自动生成该密钥。

## Docker 生产部署

`infra/deploy/production` 提供面向宝塔和 2 核 2G ECS 的轻量 Compose。ECS 只常驻 Web、API、Admin Web 和 Admin API；PostgreSQL、Redis、私有对象存储分别使用 RDS、阿里云 Redis 和 OSS。镜像必须在本地或 CI 构建并推送到 ACR，生产服务器只拉取镜像，不在 2G 内存机器上执行前端构建。

生产配置从 `infra/deploy/production/production.env.example` 复制为同目录未跟踪的 `production.env`。首次发布、宝塔反向代理、迁移、升级和回滚顺序见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#docker-生产部署)。安全组只需开放 `22`、`80` 和 `443`，`8787`、`8788`、PostgreSQL 与 Redis 端口不得暴露公网。

[`infra/deploy/single-host`](infra/deploy/single-host) 提供面向宝塔单机的简化部署：长期只运行普通应用、后台应用、PostgreSQL 和 Redis 四个容器。本地 Docker Desktop 一次构建并导出程序镜像，上传服务器后由 `setup.sh`/`deploy.sh` 直接加载；服务器不构建源码，也不要求购买 ACR。PostgreSQL 和 Redis 继续使用 Compose 中固定版本的官方镜像，服务器已有时不会重复上传。`setup.sh` 只用于首次安装；以后更新重新构建并上传镜像和部署文件，再运行 `deploy.sh`，不得覆盖服务器的 `secrets/`、`backups/` 或 Docker volumes。单机首次安装、离线镜像构建、更新、备份和故障处理见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#单机-docker-生产部署)。

普通站点的公开首页、登录、注册、密码重置、帮助和法律页面只加载认证与基础界面。会话确认已登录后才动态下载画布、工具栏、项目管理、编辑器、任务运行器、React Flow 和全景预览；Chunk 加载失败会显示刷新恢复界面。`npm run build` 会检查 `apps/web/dist/index.html` 没有 preload 登录后、工具栏、React Flow、编辑器、Three.js 或全景 Chunk，并要求匿名入口实际引用的 JS/CSS Gzip 总量不超过 200 KiB。

静态站点对 `index.html` 和 SPA 回退 HTML 返回 `Cache-Control: no-store`，对带 Hash 的 `/assets/*` 返回 `public, max-age=31536000, immutable`。EdgeOne 应遵循源站缓存头，不得用短缓存规则覆盖 `/assets/*`。单机 `deploy.sh` 在普通站点和 Admin 存活检查通过后，从 release 容器读取两套构建目录，经 `WEB_PUBLIC_URL` 和 `ADMIN_WEB_PUBLIC_URL` 预热 HTML 与全部静态资源；个别预热失败只警告并汇总，不回滚已健康版本，也不需要腾讯云密钥或 EdgeOne 管理 API。

## 日常验证

编辑过程中只运行受影响范围：

```bash
npm run test:unit -- apps/web/src/features/settings
npm run lint:files -- apps/web/src/features/settings/LocalVaultSettingsPanel.tsx
npm run format:files -- README.md docs/DEVELOPMENT.md
npm run typecheck
```

常规代码改动收尾运行：

```bash
npm run check
```

`check` 运行全部非集成测试，只对当前 Git 改动文件执行 Lint/Prettier，再执行增量 TypeScript 检查；它不运行数据库迁移、真实依赖集成、浏览器 E2E 或生产打包。共享行为、跨模块契约或高风险改动再运行：

```bash
npm test
npm run build
```

`npm test` 会构建测试运行时实际依赖的 6 个共享/后端工作区，不再重复构建两个前端生产包。`npm run build` 除生产打包外还执行匿名入口体积和 preload 门禁。数据库、认证、权限、资产、Vault 和发布验证按风险触发，完整矩阵见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。

## 文档入口

| 文档                                                     | 只维护什么                           |
| -------------------------------------------------------- | ------------------------------------ |
| [`README.md`](README.md)                                 | 启动入口、常用命令、文档导航         |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)             | 当前架构不变量、开发流程、验证矩阵   |
| [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) | 目录职责、模块所有权、依赖方向       |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)               | 表、约束、事务与迁移语义             |
| [`docs/API.md`](docs/API.md)                             | HTTP 请求、响应、错误码与安全边界    |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)                     | 唯一阶段状态、当前剩余验收、后续路线 |

完成态不再写成逐次复盘。稳定结论写入对应参考文档，阶段只在路线图保留一行摘要，测试次数和某次命令输出不进入长期文档。

## 核心边界

- Cloud 与本地 Web/Electron 仓库 `136909482/ai-canvas` 不共享数据库或源码路径，只通过版本化 `ProjectRecord` 和目录包显式迁移。
- PostgreSQL 保存认证、工作区、关系化项目图、变更、检查点、资产元数据、迁移会话和 Admin 数据；不保存媒体 blob 或浏览器生成任务。
- OSS/S3 兼容私有对象存储保存图片和视频；Redis 只用于普通 API 分布式安全限流和 readiness。
- Web 只能通过 Cloud API 和客户端平台适配层持久化；API 路由必须经可信 session、workspace 成员关系和领域服务授权。
- 平台不提供 Provider 代理，不接收用户 API Key、endpoint、真实模型 ID 或任意 target URL。

## 其他命令

数据库与管理：

```bash
npm run db:migrate
npm run db:roles:provision
npm run db:roles:check
npm run admin:bootstrap
npm run db:migrate:test
npm run db:migrate:compat
npm run db:repair:checkpoint-assets
npm run db:maintain:assets
```

格式、构建与 staging：

```bash
npm run format:check
npm run format:files -- <files>
npm run deploy:staging:check
npm run deploy:staging:gate
npm run deploy:staging:backup
npm run deploy:staging:restore:drill
```

生产应用启动不自动迁移。`0029_remove_server_generation.sql` 会不可逆删除旧 Provider 密文和服务端生成链路；`0030_user_usernames.sql` 会把普通账号切换到必填用户名契约，两者都要求协调应用发布并提前备份。`0031`–`0035` 是只新增的运营遥测、加密 SMTP、邮箱验证码与加密对象存储配置迁移；`0036` 在保留现有数据的前提下把旧默认个人空间配额从 20 GiB 调整为 10 GiB。执行、回滚和前向修复要求见 [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)。
