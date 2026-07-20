# AI Canvas Cloud API 契约

本文档定义首发 HTTP API 的资源边界。实际 OpenAPI/schema 文件落地后应成为机器可验证的协议来源，本文件保留长期语义和安全约束。

## 通用约定

- API 前缀：`/api/v1`。
- 浏览器认证：服务端不透明会话 Cookie。
- JSON 请求必须设置大小和深度上限。
- 所有响应携带 request ID。
- 列表使用不透明游标分页，不接受任意 offset 扫描大型表。
- 创建、图批次、上传完成、任务和用量相关写操作支持幂等键。
- 时间使用 ISO 8601 UTC；ID 对客户端是不透明字符串。

P7-1/P7-3/P7-4 起，浏览器来源使用 `WEB_ALLOWED_ORIGINS` 精确匹配。允许来源的 CORS 响应回显该精确 origin、允许 credentials，并仅在 `OPTIONS` 预检中开放固定的 `GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS` 与 `content-type/x-request-id`；不使用 `*`。任何携带不受信 `Origin` 的请求在认证和业务路由前返回 `403 ACCESS_DENIED`，不回显来源或读取其 Cookie。staging/production 的 Cookie 写请求以及登录、注册、密码/邮箱认证写入口缺失允许 Origin 时同样返回 `403 ACCESS_DENIED`，所有非安全方法拒绝 `Sec-Fetch-Site: cross-site`。无 Cookie 的健康检查和受控服务端客户端保留可用性。

API 响应统一发送 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、Referrer/Permissions/COOP/CORP 及 `default-src 'none'` 的 API CSP；staging/production 发送 HSTS。该 CSP 只约束 API 响应，不代表 Web HTML 的页面 CSP 已配置。

API 对认证尝试、密码/邮件、Provider 测试、任务创建、资产/迁移 prepare 和普通读写使用 Redis 共享限流。超限固定返回 `429 RATE_LIMITED`、`retryable=true`，并发送整数秒 `Retry-After`；`details` 最多包含相同的非敏感等待秒数，不包含 Cookie、邮箱、账号、workspace、IP 或 Redis key。Redis 不可用时普通读 fail-open，高风险认证、费用写和普通写 fail-closed，返回可重试 `503 SERVICE_UNAVAILABLE` 且不得读取 body 或调用领域服务。

Web 页面由 staging Nginx 发送页面级 CSP、HSTS、frame-ancestors、Referrer-Policy、Permissions-Policy、nosniff 和静态资源缓存头。CSP 的 `script-src` 仅允许 `'self'`，图片/视频/连接只允许 `'self'`、浏览器 blob/data 和配置的 `S3_PUBLIC_ORIGIN`，不允许 `unsafe-eval` 或任意公网媒体源。

对象存储管理地址 `S3_ENDPOINT` 不返回浏览器；签名 URL 使用独立 `S3_PUBLIC_ENDPOINT`，并由 protected 配置验证其 HTTPS origin 与 `S3_PUBLIC_ORIGIN` 一致。staging bucket CORS 只允许 `WEB_ALLOWED_ORIGINS` 的 GET/PUT/HEAD、Content-Type/必要 `x-amz-*` headers 并暴露 ETag，匿名 list/read/write 保持关闭。资产单文件上限 50 MiB；迁移 manifest 和 JSON 深度/entries、8 MiB API body、8 MiB multipart part、最多 256 parts、短期签名 TTL、MIME/大小/SHA-256 完成复核共同组成上传边界。对象缺失、MIME/大小/hash 不匹配不得进入 completed asset 或正式引用。

P7-5 起，所有 JSON API 请求在路由业务逻辑前拒绝非法 UTF-8、重复对象键、非法 Unicode 代理项、非有限数值、超过 64 层或 100000 entries 的结构；各路由仍执行自身更小的字节上限和字段 schema。迁移包额外拒绝路径穿越、大小写重复路径、symlink、ZIP bomb、data/blob/持久 URL、敏感字段和非 canonical JSON。错误响应不回显 Cookie、Authorization、token、API Key、对象 key、签名 URL、附件正文、底层存储错误或完整 Provider 响应。

P7-6 的资源访问只使用可信 session actor 推导的 user/workspace，客户端提交的 `userId`、`workspaceId`、项目/资产/任务归属字段不参与授权。不存在资源和其他 workspace 资源使用相同 `404 RESOURCE_NOT_FOUND` 语义；签名 URL 只在当前 workspace 的服务端授权成功后生成。会话和设备撤销同样按当前用户作用域查询，owner/admin/editor/viewer 的写权限由服务端 workspace membership 决定。

成功响应可以直接返回资源或统一 data envelope，P0 固定后不得混用。错误响应固定为：

```json
{
  "error": {
    "code": "PROJECT_VERSION_CONFLICT",
    "message": "项目已在其他位置更新",
    "retryable": false,
    "requestId": "req_...",
    "details": {
      "currentVersion": 19
    }
  }
}
```

`details` 只包含恢复所需的非敏感信息。生产错误不得返回堆栈、SQL、Cookie、API Key 或 Provider Authorization。

## 可观测性

```text
GET /metrics
```

`/metrics` 返回 Prometheus text exposition 格式的 API 指标，不要求浏览器会话，仅用于受控内网抓取。它包含请求计数/延迟、错误、认证失败、限流、项目版本冲突、配额、迁移阶段、PostgreSQL/Redis/对象存储依赖、PostgreSQL pool total/idle/waiting，以及 queued backlog、running task、过期租约和可重试失败 gauge。Worker 的内网 `GET /metrics` 还包含 outbox/Consumer/lease recovery、任务重试、Provider 请求耗时和结果转存失败。指标 registry 只允许固定低基数枚举标签，拒绝 workspace/user/project/task/request ID、URL、邮箱、请求正文、长值和凭据；健康检查错误只返回 Error 类型。

## 健康检查

```text
GET /health/live
GET /health/ready
GET /api/v1/health/live
GET /api/v1/health/ready
```

`live` 只表示 API 进程仍可响应，不触发数据库、Redis 或对象存储访问。`ready` 并行检查 PostgreSQL、Redis 和配置 Bucket：对象存储使用服务端 S3 凭据执行 `HeadBucket`，不调用 MinIO 专用路径。全部依赖可用时返回 `200` 与 `status=ok`；任一依赖停止时返回 `503`、`status=degraded` 和不含 URL/凭据的错误类别。健康检查不执行数据库迁移，迁移必须由独立发布步骤运行。

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
DELETE /api/v1/account
```

认证兼容接口保留在 `/api/v1/auth/*`，底层委托 Better Auth 管理邮箱密码、签名 HttpOnly Cookie、session、邮箱验证 token 和密码重置 token。注册、登录和会话恢复后，Cloud 侧会幂等确保个人工作区和 owner membership 存在。

注册、登录和 `GET /auth/session` 返回的用户摘要包含不可变数字用户编号：

```json
{
  "user": {
    "id": "better-auth-internal-id",
    "userNumber": 10001,
    "email": "artist@example.com",
    "status": "active",
    "emailVerified": true
  },
  "workspace": {
    "id": "workspace-uuid",
    "type": "personal",
    "name": "artist 的个人空间",
    "role": "owner",
    "status": "active",
    "planKey": "free"
  }
}
```

`userNumber` 从 `10001` 开始递增，用于账号页展示和后台人工检索；它可被枚举，因此不得作为认证凭据、对象存储边界或资源授权依据。服务端仍只信任 HttpOnly session 解析出的 Better Auth `user.id`。

### 登录与单设备接管

同账号只允许一个有效登录 session。`POST /auth/login` 首次提交会先完成密码验证；如检测到其他有效 session，本次临时 session 立即删除并返回 `409 ACTIVE_SESSION_EXISTS`，不设置 Cookie。客户端明确确认后以同一凭据和 `force: true` 重试，服务端撤销旧 session 并签发新 Cookie。

### 设备历史

`deviceId` 是浏览器生成的非认证设备标识，只用于关联设备历史，不参与授权。`GET /auth/devices` 返回当前账号的持久设备记录，每项包含 `id`、`deviceLabel`、`firstSeenAt`、`lastSeenAt` 和 `current`；`DELETE /auth/devices/:deviceId` 只能删除当前用户自己的非当前设备记录。`GET /auth/sessions` 与 `DELETE /auth/sessions/:sessionId` 保留为活跃会话管理兼容接口。

### 会话恢复与账号安全

前端首屏恢复一次 session，可见页面每 5 分钟心跳一次，业务 API 返回未授权时立即清理 Cloud 会话缓存并回到登录页。密码重置成功后撤销旧会话。登录、注册、验证和重置需要分层限流；忘记密码接口不得泄漏邮箱是否存在。

邮箱验证请求：

```json
{
  "token": "verification-token"
}
```

密码重置请求：

```json
{
  "token": "reset-token",
  "password": "new-long-enough-password"
}
```

## 工作区

```text
GET /api/v1/workspaces/current
GET /api/v1/workspaces/current/usage
```

`GET /workspaces/current` 从当前 HttpOnly session 解析用户并返回当前工作区摘要：

```json
{
  "workspace": {
    "id": "workspace_...",
    "type": "personal",
    "name": "artist 的个人空间",
    "role": "owner",
    "status": "active",
    "planKey": "free"
  }
}
```

首发不提供工作区切换和成员邀请，但响应保留工作区 ID、类型和用户角色；用量与配额由独立 `/usage` 响应提供。工作区 ID 不能单独构成授权；服务端领域模块必须同时校验 session 用户和 `workspace_members` 成员关系，非成员访问返回不泄漏存在性的拒绝。

`GET /workspaces/current/usage` 同样只使用当前 session 的用户和 workspace，不接受查询参数或请求体指定租户。首发 personal workspace 的云资产配额为 20 GiB：

```json
{
  "workspaceId": "workspace_...",
  "storage": {
    "usedBytes": 1073741824,
    "reservedBytes": 52428800,
    "totalBytes": 1126170624,
    "quotaBytes": 21474836480,
    "availableBytes": 20348665856
  },
  "projects": [
    {
      "projectId": "11111111-1111-4111-8111-111111111111",
      "name": "产品主视觉",
      "fileCount": 12,
      "nodeCount": 24,
      "storageBytes": 268435456,
      "archivedAt": null,
      "updatedAt": "2026-07-17T12:00:00.000Z"
    }
  ]
}
```

`usedBytes` 包含 completed、failed 和 quarantined 资产，`reservedBytes` 包含 pending 上传，`totalBytes` 为两者之和；软删除资产退出逻辑用量。`projects` 返回当前工作区所有未软删除项目，按项目来源聚合同一配额口径下的文件数和字节数，并直接读取关系化的 `projects.node_count`；列表按占用字节降序排列，归档项目保留 `archivedAt`，已删除项目不返回。响应不包含对象 key、资产 ID、用户 ID 或其他工作区统计。

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

本切片已实现以上七个接口。所有接口先从 HttpOnly session 解析 `userId` 和当前 `workspaceId`，请求体、查询参数和路径均不接受客户端指定的 `user_id`/`workspace_id`。读取要求当前工作区成员身份；创建、重命名、归档、恢复和删除只允许 owner/admin/editor。项目不存在、已软删除或属于其他工作区时统一返回 `404 RESOURCE_NOT_FOUND`。

列表使用 `status=active|archived`（默认 `active`）、`limit=1..100`（默认 50）和不透明 `cursor`：

```json
{
  "projects": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "产品主视觉",
      "version": 0,
      "lastSequence": 0,
      "nodeCount": 0,
      "edgeCount": 0,
      "taskCount": 0,
      "archivedAt": null,
      "createdAt": "2026-07-15T10:00:00.000Z",
      "updatedAt": "2026-07-15T10:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

创建请求只接受可选客户端 UUID 和白名单名称字段。`id` 用于浏览器先生成项目 ID 后再幂等创建；不传时由服务端生成 UUID。重试同一 `id`、同一工作区和同一名称会返回已创建项目；同一 `id` 指向其他工作区、已删除项目或不同名称时返回 `409 VALIDATION_FAILED`。客户端仍不能提交 `user_id` 或 `workspace_id`：

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "产品主视觉"
}
```

创建返回 `201`，读取和元数据变更返回 `200` 与 `{ "project": <项目摘要> }`。归档/恢复为幂等动作；`DELETE` 只设置 `deleted_at` 并清除工作区用户状态中对该项目的活动/最近打开引用，返回 `{ "ok": true }`。项目列表和读取不包含全部节点、连线、任务、检查点、工作区 ID 或操作者 ID；`PATCH` 不能修改租户、版本、计数、归档或删除状态。

## 项目图

```text
GET   /api/v1/projects/:projectId/graph
PATCH /api/v1/projects/:projectId/graph
GET   /api/v1/projects/:projectId/changes?after=<sequence>
```

当前已实现 `GET /graph`、`PATCH /graph` 和 `GET /changes`。图读取响应包含项目 ID、版本、last sequence、规范化活动节点和活动连线，不返回数据库行版本、软删除行、工作区 ID 或其他租户信息：

```json
{
  "projectId": "11111111-1111-4111-8111-111111111111",
  "version": 18,
  "sequence": 41,
  "nodes": [],
  "edges": []
}
```

`GET /changes` 从当前 HttpOnly session 解析用户和工作区，只返回该工作区内未软删除项目在指定 sequence 之后的有序变更批次；`after` 省略时按 `0` 处理，必须是非负安全整数。响应最多返回 500 条 change，客户端可在 `hasMore=true` 时用最后一条 `sequence` 继续请求。响应不包含 `workspaceId`、`actorUserId`、幂等键或数据库内部行信息：

```json
{
  "projectId": "11111111-1111-4111-8111-111111111111",
  "version": 19,
  "sequence": 42,
  "after": 41,
  "changes": [
    {
      "sequence": 42,
      "baseVersion": 18,
      "resultVersion": 19,
      "clientId": "browser_01J...",
      "batchId": "batch_01J...",
      "source": "user",
      "operations": [
        {
          "type": "deleteEdge",
          "edgeId": "edge_01J..."
        }
      ],
      "createdAt": "2026-07-14T10:00:00.000Z"
    }
  ],
  "hasMore": false
}
```

图操作请求示例：

```json
{
  "baseVersion": 18,
  "clientId": "browser_01J...",
  "batchId": "batch_01J...",
  "idempotencyKey": "graph_01J...",
  "operations": [
    {
      "type": "upsertNode",
      "node": {
        "id": "node_01J...",
        "nodeType": "generateNode",
        "position": { "x": 320, "y": 180 },
        "size": { "width": 360, "height": 480 },
        "dataSchemaVersion": 1,
        "data": { "prompt": "产品图", "model": "gpt-image-1" }
      }
    },
    {
      "type": "deleteEdge",
      "edgeId": "edge_01J..."
    }
  ]
}
```

成功响应：

```json
{
  "projectId": "project_01J...",
  "version": 19,
  "sequence": 42,
  "acceptedBatchId": "batch_01J...",
  "updatedAt": "2026-07-14T10:00:00Z"
}
```

约束：

- 服务端不接受客户端指定 `workspace_id` 或操作者。
- `GET /changes` 同样不接受客户端指定 `workspace_id`、`user_id` 或操作者；跨工作区、已软删除或不存在项目统一返回 `404 RESOURCE_NOT_FOUND`。
- 所有 operations 作为一个事务接受或拒绝。
- 同一 actor、client、batch、幂等键、baseVersion 和 operations 的重复提交返回同一已接受结果；复用幂等键或 batch ID 提交不同内容返回 `409 VALIDATION_FAILED`。
- 非幂等重试的 `baseVersion` 不一致返回 `409 PROJECT_VERSION_CONFLICT`，`details.currentVersion` 提供重新加载依据。
- 每批包含 1-500 个操作，同一节点或连线在一个批次中只能变更一次；实体 ID 最长 128 字符，图 PATCH 请求体上限为 2 MiB。
- 节点父级必须是操作后仍活动的同项目节点且不能成环；source/target 必须是操作后仍活动的同项目节点。
- 删除节点在同一事务软删除关联边；归档项目拒绝新的图修改，但已接受批次仍可幂等重试。
- `upsertNode` 只把规范化 UUID/`cloud-assets/<asset-id>` 识别为持久化资产引用；签名 URL、object key、第三方 URL 和 data/blob URL 不构成资产身份。被引用资产必须属于可信 session 的当前工作区、未删除且状态为 completed。
- 节点 upsert 会在同一事务替换该节点旧 `asset_references`，节点 delete 会删除该节点引用；任一资产校验失败时节点、连线、项目 version/sequence、`project_changes` 和引用全部不提交。
- 当前工作区 pending、failed 或 quarantined 资产返回 `409 ASSET_NOT_READY`；跨工作区、已删除或不存在资产统一返回 `404 RESOURCE_NOT_FOUND`，不泄漏其他租户资产是否存在。

## 检查点与历史

```text
POST /api/v1/projects/:projectId/checkpoints
GET  /api/v1/projects/:projectId/revisions
GET  /api/v1/projects/:projectId/revisions/:version
POST /api/v1/projects/:projectId/revisions/:version/restore
```

当前已实现 `POST /revisions/:version/restore`。请求必须携带客户端最近确认的当前项目 `expectedVersion` 和 `expectedSequence`，服务端从 session 解析用户和工作区，锁定项目后校验当前版本一致，读取目标版本最新有效 checkpoint，先创建 `pre_restore` 检查点保护恢复前状态，再用目标 checkpoint 的节点和连线替换当前关系图，追加一条 `source="restore"` 的 `project_changes`，递增项目 version/sequence，并把 `projects.saved_snapshot_id` 指向被恢复的 checkpoint。请求体不接受 `workspace_id`、`user_id`、操作者或任意 `record_json`。

成功响应包含 `restoredCheckpoint`、`preRestoreCheckpoint`、更新后的 `project` 摘要，以及新的 `version` 和 `sequence`。版本不一致返回 `409 PROJECT_VERSION_CONFLICT` 并带 `details.currentVersion/currentSequence`；归档项目返回 `403 ACCESS_DENIED`；目标 checkpoint 不存在、跨工作区或项目已软删除返回 `404 RESOURCE_NOT_FOUND`。

当前已实现 `POST /checkpoints` 创建 `manual` 或 `periodic` checkpoint。请求必须携带客户端最近确认的项目版本和 sequence，服务端从 session 解析用户和工作区，锁定项目后确认当前版本完全一致，再读取当前关系化节点/连线生成 `project_snapshots`。P4-8 起，服务端同时从节点 record 提取 Cloud asset UUID 集合，校验当前工作区 completed 状态并写入内部 `asset_manifest_json`；客户端不能提交或覆盖 manifest。`checkpointType` 省略时按 `manual` 处理；`manual` 会把 `projects.saved_snapshot_id` 指向新检查点，`periodic` 只写入历史检查点，不改变手动保存点。请求体不接受 `workspace_id`、`user_id`、操作者或任意 `record_json`：

```json
{
  "expectedVersion": 19,
  "expectedSequence": 42,
  "checkpointType": "periodic"
}
```

成功返回 `201`：

```json
{
  "checkpoint": {
    "id": "checkpoint_...",
    "projectId": "11111111-1111-4111-8111-111111111111",
    "projectVersion": 19,
    "lastSequence": 42,
    "snapshotType": "manual",
    "schemaVersion": 1,
    "byteSize": 2048,
    "isValid": true,
    "createdAt": "2026-07-15T10:00:00.000Z"
  },
  "project": {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "产品主视觉",
    "version": 19,
    "lastSequence": 42,
    "nodeCount": 12,
    "edgeCount": 8,
    "taskCount": 0,
    "archivedAt": null,
    "createdAt": "2026-07-15T08:00:00.000Z",
    "updatedAt": "2026-07-15T10:00:00.000Z"
  }
}
```

若项目已被其他客户端更新，返回 `409 PROJECT_VERSION_CONFLICT`，`details.currentVersion` 和 `details.currentSequence` 提供重新加载或增量追平依据。归档项目拒绝创建新 checkpoint；跨工作区、已软删除或不存在项目统一返回 `404 RESOURCE_NOT_FOUND`。

当前已实现 `GET /revisions`，返回 checkpoint 摘要列表，不返回完整 `record_json`。列表按 `createdAt DESC, id DESC` 排序，支持 `limit=1..100`（默认 20）和不透明 `cursor`：

```json
{
  "revisions": [
    {
      "id": "checkpoint_...",
      "projectId": "11111111-1111-4111-8111-111111111111",
      "projectVersion": 19,
      "lastSequence": 42,
      "snapshotType": "manual",
      "schemaVersion": 1,
      "byteSize": 2048,
      "isValid": true,
      "createdAt": "2026-07-15T10:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

当前已实现 `GET /revisions/:version`，按项目版本读取该版本最新创建的 checkpoint，并返回完整 `record`。同一版本存在多个 checkpoint 时，返回 `createdAt DESC, id DESC` 的第一条；不存在、跨工作区或项目已软删除时返回 `404 RESOURCE_NOT_FOUND`。`asset_manifest_json` 保持服务端内部 GC/恢复校验字段，不随摘要或详情响应暴露：

```json
{
  "checkpoint": {
    "id": "checkpoint_...",
    "projectId": "11111111-1111-4111-8111-111111111111",
    "projectVersion": 19,
    "lastSequence": 42,
    "snapshotType": "manual",
    "schemaVersion": 1,
    "byteSize": 2048,
    "isValid": true,
    "createdAt": "2026-07-15T10:00:00.000Z"
  },
  "record": {
    "schemaVersion": 1,
    "project": {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "产品主视觉",
      "version": 19,
      "lastSequence": 42
    },
    "canvas": {
      "nodes": [],
      "edges": []
    },
    "taskQueue": {
      "tasks": []
    }
  }
}
```

恢复会创建新版本，不覆盖旧检查点。P4-8 起，目标 checkpoint 的 `asset_manifest_json` 必须与 `record.canvas.nodes` 提取出的 Cloud 资产集合一致；服务端按可信 session 工作区重新校验所有目标资产仍未删除且为 completed，再创建带当前资产 manifest 的 `pre_restore` 检查点、替换节点/连线并重建 `asset_references`。manifest 损坏或与 record 不一致返回 `409 VALIDATION_FAILED`；当前工作区非 completed 资产返回 `409 ASSET_NOT_READY`；跨工作区、已删除或缺失资产统一返回 `404 RESOURCE_NOT_FOUND`。任一失败不会提交 pre-restore、节点/连线、引用、change 或 version/sequence。任务队列恢复仍随 P5 接入。

P4-9 的历史 manifest 前向修复不是浏览器 HTTP API，不接受用户传入 workspace、asset ID 或 record。运维入口 `npm run db:repair:checkpoint-assets` 默认只读预检，显式 `--apply` 后才按 checkpoint 短事务提交；输出只包含 checkpoint/project ID、动作、非泄漏原因分类和计数，不返回 manifest、资产 ID、workspace ID 或具体资产状态。修复不会改写 checkpoint record、当前图、version/sequence、changes 或当前引用，也不会清空或改指 `saved_snapshot_id`。

## 资产

```text
POST   /api/v1/assets/uploads
POST   /api/v1/assets/uploads/:uploadId/complete
GET    /api/v1/assets/:assetId
GET    /api/v1/assets/:assetId/url
DELETE /api/v1/assets/:assetId
```

当前已实现 `POST /assets/uploads` 创建上传会话。请求包含项目、文件名、MIME、字节数、资产类型、引用用途和幂等键，可选 `sha256` 与图片尺寸。服务端从 session 解析用户和工作区，不接受客户端提交 `workspace_id` 或 `user_id`，写操作要求 owner/admin/editor。当前对象存储适配使用 S3 兼容预签名 `PUT`，本地开发面向 MinIO，后续可替换为 OSS 兼容适配：

```json
{
  "projectId": "11111111-1111-4111-8111-111111111111",
  "originalFileName": "reference.png",
  "mimeType": "image/png",
  "byteSize": 2048,
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "width": 1024,
  "height": 768,
  "assetKind": "upload",
  "referenceRole": "source",
  "idempotencyKey": "asset_upload_01J..."
}
```

成功返回 `201`，只包含可暴露给浏览器的短期上传信息，不返回 object key、workspace ID、永久 access key 或 secret：

```json
{
  "upload": {
    "id": "55555555-5555-4555-8555-555555555555",
    "assetId": "66666666-6666-4666-8666-666666666666",
    "projectId": "11111111-1111-4111-8111-111111111111",
    "originalFileName": "reference.png",
    "expectedMimeType": "image/png",
    "expectedByteSize": 2048,
    "expectedSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "assetKind": "upload",
    "status": "pending",
    "expiresAt": "2026-07-15T00:15:00.000Z",
    "createdAt": "2026-07-15T00:00:00.000Z"
  },
  "asset": {
    "id": "66666666-6666-4666-8666-666666666666",
    "projectId": "11111111-1111-4111-8111-111111111111",
    "originalFileName": "reference.png",
    "mimeType": "image/png",
    "byteSize": 2048,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "width": 1024,
    "height": 768,
    "assetKind": "upload",
    "status": "pending",
    "createdAt": "2026-07-15T00:00:00.000Z",
    "updatedAt": "2026-07-15T00:00:00.000Z"
  },
  "directUpload": {
    "method": "PUT",
    "url": "http://localhost:9000/ai-canvas-cloud/...",
    "headers": {
      "content-type": "image/png"
    },
    "expiresAt": "2026-07-15T00:15:00.000Z"
  }
}
```

同一工作区复用同一 `idempotencyKey` 且元数据一致时返回同一 upload/asset 并重新生成短期上传 URL；复用幂等键但文件元数据不同返回 `409 VALIDATION_FAILED`；上传会话已过期或不再 pending 返回 `409 ASSET_UPLOAD_EXPIRED`。

创建新上传会话会在 workspace 行锁内把 `byteSize` 作为 pending 容量预留，并以最新已用量和预留量校验 20 GiB 配额。同一幂等请求不重复预留；不同并发请求不能共同超限。超过配额返回 `409 QUOTA_EXCEEDED`，`details` 只包含 `quotaBytes`、`usedBytes`、`reservedBytes`、`availableBytes` 和 `requestedBytes`，不会创建 asset/upload 行或签发上传 URL。

Web Cloud 平台层已接入完整调用顺序：从项目资产路径推导 `projectId`、`assetKind` 和引用用途，创建上传会话后直接以响应中的 method/headers/body 请求对象存储 URL。对象存储直传使用 `credentials: omit`，不得携带站点 Cookie、Authorization 或对象存储永久凭据；直传非 2xx 时不得调用完成确认。成功完成后前端只保存 `cloud-assets/<asset-id>`、文件名、MIME 和必要显示元数据。图片导入、视频上传、生成结果、编辑、裁切和缩略图均复用该流程。

当前已实现 `POST /assets/uploads/:uploadId/complete`。请求体为空；服务端从 session 解析用户和工作区，按当前工作区查找上传会话，不接受客户端提交 `workspace_id`、`user_id` 或对象 key。完成接口从对象存储读取实际元数据并验证；浏览器声明不能作为事实。成功返回 completed upload 和 asset 摘要：

```json
{
  "upload": {
    "id": "55555555-5555-4555-8555-555555555555",
    "assetId": "66666666-6666-4666-8666-666666666666",
    "projectId": "11111111-1111-4111-8111-111111111111",
    "originalFileName": "reference.png",
    "expectedMimeType": "image/png",
    "expectedByteSize": 2048,
    "expectedSha256": null,
    "assetKind": "upload",
    "status": "completed",
    "expiresAt": "2026-07-15T00:15:00.000Z",
    "createdAt": "2026-07-15T00:00:00.000Z"
  },
  "asset": {
    "id": "66666666-6666-4666-8666-666666666666",
    "projectId": "11111111-1111-4111-8111-111111111111",
    "originalFileName": "reference.png",
    "mimeType": "image/png",
    "byteSize": 2048,
    "sha256": null,
    "width": null,
    "height": null,
    "assetKind": "upload",
    "status": "completed",
    "createdAt": "2026-07-15T00:00:00.000Z",
    "updatedAt": "2026-07-15T00:10:00.000Z"
  }
}
```

对象尚未直传完成返回 `409 ASSET_NOT_READY`；上传会话过期返回 `409 ASSET_UPLOAD_EXPIRED`；对象真实大小、MIME 或 SHA-256 与上传会话不一致返回 `422 ASSET_VALIDATION_FAILED`。

`GET /assets/:assetId` 已实现，只返回当前 session 工作区内 completed 资产的 `AssetSummary`。`GET /assets/:assetId/url` 在同样授权和状态校验后返回 5 分钟短期读取地址：

```json
{
  "assetId": "66666666-6666-4666-8666-666666666666",
  "url": "http://localhost:9000/ai-canvas-cloud-local/...X-Amz-Signature=...",
  "expiresAt": "2026-07-15T00:15:00.000Z"
}
```

任意有效工作区成员可以读取本工作区 completed 资产。跨工作区、已删除或不存在返回 `404 RESOURCE_NOT_FOUND`，不泄漏资产是否存在；pending、failed 和 quarantined 返回 `409 ASSET_NOT_READY`，且不会调用对象存储签名。响应不包含 object key、workspace ID 或对象存储凭据。

Web Cloud 平台层把上传完成后得到的 `cloud-assets/<asset-id>` 作为客户端资产定位符，按 asset ID 缓存本接口返回的 URL；当剩余有效期不足 30 秒时重新请求 `/url`，同一资产的并发刷新只发送一个请求。换账号、退出登录、session 失效或工作区切换必须清空缓存；旧 session 发出的在途签名请求在清理后不得重新写回缓存。签名 URL 只作为运行时解析结果，不作为节点、任务或检查点的长期资产来源。

项目图 `PATCH /projects/:projectId/graph` 已把当前节点资产引用接入 `asset_references`。客户端不提交 workspace、object key 或签名 URL 作为授权依据；服务端从节点持久化数据提取 Cloud asset ID，以 session 工作区校验 completed 状态，并在节点替换/删除时原子更新引用。该接口不新增请求字段，保持既有 baseVersion、幂等键、version/sequence 和 changes 契约。

P4-11 资产维护不是浏览器 HTTP API，不接受用户传入 workspace、asset ID 或 object key。运维入口 `npm run db:maintain:assets` 默认只读，分批诊断数据库 completed 资产缺失对象和 bucket `workspaces/` 受控前缀中的孤立对象；显式 `--apply` 后才按默认 168 小时宽限期执行 GC。数据库侧只回收 pending 已过期、failed、quarantined 或已软删除资产，completed 资产不因暂时无引用被回收。删除前会锁定资产并重新验证当前引用和同工作区有效 checkpoint manifest；缺失对象本身不会使仍受保护的数据库资产变为 deleted。JSONL 输出用于内部审计，不会通过用户 API 暴露其他工作区状态。该命令不改变项目图、version/sequence、changes 或手动保存点。

## 任务

```text
POST /api/v1/tasks
GET  /api/v1/tasks
GET  /api/v1/tasks/:taskId
POST /api/v1/tasks/:taskId/cancel
POST /api/v1/tasks/:taskId/retry
GET  /api/v1/tasks/events
```

P5-3 已实现任务 HTTP 路由，P5-11 增加事件轮询路径。所有作用域来自可信 session；读取允许当前工作区成员，创建、取消和重试要求 owner/admin/editor。创建返回 `201`，其余成功返回 `200`。跨工作区任务、项目或节点统一按不存在处理，响应不包含 workspace/user、请求参数、Worker 租约、远端任务 ID 或 Provider 凭据。

创建请求携带项目、source node、可选 preview node、image/video kind、Provider/model、参数对象和幂等键。当前只接受 `billingMode="workspace_key"`，且对应 Provider 必须已配置并为 active；服务端只锁定并确认配置，不在 API 路径解密密钥。`parameters` 最大 256 KiB、嵌套深度最大 12，不接受非 JSON 值，也拒绝任何层级的 apiKey、Authorization、base/api/target URL 或 endpoint 字段。客户端不能指定任意 Provider URL。创建幂等键在同一 workspace 唯一；同键同输入返回原任务，不同输入返回 `409 VALIDATION_FAILED`。同一 workspace 最多 5 个 queued/running 任务，超限返回 `409 TASK_CONCURRENCY_LIMIT` 和 `details.activeLimit=5`。P5-7 的 submission key、提交阶段、远端任务 ID 和 `PROVIDER_SUBMISSION_UNCERTAIN` 只属于 Worker/attempt 内部状态，不由本 API 接收或响应；不确定的非幂等提交不得被 API 重试入口伪装成普通重试。P5-8 的结果 URL、对象 key、SHA-256、用量账本和 worker 图变更同样没有浏览器 HTTP 写入接口：只由持有有效 lease 的 Worker 领域服务在私有转存成功后收敛，任务查询仍不返回这些内部字段。P5-9 已使能力矩阵中的 OpenAI `gpt-image-2` 同步图片、阿里百炼 `wanx2.1-t2i-turbo` 异步图片与 `wan2.7-t2v` 异步视频 task 由 Worker 消费；视频参数只接受服务端固定的分辨率、比例和时长，其他 Provider/model/kind 组合在创建时返回 `409 PROVIDER_CAPABILITY_UNSUPPORTED`。未新增任务 HTTP 字段或响应字段，浏览器仍不能提交 Provider endpoint、密钥、远端任务 ID、结果字节或用量。

P5-10 Cloud Web 已使用上述 task API：创建请求的幂等键由当前项目和本地 UI task ID 派生，浏览器分页读取当前项目任务并把返回 `GenerationTaskSummary` 的 server task ID、0-100 `progress`、状态和脱敏错误映射为投影；非当前项目只使用同一固定列表路由附带 `status=queued` 或 `status=running` 做轮转式活跃任务缓存。取消/重试命令从浏览器生成新的命令幂等键；浏览器不把 `remoteTaskId`、attempt、结果 URL 或对象 key 写入请求。任务终态的媒体恢复不扩展 task response，而是重新读取项目图并按其中的 asset ID 请求既有 `GET /assets/:assetId/url`。

列表支持 `projectId`、`status`、`cursor` 和 `limit`；status 只允许 queued/running/succeeded/failed/canceled，limit 默认为 50、最大 100，按 `(created_at, id)` 倒序 keyset 分页。取消/重试请求均为 `{ "idempotencyKey": "..." }`。queued 取消立即进入 canceled；running 取消只写 `cancelRequestedAt`，由后续 Worker 收敛；只有 failed 且未达到 max attempts 的任务可重排为 queued。命令幂等键在同一 workspace 全局唯一，同键重放返回当前任务状态，同键用于其他任务或命令返回冲突。取消和重试不会修改项目图 version/sequence 或 `project_changes`。

`GET /api/v1/tasks/events` 是 P5-11 首发的轮询接口，接受 `projectId`、可选 `taskId`、数字 `after` 游标和 `limit`（默认 100，最大 200）。响应按工作区内单调 `sequence` 升序返回 `{ id, taskId, projectId, type, status, progress, errorCode, errorMessage, createdAt }`，并返回 `nextCursor` 与 `hasMore`；事件 UUID 是终态通知的幂等键。事件只包含脱敏状态投影，不包含 request JSON、workspace/user、lease、attempt、远端任务 ID、结果 URL、对象 key 或 Provider 凭据。读取仍由可信 session 的 workspace 成员关系授权，跨工作区任务统一返回空事件列表。客户端必须保存 `nextCursor`，断线或页面重载后从该游标继续轮询；任务列表/详情始终是状态事实来源。SSE、心跳和断线恢复在后续阶段实现，不在 P5-11 首发范围内。

## Provider 设置

```text
GET    /api/v1/settings/providers
PUT    /api/v1/settings/providers/:providerId
DELETE /api/v1/settings/providers/:providerId
POST   /api/v1/settings/providers/:providerId/test
```

`GET /settings/providers`、`PUT /settings/providers/:providerId` 和 `DELETE /settings/providers/:providerId` 管理当前登录用户自己的自定义 Provider。GET 只返回该用户已经创建的 Provider ID、显示名称、官网链接、API base URL、active/disabled、末四位和更新时间；不返回明文、密文、key version、workspace、user ID 或更新用户。PUT 可创建或更新，DELETE 幂等删除；任何已认证成员都只能操作自己的记录，user/workspace 只从 session 解析。同一用户切换项目或工作区仍看到同一套服务商，同一工作区的其他用户看不到也不能使用这些凭据。

PUT 请求接受供应商名称、官网链接、API 请求地址和 API Key；更新已有 Provider 时省略 `apiKey` 表示保留原密钥：

```json
{
  "label": "Krill",
  "websiteUrl": "https://krill.ai",
  "baseUrl": "https://api.cdn-krill-ai.com/v1",
  "apiKey": "<provider-api-key>"
}
```

`websiteUrl` 必须是公开 HTTPS 地址，只用于设置页展示和用户识别供应商，不参与连接测试、模型调用、endpoint 拼接或网络 allowlist。自定义 Provider 首发统一使用 OpenAI Compatible 协议。`baseUrl` 同样必须是公开 HTTPS 地址，不接受非标准端口、URL 用户名/密码、query、fragment、localhost、`.local`、`.internal` 或私有 IP；Worker 只会在已保存的 base URL 下访问固定的 `/models`、`/images/generations` 和 `/images/edits` 路径，不接受任务请求携带 target URL。既有 `aliyun` 记录继续以前向兼容的 `aliyun_dashscope` 协议执行。成功响应只返回含 `websiteUrl` 的脱敏 `ProviderSettingSummary`；删除后新任务不能使用该 Provider。

`POST /settings/providers/:providerId/test` 的请求体必须为 `{}`；Provider 必须来自当前登录用户已保存的记录，query 和请求体中的任意 target URL 都不参与网络请求，非空字段请求返回 `400 VALIDATION_FAILED`。路由不接触密文或明文 API Key，领域服务在内部短期解密后按已保存 base URL 的固定 models endpoint 发起测试，使用 `redirect: 'error'`、10 秒超时和 64 KiB 响应上限。

Web 设置客户端通过上述固定 API 路径新增、更新、测试和删除自定义 Provider。API Key 只存在于表单临时状态，成功后立即清空，不进入模型配置、Zustand 持久化、任务投影、项目图或快照；模型设置只保存 `modelId -> providerId` 绑定。

成功返回 `200`，不暴露 Provider 正文、远端 URL、凭据或 workspace：

```json
{
  "providerId": "openai",
  "ok": true,
  "checkedAt": "2026-07-18T10:00:00.000Z"
}
```

认证或非临时客户端拒绝返回 `409 PROVIDER_CONFIG_INVALID`；网络、超时、重定向、响应过大、限流及上游失败返回 `503 PROVIDER_UNAVAILABLE`，其中 `details.category` 仅为脱敏分类。日志只记录 Provider ID、分类、可重试性、成功状态码和耗时，绝不记录 Authorization、请求/响应正文或完整 Provider 响应。

## 搜索与审计

```text
GET /api/v1/search
GET /api/v1/audit
```

首发搜索只在当前工作区范围内查询项目、节点可搜索字段和资产元数据。审计不返回用户正文、完整 prompt、密钥或附件内容。

## 导入与导出

```text
POST /api/v1/migrations/imports/prepare
GET  /api/v1/migrations/imports/:importId
POST /api/v1/migrations/imports/:importId/cancel
```

P6-2 已实现以上三条单项目导入预检接口。prepare 请求包含 `idempotencyKey` 以及 P6-1 的 manifest、ProjectRecord、graph、asset manifest、可空 checkpoint 和 archive entry 元数据；最大请求体 8 MiB。请求不接受 user/workspace、object key、签名 URL、Provider URL 或凭据。服务端从 HttpOnly session 解析 actor，prepare/cancel 要求 owner/admin/editor，GET 允许当前 workspace 成员。

prepare 返回 `201` 与持久化 import 摘要：import ID/status/过期时间、来源项目 ID/name/version/sequence、冲突类型、允许策略、文件/资产/字节估算、进度及逻辑资产上传清单。上传项只包含 logical asset ID、包内路径、文件名、MIME、字节数、SHA-256、尺寸和 asset kind，不包含对象 key 或上传 URL。`conflict.type` 为 `none`、`project_exists`、`project_id_unavailable` 或 `source_id_incompatible`；只有当前 workspace 的真实目标项目会返回 ID/name 与 expected version/sequence，跨 workspace 碰撞只返回 unavailable。replace 仅对 owner/admin 的同 workspace 目标开放，editor 最多返回 copy，viewer 的只读状态响应返回空策略列表。

prepare 使用 `(workspace_id, idempotencyKey)` 幂等：同键同内容返回同一 import，不同内容返回 `409 IMPORT_CONFLICT`。包/schema/摘要/引用非法返回 `422 IMPORT_INVALID`；配额不足返回 `409 QUOTA_EXCEEDED`，且都不创建 import 或正式资源。prepare 只写 `migration_imports`，不创建项目图、资产、引用、checkpoint 或配额 reservation。

GET 从 PostgreSQL 恢复状态；跨 workspace 和不存在统一返回 `404 RESOURCE_NOT_FOUND`。cancel 不需要命令幂等键，无请求体或仅接受 `{}`，重复调用返回同一 canceled/expired/failed 状态；completed 返回 `409 IMPORT_CONFLICT`。

P6-3 为每个逻辑资产提供独立暂存上传会话：

```text
POST /api/v1/migrations/imports/:importId/assets/:logicalAssetId/upload
GET  /api/v1/migrations/imports/:importId/assets/:logicalAssetId/upload
POST /api/v1/migrations/imports/:importId/assets/:logicalAssetId/parts/:partNumber/complete
POST /api/v1/migrations/imports/:importId/assets/:logicalAssetId/complete
POST /api/v1/migrations/imports/:importId/assets/:logicalAssetId/cancel
```

上传会话只绑定 workspace、import 和 logical asset ID。小文件返回服务端生成 staging key 对应的短期 presigned PUT；大文件使用 S3 multipart，返回缺失分片的短期 URL，客户端在每个分片成功后提交 ETag/字节数，刷新或重试可恢复未完成分片。请求体不接受 object key、provider upload ID、签名 URL 或凭据；浏览器直传沿用 `credentials: omit`、`redirect: error` 和 `cache: no-store`。

最终完成会重新读取暂存对象，校验 MIME、字节数和 SHA-256；失败标记 `ASSET_VALIDATION_FAILED`、清理暂存对象并允许同一逻辑资产重新建立上传会话。cancel/过期不会创建 `assets`、`asset_references` 或项目图记录；已完成上传仍保留暂存 reservation，等待 commit 事务转为正式资产。

P6-4/P6-5 `POST /api/v1/migrations/imports/:importId/commit` 请求必须包含 `idempotencyKey` 和 `strategy=copy|replace`。copy 始终生成新的 project ID，并重新生成节点/连线 ID、重写父级和连线端点；replace 保留包内图 ID，仅 owner/admin 可用，必须携带 prepare 返回的 `expectedVersion`、`expectedSequence` 和 `confirmReplace=true`。commit 会在一个数据库事务中锁定 import/workspace/目标项目，按同 workspace 的 SHA-256、字节数和 MIME 复用安全匹配的 completed 资产，否则物化 staging asset；随后重映射逻辑资产 ID、写入项目图、引用和 `source=import` 的 project change，包内 checkpoint（若有）使用同一映射写入 `snapshot_type=import`。版本不一致返回 `409 PROJECT_VERSION_CONFLICT`，同一 commit 指纹重试返回同一结果，事务失败不留下正式项目、资产、引用或 change。资产匹配和 `committedAssetId` 映射始终限定可信 session workspace，不能跨 workspace 复用；首发不提供 merge。

P6-6 导出接口：

```text
POST /api/v1/projects/:projectId/exports/prepare
GET  /api/v1/projects/:projectId/exports/:exportId
GET  /api/v1/projects/:projectId/exports/:exportId/download
POST /api/v1/projects/:projectId/exports/:exportId/cancel
POST /api/v1/projects/:projectId/exports/:exportId/retry
```

prepare 请求为 `{ idempotencyKey, expectedVersion?, expectedSequence? }`，项目 ID 只来自路径，actor 只来自 HttpOnly session。服务端在项目行锁内读取同一 version/sequence 的关系化图、项目元数据、当前 saved checkpoint 和 completed 资产元数据，随后持久化 `prepared` 导出会话；提供 expected 快照时不匹配返回 `409 PROJECT_VERSION_CONFLICT`。同 workspace 同键同内容返回原导出，不同内容返回 `409 EXPORT_CONFLICT`。

导出状态包含 `prepared`、`generating`、`completed`、`failed`、`canceled`、`expired` 及文件/字节/retryCount 进度。后台生成固定单项目 ZIP，payload 使用 `manifest.json`、`project.json`、`graph.json`、`assets.json` 和可选 `checkpoint.json`；逻辑资产 ID 与 `assets/<path>` 在生成时重写，归档完成后再次校验 P6-1 契约。生成失败只收敛导出行，不修改项目图、资产引用或检查点。download 仅对 completed 导出签发 5 分钟私有 URL，不返回对象 key；cancel 在生成边界使用 cancel request，重复调用保持同一终态；failed/canceled 导出可由 owner/admin/editor 调用 retry，最多 3 次，超过上限返回 `409 EXPORT_RETRY_EXHAUSTED`。跨 workspace、不存在或已删除项目不泄漏存在性。

P6-8 Cloud Web 只通过以上固定接口编排迁移。导入先在浏览器读取目录包条目，再将 JSON 和 archive entry 元数据提交 prepare；服务端响应返回前不得开始资产直传，所有统计、冲突类型和允许策略以 prepare 摘要为准。replace UI 必须展示 `targetProject.expectedVersion/expectedSequence` 并取得单独确认；提交返回 `PROJECT_VERSION_CONFLICT` 时只能重新加载云端状态或使用允许的 copy 策略。multipart 直传必须使用对象存储响应中的 ETag，重新选择相同 package ID 时可以读取已有 upload 状态并续传缺失分片。导出先读取当前关系图 version/sequence 作为 expected 快照，再轮询 status；completed 后才请求 download URL。浏览器只持久化 import/export ID 用于刷新和重新登录后的 GET 恢复，不持久化目录包正文、媒体、签名 URL、object key、workspace/user 或凭据；通知中心只显示迁移摘要。

## 主要错误码

```text
AUTH_REQUIRED
SESSION_EXPIRED
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
TASK_CONCURRENCY_LIMIT
PROVIDER_CONFIG_INVALID
PROVIDER_UNAVAILABLE
IMPORT_CONFLICT
IMPORT_INVALID
EXPORT_CONFLICT
EXPORT_NOT_READY
EXPORT_EXPIRED
EXPORT_CANCELED
EXPORT_RETRY_EXHAUSTED
EXPORT_GENERATION_FAILED
SERVICE_UNAVAILABLE
```

权限不足与不存在的响应必须避免泄漏其他租户资源是否存在。可重试字段由错误分类决定，不能把所有 5xx 或 Provider 失败都标记为可重试。
