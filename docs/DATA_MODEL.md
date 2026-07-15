# AI Canvas Cloud 数据模型

本文档定义 PostgreSQL 混合图模型。关系表保存当前事实状态，JSONB 只承载节点专属数据、操作载荷和完整检查点；图片与视频 blob 不进入数据库。

## 通用约定

- 服务端实体 ID 使用 UUID/ULID 等全局唯一值。
- 所有时间使用带时区时间戳并由服务端生成。
- 所有租户资源包含 `workspace_id`，查询和唯一约束不得跨租户混淆。
- 需要用户恢复或后台清理的资源使用软删除；硬删除由受控 GC 完成。
- JSONB 字段必须有运行时 schema、大小上限和版本；可查询、可排序、需要外键或授权的字段关系化。
- schema 只能通过显式迁移升级，生产启动不自动改表。

## 用户与租户

### Better Auth 核心表

认证核心使用 Better Auth 1.6.x 的 PostgreSQL 表模型：

- `"user"`：主要字段为 `id`、`name`、`email`、`email_verified`、`image`、`status`、`created_at`、`updated_at`。其中 `status` 是 Cloud 追加字段，用于 `active`、`disabled`、`deleted` 账号状态。
- `"session"`：主要字段为 `id`、`user_id`、`token`、`expires_at`、`ip_address`、`user_agent`、`created_at`、`updated_at`。会话 Cookie 由 Better Auth 生成签名值并写入 `better-auth.session_token`。
- `"account"`：保存登录提供方账号，邮箱密码登录使用 `provider_id='credential'`，密码哈希由 Better Auth 管理并保存在 `password` 字段。
- `"verification"`：保存 Better Auth 的邮箱验证、密码重置等一次性验证值。注册后发送验证邮件、重发验证邮件、验证 token 消费、忘记密码和重置密码均复用 Better Auth 能力，不维护自研 token 表。

前端和 API 日志不得记录密码、`better-auth.session_token`、重置 token、生产验证/重置链接、Authorization 或 Provider API Key。开发/测试环境可以打印邮箱验证和密码重置链接用于本地调试；生产环境必须接入真实邮件发送服务，不能依赖日志取 token。Cloud 业务授权不信任客户端传入的 `user_id`，必须先从 Better Auth session 解析用户，再通过 `workspace_members` 校验工作区权限。

首发采用单活跃会话策略。注册或登录创建新 session 后，服务端撤销同用户其他 session；旧 session 行可由 Better Auth 标记失效或删除，但无论实现细节如何，业务 API 都只能信任当前有效 session。密码重置成功后同样撤销旧 session。

### `workspaces`

主要字段：`id`、`type`、`name`、`owner_user_id`、`status`、`plan_key`、配额字段和时间戳。

首发 `type=personal`。注册事务必须同时创建用户、个人工作区和 owner membership。

### `workspace_members`

主要字段：`workspace_id`、`user_id`、`role`、`joined_at`。

`(workspace_id, user_id)` 唯一。首发只开放 owner，但角色枚举预留 `admin`、`editor`、`viewer`。

### `workspace_user_state`

保存某用户在某工作区的最近项目、当前项目和非敏感 UI 游标。首发单活跃会话避免多个设备同时更新该状态；该状态仍不能放在 `workspaces` 上，否则未来团队成员会互相覆盖。

### `auth_audit_events`

保存认证和账号安全相关审计事件，主要字段：`id`、`user_id`、`workspace_id`、`event_type`、`request_id`、脱敏后的 IP/UA 摘要、`result`、`metadata_json` 和 `created_at`。

审计元数据只保存恢复和风控所需的非敏感摘要，不保存密码、会话 token、验证码、Cookie、Authorization 或 Provider API Key。认证失败事件可以没有 `user_id`，但不得通过错误响应泄漏邮箱是否存在。

## 项目图

### `projects`

主要字段：

```text
id
workspace_id
name
version
last_sequence
saved_snapshot_id
node_count
edge_count
task_count
archived_at
deleted_at
created_at
updated_at
```

`id` 使用 PostgreSQL UUID。服务端可用 `gen_random_uuid()` 生成；Web 客户端也可先生成 UUID 并在创建请求中提交，服务端只在当前授权工作区内按同 ID、同名称、未删除项目幂等返回，不能让客户端指定 `workspace_id` 或所有者。项目名称去除首尾空白后长度为 1-160。活动项目和归档项目分别使用 `(workspace_id, updated_at, id)` 局部索引并排除软删除行。`version` 用于项目级乐观并发，`last_sequence` 是变更日志的项目内连续序号；版本、序列和计数均不得为负数。`workspace_user_state` 的最近打开/活动项目通过 `(workspace_id, project_id)` 复合外键保证不能指向其他工作区项目。

### `project_nodes`

主要字段：

```text
project_id
node_id
node_type
position_x / position_y
width / height
z_index
parent_node_id
row_version
data_schema_version
data_json
presentation_json
deleted_at
created_at / updated_at
```

约束：

- `(project_id, node_id)` 唯一。
- `node_id` 使用可容纳 UUID/ULID 的不透明文本 ID；节点 ID 和类型有显式长度上限，行版本与数据 schema 版本必须为正数。
- 父节点必须属于同一项目，不能形成自引用；复杂环检测在领域服务完成。
- `data_json` 保存 prompt、模型参数和节点专属业务数据。
- `presentation_json` 只保存低频、非查询型 React Flow 展示属性。
- 资产 ID、任务 ID 等需要授权和引用治理的关系不得只存在于 JSONB，必须同步写引用表或关系字段。

### `project_edges`

主要字段：`project_id`、`edge_id`、source/target node ID、source/target handle、edge type、row version、`data_json`、删除时间和时间戳。

约束：

- `(project_id, edge_id)` 唯一。
- source/target 通过复合外键保证属于同一项目；端点是否已软删除由领域服务在写事务中校验。
- 删除节点时，同一事务删除或标记关联边，并写入同一变更批次。

### `project_changes`

主要字段：

```text
project_id
sequence
base_version
result_version
actor_user_id
client_id
batch_id
idempotency_key
source
operations_json
created_at
```

约束：

- 数据库保证 `(project_id, sequence)` 唯一且 sequence 为正；领域事务锁定项目并保证 sequence 连续递增。
- `(project_id, idempotency_key)` 和 `(project_id, batch_id)` 分别唯一，同一批次重试返回原结果。
- `result_version` 必须大于非负的 `base_version`；user 来源必须记录 `actor_user_id`。
- `operations_json` 使用版本化 schema，只保存必要操作和非敏感摘要。
- `source` 区分 user、worker、import、restore 和 system。

`GET /api/v1/projects/:projectId/changes?after=<sequence>` 只在 session 用户通过 `workspace_members` 授权后读取当前工作区、未软删除项目的变更日志。响应按 `sequence ASC` 返回 `after` 之后的批次，并带当前项目 `version`/`last_sequence`；API 不返回 `actor_user_id`、`idempotency_key`、`workspace_id` 或数据库内部行信息。

### `project_snapshots`

主要字段：`id`、`project_id`、`project_version`、`last_sequence`、`snapshot_type`、`schema_version`、`record_json`、`byte_size`、`asset_manifest_json`、`is_valid` 和时间戳。

`snapshot_type` 至少包含 `manual`、`periodic`、`import`、`pre_restore`。检查点不是当前事实来源；显式恢复会产生新版本。

`projects.saved_snapshot_id` 使用 `(project_id, snapshot_id)` 复合外键，只能指向本项目检查点。保留策略必须同时约束检查点数量、总字节和变更日志窗口。只有有效检查点覆盖目标 sequence 且通过恢复测试后，才能裁剪更早 `project_changes`。

服务端 manual/periodic checkpoint 从当前关系化 `project_nodes` 和 `project_edges` 组装 `record_json`，不接受客户端上传整份 record。P3 当前 `record_json.schemaVersion=1`，包含 `project` 摘要、`canvas.nodes`、`canvas.edges` 和空 `taskQueue.tasks`；P4/P5 接入后再把资产 manifest 和持久化任务状态纳入同一可恢复记录。manual 和 periodic checkpoint 都只在请求携带的 `expectedVersion` 与 `expectedSequence` 同时匹配当前项目时创建；manual 会把 `projects.saved_snapshot_id` 更新为新检查点，periodic 只作为历史恢复点保留，不改变手动保存点。

checkpoint 列表只返回摘要字段，按 `(created_at, id)` 倒序 keyset 分页，不返回 `record_json`。读取列表仍先通过 session 用户和 `workspace_members` 校验当前工作区，再限定项目属于该工作区且未软删除。checkpoint 详情按 `project_version` 读取该版本最新创建的检查点并返回完整 `record_json`，仍不得返回 `workspace_id`、`actor_user_id` 或数据库内部行信息。

checkpoint restore 要求请求携带当前确认的 `expectedVersion` 和 `expectedSequence`。服务端在同一事务中锁定项目、校验当前版本、读取目标版本最新有效 checkpoint、创建 `pre_restore` 检查点、替换当前 `project_nodes`/`project_edges` 活动关系、追加 `source='restore'` 的 `project_changes`，再递增 `projects.version` 和 `projects.last_sequence`。P3 restore 当前只恢复节点和连线；资产引用与任务状态随 P4/P5 表落地后纳入同一恢复事务。

### P3 schema 迁移策略

`0003_project_graph.sql` 是在 P2 用户/工作区 schema 之上的纯新增迁移，不改写既有认证数据；`0004_project_snapshot_scope.sql` 以前向修复方式把 saved snapshot 收紧为项目内复合外键。升级测试在随机隔离 schema 中依次执行全部迁移，并验证五张表、关键外键/索引、空项目名拒绝、连线端点约束、变更幂等唯一性和跨项目检查点拒绝。

在尚未写入 P3 数据且需要回退到 P2 应用时，可停止新应用后删除 P3 外键和五张新增表；一旦写入真实项目，不执行破坏性回滚，应保留数据并通过新的前向修复迁移调整约束或列。P2 应用不会访问新增表，因此应用回退可以与新增表保留并存。

## 资产

### `assets`

主要字段：

```text
id
workspace_id
origin_project_id
created_by_user_id
object_key
original_file_name
mime_type
byte_size
sha256
width / height
asset_kind
status
deleted_at
created_at / updated_at
```

`object_key` 唯一，不含邮箱和项目名称。`status` 至少包含 pending、completed、failed、quarantined、deleted。P4-1 迁移已建立 `assets` 表，`workspace_id` 是所有查询和配额统计的租户边界；`origin_project_id` 通过 `(workspace_id, project_id)` 复合外键保证不能指向其他工作区项目。`object_key` 按工作区、项目或用途分段，但必须由服务端 ID 组成，不保存用户邮箱、项目名称或原始完整本地路径。

### `asset_uploads`

保存上传会话、工作区、目标对象 key、期望 MIME/大小、幂等键、过期时间和完成状态。完成确认必须查询对象存储验证实际对象，不能只相信浏览器上报。P4-1 迁移已建立 `asset_uploads`，同一工作区的 `(workspace_id, idempotency_key)` 唯一；上传会话只能指向同工作区 asset，过期或已完成会话不能复用为新的资产写入。P4-3 完成确认会在对象存储校验通过后，于同一数据库事务中把上传会话和资产状态更新为 `completed`；对象不存在、过期或元数据不匹配时不会产生可被节点引用的 completed 资产。

### `asset_references`

主要字段：`asset_id`、`workspace_id`、`project_id`、`node_id` 或 `task_id`、引用角色和时间戳。

同一引用使用复合唯一约束。节点/任务变化与引用更新在同一 PostgreSQL 事务中完成。检查点的历史资产集合记录在 snapshot manifest，并参与 GC 保护。P4-1 迁移已建立 `asset_references`，项目引用通过 `(workspace_id, project_id)` 和 `(project_id, node_id)` 约束锁定在同一工作区、同一项目图；任务引用预留 `task_id`，待 P5 `generation_tasks` 建表后通过前向迁移补齐外键。

## 任务与用量

### `generation_tasks`

主要字段：工作区、项目、source/preview node、kind、Provider、model、计费模式、状态、进度、远端任务 ID、结果资产、错误码、重试计数、租约和时间戳。

任务状态机必须由领域服务执行条件迁移，例如 queued -> running -> succeeded/failed/canceled。超时租约由恢复任务重新排队或标记失败，不允许永久 running。

### `task_attempts`

保存每次尝试的 Provider、开始/结束、远端请求 ID、可重试分类、计量摘要和脱敏错误。不得保存 Authorization、完整附件或完整响应正文。

### `provider_credentials`

保存工作区、Provider、加密密文、密钥版本、末四位提示、状态和更新时间。密文使用版本化包封加密；更换主密钥时支持后台重加密。

### `usage_ledger`

保存工作区、任务、计量类型、数量、计费单位、幂等键和时间。`(workspace_id, idempotency_key)` 唯一，Provider 回调重试不得重复记账。

## 核心事务

### 注册

Better Auth 负责创建 `"user"`、`"account"` 和 `"session"`；Cloud 侧在注册、登录和会话恢复后幂等创建 personal workspace、owner membership 和默认 workspace user state。若 Better Auth 用户已存在但工作区补齐失败，后续登录或 session 恢复会再次补齐，避免重复用户或重复个人空间。

### 图操作批次

同一事务：

1. 以 workspace membership 条件读取并锁定项目。
2. 校验 `baseVersion`。
3. 校验全部节点、连线和 completed 资产归属。
4. 应用 node/edge upsert/delete。
5. 更新 `asset_references` 和计数。
6. 追加一个连续 `project_changes` 记录。
7. 递增 project version/sequence。

P3-3/P3-4 当前实现已覆盖步骤 1、2、3 中的节点/连线校验、4、6、7，并在同一事务刷新活动节点/连线计数。项目行使用 `FOR UPDATE` 串行化同项目批次；幂等键查询先于版本冲突判断，确保已接受请求在项目继续更新或归档后仍返回原结果。节点父级基于操作后的活动节点集合校验缺失引用和环，删除节点会软删除关联边。步骤 5 的资产引用更新依赖 P4 `asset_references`，尚未接入时不得宣称资产引用事务已完成。

### 手动检查点

提交待处理图变化后，在一致版本读取当前节点、连线、任务和资产引用，组装检查点并验证可恢复。manual checkpoint 更新 `projects.saved_snapshot_id`；periodic checkpoint 只进入历史列表和恢复候选，不改变手动保存点。P3 当前 manual/periodic checkpoint 已覆盖节点和连线；任务和资产引用仍随 P4/P5 接入。

### 任务完成

同一事务更新任务状态、结果资产、用量账本和必要节点，通过任务幂等键追加项目变更。对象转存未完成时不能把任务标记为 succeeded。

### 历史恢复

锁定项目，校验 `expectedVersion`/`expectedSequence`，读取并验证目标检查点，先创建 pre-restore 检查点，再替换当前关系状态、重建引用、追加 restore 变更并递增版本。原检查点和历史行保持不变。P3 当前实现已经覆盖节点和连线关系，资产引用重建随 P4 接入。

## 导入导出映射

导入将迁移后的 `ProjectRecord` 拆成：

- 项目元数据 -> `projects`
- canvas nodes -> `project_nodes`
- canvas edges -> `project_edges`
- task queue -> `generation_tasks`
- 媒体引用 -> `assets` / `asset_references`
- saved/working snapshot -> import/manual 检查点和当前关系状态

导出反向组装 `savedSnapshot` 与 `workingSnapshot`，保持 schema 版本和本地目录包契约。往返测试必须比较语义归一化结果，而不是依赖 JSON 属性顺序。

