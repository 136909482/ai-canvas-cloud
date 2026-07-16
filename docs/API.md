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

## 认证

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/session
GET    /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/:sessionId
POST   /api/v1/auth/email/verify
POST   /api/v1/auth/email/resend
POST   /api/v1/auth/password/forgot
POST   /api/v1/auth/password/reset
DELETE /api/v1/account
```

认证兼容接口保留在 `/api/v1/auth/*`，底层委托 Better Auth 管理邮箱密码、签名 HttpOnly Cookie、session、邮箱验证 token 和密码重置 token。注册、登录和会话恢复后，Cloud 侧会幂等确保个人工作区和 owner membership 存在。首发同账号只保留一个活跃登录设备：注册或登录成功创建新 session 后，服务端撤销该用户其他 session；旧设备后续调用 `/auth/session` 或业务 API 会得到未授权响应。前端首屏恢复一次 session，可见页面每 5 分钟心跳一次，窗口重新聚焦或页面重新可见只在距上次检查已满 5 分钟时触发，业务 API 返回未授权时立即清理 Cloud 会话缓存并回到登录页；持续点击和键盘输入不触发 session 探测，同一标签页并发探测复用一个请求。`GET /auth/sessions` 返回当前用户的活跃会话摘要，单活跃会话策略下通常只包含当前会话；`DELETE /auth/sessions/:sessionId` 只能下线当前用户自己的会话，用于退出当前设备或管理兜底。`POST /auth/email/resend` 从当前登录 session 解析邮箱后重发验证邮件，不接受客户端指定用户 ID；`POST /auth/email/verify` 消费 Better Auth 验证 token 并返回 `{ "ok": true }`。`POST /auth/password/forgot` 只接受邮箱并始终对存在/不存在账号返回一致成功结果；`POST /auth/password/reset` 消费一次性重置 token 并设置新密码，重置成功后撤销旧会话。登录、注册、验证和重置需要分层限流；忘记密码接口不得泄漏邮箱是否存在，避免账号枚举。

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
  }
}
```

`usedBytes` 包含 completed、failed 和 quarantined 资产，`reservedBytes` 包含 pending 上传，`totalBytes` 为两者之和；软删除资产退出逻辑用量。响应不包含对象 key、资产 ID、用户 ID 或其他工作区统计。

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
GET  /api/v1/tasks/events # 尚未实现
```

P5-3 已实现除 events 外的任务 HTTP 路由。所有作用域来自可信 session；读取允许当前工作区成员，创建、取消和重试要求 owner/admin/editor。创建返回 `201`，其余成功返回 `200`。跨工作区任务、项目或节点统一按不存在处理，响应不包含 workspace/user、请求参数、Worker 租约、远端任务 ID 或 Provider 凭据。

创建请求携带项目、source node、可选 preview node、image/video kind、Provider/model、参数对象和幂等键。当前只接受 `billingMode="workspace_key"`，且对应 Provider 必须已配置并为 active；服务端只锁定并确认配置，不在 API 路径解密密钥。`parameters` 最大 256 KiB、嵌套深度最大 12，不接受非 JSON 值，也拒绝任何层级的 apiKey、Authorization、base/api/target URL 或 endpoint 字段。客户端不能指定任意 Provider URL。创建幂等键在同一 workspace 唯一；同键同输入返回原任务，不同输入返回 `409 VALIDATION_FAILED`。同一 workspace 最多 5 个 queued/running 任务，超限返回 `409 TASK_CONCURRENCY_LIMIT` 和 `details.activeLimit=5`。

列表支持 `projectId`、`status`、`cursor` 和 `limit`；status 只允许 queued/running/succeeded/failed/canceled，limit 默认为 50、最大 100，按 `(created_at, id)` 倒序 keyset 分页。取消/重试请求均为 `{ "idempotencyKey": "..." }`。queued 取消立即进入 canceled；running 取消只写 `cancelRequestedAt`，由后续 Worker 收敛；只有 failed 且未达到 max attempts 的任务可重排为 queued。命令幂等键在同一 workspace 全局唯一，同键重放返回当前任务状态，同键用于其他任务或命令返回冲突。取消和重试不会修改项目图 version/sequence 或 `project_changes`。

任务事件首发可以使用 SSE 或轮询。无论传输方式，数据库任务状态是事实来源；事件丢失后客户端必须能通过查询恢复。

## Provider 设置

```text
GET    /api/v1/settings/providers
PUT    /api/v1/settings/providers/:providerId
DELETE /api/v1/settings/providers/:providerId
POST   /api/v1/settings/providers/:providerId/test
```

P5-2 已实现 `GET /settings/providers`、`PUT /settings/providers/:providerId` 和 `DELETE /settings/providers/:providerId`。GET 允许当前工作区成员读取固定 Provider 列表，只返回 Provider ID、显示名称、固定 base URL、是否已配置、active/disabled、末四位和更新时间；不返回明文、密文、key version、workspace 或更新用户。PUT/DELETE 要求 owner/admin，workspace/user 只从 session 解析。

PUT 请求只接受 API Key 和可选 base URL：

```json
{
  "apiKey": "<provider-api-key>",
  "baseUrl": "https://api.openai.com"
}
```

当前注册表只允许 OpenAI `https://api.openai.com` 和阿里百炼 `https://dashscope.aliyuncs.com/compatible-mode/v1`，不接受任意 URL、HTTP、非标准端口、URL 用户名/密码、query、fragment、相似子域或内网地址。成功响应只返回脱敏 `ProviderSettingSummary`。DELETE 幂等删除当前工作区凭据，不影响其他工作区；删除后新任务不能使用该 Provider。

`POST /settings/providers/:providerId/test` 尚未实现，后续必须通过服务端白名单适配器发起并使用 `redirect: error`，不得接受客户端 target URL，也不得把 Authorization、正文或完整 Provider 响应写入日志。

## 搜索与审计

```text
GET /api/v1/search
GET /api/v1/audit
```

首发搜索只在当前工作区范围内查询项目、节点可搜索字段和资产元数据。审计不返回用户正文、完整 prompt、密钥或附件内容。

## 导入与导出

```text
POST /api/v1/imports/workspace/prepare
POST /api/v1/imports/workspace/:candidateId/assets
POST /api/v1/imports/workspace/:candidateId/commit
POST /api/v1/exports/workspace
GET  /api/v1/exports/:exportId

POST /api/v1/imports/project/prepare
POST /api/v1/imports/project/:candidateId/commit
POST /api/v1/exports/projects/:projectId
```

prepare 只读取、迁移和验证，不修改活动项目。commit 重新校验候选过期、ID 冲突、资产完整性和配额后写入。导出作为后台任务生成兼容目录包或后续外层归档，Provider 密钥必须清空。

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
SERVICE_UNAVAILABLE
```

权限不足与不存在的响应必须避免泄漏其他租户资源是否存在。可重试字段由错误分类决定，不能把所有 5xx 或 Provider 失败都标记为可重试。

