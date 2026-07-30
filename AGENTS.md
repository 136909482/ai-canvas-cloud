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
- 当前项目图以 `projects`、`project_nodes`、`project_edges`、`assets` 和引用表为事实来源；P8 完成后生成任务只存在于浏览器内存或加密 IndexedDB。
- 节点共有字段关系化，节点类型专属配置和低频展示属性使用 JSONB。
- 自动保存提交节点/连线增量操作；`project_changes` 保存有序变更。
- `project_snapshots` 保存手动或定期检查点，不接受每次拖拽的整份项目写入。
- 图片和视频保存在 OSS/S3 兼容私有对象存储，PostgreSQL 不保存媒体 blob。
- Redis 只用于 API 分布式安全限流，不承载模型生成队列。
- 用户 Provider、endpoint、模型 ID 和 API Key 只保存在按 Origin 与用户隔离的浏览器加密 Vault；浏览器调用受控协议 Provider，结果再通过 Cloud 资产和项目图 API 入云。
- 新建实体使用 UUID/ULID 等跨设备唯一 ID。

## 边界规则

- React 组件和普通 Zustand 持久化不得直接访问 PostgreSQL、Redis、对象存储管理凭据或 Provider 密钥；Provider 明文只能由浏览器 Vault 与受控执行适配层在内存中短期使用。
- 前端只能通过 Cloud API 和客户端平台适配层访问持久化能力。
- API 路由与后台维护入口不得绕过项目图领域模块直接修改节点、连线、变更日志或资产引用。
- 所有资源访问从可信会话解析用户，再以 `workspace_id` 和成员关系授权；不得相信客户端提交的 `user_id`。
- 平台 API 不提供 Provider 代理，也不接收用户 API Key、endpoint、真实模型 ID 或任意 target URL。浏览器 Provider 只允许受控协议适配；无 CORS 服务由用户使用自己的固定目标网关。
- 密码、会话 token、重置 token、API Key 和对象存储密钥不得写入日志、诊断、前端 bundle 或 Git。
- 本地目录包导入必须先预检、迁移和校验，再事务化拆分；登录本身不得触发本地数据上传。

## 数据一致性

- 图操作批次必须携带 `baseVersion` 和幂等键，在单个数据库事务中更新当前图、项目版本、`project_changes` 和资产引用。
- 版本不一致返回稳定的 `409 PROJECT_VERSION_CONFLICT`，首发不自动合并。
- 浏览器生成结果必须先通过受控资产上传，再以幂等项目图变更更新必要节点，不得用过期快照覆盖当前项目。
- 完整检查点通过恢复校验后才能裁剪更早操作日志。
- 删除项目和资产采用软删除与延迟 GC；仍被当前状态或保留检查点引用的资产不得删除。

## 工程与验证

在脚手架落地前，不得在文档中声明不存在的 npm 命令。每增加一个真实命令，必须同步更新 README 和开发指南。

当前真实命令：

- `npm run dev:web`
- `npm run dev:api`
- `npm run dev:admin-web`
- `npm run dev:admin-api`
- `npm run dev:start`
- `npm run dev:stop`
- `npm run dev:restart`
- `npm run dev:status`
- `npm run test`
- `npm run test:unit`
- `npm run lint`
- `npm run lint:files`
- `npm run format:files`
- `npm run typecheck`
- `npm run check`
- `npm run db:migrate`
- `npm run db:roles:provision`
- `npm run db:roles:check`
- `npm run admin:bootstrap`
- `npm run db:migrate:test`
- `npm run db:migrate:compat`
- `npm run db:repair:checkpoint-assets`
- `npm run db:maintain:assets`
- `npm run verify:http-adapters`
- `npm run build`
- `npm run deploy:staging:check`
- `npm run deploy:staging:gate`
- `npm run deploy:staging:backup`
- `npm run deploy:staging:restore:drill`
- `npm run format:check`

验证按改动风险逐级增加，不要求每次局部编辑都运行发布级门禁：

- 编辑中优先运行相关 `test:unit` 和 `lint:files`。
- 常规代码改动交付前至少运行 `npm run check`；它包含全部非集成测试、本次 Git 改动文件的 Lint/Prettier 和增量 TypeScript 检查。
- 共享包、跨模块契约和 API 行为改动运行 `npm test`、`npm run lint` 和 `npm run build`。
- 认证、权限、项目图、资产、浏览器 Vault 或本地任务改动还必须运行相应集成测试、两账号隔离和双设备 E2E。
- 只有数据库 schema、迁移器或角色变更才要求 `db:migrate:test`、`db:migrate:compat`、`db:roles:check`；schema 变更必须包含显式迁移、升级测试和回滚/前向修复说明。
- 纯文档、注释或静态文案改动不要求代码测试、构建或数据库迁移，只运行相关格式和链接检查。
- staging 与发布配置改动运行 staging 门禁和真实恢复演练；不能用本地 fake 代替真实环境验收。

## 文档维护

- 路线状态只在 `docs/ROADMAP.md` 维护。
- 当前架构不变量写入 `docs/DEVELOPMENT.md`。
- 表、约束和事务语义写入 `docs/DATA_MODEL.md`。
- HTTP 请求/响应和错误码写入 `docs/API.md`。
- 目录职责和依赖方向写入 `docs/PROJECT_STRUCTURE.md`。
- 实现与文档不一致时，修正实现或同步更新长期文档，不保留两套相互冲突的事实。
