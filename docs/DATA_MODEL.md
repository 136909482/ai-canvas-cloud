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
- `"verification"`：邮箱验证和密码重置的一次性值。

`user_no` 从 `10001` 开始，只用于本人展示、客服检索和运营管理，不参与认证或授权。`username` 为 3–30 位小写规范值，格式为 `^[a-z][a-z0-9_]{2,29}$`，具有唯一索引且排除保留词；`display_username` 保留注册时大小写，并以约束保证 `lower(display_username)=username`。两者均不可修改；`name` 只作为 Better Auth 兼容镜像，不是昵称或公共字段，`image` 兼容列不进入普通用户界面。普通用户状态为 `active|disabled|deleted`；`disabled` 不能登录、恢复 session 或通过 workspace 授权，`deleted` 可用于运营筛选和只读核对但不能再被状态操作。账号采用单活跃 session；接管新设备和密码重置会撤销旧 session。

`0030_user_usernames.sql` 为协调发布迁移：旧账号按邮箱前缀确定性清洗，`admin@example.com` 回填为 `admin_user`，保留词追加 `_user`，规范值冲突追加 `user_no`，并补齐非空、格式和唯一约束。发布、回滚与前向修复要求见“关键发布迁移”。

日志、审计、错误和前端响应不得记录密码、session/reset/verification token、完整邮件链接或 Provider API Key。业务授权只信任 Better Auth session 解析的用户。

### `auth_devices`

保存 `id`、`user_id`、客户端非认证 `device_key`、User-Agent、首次/最近时间和可空 `last_session_id`。`(user_id, device_key)` 唯一；删除 session 时只把 `last_session_id` 置空，不删除历史设备。当前设备记录不能从设备管理页删除。

### `workspaces`

保存 ID、类型、名称、owner、状态、plan、`storage_quota_bytes` 和时间戳。首发 `type=personal`，默认资产配额 20 GiB。旧任务配额列若仍存在只属于历史 schema 兼容，不作为当前服务端生成能力。

### `workspace_members`

`(workspace_id, user_id)` 唯一，角色为 owner/admin/editor/viewer。任何工作区资源查询都先带入可信 session 用户和成员关系。

### `workspace_user_state`

保存某用户在某工作区的最近项目、当前项目和非敏感 UI 游标。它不能放在 `workspaces` 上，避免未来成员互相覆盖。

### `auth_audit_events`

保存认证/账号安全事件、可信用户/工作区、request ID、脱敏网络摘要、结果和受限 metadata。事件不保存密码、Cookie、token、验证码、正文或 Provider Key。

## 项目图

### `projects`

主要字段：`id`、`workspace_id`、`name`、`version`、`last_sequence`、`saved_snapshot_id`、`node_count`、`edge_count`、`task_count`、归档/软删除时间和时间戳。

`version` 是项目级乐观并发版本，`last_sequence` 是连续 change 序号。`task_count` 由早期 schema 保留以兼容历史项目摘要；迁移 0029 后没有服务器任务写入，正常值为 0，不能作为当前任务事实来源。活动/归档列表索引都限定 workspace 并排除软删除。

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
- `source='worker'` 可作为历史 change 的兼容枚举保留，但当前没有运行时写入者。

### `project_snapshots`

保存 ID、项目、version/sequence、`manual|periodic|import|pre_restore` 类型、schema、`record_json`、字节数、`asset_manifest_json`、有效性和时间戳。检查点不是当前事实来源；恢复产生新版本。

服务端从当前关系化图组装检查点，不接受客户端整份 record 写入。`record_json.taskQueue.tasks` 只为与历史 `ProjectRecord`/目录包兼容；Cloud 检查点正常写入空数组，不能用于恢复服务器任务。浏览器本地任务缓存不进入 Cloud checkpoint。

创建 checkpoint 时从节点提取排序、去重的 Cloud asset UUID，按可信 workspace 验证 completed 状态后写入 manifest。restore 交叉校验 record/manifest，创建 pre-restore，再替换图、重建引用、追加 change 并递增 version/sequence。

历史 manifest 修复不改写 record、当前图、version/sequence 或当前引用；默认只读，`--apply` 时逐 checkpoint 短事务并保持幂等。

## 资产

### `assets`

保存 ID、workspace、来源项目、创建者、内部 object key、文件名、MIME、字节数、SHA-256、尺寸、asset kind、状态、软删除和时间戳。object key 唯一，只由服务端 ID 构成。

状态为 pending/completed/failed/quarantined/deleted。只有同一可信 workspace、未删除的 completed 资产可读取或引用。数据库不保存媒体 blob、签名 URL 或对象存储凭据。

### `asset_uploads`

保存上传会话、workspace、asset、期望 MIME/大小/hash、幂等键、过期和完成状态。创建时在 workspace 行锁下预留容量；完成时重新读取对象并验证真实 metadata。浏览器上报不是事实。

### `asset_references`

当前保存 `asset_id`、`workspace_id`、`project_id`、非空 `node_id`、reference role 和时间戳。`0029` 删除旧 `task_id` 列、任务唯一索引/外键，并把 `node_id` 恢复为必填；因此每条当前引用都属于同项目节点。

图 upsert 先删除节点旧引用，再写入去重的新引用；delete 节点同步删除引用。checkpoint 的历史引用集合在 manifest 中保护，不在本表复制。

## 生成运营遥测

### `generation_telemetry`

`0031_generation_telemetry.sql` 新增隐私最小化的浏览器生成 attempt 记录。每行只保存可信 `workspace_id/user_id`、客户端随机 `client_attempt_id`、`category=text|image|video`、`status=started|succeeded|failed|canceled`、受限 `failure_category`、`result_count`、`duration_ms` 和时间戳。`(workspace_id, user_id, client_attempt_id)` 唯一。

状态约束固定为：started 不得有终态时间、耗时、结果或失败分类；succeeded 要求 1–32 个结果、0–24 小时耗时和终态时间；failed 要求受限失败分类、0 个结果、耗时和终态时间；canceled 要求 0 个结果、无失败分类、耗时和终态时间。领域服务只允许同类别 `started -> terminal`，已进入终态的行不可由重放改写。终态先到时可直接插入，迟到 start 幂等忽略。

失败分类只允许 `network|authentication|rate_limited|upstream|invalid_response|asset_upload|unknown`。表中禁止 Prompt、输出正文或媒体、Provider、模型 ID、endpoint、API Key、上游响应正文和 remote task ID。它不是任务、队列、用量账本或恢复事实，不能驱动执行、重试、轮询和计费。

Admin dashboard 按 `Asia/Shanghai` 自然日聚合请求、结果、成功/失败/取消、去重创作者、P95 耗时和近 7 日类别趋势。成功率为 `succeeded/(succeeded+failed)`；取消不进入分母。Admin 数据库角色只读取聚合所需列，不读取 `client_attempt_id`；普通 API 角色无删除权限。

## 资产对象诊断与 GC

维护命令默认只读。completed 资产缺失对象只报告，不能据此静默改库。只有 pending 已过期、failed、quarantined 或软删除资产在宽限期后可成为候选；提交模式逐资产加排他锁并用新语句快照复查当前引用和有效 checkpoint manifest。任一保护引用存在都必须保留。

对象存储与 PostgreSQL 不能形成一个事务，收敛顺序固定为“锁后复查 -> 幂等删除对象 -> 更新数据库状态”。提交失败由后续幂等运行收敛。

## 目录包迁移

### `migration_imports`

保存可信 workspace/创建者、package/source/project 摘要、幂等键和请求指纹、内容 hash、状态、冲突快照、计数、validated manifest/ProjectRecord/graph/asset manifest/可选 checkpoint、错误与终态时间。

prepare 只写 import 行，不创建正式项目、图、资产、引用、change 或 checkpoint。历史 `ProjectRecord.taskQueue` 只用于输入兼容；Cloud commit 忽略且不执行其中任务，当前导出固定写空数组。

### `migration_import_asset_uploads`

保存每个 logical asset 的服务端 staging object key、multipart ID、分片计划/ETag、期望 metadata、状态、重试和过期。内部 key/ID 不进入 API。暂存完成不等于正式 asset；commit 才能在事务中物化或复用同 workspace completed 资产。

### Commit 幂等映射

commit 锁定 import、workspace 配额和可选 replace 目标。copy 重映射项目/节点/连线 ID；replace 仅在 expected version/sequence 仍匹配且 owner/admin 显式确认时提交。图、资产、引用、change 和可选 import checkpoint 一起提交，失败整体回滚。

### `migration_exports`

保存可信 workspace/项目、幂等指纹、冻结 version/sequence、规范化 payload、资产映射、状态/进度、私有归档 key/hash/大小、错误和终态时间。生成器只读取冻结 payload，download 只返回短期 URL。归档不包含 Provider 配置、Key、object key、签名 URL或浏览器本地任务缓存。

## Admin 数据

### `admin` schema 与认证

Admin Better Auth 表位于固定 `admin` schema，使用独立 Cookie 和 Secret。`admin.user.role` 为 `super_admin|operator|support|auditor`，status 为 active/banned。账号登录标识是唯一小写 username；内部兼容 email 不进入 Admin UI/响应。

`admin.login_security_settings` 保存验证码开关，`admin.login_captcha_challenges` 保存短期 challenge hash、失败次数、过期/消费时间，不保存验证码明文。`admin.audit_events` 是追加式脱敏审计，运行角色只有 INSERT/SELECT，触发器拒绝 UPDATE/DELETE。

### 用户运营投影、聚合与事务

Admin 运行角色对 public 普通用户数据采用列级授权：

- `"user"` 只读 `id/user_no/username/display_username/email/email_verified/status/created_at/updated_at`，只可更新 `status/updated_at`。
- `"session"` 只读 `id/user_id/expires_at/created_at/updated_at`，并拥有 DELETE；`token`、IP 和 User-Agent 不可读。
- `workspaces`、`workspace_members` 只开放用户归属、角色、状态、配额和时间所需的最小列。
- `assets` 只开放 workspace、字节数、状态和软删除时间；`migration_import_asset_uploads` 只开放 workspace、预留字节、状态和 committed asset ID。资产 `object_key`、项目/节点/Prompt 正文均不可读。

用户列表按 `created_at DESC, id DESC` 的稳定 keyset 分页，可按账号状态、验证状态和受控搜索过滤。列表只返回最小用户字段、最近 session 时间、workspace 数和已用存储；详情补充未删除 workspace 的角色、状态、配额、已用与预留存储，不返回项目或资产明细。

运营概览是无用户明细的即时聚合：注册统计排除 `deleted`，活跃用户按未过期 session 的最近更新时间计算 24 小时/7 天窗口；认证安全统计验证/未验证/disabled 数量；存储已用量统计未软删除且处于 `completed|failed|quarantined` 的资产，预留量统计 pending 资产和仍处于 `pending|uploading|validating|completed` 的迁移上传，总配额统计未删除 workspace。依赖健康只包含 PostgreSQL 与对象存储。

封禁、解封和 session 撤销先以 `FOR UPDATE` 锁定目标用户，拒绝 `deleted` 用户，并在同一数据库事务追加脱敏 `admin.audit_events`。封禁将状态幂等设为 `disabled` 后删除该用户 session；并发登录若已创建临时 session，会在发现 `disabled` 状态时自行删除，因而不能留下竞态迟到 session。解封只设为 `active`，不恢复旧 session；独立 session 撤销不改变用户状态。审计 before/after 只保存目标 ID、状态、受限原因、撤销数量和哈希请求来源。

### 站点配置与品牌资产

`admin.site_config_revisions` 保存不可变结构配置，`admin.site_config_current` 保存当前 revision 指针。配置只允许版本化纯数据，不接受 HTML、JavaScript 或任意 CSS。

`admin.site_assets` 保存 Logo/Favicon 私有对象元数据。完成确认复核对象 metadata、hash、魔数和真实尺寸。`public.site_config_publications` 是普通 API 唯一可读的最小投影；Admin 发布事务原子更新 current 和投影。

### 全站 SMTP 配置

`admin.smtp_config_revisions` 保存不可修改的全站 SMTP 版本：启停状态、主机、受控端口、安全模式、用户名、加密密码信封、key version、发件地址/名称、创建管理员和时间。UPDATE/DELETE 由触发器拒绝。`admin.smtp_config_current` 是 singleton 当前 revision 指针；保存或停用都创建新 revision，不原地修改旧版本。

SMTP 密码使用 AES-256-GCM 信封加密，每个 revision 使用随机 96 位 IV 和 128 位认证标签，AAD 固定绑定 `smtp-config:<revisionId>:password`。密文文档只包含算法、key version、IV、ciphertext 和 auth tag；主密钥版本映射 `SMTP_CREDENTIAL_KEYS` 与活动版本只存在 API/Admin API 服务器环境。轮换时先同时部署新旧 key、切换活动版本，再通过新 revision 重加密；旧 revision 仍需读取期间不能提前删除旧 key。

`public.smtp_config_publications` 保存普通 API 动态发送所需的当前加密投影。Admin 发布事务在验证 SMTP 连接成功后，用 revision 乐观锁同时插入 revision、切换 current、upsert publication 和追加脱敏审计；失败或冲突不改变旧 publication。停用同样创建携带重新加密密码的 disabled revision，明确停用态阻止普通 API 回退旧环境变量。

`admin.smtp_test_attempts` 只保存管理员、`connection|email`、`pending|success|failure`、受限失败类别与时间，用于每管理员 10 分钟 5 次的原子限频；不含收件邮箱、SMTP 主机、用户名或凭据。测试请求不创建配置 revision，也不改变 current/publication。

普通 API 角色没有 `admin` schema USAGE，只对站点和 SMTP 公开投影有 SELECT；SMTP publication 不可写。Admin 角色除上述用户运营列级投影、生成遥测安全聚合列以及站点/SMTP 公开投影外，不拥有 public 业务表的宽泛权限；`PUBLIC` 对 SMTP 三类 Admin 表和 publication 均无权限。

## 已移除的历史 schema

`0029_remove_server_generation.sql` 删除以下运行时对象：

- `generation_tasks`、`task_attempts`、`task_commands`、`task_queue_outbox`、`generation_task_events`、`usage_ledger`。
- `provider_credentials` 及其 legacy metadata trigger/function。
- `public.official_model_publications`、`workspace_official_credit_periods`、`official_credit_ledger`。
- `admin.official_providers`、Provider revisions/secrets/tests、official models/revisions。
- 官方任务预留、执行凭据读取、积分余额和积分调整函数。
- `asset_references.task_id` 及对应索引/约束。
- 当前站点配置若仍有旧 `features.officialModeEnabled`，则保留原不可变修订，创建删除该字段的新修订，并原子切换 `admin.site_config_current` 与 `public.site_config_publications`。

历史迁移 `0007`–`0024` 仍必须保留，保证旧数据库可按顺序升级到 0029。迁移测试可在 0029 之前创建并验证旧对象，但当前 schema、应用角色和新备份中不得存在这些对象或可用凭据。

0029 不删除普通认证/工作区、项目图/change/checkpoint、资产、目录包迁移、Admin 认证/审计、品牌资产或站点配置历史。迁移先前向发布不含旧官方模式开关的当前站点修订，再删除旧任务资产引用、列和任务表；执行前提是没有需要保留的真实 Provider/任务数据。

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

## 关键发布迁移

### 0029：清退服务端生成

0029 在 release manifest 中是 `releaseTrain=p8`、`phase=contract`、高锁风险、30 秒 statement timeout、`backupRequired=true`。旧应用不能读取新 schema，新应用也不支持旧服务器生成对象。

执行顺序：

1. 停止旧 API 的 Provider/任务写入和所有旧 Worker/Consumer/lease recovery。
2. 确认本次环境没有需要保留的真实 Provider/任务数据。
3. 创建并验证 P7-8 加密 contract 前数据库备份。
4. 独立运行 0029 transaction。
5. 运行角色 provisioning，删除旧 Worker 角色和旧环境键。
6. 只部署 Web、API、Admin Web、Admin API，再执行角色/schema/404/readiness 验收。

回滚边界：0029 删除密文和任务事实，不提供 down migration。只能恢复加密 contract 前备份，并与旧应用作为一个协调操作回滚；禁止在现库根据日志、末四位或历史配置猜测重建凭据。对象存储和项目图/资产在恢复后仍须执行一致性审计。

前向修复：保持全部旧 API/Worker 停止；幂等重跑 0029；确认活动 Admin 修订和公开投影已删除 `officialModeEnabled`；重新应用 public/admin 最小授权；删除残余旧 Worker 角色和失效环境键；验证旧表、函数、角色和 URL 均不存在；再只部署当前浏览器生成架构。历史备份中的旧密文只按既定加密保留周期淘汰，不导出、不打印、不重新启用。

### 0030：普通用户用户名契约

0030 在 release manifest 中是 `releaseTrain=p8-username`、`phase=contract`、中等锁风险、30 秒 statement timeout、`backupRequired=true`。旧应用可读取迁移后的既有账号，但不能继续创建缺少用户名的新账号；因此迁移和新 API 必须协调发布。

执行顺序：

1. 创建并验证迁移前数据库备份，停止旧版注册写入。
2. 独立运行 0030，完成旧账号确定性回填和约束建立。
3. 运行角色 provisioning，确认 Admin 只获得 `username/display_username` 所需列级权限。
4. 部署同版本 Web、API、Admin Web 和 Admin API。
5. 审计空用户名、格式、保留词、大小写规范值和重复值，并验证用户名/邮箱两种登录。

回滚边界：0030 不提供把新账号无损降级到邮箱-only 写入契约的 down migration。只能恢复迁移前备份并协调部署旧应用；禁止仅删除约束后继续混用新旧写入方。

前向修复：保持旧注册写入停止，幂等重跑 0030；对缺失值执行同一确定性回填，重新审计格式与唯一约束，重新应用数据库角色，并在审计通过后启用用户名登录。

### 0031：生成运营遥测

0031 在 release manifest 中是 `releaseTrain=p8-operations`、`phase=expand`、低锁风险、10 秒 statement timeout、`backupRequired=false`。它只新增独立表与索引，旧应用可继续读取新 schema；新 API 和 Admin 聚合必须在迁移与角色 provisioning 完成后启用。

回滚边界：采集开始前可删除 additive 表；采集开始后先关闭普通遥测入口和 Admin 新聚合，保留已有有限元数据直到替代版本部署，不使用遥测反推或重建任何浏览器任务。前向修复为幂等重跑 0031、重新应用列级角色授权，并审计列集合、状态约束、失败枚举和私有字段缺失。

### 0032：版本化加密 SMTP 配置

0032 在 release manifest 中是 `releaseTrain=p8-mail`、`phase=expand`、低锁风险、10 秒 statement timeout、`backupRequired=false`。它只新增 `admin.smtp_config_revisions`、`admin.smtp_config_current`、`admin.smtp_test_attempts` 和 `public.smtp_config_publications`；旧应用仍使用原环境 SMTP，新代码必须在迁移、角色 provisioning 和两端加密密钥完成后启用 `managed`。

发布顺序：先把同一份 `SMTP_CREDENTIAL_KEYS` 与活动 key version 部署到 API/Admin API，再执行 0032 和角色 provisioning，随后发布代码并保留旧 SMTP 环境变量；超级管理员完成连接和测试邮件后保存启用，确认验证/重置邮件动态使用 managed revision，最后移除旧 `SMTP_PASSWORD`。密钥和数据库备份必须分离保存。

回滚边界：首次发布前可删除 additive 表并继续使用环境 SMTP；已有 managed revision 后先把传输模式切回 `smtp` 或部署兼容版本，确认旧环境凭据仍有效，再删除 additive 表。前向修复为幂等重跑 0032、重新应用精确角色授权、校验 publication/current/revision 一致性和密文 envelope，并在 managed 投递通过前保留旧环境回退。禁止从日志、审计或前端值重建密码。

## 浏览器本地状态

浏览器 Vault 不是 PostgreSQL 数据模型，也不通过 Cloud 同步。当前格式为 `schemaVersion=2`、`cipherVersion=1`：单个版本化文档保存 Provider 配置、按 `providerProfileId` 索引的 API Key 凭据、模型条目和匿名绑定。`ModelEntry.id` 是唯一身份；`modelId` 仅在运行时请求上游，不能作为任何持久化引用身份。设备模式使用不可导出的 WebCrypto AES-256-GCM `CryptoKey`、96 位随机 IV 和 128 位认证标签加密，AAD 绑定 cipher/schema version、当前 Origin 和可信 session 用户 ID。IndexedDB 的密文记录与 Key 记录按可信用户 ID 分区；两个独立浏览器设备各自持有独立数据库与 Key，不存在隐式同步。

模型发现的导入以单个 Vault 文档写入为边界：Provider、其 `providerProfileId` 凭据槽和选中的新 `ModelEntry` 必须一起写入；取消不创建或更新任何 Vault 内容。再次发现按 `(providerProfileId, modelId)` 精确 reconcile：仅 `source=discovered` 条目可更新 `lastSeenAt/status`，上游缺失为 `missing`、重现为 `available`；`displayName/category/enabled` 和全部 `source=manual` 条目不被覆盖。

设备持久化是唯一用户可见模式，不提供 persistence 或单独删除入口。Vault 保存与本地任务写入在浏览器内串行执行；登出/session 失效/换账号只清空内存明文并保留按账号隔离的设备密文。用户清除当前网站数据时，浏览器删除 IndexedDB 中的密文、CryptoKey、模型绑定和本地任务缓存。异步完成只有在可信用户、内部持久化状态与状态代次仍一致时才能更新运行态。

当前内测环境不读取或迁移旧 `ai-canvas-settings` 明文、旧 Vault 或 v1 任务缓存；任务缓存 v2 只做结构兼容迁移到 v3。workspace 配置、workspace/localStorage 缓存、项目图、checkpoint、迁移包、Cloud API 请求、日志、指标、诊断、PostgreSQL 和 Admin 均不保存真实 Provider、endpoint、模型 ID、绑定或 Key。

浏览器本地生成与任务恢复不创建服务端任务表，也不把执行状态同步到 Cloud；`generation_telemetry` 只是不可执行的有限运营记录。项目图中的模型字段仅保存 `local:<uuid>`，其 Vault 绑定值是 `modelEntryId`；真实模型 ID 只存在对应 Vault 模型条目中。Cloud 图还会移除 profile/Provider/endpoint/Key、task ID、remote task、上游错误和运行态。生成媒体先作为私有 `assets` 上传，完成后项目图只引用 Cloud asset UUID，不保存 Provider 临时 URL。

节点先按类别过滤可执行 `ModelEntry`，再按上游 `modelId` 分组；同名模型在不同服务商下仍是不同的 `modelEntryId` 路由，界面必须让用户明确选择具体服务商，不能按名称合并为同一持久化身份。未绑定、已删除、上游缺失、模型/服务商停用或凭据无效的引用可作为节点当前状态显示，但不得执行。对已绑定匿名引用，运行时只使用绑定的 `modelEntryId` 解析其唯一 Provider 和凭据；本地任务记录同样保存解析后的 `modelEntryId`，不会以匿名引用或显示名称猜测路由。

本地任务缓存是独立加密文档：`schemaVersion=3`、`cipherVersion=1`，IndexedDB 数据库版本为 3，并兼容解密和迁移 v2 文档；复用同一不可导出 AES-256-GCM 设备 Key，AAD 在 Origin/可信用户之外额外绑定项目 ID。任务使用 UUID，保存冻结的 Prompt/参考图/比例/分辨率、`modelEntryId`、adapter、执行模式、Provider 绑定指纹、`queued|running|done|error` 主状态、`requesting|polling|persisting` 本地阶段和受控 `remoteTaskId`；不保存真实模型 ID、endpoint 或 API Key。

Provider 返回而 Cloud 资产尚未完成时，图片 Blob 存入独立 `taskResults` 对象仓库，使用同一设备 Key 加密，AAD 额外绑定 Origin、可信用户、项目和任务 ID。Cloud 保存失败只重试该 Blob，不重新发起 Provider POST；保存成功、任务删除、项目任务缓存删除或用户 Vault 清除时同步删除临时结果。任务文档和临时结果均按用户/项目分区，只属于当前浏览器，不进入 workspace/project record、checkpoint、迁移包、Cloud API、日志、诊断或 PostgreSQL。
