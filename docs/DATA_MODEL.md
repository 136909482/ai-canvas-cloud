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

主要字段：`id`、`type`、`name`、`owner_user_id`、`status`、`plan_key`、`storage_quota_bytes`、任务配额字段和时间戳。

首发 `type=personal`。注册事务必须同时创建用户、个人工作区和 owner membership。P4-10 起，新建 personal workspace 的 `storage_quota_bytes` 默认是 `21474836480`（20 GiB），`0006_workspace_storage_quota.sql` 同时把历史 personal workspace 的占位 `0` 前向回填为该值。团队工作区尚未开放，后续可按 plan 显式覆盖配额。

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

服务端 manual/periodic checkpoint 从当前关系化 `project_nodes` 和 `project_edges` 组装 `record_json`，不接受客户端上传整份 record。P3 当前 `record_json.schemaVersion=1`，包含 `project` 摘要、`canvas.nodes`、`canvas.edges` 和空 `taskQueue.tasks`。P4-8 从同一节点 record 提取排序、去重的 Cloud asset UUID 数组写入 `asset_manifest_json`；manual、periodic 和 restore 前创建的 `pre_restore` 都保存 manifest。创建新 checkpoint 前重新校验 manifest 中资产属于当前工作区、未删除且 completed。manual 和 periodic checkpoint 都只在请求携带的 `expectedVersion` 与 `expectedSequence` 同时匹配当前项目时创建；manual 只复用同 version/sequence 且 manifest 完全一致的有效检查点，并把 `projects.saved_snapshot_id` 更新为该检查点，periodic 只作为历史恢复点保留，不改变手动保存点。持久化任务状态仍随 P5 接入。

checkpoint 列表只返回摘要字段，按 `(created_at, id)` 倒序 keyset 分页，不返回 `record_json`。读取列表仍先通过 session 用户和 `workspace_members` 校验当前工作区，再限定项目属于该工作区且未软删除。checkpoint 详情按 `project_version` 读取该版本最新创建的检查点并返回完整 `record_json`，仍不得返回 `workspace_id`、`actor_user_id` 或数据库内部行信息。

checkpoint restore 要求请求携带当前确认的 `expectedVersion` 和 `expectedSequence`。服务端在同一事务中锁定项目、校验当前版本、读取目标版本最新有效 checkpoint，重新从 `record_json` 提取资产集合并与 `asset_manifest_json` 交叉校验，再按可信工作区锁定并验证 completed 资产。通过后创建带当前图 manifest 的 `pre_restore` 检查点、替换当前 `project_nodes`/`project_edges` 活动关系、全量重建节点 `asset_references`、追加 `source='restore'` 的 `project_changes`，再递增 `projects.version` 和 `projects.last_sequence`。manifest 不一致、资产不可用或任一 SQL 失败均回滚整个恢复事务。任务状态仍随 P5 纳入。

P4-9 的历史 manifest 前向修复不重写 `record_json`，也不修改项目 version/sequence、`project_changes`、当前图或 `asset_references`。默认预检按 `(created_at, id)` keyset 分批只读扫描；显式提交时逐 checkpoint 开启短事务，以 `FOR UPDATE ... SKIP LOCKED` 锁定 snapshot，并从所属项目关系取得可信 `workspace_id`。修复服务调用项目图节点运行时校验和资产引用提取器生成排序去重 manifest，再复用 completed 资产检查模块按工作区加共享锁。规范空 manifest、合法 UUID 的错误 manifest 和重复/乱序 manifest 在资产全部可用时回填；record/manifest 结构损坏或资产跨工作区、缺失、已删除、pending、failed、quarantined 时，checkpoint 保持或调整为 `is_valid=false`。既有 `is_valid=false` 行不重新启用或改写；`projects.saved_snapshot_id` 无论目标是否异常都不由维护任务清空或改指，因此用户手动保存点指针不会静默丢失。命令可幂等重跑，单行失败只回滚该短事务；本切片复用现有列和约束，不需要 schema 迁移。

### P4-10 存储配额迁移策略

`0006_workspace_storage_quota.sql` 不新增表或列，只把 `workspaces.storage_quota_bytes` 默认值改为 20 GiB，并将历史 personal workspace 的占位 `0` 前向回填。升级测试会在执行 0006 前创建旧值 fixture，再验证回填和新建默认值。回退旧应用时保留 20 GiB 数值即可，旧版本不会执行配额读取或校验；若必须数据库层回退，只恢复列默认值，不把已回填 workspace 改回 `0`，避免重新开放无约束上传。

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

`object_key` 唯一，不含邮箱和项目名称。`status` 至少包含 pending、completed、failed、quarantined、deleted。P4-1 迁移已建立 `assets` 表，`workspace_id` 是所有查询和配额统计的租户边界；`origin_project_id` 通过 `(workspace_id, project_id)` 复合外键保证不能指向其他工作区项目。`object_key` 按工作区、项目或用途分段，但必须由服务端 ID 组成，不保存用户邮箱、项目名称或原始完整本地路径。P4-4 读取始终先校验当前 session 的工作区成员关系，再以 `(workspace_id, asset_id)` 查询未软删除资产；只有 completed 状态可以取得短期对象存储读取 URL，其他工作区或已删除资产按不存在处理。

### `asset_uploads`

保存上传会话、工作区、目标对象 key、期望 MIME/大小、幂等键、过期时间和完成状态。完成确认必须查询对象存储验证实际对象，不能只相信浏览器上报。P4-1 迁移已建立 `asset_uploads`，同一工作区的 `(workspace_id, idempotency_key)` 唯一；上传会话只能指向同工作区 asset，过期或已完成会话不能复用为新的资产写入。P4-3 完成确认会在对象存储校验通过后，于同一数据库事务中把上传会话和资产状态更新为 `completed`；对象不存在、过期或元数据不匹配时不会产生可被节点引用的 completed 资产。P4-6 Web 平台层已消费该三步协议：API 创建会话后，浏览器仅向预签名对象存储 URL 发送媒体正文且不携带站点 Cookie，直传成功后才请求完成确认；节点长期保存资产 ID 定位符，不保存上传 URL 或对象 key。P4-7 已在图事务中同步写入 `asset_references`。P4-10 把 pending asset 的 `byte_size` 作为工作区容量预留；completed、failed 和 quarantined 计入已用量，软删除/`deleted` 不计入逻辑配额。完成确认只在预留和已用分类之间移动字节，不改变总占用。

### `asset_references`

主要字段：`asset_id`、`workspace_id`、`project_id`、`node_id` 或 `task_id`、引用角色和时间戳。

同一引用使用复合唯一约束。P4-7 复用现有 schema：项目图事务从节点数据中的规范化 `assetId` 与 `cloud-assets/<asset-id>` 定位符提取当前引用，只接受同一工作区、未删除、completed 的资产；upsert 节点先删除该节点旧引用再写入去重后的新引用，delete 节点同步删除引用。P4-8 继续复用同一提取与 PostgreSQL 校验模块，在 checkpoint restore 中先验证目标 manifest，再在替换关系图后全量重建该项目的节点引用。跨工作区、已删除或不存在资产按同一种不存在响应处理，pending、failed 和 quarantined 不可进入引用。节点、连线、项目版本、`project_changes` 和引用共享一个 PostgreSQL 事务。检查点的历史资产集合记录到 snapshot manifest 供 GC 保护；P5-1 已把任务引用的 `task_id` 收紧为 UUID，并通过 `(workspace_id, task_id)` 外键绑定 `generation_tasks`，任务删除会级联清理其资产引用。

### P4-11 对象诊断与 GC

资产维护默认执行只读预检。数据库侧按 `(assets.created_at, assets.id)` 稳定游标分批读取，使用 HEAD 区分对象存在与缺失；completed 资产缺失对象只产生诊断，不能仅凭缺失静默改写数据库。对象存储侧只列出 `workspaces/` 受控前缀，并再次要求 key 严格符合服务端生成的 workspace/project/用途/asset UUID/扩展名结构；不符合结构的 key 即使位于该前缀也只诊断、不删除。bucket 中没有任何 `assets.object_key` 对应行且最后修改时间早于宽限期的受控对象才是可删除孤立对象。

数据库侧只有 pending 已过期、failed、quarantined 或已软删除资产可成为 GC 候选；completed 资产即使暂时无引用也保留，只对对象缺失做诊断。候选时间以状态更新时间为基线；pending 还必须等上传会话过期后再开始宽限期。默认宽限期是 168 小时。超过宽限期仍不能直接删除：提交模式对每个候选开启独立短事务，以 `FOR UPDATE ... SKIP LOCKED` 取得资产排他锁，再在新的 SQL 语句快照中复查 `asset_references` 和同工作区 `is_valid=true` checkpoint 的 `asset_manifest_json`。任一当前节点/任务引用或有效 checkpoint manifest 引用都会保留资产。项目图、checkpoint 创建和后续任务引用必须继续先以共享锁校验 completed 资产，因此不能与已取得排他锁的 GC 同时提交引用。

对象存储删除与 PostgreSQL 不能形成单一事务，收敛顺序固定为“锁后复查 -> 幂等删除对象 -> 标记 `assets.status='deleted'` 并设置 `deleted_at`”。删除失败时数据库事务回滚；对象实际已删除但响应或数据库提交失败时，下次运行会把仍满足 GC 条件且对象已不存在的资产状态收敛为 deleted。已经 deleted 且对象不存在的资产重复运行不再改写。GC 不修改 `record_json`、项目 version/sequence、`project_changes`、当前节点/连线或 `saved_snapshot_id`。现有 `status`、`deleted_at`、`object_key`、引用表和 checkpoint manifest 足够表达该流程，P4-11 不新增 schema 迁移。

## 任务与用量

### `generation_tasks`

P5-1 已由 `0007_generation_tasks.sql` 建表。主要字段：`id`、`workspace_id`、`project_id`、`created_by_user_id`、source/preview node、image/video kind、Provider、model、计费模式、queue lane、版本化 `request_json`/`result_json`、状态、进度、尝试计数/上限、幂等键、远端任务 ID、脱敏错误、可领取时间、取消请求、租约和时间戳。

`(workspace_id, id)` 和 `(workspace_id, idempotency_key)` 唯一；任务通过 `(workspace_id, project_id)` 复合外键限制到同租户项目，source/preview node 通过 `(project_id, node_id)` 外键限制到同项目。状态只允许 queued、running、succeeded、failed、canceled，进度为 0-100，attempt 不得超过 max attempts。running 必须同时拥有 lease owner/token/expiry 和 started time，终态必须拥有 finished time，非 running 不得保留租约。

任务状态机必须由 `server/modules/tasks` 执行条件迁移：queued -> running/canceled，running -> queued/succeeded/failed/canceled，failed -> queued；succeeded/canceled 为不可逆终态。running -> queued 用于租约过期恢复，failed -> queued 用于显式重试。后续 PostgreSQL 服务必须把状态条件写进 `UPDATE ... WHERE status = ...`，不能先读后无条件覆盖。超时租约由恢复任务重新排队或标记失败，不允许永久 running。

### `task_attempts`

P5-1 已建表，按 `(workspace_id, task_id)` 外键绑定任务，并以 `(task_id, attempt_number)` 唯一。保存每次尝试的 Provider/model、running/succeeded/failed/canceled 状态、开始/结束、远端请求 ID、可重试分类、计量摘要和脱敏错误。不得保存 Authorization、完整附件或完整响应正文。

### `task_commands`

P5-3 已由 `0009_task_commands.sql` 建表，持久化 cancel/retry 命令的 `workspace_id`、`task_id`、命令类型、幂等键、可信 session 用户和创建时间。`(workspace_id, idempotency_key)` 唯一，`(workspace_id, task_id)` 复合外键绑定同租户任务并随任务级联删除；命令只允许 cancel/retry。命令记录用于区分“请求重放”和“在相同任务状态下发出的新命令”，不能用当前状态代替持久化幂等事实。

### P5-1 schema 迁移策略

`0007_generation_tasks.sql` 新增任务/尝试表和索引，并把 P4 预留的 `asset_references.task_id` 从 text 转为 UUID、增加同工作区任务外键。P4 应用尚未写入任务引用；若升级时发现任何遗留 task 引用，迁移会在单个事务中显式失败，运维必须先核对来源并以前向修复方式创建可信任务或移除错误数据，不能由迁移猜测 workspace 或静默丢弃引用。应用回退到 P4 时可保留新增表；P4 不读取任务表，但已转换的 UUID 列不能再接受任意文本任务 ID。

### `provider_credentials`

P5-2 已由 `0008_provider_credentials.sql` 建表。保存 `workspace_id`、Provider ID、白名单 base URL、AES-256-GCM envelope JSON、密钥版本、末四位提示、active/disabled 状态、创建/更新用户和时间戳；`(workspace_id, provider_id)` 唯一。envelope 必须包含 algorithm、keyVersion、IV、ciphertext 和 auth tag，JSON keyVersion 必须与关系列一致。表中不保存明文 API Key。

加密 AAD 绑定 workspace ID 和 Provider ID，因此跨租户或跨 Provider 复制 ciphertext 无法通过认证解密。写入使用当前 active key version，读取可使用 keyring 中的历史版本；轮换采用“部署新旧 keyring -> 切换 active -> 后台重加密 -> 移除旧密钥”的前向流程。回退旧应用时保留表即可；旧应用不读取 Provider 凭据。base URL 的精确 allowlist 属于服务端注册表约束，数据库额外拒绝非 HTTPS 和含空白的值。

### P5-2 schema 迁移策略

`0008_provider_credentials.sql` 是纯新增表迁移，不改写用户、项目、任务或资产数据。应用回退可保留该表；若回退版本无法解密新 key version，必须停止 Provider 执行而不是清空或降级密文。迁移测试验证 envelope 完整性、key version 一致性、HTTPS base URL、workspace/provider 唯一性和随机隔离 schema 升级。

### P5-3 schema 迁移策略

`0009_task_commands.sql` 是纯新增审计/幂等表迁移，不改写既有任务、项目图、版本、change 或资产引用。应用回退可保留该表；旧应用不会读取命令记录，但回退期间不得同时开放旧的非持久化 cancel/retry 写入口。迁移测试验证表、租户复合外键、workspace 幂等唯一约束、命令类型约束和历史索引。

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

P3-3/P3-4 与 P4-7 当前实现已覆盖上述当前图步骤。项目行使用 `FOR UPDATE` 串行化同项目批次；幂等键查询先于版本冲突和资产重新校验，确保已接受请求在项目继续更新或归档后仍返回原结果。节点父级基于操作后的活动节点集合校验缺失引用和环，删除节点会软删除关联边并删除节点引用。资产校验只按可信 actor 的 `workspace_id` 查询 UUID，并对命中的资产行使用共享锁保持 completed 判定到图事务提交；服务端不相信节点中的 workspace、user、object key、签名 URL 或临时 URL。缺失或跨工作区引用在任何写入前拒绝，事务异常也会回滚节点、连线、计数、change、version/sequence 和引用。

### 上传配额预留

创建新上传会话时，事务先锁定可信 `workspace_id` 对应的 workspace 行，再读取同工作区幂等键。已存在且元数据一致的 pending 会话直接复用，不重复预留；新请求汇总所有未软删除资产，其中 pending 为预留量，completed/failed/quarantined 为已用量。只有 `已用 + 预留 + 本次 byte_size <= storage_quota_bytes` 才能同时插入 pending `assets` 和 `asset_uploads`。workspace 行锁保证同一工作区并发请求依次看到前一笔已提交预留；超限返回 `QUOTA_EXCEEDED`，不插入资产、不签发对象存储 URL。配额事务不依赖浏览器声明的 workspace/user，也不读取其他工作区资产。

### 手动检查点

提交待处理图变化后，在一致版本读取当前节点和连线，从节点 record 提取资产 manifest，重新验证资产租户与 completed 状态，再组装检查点。manual checkpoint 更新 `projects.saved_snapshot_id`；periodic checkpoint 只进入历史列表和恢复候选，不改变手动保存点。P4-8 已覆盖当前节点资产 manifest；任务状态和任务资产引用仍随 P5 接入。

### 任务完成

同一事务更新任务状态、结果资产、用量账本和必要节点，通过任务幂等键追加项目变更。对象转存未完成时不能把任务标记为 succeeded。

### 任务创建与命令

创建任务先校验可信 session 成员和写角色，再在短事务中锁定 workspace 行。事务先读取同 workspace 创建幂等键；同键同输入返回原任务，同键异输入拒绝。新任务必须验证活动项目及 source/preview node 归属、对 active Provider 配置加共享锁，并在 workspace 行锁保护下统计 queued/running 数量；只有少于 5 个时才插入任务并递增项目 `task_count`。任一失败均不插入任务或修改计数，也不改变图 version/sequence/change。

cancel/retry 同样先锁 workspace，再锁同 workspace 任务行并读取持久化命令幂等键。queued cancel 原子进入 canceled，running cancel 只设置取消请求；retry 只把未达尝试上限的 failed 任务重排为 queued 并清理旧错误和租约字段。状态更新与 `task_commands` 插入共享一个事务；唯一键竞争由 workspace 锁串行化。命令不修改当前图、项目 version/sequence 或 `project_changes`。

### 历史恢复

锁定项目，校验 `expectedVersion`/`expectedSequence`，读取并验证目标检查点，先创建 pre-restore 检查点，再替换当前关系状态、重建引用、追加 restore 变更并递增版本。原检查点和历史行保持不变。P4-8 已把节点资产 manifest 校验和当前引用重建纳入同一恢复事务；任务状态恢复仍随 P5 接入。

## 导入导出映射

导入将迁移后的 `ProjectRecord` 拆成：

- 项目元数据 -> `projects`
- canvas nodes -> `project_nodes`
- canvas edges -> `project_edges`
- task queue -> `generation_tasks`
- 媒体引用 -> `assets` / `asset_references`
- saved/working snapshot -> import/manual 检查点和当前关系状态

导出反向组装 `savedSnapshot` 与 `workingSnapshot`，保持 schema 版本和本地目录包契约。往返测试必须比较语义归一化结果，而不是依赖 JSON 属性顺序。

