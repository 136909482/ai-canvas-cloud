# AI Canvas Cloud 数据模型

本文档只定义当前 PostgreSQL 表、约束、事务和 schema 迁移语义。关系表保存事实状态，JSONB 只承载节点专属数据、版本化操作载荷、迁移载荷和完整检查点；图片与视频 blob 不进入数据库。阶段状态和完成记录只写入 `ROADMAP.md`。

## 通用约定

- 服务端实体使用 UUID/ULID 等跨设备唯一 ID。
- 时间使用带时区时间戳并由服务端生成。
- 租户资源包含 `workspace_id`，查询、外键和唯一约束不得跨租户混淆。
- 需要恢复或延迟清理的资源使用软删除；硬删除只由受控 GC 完成。
- JSONB 必须有运行时 schema、大小上限和版本；可查询、排序、授权或外键字段必须关系化。
- schema 只通过显式迁移升级，应用启动不自动改表。
- 浏览器 Provider、endpoint、模型 ID、API Key、本地生成任务和上游正文不进入 PostgreSQL；只允许 `generation_telemetry` 保存脱敏运营计数所需的有限元数据。

## 用户与租户

### Better Auth 核心表

普通认证位于 public schema：

- `"user"`：Better Auth 用户 ID、不可变 `user_no`、不可变 `username/display_username`、兼容 `name`、email、验证状态、账号状态和时间戳。
- `"session"`：用户、token、过期时间、IP/User-Agent 摘要和时间戳。
- `"account"`：credential provider 账号及 Better Auth 管理的密码哈希。
- `"verification"`：Better Auth 密码重置的一次性内部值。
- `registration_email_challenges`：注册前邮箱验证码的 `email_hash`、`code_hash`、过期/发送/消费时间与失败次数；不保存邮箱或验证码明文。
- `password_reset_email_challenges`：密码重置邮箱验证码的 `email_hash`、`code_hash`、AES-256-GCM 加密的 Better Auth token、过期/发送/消费时间与失败次数；不保存邮箱、验证码或 token 明文。

`user_no` 从 `10001` 开始，只用于本人展示、客服检索和运营管理，不参与认证或授权。`username` 为 3–30 位小写规范值，格式为 `^[a-z][a-z0-9_]{2,29}$`，具有唯一索引且排除保留词；`display_username` 保留注册时大小写，并以约束保证 `lower(display_username)=username`。两者均不可修改；`name` 只作为 Better Auth 兼容镜像，不是昵称或公共字段，`image` 兼容列不进入普通用户界面。普通用户状态为 `active|disabled|deleted`；`disabled` 不能登录、恢复 session 或通过 workspace 授权，`deleted` 可用于运营筛选和只读核对但不能再被状态操作。账号采用单活跃 session；同设备重登或异设备超过 10 分钟未活跃时静默接管，最近活跃或活跃状态未知的异设备要求明确确认，密码重置仍直接撤销旧 session。

日志、审计、错误和前端响应不得记录密码、session/reset token、注册或密码重置验证码、完整邮件链接或 Provider API Key。业务授权只信任 Better Auth session 解析的用户。

### `auth_devices`

保存 `id`、`user_id`、客户端非认证 `device_key`、User-Agent、首次/最近时间和可空 `last_session_id`。`device_key` 实际是浏览器级随机标识：每个浏览器在本 Origin 独立保存，不采集硬件指纹、不跨浏览器共享或合并。`last_seen_at` 在登录、注册和已认证 session 检查成功后刷新，既供设备管理展示，也作为登录时 10 分钟最近活跃窗口的事实来源；无法通过 `last_session_id` 关联的有效 session 视为活跃状态未知，不允许静默接管。`(user_id, device_key)` 唯一；删除 session 时只把 `last_session_id` 置空，不删除历史设备记录。当前设备记录不能从设备管理页删除。

### `workspaces`

保存 ID、类型、名称、owner、状态、plan、`storage_quota_bytes` 和时间戳。首发 `type=personal`，默认资产配额 10 GiB。

### `workspace_members`

`(workspace_id, user_id)` 唯一，角色为 owner/admin/editor/viewer。任何工作区资源查询都先带入可信 session 用户和成员关系。

### `workspace_user_state`

保存某用户在某工作区的最近项目、当前项目和非敏感 UI 游标。`ui_state_json.canvasPreferences` 是 `schemaVersion=1` 的版本化账号画布偏好，保存自动保存间隔、工具栏折叠、对齐线、入线动画、主题、性能模式、网格、连线样式和高清预览，并带独立 `updatedAt`；PATCH 在 JSONB 内按字段合并且保留其他 UI 状态。它不能放在 `workspaces` 上，避免未来成员互相覆盖，也不得包含 Provider、endpoint、真实模型 ID、绑定、Key 或本地任务。

### `auth_audit_events`

保存认证/账号安全事件、可信用户/工作区、request ID、脱敏网络摘要、结果和受限 metadata。事件不保存密码、Cookie、token、验证码、正文或 Provider Key。

## 项目图

### `projects`

主要字段：`id`、`workspace_id`、`name`、`version`、`last_sequence`、`saved_snapshot_id`、`node_count`、`edge_count`、归档/软删除时间和时间戳。

`version` 是项目级乐观并发版本，`last_sequence` 是连续 change 序号。活动/归档列表索引都限定 workspace 并排除软删除。

### `project_nodes`

主要字段：项目/节点 ID、类型、位置、尺寸、z-index、父节点、行版本、数据 schema 版本、`data_json`、`presentation_json`、软删除和时间戳。

- `(project_id, node_id)` 唯一。
- 父节点必须属于同项目；环在领域服务事务中校验。
- `data_json` 保存 prompt、匿名模型引用、生成参数和节点专属数据。
- `presentation_json` 只保存低频展示属性。
- Cloud 资产 ID 还必须同步进入 `asset_references`。
- 真实 Provider、endpoint、模型 ID、Key、任意 target URL 不得进入节点 JSON。

### `project_edges`

保存项目/连线 ID、source/target node、handles、类型、行版本、`data_json`、软删除和时间戳。端点使用同项目复合外键；删除节点时同事务清理关联边。

### `project_changes`

保存项目、sequence、base/result version、actor、client/batch/幂等键、source、版本化 operations 和时间。

- `(project_id, sequence)`、`(project_id, idempotency_key)` 和 `(project_id, batch_id)` 唯一。
- 领域事务锁定项目并保证 sequence 连续。
- user 来源记录可信 actor；HTTP 响应不返回 actor/workspace/幂等键。

### `project_snapshots`

保存 ID、项目、version/sequence、`manual|periodic|import|pre_restore` 类型、schema、`record_json`、字节数、`asset_manifest_json`、有效性和时间戳。检查点不是当前事实来源；恢复产生新版本。

服务端从当前关系化图组装检查点，不接受客户端整份 record 写入。当前 `ProjectRecord` 结构包含 `record_json.taskQueue.tasks`，但 Cloud 检查点固定写入空数组；浏览器本地任务缓存不进入 Cloud checkpoint。

创建 checkpoint 时从节点提取排序、去重的 Cloud asset UUID，按可信 workspace 验证 completed 状态后写入 manifest。restore 交叉校验 record/manifest，创建 pre-restore，再替换图、重建引用、追加 change 并递增 version/sequence。

历史 manifest 修复不改写 record、当前图、version/sequence 或当前引用；默认只读，`--apply` 时逐 checkpoint 短事务并保持幂等。

## 资产

### `assets`

保存 ID、workspace、来源项目、创建者、内部 object key、文件名、MIME、字节数、SHA-256、尺寸、asset kind、状态、软删除和时间戳。object key 唯一，只由服务端 ID 构成。

状态为 pending/completed/failed/quarantined/deleted。只有同一可信 workspace、未删除的 completed 资产可读取或引用。数据库不保存媒体 blob、签名 URL 或对象存储凭据。

### `asset_uploads`

保存上传会话、workspace、asset、期望 MIME/大小/hash、幂等键、过期和完成状态。创建时在 workspace 行锁下预留容量；完成时重新读取对象并验证真实 metadata。浏览器上报不是事实。

### `asset_references`

当前保存 `asset_id`、`workspace_id`、`project_id`、非空 `node_id`、reference role 和时间戳。每条引用都属于同项目节点。

图 upsert 先删除节点旧引用，再写入去重的新引用；delete 节点同步删除引用。checkpoint 的历史引用集合在 manifest 中保护，不在本表复制。

## 生成运营遥测

### `generation_telemetry`

每条浏览器生成 attempt 只保存可信 `workspace_id/user_id`、客户端随机 `client_attempt_id`、`category=text|image|video`、`status=started|succeeded|failed|canceled`、受限 `failure_category`、`result_count`、`duration_ms` 和时间戳。`(workspace_id, user_id, client_attempt_id)` 唯一。

状态约束固定为：started 不得有终态时间、耗时、结果或失败分类；succeeded 要求 1–32 个结果、0–24 小时耗时和终态时间；failed 要求受限失败分类、0 个结果、耗时和终态时间；canceled 要求 0 个结果、无失败分类、耗时和终态时间。领域服务只允许同类别 `started -> terminal`，已进入终态的行不可由重放改写。终态先到时可直接插入，迟到 start 幂等忽略。

失败分类只允许 `network|authentication|rate_limited|upstream|invalid_response|asset_upload|unknown`。表中禁止 Prompt、输出正文或媒体、Provider、模型 ID、endpoint、API Key、上游响应正文和 remote task ID。它不是任务、队列、用量账本或恢复事实，不能驱动执行、重试、轮询和计费。

Admin dashboard 按 `Asia/Shanghai` 自然日聚合请求、结果、成功/失败/取消、去重创作者、P95 耗时和近 7 日类别趋势。成功率为 `succeeded/(succeeded+failed)`；取消不进入分母。Admin 数据库角色只读取聚合所需列，不读取 `client_attempt_id`；普通 API 角色无删除权限。

## 资产对象诊断与 GC

通用维护命令默认只读。后台无引用资产清理固定使用 7 天宽限期，并拆分为只读 preview 与显式 apply。`pending` 已过期、`failed`、`quarantined`、软删除资产，以及已完成但不再被引用的 `completed` 资产，在宽限期后都可成为候选；当前 `asset_references` 或任一有效 `project_snapshots.asset_manifest_json` 引用存在时必须保留。宽限期按 pending 上传到期时间或资产最近的 `deleted_at/updated_at/created_at` 计算；首版不新增“引用移除时间”字段。

apply 逐资产加排他锁，并在持锁后的新语句快照中复查当前引用和有效 checkpoint manifest。completed 资产对象缺失时只在显式 apply 中把数据库状态收敛为 deleted；preview 只汇总可释放对象、容量和缺失对象记录。Admin 数据库角色不读取 asset ID、object key 或项目内容，聚合结果由普通 API 的最小权限角色计算。

对象存储与 PostgreSQL 不能形成一个事务，收敛顺序固定为“锁后复查 -> 幂等删除对象 -> 更新数据库状态”。提交失败由后续幂等运行收敛。

## 目录包迁移

### `migration_imports`

保存可信 workspace/创建者、package/source/project 摘要、幂等键和请求指纹、内容 hash、状态、冲突快照、计数、validated manifest/ProjectRecord/graph/asset manifest/可选 checkpoint、错误与终态时间。

prepare 只写 import 行，不创建正式项目、图、资产、引用、change 或 checkpoint。Cloud commit 不导入或执行 `ProjectRecord.taskQueue`，当前导出固定写空数组。

### `migration_import_asset_uploads`

保存每个 logical asset 的服务端 staging object key、multipart ID、分片计划/ETag、期望 metadata、状态、重试和过期。内部 key/ID 不进入 API。暂存完成不等于正式 asset；commit 才能在事务中物化或复用同 workspace completed 资产。

### Commit 幂等映射

commit 锁定 import、workspace 配额和可选 replace 目标。copy 重映射项目/节点/连线 ID；replace 仅在 expected version/sequence 仍匹配且 owner/admin 显式确认时提交。图、资产、引用、change 和可选 import checkpoint 一起提交，失败整体回滚。

### `migration_exports`

保存可信 workspace/项目、幂等指纹、冻结 version/sequence、规范化 payload、资产映射、状态/进度、私有归档 key/hash/大小、错误和终态时间。生成器只读取冻结 payload，download 只返回短期 URL。归档不包含 Provider 配置、Key、object key、签名 URL或浏览器本地任务缓存。

## Admin 数据

### 站内通知与时间线

`public.announcements` 保存面向全部已登录用户的平台通知，字段包括受控类别 `notice|product_update|maintenance`、状态 `draft|published|archived`、标题、纯文本正文、创建/更新管理员和生命周期时间。只有 `published` 且 `published_at <= now()` 的记录进入用户时间线；已发布内容不可编辑，下线只切换为 `archived` 并保留审计与历史事实，不物理删除。

`public.announcement_receipts` 以 `(announcement_id, user_id)` 为主键，只保存用户首次已读时间。发布不向全体用户扇出收件箱行，未读状态由已发布公告与当前用户回执的差集计算；标记已读使用 `INSERT ... SELECT` 并再次限制公告仍处于已发布状态。普通 API 角色只能读取公告并写当前可信用户的回执，Admin 角色可管理公告但不读取用户回执。公告正文不进入 Admin 审计，审计只记录公告 ID、类别和状态变化。

### `admin` schema 与认证

Admin Better Auth 表位于固定 `admin` schema，使用独立 Cookie 和 Secret。`admin.user.role` 为 `super_admin|operator|support|auditor`，status 为 active/banned。账号登录标识是唯一小写 username；内部兼容 email 不进入 Admin UI/响应。

`admin.login_security_settings` 保存验证码开关；`singleton_id = 1` 的记录必须始终存在，新库默认写入 `captcha_enabled = false`，补偿迁移使用幂等插入修复缺失记录。`admin.login_captcha_challenges` 保存短期 challenge hash、失败次数、过期/消费时间，不保存验证码明文。`admin.audit_events` 是追加式脱敏审计，运行角色只有 INSERT/SELECT，触发器拒绝 UPDATE/DELETE。

### 用户运营投影、聚合与事务

Admin 运行角色对 public 普通用户数据采用列级授权：

- `"user"` 只读 `id/user_no/username/display_username/email/email_verified/status/created_at/updated_at`，只可更新 `status/updated_at`。
- `"session"` 只读 `id/user_id/expires_at/created_at/updated_at`，并拥有 DELETE；`token`、IP 和 User-Agent 不可读。
- `"account"` 只读用于定位 credential 行的 `user_id/provider_id`，只可更新 `password/updated_at`；密码哈希不可读。
- `workspaces`、`workspace_members` 只开放用户归属、角色、状态、配额和时间所需的最小列。
- `assets` 只开放 workspace、字节数、状态和软删除时间；`migration_import_asset_uploads` 只开放 workspace、预留字节、状态和 committed asset ID。资产 `object_key`、项目/节点/Prompt 正文均不可读。

用户列表按 `created_at DESC, id DESC` 的稳定 keyset 分页，可按账号状态、验证状态和受控搜索过滤。列表只返回最小用户字段、最近 session 时间、workspace 数和已用存储；详情补充未删除 workspace 的角色、状态、配额、已用与预留存储，不返回项目或资产明细。

运营概览是无用户明细的即时聚合：注册统计排除 `deleted`，活跃用户按未过期 session 的最近更新时间计算 24 小时/7 天窗口；认证安全统计验证/未验证/disabled 数量；存储已用量统计未软删除且处于 `completed|failed|quarantined` 的资产，预留量统计 pending 资产和仍处于 `pending|uploading|validating|completed` 的迁移上传，总配额统计未删除 workspace。依赖健康只包含 PostgreSQL 与对象存储。

封禁、解封、session 撤销和管理员密码重置先以 `FOR UPDATE` 锁定目标用户，拒绝 `deleted` 用户，并在同一数据库事务追加脱敏 `admin.audit_events`。封禁将状态幂等设为 `disabled` 后删除该用户 session；并发登录若已创建临时 session，会在发现 `disabled` 状态时自行删除，因而不能留下竞态迟到 session。解封只设为 `active`，不恢复旧 session；独立 session 撤销不改变用户状态。密码重置只允许 `super_admin`，使用 Better Auth 同源哈希更新现有 credential 并删除全部 session；密码明文、哈希和 session ID 不进入审计。审计 before/after 只保存目标 ID、状态、受限原因、撤销数量、操作时间和哈希请求来源。

### 站点配置与品牌资产

`admin.site_config_revisions` 保存不可变结构配置，`admin.site_config_current` 保存当前 revision 指针。只接受 schema version 2，`features` 必须显式包含 `registrationEmailVerificationRequired`；配置只允许版本化纯数据，不接受 HTML、JavaScript 或任意 CSS。

`admin.site_assets` 保存 Logo/Favicon 私有对象元数据。完成确认复核对象 metadata、hash、魔数和真实尺寸。`public.site_config_publications` 是普通 API 唯一可读的最小投影；Admin 发布事务原子更新 current 和投影。

### 全站 SMTP 配置

`admin.smtp_config_revisions` 保存不可修改的全站 SMTP 版本：启停状态、主机、受控端口、安全模式、用户名、加密密码信封、key version、发件地址/名称、创建管理员和时间。UPDATE/DELETE 由触发器拒绝。`admin.smtp_config_current` 是 singleton 当前 revision 指针；保存或停用都创建新 revision，不原地修改旧版本。

SMTP 密码使用 AES-256-GCM 信封加密，每个 revision 使用随机 96 位 IV 和 128 位认证标签，AAD 固定绑定 `smtp-config:<revisionId>:password`。密文文档只包含算法、key version、IV、ciphertext 和 auth tag；主密钥版本映射 `SMTP_CREDENTIAL_KEYS` 与活动版本只存在 API/Admin API 服务器环境。轮换时先同时部署新旧 key、切换活动版本，再通过新 revision 重加密；旧 revision 仍需读取期间不能提前删除旧 key。

`public.smtp_config_publications` 保存普通 API 动态发送所需的当前加密投影。Admin 发布事务在验证 SMTP 连接成功后，用 revision 乐观锁同时插入 revision、切换 current、upsert publication 和追加脱敏审计；失败或冲突不改变旧 publication。停用同样创建携带重新加密密码的 disabled revision；普通 API 没有环境 SMTP 回退路径。

`admin.smtp_test_attempts` 只保存管理员、`connection|email`、`pending|success|failure`、受限失败类别与时间，用于每管理员 10 分钟 5 次的原子限频；不含收件邮箱、SMTP 主机、用户名或凭据。测试请求不创建配置 revision，也不改变 current/publication。

### 全站对象存储配置

`admin.object_storage_config_revisions` 保存不可修改的 Endpoint、签名 Endpoint/Origin、Region、Bucket、路径样式、加密凭据信封、key version、创建管理员和时间；`admin.object_storage_config_current` 保存 singleton 当前指针。AccessKey ID/Secret 合并为 AES-256-GCM 信封，AAD 固定为 `object-storage-config:<revisionId>:credentials`；独立主密钥版本映射 `OBJECT_STORAGE_CREDENTIAL_KEYS` 只存在 API/Admin API 环境。

`public.object_storage_config_publications` 是普通 API 动态选择 S3 客户端所需的最小加密投影。发布先在事务外对候选 Bucket 完成 `HeadBucket` 和随机探针对象写、读、删，再以 `expectedRevisionId` 乐观锁原子插入 revision、切换 current、upsert publication 和追加脱敏审计。恢复环境配置删除 current/publication，保留不可变历史 revision，并回退部署 `S3_*`；失败或冲突不改变旧发布。

`admin.object_storage_test_attempts` 只保存管理员、`pending|success|failure`、受限失败类别与时间，用于每管理员 10 分钟 5 次限频；不保存 Endpoint、Bucket、探针 object key 或凭据。只要存在未删除正式资产，服务拒绝改变 Endpoint、Region、Bucket 或路径样式；RAM AccessKey 和签名访问地址仍可通过新 revision 轮换。

普通 API 角色没有 `admin` schema USAGE，只对站点、SMTP 和对象存储公开投影有 SELECT；三类 publication 均不可写。Admin 角色除用户运营列级投影、生成遥测安全聚合列和必要公开投影外，不拥有 public 业务表宽泛权限，尤其不能读取资产 object key；`PUBLIC` 对配置 Admin 表和 publication 均无权限。

## 当前 Schema 基线

`server/db/migrations/0001_current_schema.sql` 是新库的当前基线；基线发布后新增的前向修复继续使用未占用的历史序号。`0038_initialize_login_security_settings.sql` 补齐管理员登录安全单例，`0039_add_announcements.sql` 新增站内通知与用户已读回执。新库会依次执行基线和后续迁移；曾执行旧 `0001` 至 `0037` 链的数据库从 `0038` 继续升级，不复用旧迁移版本号。项目正式运营前如需主动清空开发数据，仍应重建空库，再依次运行 `db:migrate` 和 `db:roles:provision`。目录包导入/导出是当前跨仓库产品能力，继续使用当前版本化契约。

## 核心事务

### 图操作批次

1. 以 workspace membership 条件锁定项目。
2. 校验 `baseVersion`。
3. 校验操作后节点/连线拓扑和 completed 资产归属。
4. 应用节点/连线 upsert/delete。
5. 更新节点 `asset_references` 和项目计数。
6. 追加连续 change。
7. 递增 version/sequence 并提交。

### 上传配额预留

锁定 workspace，先读取同 workspace 幂等键，再计算已用和 pending 预留；只有 `used + reserved + requested <= quota` 才同时插入 pending asset/upload。并发请求依靠 workspace 行锁防止超卖。

### 手动检查点与恢复

manual checkpoint 从一致版本的关系图生成 record 和资产 manifest，并更新 saved pointer。restore 锁定项目、校验 expected version/sequence、验证目标 checkpoint/资产、创建 pre-restore、替换图、重建引用并追加 change。原历史行保持不变。

### 导入 commit

commit 在一个事务中完成项目策略、资产 UUID 映射、图/引用/change/checkpoint 和 import 状态。跨 workspace 相同 hash 不可复用；任一失败不留下半完成正式资源。

## 基线发布与修复

首次正式运营前，停止四个应用进程，重建目标空库，运行 `npm run db:migrate`、`npm run db:roles:provision` 与 `npm run db:roles:check`，再部署同一版本的 Web、API、Admin Web 和 Admin API。回滚边界是恢复本次发布前的空库备份或重新创建空库；不尝试把旧迁移链或旧运行时表合并进当前基线。前向修复以新的显式迁移追加到基线之后，已经运营并产生正式数据后不得再次压缩迁移历史。

当前基线直接包含账户注销和延迟清理结构：`"user".deleted_at`、`personal_data_purged_at` 与 `account_erasure_jobs`。用户注销立即撤销身份和当前引用，个人对象与历史元数据按 `purge_after` 延迟清理；团队 workspace 不进入个人清理任务。

## 浏览器本地状态

浏览器 Vault 不是 PostgreSQL 数据模型，也不通过 Cloud 同步。当前格式为 `schemaVersion=2`、`cipherVersion=1`：单个版本化文档保存 Provider 配置、按 `providerProfileId` 索引的 API Key 凭据、模型条目和匿名绑定。`ModelEntry.id` 是唯一身份；`modelId` 仅在运行时请求上游，不能作为任何持久化引用身份。设备模式使用不可导出的 WebCrypto AES-256-GCM `CryptoKey`、96 位随机 IV 和 128 位认证标签加密，AAD 绑定 cipher/schema version、当前 Origin 和可信 session 用户 ID。IndexedDB 的密文记录与 Key 记录按可信用户 ID 分区；两个独立浏览器设备各自持有独立数据库与 Key，不存在隐式同步。账户注销无法远程删除任何设备的 Vault 密文或 CryptoKey，但已撤销可信会话使其不能再用于 Cloud 或受控 Provider 操作。

模型发现的导入以单个 Vault 文档写入为边界：Provider、其 `providerProfileId` 凭据槽和选中的新 `ModelEntry` 必须一起写入；取消不创建或更新任何 Vault 内容。再次发现按 `(providerProfileId, modelId)` 精确 reconcile：仅 `source=discovered` 条目可更新 `lastSeenAt/status`，上游缺失为 `missing`、重现为 `available`；`displayName/category/enabled` 和全部 `source=manual` 条目不被覆盖。

设备持久化是唯一用户可见模式，不提供 persistence 或单独删除入口。Vault 保存与本地任务写入在浏览器内串行执行；登出/session 失效/换账号只清空内存明文并保留按账号隔离的设备密文。用户清除当前网站数据时，浏览器删除 IndexedDB 中的密文、CryptoKey、模型绑定和本地任务缓存。异步完成只有在可信用户、内部持久化状态与状态代次仍一致时才能更新运行态。

当前运行时只读取当前版本的浏览器 Vault、任务缓存和项目快照。非敏感画布与外观偏好通过 `workspace_user_state` 跨设备同步；项目图、checkpoint、迁移包、偏好 API、日志、指标、诊断、PostgreSQL 和 Admin 均不保存真实 Provider、endpoint、模型 ID、绑定或 Key。

浏览器本地生成与任务恢复不创建服务端任务表，也不把执行状态同步到 Cloud；`generation_telemetry` 只是不可执行的有限运营记录。项目图中的模型字段仅保存 `local:<uuid>`，其 Vault 绑定值是 `modelEntryId`；真实模型 ID 只存在对应 Vault 模型条目中。Cloud 图还会移除 profile/Provider/endpoint/Key、task ID、remote task、上游错误和运行态。生成媒体先作为私有 `assets` 上传，完成后项目图只引用 Cloud asset UUID，不保存 Provider 临时 URL。

节点先按类别过滤可执行 `ModelEntry`，再按上游 `modelId` 分组；同名模型在不同服务商下仍是不同的 `modelEntryId` 路由，界面必须让用户明确选择具体服务商，不能按名称合并为同一持久化身份。未绑定、已删除、上游缺失、模型/服务商停用或凭据无效的引用可作为节点当前状态显示，但不得执行。对已绑定匿名引用，运行时只使用绑定的 `modelEntryId` 解析其唯一 Provider 和凭据；本地任务记录同样保存解析后的 `modelEntryId`，不会以匿名引用或显示名称猜测路由。

本地任务缓存是独立加密文档：`schemaVersion=3`、`cipherVersion=1`，IndexedDB 数据库版本为 3，只接受 v3 文档；复用同一不可导出 AES-256-GCM 设备 Key，AAD 在 Origin/可信用户之外额外绑定项目 ID。任务使用 UUID，保存冻结的 Prompt/参考图/比例/分辨率、`modelEntryId`、adapter、执行模式、Provider 绑定指纹、`queued|running|done|error` 主状态、`requesting|polling|persisting` 本地阶段和受控 `remoteTaskId`；不保存真实模型 ID、endpoint 或 API Key。

Provider 返回而 Cloud 资产尚未完成时，图片 Blob 存入独立 `taskResults` 对象仓库，使用同一设备 Key 加密，AAD 额外绑定 Origin、可信用户、项目和任务 ID。Cloud 保存失败只重试该 Blob，不重新发起 Provider POST；保存成功、任务删除、项目任务缓存删除或用户 Vault 清除时同步删除临时结果。任务文档和临时结果均按用户/项目分区，只属于当前浏览器，不进入 workspace/project record、checkpoint、迁移包、Cloud API、日志、诊断或 PostgreSQL。
