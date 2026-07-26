# AI Canvas Cloud

AI Canvas Cloud 是 AI Canvas 的独立账号网站端。它提供账号、个人空间、云端项目图、私有媒体资产、目录包迁移和独立 Admin；用户 Provider、endpoint、模型 ID、API Key 与可恢复生成任务只保存在当前浏览器的加密设备存储中，不进入 Cloud。

仓库使用 npm workspaces，常驻应用只有 Web、API、Admin Web 和 Admin API。当前阶段与剩余工作以 [`docs/ROADMAP.md`](docs/ROADMAP.md) 为准。

## 快速开始

安装依赖，复制 `.env.example` 为未跟踪的 `.env`，再启动本地 PostgreSQL、Redis 和 MinIO：

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

本地需要自动创建普通开发账号时，在未跟踪的 `.env` 中设置 `DEV_SEED_ADMIN=true`、`DEV_SEED_ADMIN_USERNAME`、`DEV_SEED_ADMIN_EMAIL` 和 `DEV_SEED_ADMIN_PASSWORD`；默认用户名为 `admin_user`。该账号属于普通用户体系，与独立 Admin 账号完全隔离。

后台管理 SMTP 时，把 `AUTH_EMAIL_TRANSPORT` 设为 `managed`，并在 API 与 Admin API 的服务器环境中提供同一份 `SMTP_CREDENTIAL_KEYS`（版本到 32 字节 Base64 密钥的 JSON）和 `SMTP_CREDENTIAL_ACTIVE_KEY_VERSION`。主密钥不能在后台填写；首次发布 managed 配置前可保留旧 `SMTP_*` 环境变量作为回退，确认测试邮件和认证邮件成功后再移除旧密码。

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

`npm test` 会构建测试运行时实际依赖的 6 个共享/后端工作区，不再重复构建两个前端生产包。数据库、认证、权限、资产、Vault 和发布验证按风险触发，完整矩阵见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。

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

生产应用启动不自动迁移。`0029_remove_server_generation.sql` 会不可逆删除旧 Provider 密文和服务端生成链路；`0030_user_usernames.sql` 会把普通账号切换到必填用户名契约，两者都要求协调应用发布并提前备份。`0031_generation_telemetry.sql` 和 `0032_managed_smtp_configuration.sql` 分别是只新增脱敏运营表、版本化加密 SMTP 配置的 expand 迁移。执行、回滚和前向修复要求见 [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)。
