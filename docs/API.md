# AI Canvas Cloud API 契约

本文档只定义当前 HTTP API 的资源边界、请求响应、稳定错误和安全约束。运行时 schema 与 TypeScript 类型以 `packages/contracts` 为机器可验证来源；阶段状态和完成记录只写入 `ROADMAP.md`。

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

## 浏览器 Vault 与 API 边界

浏览器 Vault、任务缓存和临时生成结果没有 Cloud HTTP 资源。配置 Vault 使用 `schemaVersion=2`，任务缓存使用 `schemaVersion=3` 并兼容解密迁移 v2，二者的 `cipherVersion=1`；IndexedDB 数据库版本为 3。设备存储使用不可导出的 WebCrypto AES-256-GCM `CryptoKey`，AAD 绑定版本、Origin 和可信 session 用户 ID，任务缓存额外绑定项目 ID，临时结果额外绑定任务 ID。Provider 配置不含 Key，Key 按 `providerProfileId` 存在独立凭据槽，模型条目以 `modelEntryId` 为唯一身份。Provider 与模型配置保存后固定把密文与 Key 写入当前 Origin 的 IndexedDB，不提供 persistence 或单独删除入口；登出/session 失效/换账号清空内存但不删除设备记录；清除当前网站数据会由浏览器删除密文、Key、模型绑定、任务缓存和临时结果。当前内测环境不读取历史 localStorage、旧 Vault 或 v1 任务缓存。

`GET /v1/models` 是浏览器到用户 Provider 的直接受控请求，不是 Cloud HTTP 契约：平台 API 不接收其 URL、Key、请求或响应。请求固定为 Bearer/Accept、无 Cookie、无 Referrer、禁止重定向、CORS、15 秒超时和 2 MiB 响应限制；弹窗取消不写入 Vault，确认把 Provider、凭据槽和模型条目作为同一次本地 Vault 更新保存。

设备保存与本地任务写入串行执行；异步结果只能更新同一可信用户、同一内部 persistence 和同一状态代次。两个浏览器设备的 IndexedDB/Key 相互独立，认证、工作区或项目 API 不上传、下载或同步 Vault、任务缓存或临时结果。

workspace 文件与 workspace/localStorage 缓存、项目图/checkpoint、迁移包、Cloud API 请求/响应、日志、指标和诊断均不得携带 Provider、endpoint、真实模型 ID、绑定、Key、remote task ID 或本地任务缓存。项目图只存 `local:<uuid>`，其本机绑定值为 `modelEntryId`。平台不新增 Provider 代理、连接测试或任务 API；浏览器只对受控 OpenAI Compatible/DashScope 路径发起请求，无 CORS 服务使用用户自有的固定目标网关。

同一设备重新打开项目时，浏览器从按可信用户/项目隔离的加密任务缓存恢复任务：排队任务重新进入本地调度；无 remote task ID 的运行中同步任务转为已中断；已有受控 remote task ID 且 Provider 绑定指纹未变化的异步任务继续轮询；已暂存结果的 `persisting` 任务只重试 Cloud 保存。新设备只收到图中的 `local:<uuid>`，必须由用户在节点上明确选择本机同类型模型完成绑定；认证和项目 API 不参与绑定、匹配或同步。

服务商和模型选择全部在浏览器内完成，不存在对应 Cloud API。节点把当前类别下可执行的 `ModelEntry` 按上游 `modelId` 分组，同名模型的不同服务商作为独立路由展示和选择；未绑定、已删除、缺失、停用或凭据无效的当前引用仍可见，但请求在浏览器适配器前被拒绝。匿名引用绑定后，执行请求和本地任务使用该绑定解析出的 `modelEntryId`，而项目图字段继续保留 `local:<uuid>`。

生成结果入云只调用既有 `POST /api/v1/assets/uploads`、签名直传、`POST /api/v1/assets/uploads/:uploadId/complete` 和 `PATCH /api/v1/projects/:projectId/graph`。资产创建元数据使用 `generated-<taskId>.<ext>`，不包含真实模型 ID；图变更中只出现 `local:<uuid>` 与 Cloud asset UUID。图片结果先写入按用户、项目和任务隔离的加密临时 Blob，再上传 Cloud；上传或图变更失败时不重新发起 Provider POST，任务停留在可继续保存的本地阶段，成功后立即删除临时 Blob。Provider 结果无法下载时任务失败且不提交成功图变更。

生成运营遥测是上述边界的唯一最小化例外：它只记录请求类别、生命周期、耗时、结果数量和受限失败分类，不是生成任务 API，也不能恢复、轮询、重试或查看 Provider 请求。

```text
POST /api/v1/telemetry/generations
```

请求由可信 session 推导用户和 workspace，正文拒绝未知字段。`attemptId` 必须是浏览器随机 UUID；`category` 只允许 `text|image|video`。开始事件为 `{ attemptId, category, status: "started" }`；终态只允许 `succeeded|failed|canceled`，携带 0–86400000 的整数 `durationMs`。成功还要求 `resultCount=1..32`，失败还要求 `failureCategory=network|authentication|rate_limited|upstream|invalid_response|asset_upload|unknown`。同一用户、workspace、attempt 只允许 `started -> terminal`，重复或乱序请求幂等收敛；响应为 `202 { accepted: true, attemptId, status }`。

正文绝不接受 Prompt、输出、Provider、模型 ID、endpoint、API Key、上游响应正文或 remote task ID。遥测发送失败不能阻断浏览器生成；服务端写接口仍执行普通 Cookie Origin/CSRF 边界和 Redis `write` 限流。

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

`live` 只表示进程可响应。普通 API `ready` 并行执行 PostgreSQL query、Redis `PING` 和 S3 `HeadBucket`；Admin API `ready` 只执行 PostgreSQL query 与 S3 `HeadBucket`。失败返回 `503`、`status=degraded`，错误分类只允许 `connection_refused|timeout|authentication_failed|permission_denied|bucket_unavailable|unknown`。响应不含连接串、主机凭据、Bucket/object key 或底层错误正文。

`/metrics` 仅用于受控内网抓取。普通 API 包含请求/延迟、错误、认证失败、限流、项目冲突、配额、迁移阶段、依赖和数据库连接池；Admin API 额外暴露同进程的 SMTP 测试投递计数。邮件指标仅使用 operation/outcome/reason/source 低基数标签，不含主机或邮箱。不存在 Worker metrics、任务 backlog/running/retry/lease、Provider/模型维度或结果转存指标；生成运营聚合只通过独立 Admin dashboard 读取。标签禁止 workspace/user/project/request ID、URL、邮箱、正文和凭据。

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
POST   /api/v1/auth/registration/email-code
POST   /api/v1/auth/password/forgot
POST   /api/v1/auth/password/reset
POST   /api/v1/auth/password/change
```

底层委托 Better Auth 管理用户名、邮箱密码、签名 Cookie、session 和内部密码重置 token。注册请求为 `{ username, email, password, emailVerificationCode?, deviceId? }`；`username` 必须匹配 `^[A-Za-z][A-Za-z0-9_]{2,29}$`，保留输入大小写用于展示，以小写规范值实现全局唯一。`admin|administrator|api|root|support|system` 不可注册，格式或保留词返回 `400 VALIDATION_FAILED`，冲突返回稳定 `409 USERNAME_UNAVAILABLE`。不提供用户名可用性查询或修改接口。

登录请求为 `{ identifier, password, deviceId?, force? }`；`identifier` 包含 `@` 时按邮箱登录，否则按不区分大小写的用户名登录。账号不存在、邮箱不存在、用户名不存在或密码错误统一返回 `401 AUTH_REQUIRED` 和“账号或密码错误”语义，不允许据此枚举账号。忘记密码仍只接受邮箱。注册、登录与 session 恢复后幂等确保 personal workspace 和 owner membership。

用户摘要包含 Better Auth 内部 ID、不可变 `userNumber`、保留原始大小写的不可变 `username`、email、status、emailVerified；不返回兼容 `name` 或图片头像。workspace 摘要包含 ID、personal 类型、名称、role、status、planKey。`userNumber` 只用于展示/检索，不参与认证或资源授权。

同账号只允许一个有效 session。登录检测到其他有效 session 时删除本次临时 session，返回 `409 ACTIVE_SESSION_EXISTS`；只有 `force=true` 的明确确认才撤销旧 session 并签发新 Cookie。

`deviceId` 是浏览器级、非认证的随机标识。每个浏览器在同一 Origin 独立保存它，因此同一台电脑使用 Chrome、Edge 或 Firefox 会产生独立的设备管理记录；平台不采集硬件指纹，不跨浏览器共享或合并 ID，也不将其作为认证凭据。`/auth/devices` 和 `DeviceSummary` 契约保持兼容，列表只返回当前账号的 label、首次/最近时间和 current；只能删除自己的非当前设备历史记录。忘记密码接口不泄漏邮箱是否存在，密码重置成功后撤销旧 session。已登录用户可调用受 Cookie 保护的 `POST /api/v1/auth/password/change`，请求为 `{ currentPassword, newPassword }`；服务端通过 Better Auth 校验当前密码、更新密码并撤销其他有效 session，客户端随后退出当前会话并跳转登录。

网站设置开启 `registrationEmailVerificationRequired` 后，浏览器先以 `{ email }` 调用 `POST /api/v1/auth/registration/email-code`，再将邮件中的 6 位 `emailVerificationCode` 传给注册接口。验证码有效 10 分钟，60 秒内不重复投递，连续 5 次错误即消费失效；发送接口保持非枚举响应，不返回账号或挑战状态。注册接口只接受一次性未过期验证码，成功后将邮箱标为已验证。关闭开关时不发送注册验证邮件，注册直接将邮箱标为已验证。密码重置同样先以 `{ email }` 调用 `POST /api/v1/auth/password/forgot`，再以 `{ email, code, password }` 调用 `POST /api/v1/auth/password/reset`；两个接口都不泄漏邮箱是否存在。重置验证码遵循相同的 10 分钟、60 秒和 5 次失败限制，短期表仅保存 HMAC 与 AES-256-GCM token 密文；SMTP `sendMail` 不自动重试。

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

项目摘要包含 ID、name、version、lastSequence、nodeCount、edgeCount、兼容 `taskCount`、archive/创建/更新时间。当前 `taskCount` 正常为 0，只是历史契约兼容字段，不代表存在服务器任务 API。删除为软删除并清理 workspace user state 引用。

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
GET  /admin/v1/dashboard
GET  /admin/v1/audit-events
GET  /admin/v1/users
GET  /admin/v1/users/:userId
POST /admin/v1/users/:userId/ban
POST /admin/v1/users/:userId/unban
POST /admin/v1/users/:userId/revoke-sessions
GET  /admin/v1/smtp-settings
POST /admin/v1/smtp-settings/test-connection
POST /admin/v1/smtp-settings/test-email
POST /admin/v1/smtp-settings
POST /admin/v1/smtp-settings/disable
GET  /admin/v1/object-storage-settings
POST /admin/v1/object-storage-settings/test-connection
POST /admin/v1/object-storage-settings
POST /admin/v1/object-storage-settings/restore-environment
GET  /admin/v1/site-config
POST /admin/v1/site-config
GET  /admin/v1/site-assets
POST /admin/v1/site-assets
POST /admin/v1/site-assets/:assetId/complete
```

`GET /auth/csrf` 返回 token 并设置签名 HttpOnly CSRF Cookie。所有 Admin POST 要求精确 Origin、非 cross-site Fetch Metadata 和匹配的 `X-CSRF-Token`。普通用户 Cookie 无效。

验证码默认关闭；开启时 captcha 返回 5 位数字的短期 SVG challenge，数据库只保存 hash、失败次数和过期/消费时间。login 接受 username/password 和可选 captcha 字段；响应不返回内部 email 或 session token。

username 修改要求 3–30 位小写字母、数字、下划线或点。password 修改校验当前密码，新密码 12–256 位，成功后保留当前 session、撤销其他 Admin session并写脱敏审计。

`GET /admin/v1/dashboard` 要求 `dashboard.read`，四种 Admin 角色均可访问。响应包含 `generatedAt` 以及 `registrations`、`activity`、`storage`、`authentication`、`generation` 和 `infrastructure.postgres/objectStorage` 聚合；依赖项只返回 `ok/latencyMs` 和可选稳定错误分类，不返回用户列表或基础设施地址。

`generation.timeZone` 固定为 `Asia/Shanghai`。`today` 和 `yesterdaySamePeriod` 返回 requests/succeeded/failed/canceled/results/activeCreators/successRate/p95DurationMs；昨日同期使用相同已过自然日时长。成功率为 `succeeded / (succeeded + failed)`，主动取消不进入分母。`daily` 返回近 7 个上海自然日的文本/图片/视频请求和终态数量，`failures` 只返回当日受限失败分类排行。`registrations.today/yesterdaySamePeriod` 使用同一自然日边界。

用户运营要求 `super_admin` 或 `support`：GET 使用 `user.read`，POST 使用 `user.write`。`GET /admin/v1/users` 接受 `cursor`、`limit=1..100`（默认 50）、`status=active|disabled|deleted`、`verification=verified|unverified` 和最长 128 字符的 `search`；搜索仅匹配精确用户编号以及受控的用户名/邮箱子串。响应为 `{ items, nextCursor }`，按 `createdAt DESC, id DESC` 使用不透明 keyset 游标。

列表 `items` 只包含 `id/userNumber/username/email/emailVerified/status/workspaceCount/storageUsedBytes/activeSessionCount/lastActiveAt/createdAt/updatedAt`。`GET /admin/v1/users/:userId` 返回 `{ user, workspaces }`，workspace 只包含 ID、名称、类型、成员角色、状态、套餐键、存储配额/已用/预留和时间。响应不包含兼容 `name`、密码、session token、IP/User-Agent、项目正文、Prompt、资产内容/object key 或 Provider 配置。

三个用户 POST 都接受且只接受 `{ "reason": string }`，去除首尾空白后长度必须为 3–500，并执行统一 Admin Origin/Fetch Metadata/CSRF 校验。`ban`/`unban` 返回 `{ user, revokedSessionCount }`；封禁幂等设为 disabled 并撤销 session，解封设为 active 但不恢复旧 session。`revoke-sessions` 返回 `{ userId, revokedSessionCount, revokedAt }` 且不改变用户状态。目标不存在返回 `404 RESOURCE_NOT_FOUND`，目标为 deleted 或请求非法返回稳定校验错误；成功操作与脱敏审计同事务提交。

SMTP 设置只允许 `super_admin` 通过 `smtp_config.write` 访问。GET 返回 `state=unconfigured|active|disabled`、`source=none|environment|managed`、非敏感连接/发件字段、`passwordConfigured`、`revisionId` 和更新时间，永不返回旧密码。设置输入只接受 `host/port/securityMode/username/password?/fromEmail/fromName/expectedRevisionId`；端口限于 `25|465|587|2525`，安全模式限于 `implicit_tls|starttls`。首次 managed 配置必须提供密码，已有 managed revision 时留空表示保留。

连接测试和测试邮件使用当前请求表单，不发布配置，合计按管理员限制为 10 分钟 5 次；测试邮件额外接受 `recipient`，测试记录不保存收件地址、主机或凭据。保存会在写事务前重新验证连接，再以 `expectedRevisionId` 乐观锁原子插入不可变 revision、切换 current 并更新普通 API 可读发布投影；验证失败保留旧配置，冲突返回 `409 SMTP_CONFIG_CONFLICT`。disable 创建新的 disabled revision；普通 API 看到明确停用后不回退环境变量。

SMTP 上游错误只映射为 `SMTP_HOST_NOT_ALLOWED|SMTP_DNS_FAILED|SMTP_CONNECTION_FAILED|SMTP_TLS_FAILED|SMTP_AUTH_FAILED|SMTP_SENDER_REJECTED|SMTP_RECIPIENT_REJECTED`；测试限流为 `SMTP_RATE_LIMITED`。响应、日志、审计与指标不包含上游原始响应、密码、token、注册或密码重置验证码、完整密码重置链接或收件邮箱。

对象存储设置只允许 `super_admin` 通过 `object_storage_config.write` 访问。GET 返回 `source=unconfigured|environment|managed`、非敏感连接字段、`credentialsConfigured/environmentFallbackConfigured/identityLocked/revisionId/updatedAt`，永不返回 AccessKey。`unconfigured` 表示服务已启动但尚无可用对象存储，连接字段为空。写入只接受 `endpoint/publicEndpoint/publicOrigin/region/bucket/forcePathStyle/accessKeyId?/secretAccessKey?/expectedRevisionId`；两项凭据必须同时出现，首个 managed revision 必填，后续留空表示保留。

测试连接和保存都执行候选 Bucket 的 `HeadBucket`、随机对象写入、读回比对和删除；测试不发布，保存验证成功后才原子切换。已有资产时改变存储身份返回 `409 OBJECT_STORAGE_IDENTITY_LOCKED`，revision 冲突返回 `409 OBJECT_STORAGE_CONFIG_CONFLICT`，读写删除失败为 `OBJECT_STORAGE_CONNECTION_FAILED`，限流为 `OBJECT_STORAGE_RATE_LIMITED`。恢复环境要求当前 revision 且 `environmentFallbackConfigured=true`，否则返回 `409 OBJECT_STORAGE_ENVIRONMENT_FALLBACK_UNAVAILABLE`；探针 key、AccessKey 和 SDK 原始错误不进入响应、日志或审计。

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
USERNAME_UNAVAILABLE
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
SMTP_CONFIG_CONFLICT
SMTP_HOST_NOT_ALLOWED
SMTP_DNS_FAILED
SMTP_CONNECTION_FAILED
SMTP_TLS_FAILED
SMTP_AUTH_FAILED
SMTP_SENDER_REJECTED
SMTP_RECIPIENT_REJECTED
SMTP_RATE_LIMITED
```

不存在任务并发、Provider 配置/可用性、官方模型、积分或模式切换错误码。Vault/任务缓存存储解密、任务中断恢复、设备模型绑定以及浏览器 Provider/CORS/结果下载错误均属于客户端语义，不是 Cloud API 契约。
