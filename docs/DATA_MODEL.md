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

- `"user"`：主要字段为 `id`、`user_no`、`name`、`email`、`email_verified`、`image`、`status`、`created_at`、`updated_at`。其中 `status` 是 Cloud 追加字段，用于 `active`、`disabled`、`deleted` 账号状态；`user_no` 是从 `10001` 开始、由 PostgreSQL sequence 自动分配的不可变人类可读用户编号，唯一且不回收，但不参与认证或授权。
- `"session"`：主要字段为 `id`、`user_id`、`token`、`expires_at`、`ip_address`、`user_agent`、`created_at`、`updated_at`。会话 Cookie 由 Better Auth 生成签名值并写入 `better-auth.session_token`。
- `"account"`：保存登录提供方账号，邮箱密码登录使用 `provider_id='credential'`，密码哈希由 Better Auth 管理并保存在 `password` 字段。
- `"verification"`：保存 Better Auth 的邮箱验证、密码重置等一次性验证值。注册后发送验证邮件、重发验证邮件、验证 token 消费、忘记密码和重置密码均复用 Better Auth 能力，不维护自研 token 表。

前端和 API 日志不得记录密码、`better-auth.session_token`、重置 token、生产验证/重置链接、Authorization 或 Provider API Key。开发/测试环境可以打印邮箱验证和密码重置链接用于本地调试；生产环境必须接入真实邮件发送服务，不能依赖日志取 token。Cloud 业务授权不信任客户端传入的 `user_id`，必须先从 Better Auth session 解析用户，再通过 `workspace_members` 校验工作区权限。

`0023_user_numbers.sql` 按 `(created_at, id)` 为历史账号稳定回填 `10001` 起的编号，再把 sequence 推进到当前最大值；新账号由列默认值取得下一编号。sequence 允许因事务回滚产生空号，但已经分配的编号不得修改或复用。Better Auth 的不透明 `user.id` 继续作为认证主键和外键目标，`user_no` 只用于用户本人展示、客服检索和后台运营管理。

账号采用单活跃 session。登录密码验证成功后若已存在其他有效 session，未携带接管确认时返回稳定的 `409 ACTIVE_SESSION_EXISTS` 并删除本次临时 session；确认后删除同用户其他 session，只保留新 session。业务 API 只能信任未到期且未撤销的当前 session，密码重置成功后同样撤销旧 session。

### `auth_devices`

持久保存当前与历史登录设备，主要字段为 `id`、`user_id`、`device_key`、`user_agent`、`first_seen_at`、`last_seen_at` 和可空的 `last_session_id`。`(user_id, device_key)` 唯一；`last_session_id` 通过外键指向 Better Auth session 并在 session 删除时置空，因此踢掉旧设备不会删除历史设备记录。设备 ID 是客户端生成的非认证标识，服务端仍从可信 session 解析用户并按 `user_id` 隔离查询和删除。当前设备记录不可从设备管理页删除。

`0010_auth_devices.sql` 会创建表、约束和索引，并把升级时仍有效的历史 session 前向回填为设备记录。浏览器首次携带持久设备 ID 登录后，服务端会合并相同 User Agent 的 `legacy-session` 回填记录；`0011_auth_device_legacy_dedup.sql` 负责清理升级后已经产生的这类重复记录。发布前回滚可以删除 `auth_devices` 表并停用设备历史接口；一旦生产设备历史已经写入，应采用前向修复而不是回滚迁移，避免丢失用户可见的登录历史。

### `workspaces`

主要字段：`id`、`type`、`name`、`owner_user_id`、`status`、`plan_key`、`storage_quota_bytes`、任务配额字段和时间戳。

首发 `type=personal`。注册事务必须同时创建用户、个人工作区和 owner membership。P4-10 起，新建 personal workspace 的 `storage_quota_bytes` 默认是 `21474836480`（20 GiB），`0006_workspace_storage_quota.sql` 同时把历史 personal workspace 的占位 `0` 前向回填为该值。团队工作区尚未开放，后续可按 plan 显式覆盖配额。

### `workspace_members`

主要字段：`workspace_id`、`user_id`、`role`、`joined_at`。

`(workspace_id, user_id)` 唯一。首发只开放 owner，但角色枚举预留 `admin`、`editor`、`viewer`。

### `workspace_user_state`

保存某用户在某工作区的最近项目、当前项目和非敏感 UI 游标。单活跃会话降低多设备同时写入，但旧标签和并发请求仍必须依赖版本冲突保护；该状态不能放在 `workspaces` 上，否则未来团队成员会互相覆盖。

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

`object_key` 唯一，不含邮箱和项目名称。`status` 至少包含 pending、completed、failed、quarantined、deleted。P4-1 迁移已建立 `assets` 表，`workspace_id` 是所有查询和配额统计的租户边界；`origin_project_id` 通过 `(workspace_id, project_id)` 复合外键保证不能指向其他工作区项目。`object_key` 按工作区、项目或用途分段，但必须由服务端 ID 组成，不保存用户邮箱、项目名称或原始完整本地路径。P4-4 读取始终先校验当前 session 的工作区成员关系，再以 `(workspace_id, asset_id)` 查询未软删除资产；只有 completed 状态可以取得短期对象存储读取 URL，其他工作区或已删除资产按不存在处理。工作区存储明细按 `assets.origin_project_id` 归属项目，统计未软删除且状态为 pending、completed、failed 或 quarantined 的文件数与字节数，口径与配额总用量一致；查询只返回同一可信 `workspace_id` 下未软删除的项目，归档项目仍保留在明细中。

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

### `task_queue_outbox`

P5-4 已由 `0012_task_queue_outbox.sql` 建表。每行保存 workspace、任务、固定 `run` 派发类型、稳定派发键、可派发时间、发布时间、尝试次数、短期 claim owner/token/expiry、脱敏失败摘要和时间戳。`(workspace_id, dispatch_key)` 唯一，`(workspace_id, task_id)` 复合外键绑定同租户任务并随任务级联删除；claim 三元组必须同时为空或同时存在。

创建任务在原事务中写入 attempt 1 的派发事实，显式 retry 在任务重新进入 queued 的事务中写入下一 attempt 派发事实。dispatcher 只领取 `published_at IS NULL`、已到 `available_at` 且未被有效 claim 的行，使用 `FOR UPDATE SKIP LOCKED` 支持多 Worker；发布成功后按 claim token 标记 published，失败则清除 claim、保存脱敏错误并推进退避时间。BullMQ 消息只包含 outbox/task ID，job ID 使用 outbox ID；PostgreSQL 仍是任务状态事实来源。

### P5-5 Worker 租约语义

领取任务使用带 `status='queued'`、`available_at<=now()` 和 attempt 上限的条件 UPDATE；成功时同事务将状态改为 running、递增 `attempt_count`、生成 lease token、设置 owner/expiry、保留首次 `started_at` 并插入对应 attempt_number 的 running `task_attempts`。重复 BullMQ 作业、陈旧 outbox 或多 Worker 竞争只允许一个 claim 成功。

续租和进度更新必须同时匹配 task ID、running 状态、lease owner、lease token，并要求原租约尚未过期。进度只允许单调增加。取消或失败收敛先锁定同一 lease 的任务并结束当前 running attempt；取消进入 canceled，可重试失败在还有 attempt 时进入 queued，并让任务和下一 outbox 使用一致退避窗口；不可重试或达到上限进入 failed。过期租约恢复按 `lease_expires_at` 扫描并使用 `FOR UPDATE SKIP LOCKED`，复用同一收敛事务，不能直接清空 lease 后遗留无 attempt 或无派发的 queued 任务。

### P5-7 Provider 提交语义

`0013_provider_submission_fencing.sql` 向 `task_attempts` 增加非空 `submission_key`、`submission_stage` 和可空 `remote_task_id`。stage 仅允许 ready、submitting、submitted、polling、uncertain；submitted/polling 必须有远端 ID，其他阶段不得伪造远端 ID。每个 task 的所有 attempt 保存同一由 task ID 派生的稳定 key，用于 Provider 明确支持的幂等提交；该 key 不包含 API Key、prompt、附件或用户身份。恢复索引仅覆盖 submitting/submitted/polling/uncertain，避免扫描全部历史 attempt。

持有当前 Worker/lease token 的事务才能读取或更新当前 attempt。提交前将 stage 写为 submitting；远端确认后在同一事务把 attempt 写为 submitted 和远端 ID，并更新任务的 `remote_task_id`。新 attempt 发现任务已有远端 ID 时写为 polling 并优先轮询；发现无 ID 的不确定提交时，只有 adapter 显式支持幂等才允许重用同一 key，否则写 uncertain，后续应以非重试失败结束，不得盲目重排。迁移对既有 attempt 回填稳定 key；若当前 attempt 已有任务远端 ID，则迁为 submitted 以保留轮询能力。迁移是加字段/约束/索引，旧应用可读取但不能创建新 attempt，因此回退时必须停止 Worker claim、Consumer 和 lease recovery；重新升级无需数据修复，由新 Worker 接续已有 remote ID 或确定不确定提交。

### P5-1 schema 迁移策略

`0007_generation_tasks.sql` 新增任务/尝试表和索引，并把 P4 预留的 `asset_references.task_id` 从 text 转为 UUID、增加同工作区任务外键。P4 应用尚未写入任务引用；若升级时发现任何遗留 task 引用，迁移会在单个事务中显式失败，运维必须先核对来源并以前向修复方式创建可信任务或移除错误数据，不能由迁移猜测 workspace 或静默丢弃引用。应用回退到 P4 时可保留新增表；P4 不读取任务表，但已转换的 UUID 列不能再接受任意文本任务 ID。

### `provider_credentials`

P5-2 已由 `0008_provider_credentials.sql` 建表，`0021_custom_provider_profiles.sql` 增加 `display_name` 和 `provider_type`，`0024_provider_website_urls.sql` 增加可空 `website_url`。`0022_user_provider_credentials.sql` 将当前归属改为账号：表以 `user_id` 和 Provider ID 唯一，保存显示名称、协议类型、官网链接、API base URL、AES-256-GCM envelope JSON、密钥版本、末四位提示、active/disabled 状态、创建/更新用户和时间戳。`workspace_id` 仅作为 0022 之前密文的可空旧加密作用域保留，新凭据不写该列。表中不保存明文 API Key。

新密文的 AAD 绑定 user ID 和 Provider ID，因此跨账号或跨 Provider 复制 ciphertext 无法通过认证解密。0022 之前的密文继续使用保留的 `workspace_id` 按 v1 AAD 解密；用户下次更新 API Key 时会写为 user scope 并清空旧 workspace 作用域。写入使用当前 active key version，读取可使用 keyring 中的历史版本；轮换采用“部署新旧 keyring -> 切换 active -> 后台重加密 -> 移除旧密钥”的前向流程。base URL 在领域层规范化为公开 HTTPS 根地址并拒绝本机、私网、凭据、query、fragment 和非标准端口；数据库继续拒绝非 HTTPS 和含空白的值。协议类型首发为 `openai_compatible`，旧 `aliyun` 行前向迁移为 `aliyun_dashscope`。

P5-6 连接测试不新增持久化表，也不写入 `provider_credentials`。请求在认证成功后只读取当前用户的 active 行并短期解密 envelope；测试结果、Provider 响应正文、Authorization、完整 URL query 和 API Key 均不进入表、任务错误或日志。失败只通过稳定的脱敏分类映射为 `PROVIDER_CONFIG_INVALID` 或 `PROVIDER_UNAVAILABLE`。

### P5-2 schema 迁移策略

`0008_provider_credentials.sql` 是纯新增表迁移，不改写用户、项目、任务或资产数据。应用回退可保留该表；若回退版本无法解密新 key version，必须停止 Provider 执行而不是清空或降级密文。当前迁移测试验证 envelope 完整性、key version 一致性、HTTPS base URL、user/provider 唯一性和随机隔离 schema 升级。

`0021_custom_provider_profiles.sql` 是兼容性扩展迁移：为既有行回填显示名称与协议类型，`openai` 映射为 `openai_compatible`，`aliyun` 映射为 `aliyun_dashscope`；触发器保证旧应用省略新字段写入时仍得到确定协议。发布后不删除这两列或密文；需要回退应用时保留 schema，由前向修复重新回填缺失元数据。迁移前必须备份凭据表，迁移过程不解密也不重写 API Key envelope。

`0022_user_provider_credentials.sql` 增加 `user_id` 并从稳定的 `created_by_user_id` 回填，随后把唯一约束和查询索引切换为 user/provider；旧 `workspace_id` 改为可空，仅用于识别 v1 AAD，不解密或重写 envelope。若历史数据中同一创建用户和 Provider ID 存在多行，迁移会原子失败，必须在加密备份后人工确认保留/改名策略再前向重跑，不能静默删除凭据。新应用不兼容未执行 0022 的 schema，旧应用也不能在 0022 后继续写 Provider，因此发布顺序必须是备份、迁移、API/Worker 同步切换；回退需要恢复迁移前备份或继续前向修复。

`0024_provider_website_urls.sql` 是可向后兼容的 nullable additive 迁移：OpenAI 和阿里百炼旧行回填各自官网，自定义 Provider 从已校验 API base URL 提取公开 HTTPS origin。数据库约束官网长度、HTTPS 和无空白；领域层进一步拒绝本机、私网、凭据、query、fragment 和非标准端口。`website_url` 仅作为设置页信息展示，Worker 和连接测试绝不把它当作请求目标，所有 Provider 网络请求仍只使用已校验的 `base_url` 与固定 endpoint。旧应用可以忽略该列；回退时保留列和回填值，缺失值由新应用使用官方默认值或 API origin 前向修复。

### P5-3 schema 迁移策略

`0009_task_commands.sql` 是纯新增审计/幂等表迁移，不改写既有任务、项目图、版本、change 或资产引用。应用回退可保留该表；旧应用不会读取命令记录，但回退期间不得同时开放旧的非持久化 cancel/retry 写入口。迁移测试验证表、租户复合外键、workspace 幂等唯一约束、命令类型约束和历史索引。

### P5-4 schema 迁移策略

`0012_task_queue_outbox.sql` 新增 outbox 表，并把升级时已有 queued 任务按 `attempt_count + 1` 回填为待发布 `run` 事实；running、failed、succeeded 和 canceled 不回填。回填不修改任务状态、attempt、项目图或资产。应用回退可保留 outbox 表，但 P5-3 应用不会继续创建派发事实，因此回退期间必须停止 Worker dispatcher；重新升级后应通过受控前向修复补齐回退窗口产生的 queued 任务，不能依赖 Redis 中的偶然残留作业。

### `usage_ledger`

P5-8 已由 `0014_task_results_usage_ledger.sql` 建表。保存 `workspace_id`、任务、成功 attempt、Provider/model、计费模式、受限数值 `usage_json` 和时间；同一 `task_id` 唯一，复合 workspace/task 外键和 task/attempt 外键保证账本不能跨租户、跨任务或归属不存在的 attempt。账本不保存 Provider 响应、结果 URL、prompt、附件、Authorization 或 API Key。任务成功重放返回既有结果，不重复插入账本。

### P5-8 结果资产与成功收敛

Provider 临时结果先在事务外下载、大小/MIME/魔数/SHA-256 校验并写入私有对象存储；下载、校验或对象写入失败时，不插入 `assets`，也不得将任务写为 succeeded。成功转存的 asset ID 和对象 key 由 task ID 与结果序号稳定派生，崩溃重试仍指向同一结果定位符；事务提交前的孤立对象交给既有对象维护流程诊断，不得伪造 completed 数据库资产。

持有当前 `worker_id` 与 `lease_token` 的成功事务锁定任务和 workspace 配额，写入 completed `assets`、task result `asset_references`，并仅在活动 preview node 仍存在且项目未归档时写 node result `asset_references`、合并 `project_nodes.data_json.generationResults.<taskId>`、追加 source=`worker` 的单个 `project_changes`、递增项目 version/sequence。该 JSONB 子树保存 task ID 与标准 `{ assetId, assetKind }` 对象，现有图/检查点资产提取器可以继续生成 manifest；它不改位置、尺寸、presentation 或其他用户数据。删除 preview node 或归档项目不会被 Worker 重建。随后事务结束 attempt、写入账本、更新 `generation_tasks.result_json` 为 asset IDs 并清理 lease。取消请求优先收敛 canceled；租约 fencing 失败、配额拒绝或任一写入失败都会回滚资产引用、账本、图变更和任务成功状态。

P5-9 图片/视频能力不新增表或迁移。Worker 在当前 lease 内先把 attempt 置为 `submitting`，因此进程在网络调用前后中断时仍由 P5-7 防重复提交规则处理；OpenAI `gpt-image-2` 同步调用没有远端 task ID，未确认调用不会被自动重发。当前同时允许阿里百炼 `wanx2.1-t2i-turbo` 异步文生图和 `wan2.7-t2v` 异步文生视频，其提交返回的受限远端 ID 必须在同一有效 lease 内写入 attempt 与 task；后续 attempt 一律转为 polling 并复用该 ID。OpenAI 编辑任务在同一有效 lease 下，从该 task source node 的 completed `asset_references` 解析私有对象 key 与 MIME，不接受客户端 URL 或对象 key；租约失效、跨工作区、已删除或未完成的资产都不会被读取。异步轮询和同步结果最后均进入 P5-8 成功事务，视频结果资产使用既有 `asset_kind='video'` 与 `generationResults.<taskId>.assets[].assetKind='video'`，不新增媒体 blob 列。

P5-10 首个 Web 投影不新增表或迁移。浏览器把服务端 `generation_tasks` 摘要映射为临时 UI task，并只持久化 server task ID、项目/node/model、0-100 progress、状态和脱敏错误；该投影不保存 request JSON、Provider 密钥、远端 ID、结果 URL、对象 key、账本或 attempt 字段。跨项目缓存只是会话内的 queued/running 摘要副本，按 `projectId` 隔离，不写入 `TaskQueueSnapshot`、项目图或 checkpoint，终态立即从该缓存移除。Cloud 服务商设置的新 API Key 也只是组件临时输入，不属于 `ProviderProfileConfig`、Zustand 配置、任务投影、项目图或快照；持久化凭据仍唯一存在于服务端 `provider_credentials` 加密 envelope。结果仍以 `project_nodes.data_json.generationResults.<taskId>.assets` 中的 `{ assetId, assetKind }` 为事实，浏览器只用 asset ID 请求既有短期签名 URL。服务端任务状态、结果资产和 worker graph change 的关系不因 UI 投影而改变。

P5-11 新增 `generation_task_events`，由 `generation_tasks` 的同事务触发器写入创建、状态、进度和终态事件；迁移会为已有任务回填一条当前状态事件。事件以数据库 identity `sequence` 作为工作区轮询游标，以 UUID `id` 作为稳定通知幂等键，保存 `workspace_id`、`task_id`、`project_id`、事件类型、状态、0-100 进度、脱敏错误码/消息和创建时间。事件表通过 `(workspace_id, task_id)` 与 `(workspace_id, project_id)` 复合外键约束租户边界，并提供工作区/项目/任务游标索引；不保存 request JSON、Provider 密钥、lease/attempt、远端任务 ID、结果 URL、对象 key 或媒体 blob。错误消息在数据库触发器中再次截断并替换常见凭据模式。事件日志只用于恢复和通知，不能替代 `generation_tasks`、结果资产或项目图事实；删除任务/项目时事件随外键级联清理。

## 迁移导入

### `migration_imports`

P6-2 由 `0016_migration_imports.sql` 建表。每行保存 import UUID、可信 `workspace_id`/创建成员、package schema/ID/source platform、来源项目 ID/version/sequence/name、workspace 幂等键与请求指纹、内容 SHA-256、状态、项目冲突快照、文件/资产/字节计数、估算占用、重试/脱敏错误、validated manifest/ProjectRecord/graph/asset manifest/可选 checkpoint JSONB、取消/完成/过期时间和时间戳。

状态枚举预留 `prepared`、`uploading`、`validating`、`ready`、`committing`、`completed`、`failed`、`canceled`、`expired`。计数和字节必须非负且 completed 不超过 total；failed/canceled/completed 与各自错误或终态时间保持一致。JSON payload 必须为对象，checkpoint 可空。`(workspace_id, idempotency_key)` 唯一，同键不同请求指纹不能覆盖原行；创建者通过 `(workspace_id, created_by_user_id)` 外键绑定当前成员。只有 `project_exists` 可以保存同 workspace target project 及 expected version/sequence，其他冲突类型不得携带目标详情。

prepare 保存 validated package JSON 是为了 API/Worker 重启后继续后续上传与 commit，不是当前项目事实来源。表不保存媒体 blob、对象 key、签名 URL、Provider URL、API Key、Authorization 或配额 reservation。P6-2 只产生 prepared/canceled/expired 状态，不写 `projects`、`project_nodes`、`project_edges`、`project_changes`、`project_snapshots`、`assets`、`asset_uploads` 或 `asset_references`。

### `migration_import_asset_uploads`

P6-3 为每个 `logical_asset_id` 建立独立上传行，保存服务端 staging object key、multipart provider upload ID、上传模式、分片计划、已确认分片 ETag/字节数、期望 MIME/大小/SHA-256、状态、重试次数和过期/终态时间。对象 key 和 provider upload ID 只存在服务端，API 只返回短期签名 URL。workspace/import/logical asset 唯一约束防止重复会话，复合外键保证上传不能跨 workspace 绑定 import。

`pending`、`uploading`、`validating` 和已完成但尚未 commit 的暂存字节计入 workspace `reserved_bytes`；failed/canceled/expired 行不再占用 reservation。上传完成只把父 import 推进到 `ready`，不创建正式 asset 或引用；P6-4 commit 必须在同一事务中重新校验并转移这些暂存对象。

### Commit 幂等映射

`0018_migration_import_commit.sql` 为 `migration_imports` 增加 commit request 指纹、策略、目标 project、完成时间，并为上传行增加 `committed_asset_id`。commit 在同一事务内锁定 import、workspace quota 和 replace 目标项目，完成资产 UUID 映射、图/引用/change/checkpoint 写入后才将 import 标记 completed；重复请求必须使用同一 idempotency key 和指纹，否则返回 `IMPORT_CONFLICT`。失败回滚所有数据库写入，staging 对象仍由后续重试或 GC 处理。

P6-5 copy 在事务内为节点和连线生成新 UUID，并用同一映射重写 `parent_node_id`、edge source/target、`project_changes.operations_json` 和 import checkpoint；replace 不重映射图实体 ID。正式资产映射先以可信 `workspace_id`、`status=completed`、未软删除、SHA-256、字节数和 MIME 查询既有资产并持有共享锁，完全匹配时允许多个同 workspace 项目引用同一 asset UUID，否则从当前 import 的 staging 对象创建新资产。查询条件和 `committed_asset_id` 复合外键共同禁止跨 workspace 复用；无论复用还是新建，上传行写入 `committed_asset_id` 后都退出 reservation 统计。

### `migration_exports`

P6-6 的 `0019_migration_exports.sql` 为每次单项目导出保存可信 workspace/creator/project、幂等键与请求指纹、冻结的 project version/sequence、规范化 `manifest_json`/`project_record_json`/`graph_json`/`asset_manifest_json`/可选 checkpoint、服务端资产对象映射、状态与进度、归档 object key/大小/SHA-256、脱敏错误、取消/完成/过期时间。`archive_object_key` 只存在服务端数据库和对象存储边界，API 不返回；表通过 `(workspace_id, project_id)` 与 `(workspace_id, created_by_user_id)` 复合外键保持租户边界。

`0020_migration_lifecycle_retry.sql` 增加 `retry_count` 与 retryable 索引。failed/canceled 导出只有在未超过 3 次时才能原子重置为 prepared，清空上一轮进度/错误/归档映射后重新生成；retry 不改变冻结的项目 version/sequence 或 payload。

导出状态为 `prepared`、`generating`、`completed`、`failed`、`canceled`、`expired`。prepare 事务锁定项目并一次性保存当前关系图和检查点快照，后续后台生成只能读取该快照，不能拼接新的 project version。completed 必须同时有归档 key/大小/hash 和完成时间；失败、取消或过期不写项目图、资产引用或 checkpoint。对象生成完成后若检测到取消请求会删除归档并收敛为 canceled；API/进程重启由 PostgreSQL 中的 prepared/generating 行恢复。

### P6-2 schema 迁移策略

`0016_migration_imports.sql`、`0017_migration_import_asset_uploads.sql`、`0018_migration_import_commit.sql`、`0019_migration_exports.sql` 与 `0020_migration_lifecycle_retry.sql` 都是新增字段/表、约束和索引迁移，不改写 P0-P5 的认证、项目、资产或任务数据。升级测试验证随机隔离 schema 的 20 个顺序迁移、workspace creator/target project 外键、上传复合外键、commit 映射外键、导出租户/生命周期/retry/进度/JSON 约束、幂等唯一键和拒绝路径。尚未写入真实 import/export 时可停用新 API 后删除这些表回退；一旦产生迁移会话或归档，旧应用可以忽略新表，数据库应保留数据并通过前向迁移修复，避免丢失可恢复上下文。

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

### 迁移导入预检

prepare 在进入事务前完成目录包纯校验和规范 JSON/逐文件/内容 SHA-256 校验。事务先锁定可信 workspace，再读取 `(workspace_id, idempotency_key)`；同指纹返回原行，不同指纹拒绝。新请求读取同一 workspace 最新已用和 pending 预留容量，以 package 资产总字节执行保守配额检查，再查询项目 ID 冲突并插入一行 prepared import。配额检查只是估算，不建立 reservation；任一失败回滚 import，且事务始终不修改正式图、资产、引用、change 或 checkpoint。P6-3 上传和 P6-4 commit 必须重新锁定并复查配额、状态和目标版本。

### 上传配额预留

创建新上传会话时，事务先锁定可信 `workspace_id` 对应的 workspace 行，再读取同工作区幂等键。已存在且元数据一致的 pending 会话直接复用，不重复预留；新请求汇总所有未软删除资产，其中 pending 为预留量，completed/failed/quarantined 为已用量。只有 `已用 + 预留 + 本次 byte_size <= storage_quota_bytes` 才能同时插入 pending `assets` 和 `asset_uploads`。workspace 行锁保证同一工作区并发请求依次看到前一笔已提交预留；超限返回 `QUOTA_EXCEEDED`，不插入资产、不签发对象存储 URL。配额事务不依赖浏览器声明的 workspace/user，也不读取其他工作区资产。

### 手动检查点

提交待处理图变化后，在一致版本读取当前节点和连线，从节点 record 提取资产 manifest，重新验证资产租户与 completed 状态，再组装检查点。manual checkpoint 更新 `projects.saved_snapshot_id`；periodic checkpoint 只进入历史列表和恢复候选，不改变手动保存点。P4-8 已覆盖当前节点资产 manifest；任务状态和任务资产引用仍随 P5 接入。

### 任务完成

对象转存完成后，持有当前 lease 的 Worker 在同一事务校验配额并更新任务状态、结果资产、任务/节点引用、用量账本和必要 preview node；活动 preview node 通过任务 ID 稳定的 worker change 追加结果字段，项目版本/sequence 只在实际节点变更时递增。任务已 succeeded 的重放只读取既有任务结果，不重复创建资产、节点、账本或 change。对象转存未完成、取消优先、配额不足、lease fencing 失败或任一数据库错误时不能把任务标记为 succeeded。

### 任务创建与命令

创建任务先校验可信 session 成员和写角色，再在短事务中锁定 workspace 行。事务先读取同 workspace 创建幂等键；同键同输入返回原任务，同键异输入拒绝。新任务必须验证活动项目及 source/preview node 归属、对 active Provider 配置加共享锁，并在 workspace 行锁保护下统计 queued/running 数量；只有少于 5 个时才插入任务、写入下一 attempt 的 `task_queue_outbox` 派发事实并递增项目 `task_count`。任一失败均不插入任务、outbox 或修改计数，也不改变图 version/sequence/change。

cancel/retry 同样先锁 workspace，再锁同 workspace 任务行并读取持久化命令幂等键。queued cancel 原子进入 canceled，running cancel 只设置取消请求，由持有有效 lease 的 Worker 或过期恢复事务结束 attempt 并收敛为 canceled；retry 只把未达尝试上限的 failed 任务重排为 queued、清理旧错误和租约字段并写入下一 attempt 的 outbox。状态更新、outbox 与 `task_commands` 插入共享一个事务；唯一键竞争由 workspace 锁串行化。命令不修改当前图、项目 version/sequence 或 `project_changes`。

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

## P8 管理控制面与双模式数据模型

P8 数据迁移从 `0025` 开始，按 expand/migrate/contract 发布，不把 Admin 认证、官方目录、积分和旧 BYOK 清退挤入一个不可观察的大事务。

### `admin` schema 与管理员认证（0025）

同一 PostgreSQL 实例新增独立 `admin` schema 和独立数据库角色。Better Auth 管理员表位于该 schema，包含 `user`、`session`、`account`、`verification` 和 `two_factor`；管理员 user 增加固定角色、封禁状态和 `two_factor_enabled`，session 使用与普通用户不同的 Cookie 和 Auth Secret。普通 API/普通用户数据库角色不得读取这些表。

`admin.user.role` 只接受 `super_admin|operator|support|auditor`，`status` 只接受 `active|banned`；邮箱规范化为小写唯一值。`admin.two_factor` 对管理员唯一，保存 Better Auth 加密后的 TOTP secret、加密恢复码、verified、连续失败次数和锁定时间，恢复码明文只在生成响应中出现一次。session token 只存在 Better Auth session 表和 HttpOnly Cookie，不进入 Admin HTTP 响应或审计。

`admin.audit_events` 是追加式管理审计，保存管理员 ID、角色、动作、目标类型/ID、result、request ID、IP/User-Agent 哈希、脱敏 before/after JSON 和时间。运行角色不能 UPDATE/DELETE；事件不得保存 API Key、session token、恢复码、用户正文、Provider 响应或完整连接 URL。

`0025` 创建固定 schema 后撤销 PUBLIC 的 schema/table/sequence/function 权限。部署脚本以 migration 角色分别授予普通应用角色 public 业务表权限和 Admin 角色 Admin 身份/MFA表权限；普通角色对 `admin` 无 USAGE，Admin 角色不获 public 普通身份表权限。`audit_events` 对 Admin 运行角色仅授予 INSERT/SELECT，并额外由 `BEFORE UPDATE OR DELETE` 触发器无条件拒绝修改。迁移发布清单从 `0025` 开启 `p8` release train 的新一轮 expand，相位单调性在各 train 内独立校验。

### 站点配置与品牌资产（0026）

`admin.site_config_revisions` 保存不可变结构配置，`admin.site_config_current` 只保存当前 revision 外键。配置包含网站名称/短名称、备案字段、帮助与法律链接、首页/Footer 文案、主题预设、导航枚举、功能开关和 Logo/Favicon asset ID；JSONB 必须满足版本化运行时 schema，不接受 HTML、JavaScript、任意 CSS。

`admin.site_assets` 保存独立于 workspace 资产的品牌文件元数据、对象存储定位、MIME、字节数、SHA-256、尺寸、状态和时间。只接受 PNG/JPEG/WebP/ICO；对象 key 不进入公开配置。保存站点配置时先验证引用资产 completed，再写 revision 并原子切换 current。

### 官方 Provider 与模型修订（0026）

`admin.official_providers` 保存稳定逻辑 ID、显示名、状态和当前 endpoint revision。`admin.official_provider_revisions` 不可变保存协议类型、规范化 HTTPS base URL、允许能力和创建管理员。`admin.official_provider_secrets` 保存 AES-256-GCM envelope、密钥版本、末四位、状态和轮换时间；明文不落库且不能通过列表接口恢复。

`admin.official_models` 保存稳定模型 ID、当前 revision、启用状态和排序。`admin.official_model_revisions` 不可变保存显示名、`chat|image|video` 类型、Provider revision、真实 Provider model key、能力/参数策略 JSONB 和正整数 `credit_cost`。保存立即创建 revision 并切换 current；任务必须引用具体 model revision，不能只在执行时读取 current。

### 官方积分与任务扩展（0027）

`workspace_official_credit_periods` 以 `(workspace_id, period_start)` 唯一，保存月度 grant、管理员 adjustment、reserved、consumed 和更新时间。`official_credit_ledger` 保存 `monthly_grant|admin_adjustment|reserve|consume|release`、整数 delta、幂等键、原因、可空 task ID 和操作者；同一业务幂等键不得重复影响余额。

`generation_tasks` 增加官方 model revision、Provider revision、credit period、reserved cost 和通用 `result_node_id`；`task_kind` 扩展为 `chat|image|video`。历史 `preview_node_id` 保留兼容读取并回填 `result_node_id`，不在同一版本破坏旧 Worker。官方新任务固定 `billing_mode=platform`；历史 `workspace_key` 行可读取但不再创建。

创建官方任务在一个事务中锁定 workspace 与 credit period，解析启用模型修订，验证项目/source/result node，检查 active task 限额和可用积分，再写 task、`reserve` 流水和 outbox。成功结果事务在项目图/资产/usage ledger 写入完成后把 reserve 转为 consume；最终失败/取消只释放一次。聊天结果使用受限 JSON 结构写入任务及目标节点的 task 专属结果子树，不覆盖位置、样式或后续用户编辑。

### 旧用户 BYOK 清退（0028 contract）

0028 只能在新代码停止 Provider 写入、停止创建 `workspace_key` 任务、旧 Worker 停止且所有活动旧任务收敛后执行。迁移删除 `provider_credentials` 及旧访问路径，不保留密文、末四位或可恢复导出；只允许审计记录各状态行数。随后销毁外部 `PROVIDER_CREDENTIAL_KEYS`，使历史备份密文不可解密并按保留周期淘汰。

0028 是不可逆 contract，旧应用不能在新 schema 上恢复 BYOK 写入或执行。发布前必须有隔离恢复证据，但回滚不得重新启用已销毁的用户 Key；只能以前向修复恢复非凭据业务读取。

### 浏览器本地状态

`GenerationMode`、本地 Provider、API Key、本地模型和绑定不进入 PostgreSQL。浏览器以可信 session 用户 ID 和 Origin 作为 IndexedDB Vault 分区，使用不可导出 WebCrypto `CryptoKey` 加密单个版本化配置文档。项目节点只保存 `official:<model-id>` 或 `local:<provider-id>:<model-id>` 引用，不保存 Base URL、API Key 或完整本地配置。
