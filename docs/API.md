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

注册成功在同一事务创建个人工作区。登录和注册需要分层限流；忘记密码接口无论邮箱是否存在都返回一致结果，避免账号枚举。

## 工作区

```text
GET /api/v1/workspaces/current
GET /api/v1/workspaces/current/usage
```

首发不提供工作区切换和成员邀请，但响应保留工作区 ID、类型、用户角色和配额摘要。工作区 ID 不能单独构成授权。

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

项目列表只返回摘要，不包含全部节点、连线、任务或检查点。`PATCH` 只允许名称等白名单元数据，不能通过任意 JSON patch 修改租户、版本或删除状态。

## 项目图

```text
GET   /api/v1/projects/:projectId/graph
PATCH /api/v1/projects/:projectId/graph
GET   /api/v1/projects/:projectId/changes?after=<sequence>
```

图读取响应包含项目版本、last sequence、规范化节点、连线和任务投影。内部数据库主键和其他租户信息不进入响应。

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
- 所有 operations 作为一个事务接受或拒绝。
- 同一幂等键重复提交返回同一已接受结果。
- `baseVersion` 不一致返回 `409 PROJECT_VERSION_CONFLICT`。
- source/target 节点必须属于同一项目。
- 删除节点必须同步处理关联边和资产引用。
- 操作数量、单节点 JSONB、总请求字节和文本长度均有限额。

## 检查点与历史

```text
POST /api/v1/projects/:projectId/checkpoints
GET  /api/v1/projects/:projectId/revisions
GET  /api/v1/projects/:projectId/revisions/:version
POST /api/v1/projects/:projectId/revisions/:version/restore
```

手动 checkpoint 先确认客户端无待提交批次或由请求显式提交最后批次。恢复创建新版本，不覆盖旧检查点。历史列表返回摘要和大小，不默认返回完整 `record_json`。

## 资产

```text
POST   /api/v1/assets/uploads
POST   /api/v1/assets/uploads/:uploadId/complete
GET    /api/v1/assets/:assetId
GET    /api/v1/assets/:assetId/url
DELETE /api/v1/assets/:assetId
```

创建上传会话请求包含项目、文件名、MIME、字节数和可选哈希。响应返回短期预签名上传信息，不返回对象存储永久凭据。

完成接口从对象存储读取实际元数据并验证；浏览器声明不能作为事实。读取 URL 在签发前检查成员资格和资产状态，返回短 TTL 与过期时间。

## 任务

```text
POST /api/v1/tasks
GET  /api/v1/tasks
GET  /api/v1/tasks/:taskId
POST /api/v1/tasks/:taskId/cancel
POST /api/v1/tasks/:taskId/retry
GET  /api/v1/tasks/events
```

创建任务携带项目、source node、preview node、模型参数引用和幂等键。服务端解析工作区 Provider 配置、额度和并发限制，客户端不能指定任意 Provider URL。

任务事件首发可以使用 SSE 或轮询。无论传输方式，数据库任务状态是事实来源；事件丢失后客户端必须能通过查询恢复。

## Provider 设置

```text
GET    /api/v1/settings/providers
PUT    /api/v1/settings/providers/:providerId
DELETE /api/v1/settings/providers/:providerId
POST   /api/v1/settings/providers/:providerId/test
```

写入接口接收密钥但响应不回显。读取只返回末四位、状态和更新时间。服务端测试使用白名单适配器并返回脱敏错误。

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

