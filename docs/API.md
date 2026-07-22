# AI Canvas Cloud API 契约

本文档定义当前 HTTP API 的资源边界。运行时 schema 与 TypeScript 类型以 `packages/contracts` 为机器可验证来源；本文保留长期语义和安全约束。

## 通用约定

- 普通 API 前缀为 `/api/v1`，Admin API 前缀为 `/admin/v1`。
- 浏览器认证使用服务端不透明 HttpOnly Cookie；普通用户与 Admin Cookie/Secret/Origin 完全隔离。
- JSON 在路由前执行字节、严格 UTF-8、重复键、Unicode、有限数值、深度和 entries 上限校验。
- 所有响应携带 request ID；列表使用不透明 keyset cursor，不开放任意 offset 扫描。
- 创建、图批次、上传、迁移等写操作使用幂等键。
- 时间使用 ISO 8601 UTC，ID 对客户端是不透明字符串。
- 所有资源作用域由可信 session 推导，客户端 `userId/workspaceId` 不参与授权。
- 其他 workspace 与不存在资源使用相同 `404 RESOURCE_NOT_FOUND` 语义。
- 平台 API 不接收用户 Provider Key、endpoint、真实模型 ID 或任意 target URL。

普通 API 使用 `WEB_ALLOWED_ORIGINS` 精确匹配 CORS/Origin。Cookie 写请求和认证写入口要求允许 Origin，所有非安全方法拒绝 `Sec-Fetch-Site: cross-site`。预检只开放固定 method/header，不使用 `*`。Admin 使用独立 allowlist 和 SameSite=Strict Cookie。

API 响应发送 nosniff、frame deny、Referrer/Permissions/COOP/CORP 及 `default-src 'none'` 的 API CSP；protected 环境发送 HSTS。Web HTML 的页面 CSP 由 Nginx 单独负责。

普通 API 使用 Redis 原子窗口限制认证、密码/邮件、资产/迁移 prepare、普通读和普通写。超限返回 `429 RATE_LIMITED` 与整数秒 `Retry-After`。Redis 不可用时普通读 fail-open，高风险认证和写请求 fail-closed，返回可重试 `503 SERVICE_UNAVAILABLE`，且不得进入领域副作用。已经删除的 Provider 测试和服务器任务创建没有限流分类或路由。

错误响应固定为：

```json
{
  "error": {
    "code": "PROJECT_VERSION_CONFLICT",
    "message": "项目已在其他位置更新",
    "retryable": false,
    "requestId": "req_...",
    "details": { "currentVersion": 19 }
  }
}
```

`details` 只包含恢复所需的非敏感信息，不返回堆栈、SQL、Cookie、Token、Provider 配置、object key、签名 URL 或底层响应正文。

## 健康与指标

普通 API：

```text
GET /health/live
GET /health/ready
GET /api/v1/health/live
GET /api/v1/health/ready
GET /metrics
```

Admin API：

```text
GET /health/live
GET /health/ready
```

`live` 只表示进程可响应。普通 API `ready` 并行执行 PostgreSQL query、Redis `PING` 和 S3 `HeadBucket`；失败返回 `503`、`status=degraded`，错误分类只允许 `connection_refused|timeout|authentication_failed|permission_denied|bucket_unavailable|unknown`。响应不含连接串、主机凭据、Bucket/object key 或底层错误正文。

`/metrics` 仅用于受控内网抓取，包含 API 请求/延迟、错误、认证失败、限流、项目冲突、配额、迁移阶段、依赖和数据库连接池等当前指标。不存在 Worker metrics、任务 backlog/running/retry/lease、Provider 请求或结果转存指标。标签禁止 workspace/user/project/request ID、URL、邮箱、正文和凭据。

## 公开站点配置

```text
GET /api/v1/site-config
```

无需登录，返回当前站点配置公开投影、品牌资产短期读取 URL 和 ETag。`If-None-Match` 命中返回 304。正文只包含 schemaVersion 1 的品牌/首页/Footer 纯文本、主体/备案纯文本、HTTP(S) 帮助与法律链接、主题、导航枚举、布尔功能开关和 Logo/Favicon asset ID/URL。无发布修订时返回内置安全默认值。

响应不包含 Admin revision 备注、对象 key、管理员 ID、Provider 配置或可执行 HTML/CSS/JavaScript。

## 认证

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/session
GET    /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/:sessionId
GET    /api/v1/auth/devices
DELETE /api/v1/auth/devices/:deviceId
POST   /api/v1/auth/email/verify
POST   /api/v1/auth/email/resend
POST   /api/v1/auth/password/forgot
POST   /api/v1/auth/password/reset
```

底层委托 Better Auth 管理邮箱密码、签名 Cookie、session、验证和重置 token。注册、登录与 session 恢复后幂等确保 personal workspace 和 owner membership。

用户摘要包含 Better Auth 内部 ID、不可变 `userNumber`、email、status、emailVerified；workspace 摘要包含 ID、personal 类型、名称、role、status、planKey。`userNumber` 只用于展示/检索，不参与认证或资源授权。

同账号只允许一个有效 session。登录检测到其他有效 session 时删除本次临时 session，返回 `409 ACTIVE_SESSION_EXISTS`；只有 `force=true` 的明确确认才撤销旧 session 并签发新 Cookie。

`deviceId` 是浏览器非认证标识。设备列表只返回当前账号的 label、首次/最近时间和 current；只能删除自己的非当前设备。忘记密码接口不泄漏邮箱是否存在，密码重置成功后撤销旧 session。

## 工作区

```text
GET /api/v1/workspaces/current
GET /api/v1/workspaces/current/usage
```

`/current` 返回可信 session 的 personal workspace 摘要。首发不提供切换或邀请。`/usage` 返回存储 used/reserved/total/quota/available 及同工作区项目的 file/node/storage 摘要；不返回 object key、用户 ID 或其他 workspace 统计。

## 项目元数据

```text
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:projectId
PATCH  /api/v1/projects/:projectId
POST   /api/v1/projects/:projectId/archive
POST   /api/v1/projects/:projectId/restore
DELETE /api/v1/projects/:projectId
```

读取要求 workspace 成员，写操作要求 owner/admin/editor。列表支持 `status=active|archived`、`limit=1..100` 和不透明 cursor。创建只接受可选客户端 UUID 与 name；同工作区同 ID/name 幂等返回，不允许提交租户或所有者。

项目摘要包含 ID、name、version、lastSequence、nodeCount、edgeCount、兼容 `taskCount`、archive/创建/更新时间。P8-4 后 `taskCount` 正常为 0，只是历史契约兼容字段，不代表存在服务器任务 API。删除为软删除并清理 workspace user state 引用。

## 项目图

```text
GET   /api/v1/projects/:projectId/graph
PATCH /api/v1/projects/:projectId/graph
GET   /api/v1/projects/:projectId/changes?after=<sequence>
```

图读取返回 projectId、version、sequence、活动 nodes/edges。changes 按 sequence 升序最多返回 500 条，不暴露 workspace、actor 或幂等键。

PATCH 请求包含 `baseVersion`、clientId、batchId、idempotencyKey 和 1–500 个 node/edge upsert/delete。所有操作在一个事务接受或拒绝；同键同内容重放返回原结果，同键不同内容返回冲突。baseVersion 不一致返回 `409 PROJECT_VERSION_CONFLICT`。

服务端校验操作后节点父级/环、连线端点、字段大小和 Cloud 资产引用。只有规范 UUID/`cloud-assets/<asset-id>` 构成资产身份；签名 URL、object key、第三方 URL 和 data/blob URL 不构成身份。节点 upsert/delete 与 `asset_references`、change、version/sequence 同事务。

## 检查点与历史

```text
POST /api/v1/projects/:projectId/checkpoints
GET  /api/v1/projects/:projectId/revisions
GET  /api/v1/projects/:projectId/revisions/:version
POST /api/v1/projects/:projectId/revisions/:version/restore
```

创建请求只接受 expectedVersion、expectedSequence 和 `manual|periodic` 类型。服务端从当前关系化图生成 record 和资产 manifest；客户端不能提交 record/manifest。manual 更新 saved pointer，periodic 只进入历史。

revisions 列表返回摘要，详情返回指定 version 最新 checkpoint 的完整 `record`。`record.taskQueue.tasks` 是历史 `ProjectRecord` 兼容结构，Cloud 检查点正常为空，不代表服务器任务恢复。

restore 校验 expected version/sequence、record/manifest 和 completed 资产，创建 pre-restore，再替换当前图、重建引用、追加 change 并递增版本。任一失败整体回滚。

## 资产

```text
POST /api/v1/assets/uploads
POST /api/v1/assets/uploads/:uploadId/complete
GET  /api/v1/assets/:assetId
GET  /api/v1/assets/:assetId/url
```

创建上传会话接受 projectId、文件名、MIME、字节数、可选 SHA-256/尺寸、asset kind、reference role 和幂等键。服务端从 session 推导 workspace/user，在 workspace 行锁下预留容量并返回短期 presigned PUT；响应不包含 object key 或永久凭据。

浏览器直传使用 `credentials: omit`。complete 请求体为空，服务端重新读取对象 metadata 并验证大小、MIME 和可选 hash。对象缺失返回 `ASSET_NOT_READY`，会话过期返回 `ASSET_UPLOAD_EXPIRED`，metadata 不符返回 `ASSET_VALIDATION_FAILED`。

GET 只读取当前 workspace 的 completed 资产；`/url` 返回短期私有 URL。跨 workspace、已删除或不存在统一 404，非 completed 不签名。签名 URL 不能长期写入节点、检查点或本地持久化。

## 导入与导出

导入：

```text
POST /api/v1/migrations/imports/prepare
GET  /api/v1/migrations/imports/:importId
POST /api/v1/migrations/imports/:importId/cancel
POST /api/v1/migrations/imports/:importId/commit
POST /api/v1/migrations/imports/:importId/assets/:logicalAssetId/upload
GET  /api/v1/migrations/imports/:importId/assets/:logicalAssetId/upload
POST /api/v1/migrations/imports/:importId/assets/:logicalAssetId/parts/:partNumber/complete
POST /api/v1/migrations/imports/:importId/assets/:logicalAssetId/complete
POST /api/v1/migrations/imports/:importId/assets/:logicalAssetId/cancel
```

prepare 接受 P6 目录包结构和幂等键，先执行 schema、canonical JSON、路径、大小、hash、引用、凭据泄漏和配额预检，只写 `migration_imports`。返回冲突摘要与逻辑资产上传清单，不返回 object key、签名 URL、workspace/user 或包正文。

资产暂存支持单 PUT 与 8 MiB multipart、最多 256 parts；每片提交真实 ETag，最终重新验证 MIME/大小/hash。commit 使用 `copy|replace`：copy 重映射 project/node/edge ID；replace 仅 owner/admin 且必须携带 prepare 的 expectedVersion/expectedSequence 和显式确认。正式图/资产/引用/change/checkpoint 在同一事务提交。

导出：

```text
POST /api/v1/projects/:projectId/exports/prepare
GET  /api/v1/projects/:projectId/exports/:exportId
GET  /api/v1/projects/:projectId/exports/:exportId/download
POST /api/v1/projects/:projectId/exports/:exportId/cancel
POST /api/v1/projects/:projectId/exports/:exportId/retry
```

prepare 冻结项目 version/sequence 与 payload，异步生成固定目录包 ZIP。状态为 prepared/generating/completed/failed/canceled/expired；download 仅为 completed 签发短期私有 URL。retry 最多 3 次且不重读新项目版本。

导入导出不携带 Provider 配置、Key、endpoint、真实模型 ID、浏览器本地任务缓存、object key 或签名 URL。

## Admin API

Admin 只提供以下当前资源：

```text
GET  /admin/v1/auth/csrf
GET  /admin/v1/auth/captcha
POST /admin/v1/auth/login
GET  /admin/v1/auth/session
POST /admin/v1/auth/username
POST /admin/v1/auth/password
GET  /admin/v1/auth/login-security
POST /admin/v1/auth/login-security
POST /admin/v1/auth/logout
GET  /admin/v1/audit-events
GET  /admin/v1/site-config
POST /admin/v1/site-config
GET  /admin/v1/site-assets
POST /admin/v1/site-assets
POST /admin/v1/site-assets/:assetId/complete
```

`GET /auth/csrf` 返回 token 并设置签名 HttpOnly CSRF Cookie。所有 Admin POST 要求精确 Origin、非 cross-site Fetch Metadata 和匹配的 `X-CSRF-Token`。普通用户 Cookie 无效。

验证码默认关闭；开启时 captcha 返回 5 位数字的短期 SVG challenge，数据库只保存 hash、失败次数和过期/消费时间。login 接受 username/password 和可选 captcha 字段；响应不返回内部 email 或 session token。

username 修改要求 3–30 位小写字母、数字、下划线或点。password 修改校验当前密码，新密码 12–256 位，成功后保留当前 session、撤销其他 Admin session并写脱敏审计。

site assets 只接受 PNG/JPEG/WebP/ICO、最大 4 MiB、单边最大 4096；完成时复核 metadata、完整 hash、魔数和真实尺寸。site config 保存版本化结构、不可变 revision、current 指针、公开投影和同事务审计，不接受 HTML、JavaScript、任意 CSS 或 URL 凭据/fragment。

## 已删除 URL

下列服务器生成、Provider、官方模型和积分路径必须返回 404，不提供兼容空响应、重定向或空壳写接口：

```text
/api/v1/tasks
/api/v1/tasks/*
/api/v1/settings/providers
/api/v1/settings/providers/*
/api/v1/models/official
/api/v1/workspaces/current/official-credits
/admin/v1/providers
/admin/v1/providers/*
/admin/v1/models
/admin/v1/models/*
/admin/v1/workspaces/:workspaceId/credits/adjust
```

Worker `/health/live`、`/health/ready`、`/metrics` 和开发进程管理入口也不存在。普通 API 不代理或接收浏览器 Provider 请求。

## 主要错误码

```text
AUTH_REQUIRED
SESSION_EXPIRED
ACTIVE_SESSION_EXISTS
EMAIL_NOT_VERIFIED
ACCESS_DENIED
RESOURCE_NOT_FOUND
VALIDATION_FAILED
RATE_LIMITED
PROJECT_VERSION_CONFLICT
PROJECT_TOO_LARGE
ASSET_UPLOAD_EXPIRED
ASSET_NOT_READY
ASSET_VALIDATION_FAILED
QUOTA_EXCEEDED
IMPORT_CONFLICT
IMPORT_INVALID
EXPORT_CONFLICT
EXPORT_NOT_READY
EXPORT_EXPIRED
EXPORT_CANCELED
EXPORT_GENERATION_FAILED
EXPORT_RETRY_EXHAUSTED
PACKAGE_LIMIT_EXCEEDED
SERVICE_UNAVAILABLE
ADMIN_ACCESS_DENIED
```

不存在任务并发、Provider 配置/可用性、官方模型、积分或模式切换错误码。浏览器本地 Provider/CORS 错误属于 P8-5/P8-6 客户端语义，不是 Cloud API 契约。
