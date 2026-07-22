# AI Canvas Cloud 数据模型

本文档定义当前 PostgreSQL 混合数据模型。关系表保存事实状态，JSONB 只承载节点专属数据、版本化操作载荷、迁移载荷和完整检查点；图片与视频 blob 不进入数据库。

## 通用约定

- 服务端实体使用 UUID/ULID 等跨设备唯一 ID。
- 时间使用带时区时间戳并由服务端生成。
- 租户资源包含 `workspace_id`，查询、外键和唯一约束不得跨租户混淆。
- 需要恢复或延迟清理的资源使用软删除；硬删除只由受控 GC 完成。
- JSONB 必须有运行时 schema、大小上限和版本；可查询、排序、授权或外键字段必须关系化。
- schema 只通过显式迁移升级，应用启动不自动改表。
- 浏览器 Provider、endpoint、模型 ID、API Key 和本地生成任务不进入 PostgreSQL。

## 用户与租户

### Better Auth 核心表

普通认证位于 public schema：

- `"user"`：Better Auth 用户 ID、不可变 `user_no`、name、email、验证状态、账号状态和时间戳。
- `"session"`：用户、token、过期时间、IP/User-Agent 摘要和时间戳。
- `"account"`：credential provider 账号及 Better Auth 管理的密码哈希。
- `"verification"`：邮箱验证和密码重置的一次性值。

`user_no` 从 `10001` 开始，只用于本人展示、客服检索和运营管理，不参与认证或授权。账号采用单活跃 session；接管新设备和密码重置会撤销旧 session。

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

`version` 是项目级乐观并发版本，`last_sequence` 是连续 change 序号。`task_count` 由早期 schema 保留以兼容历史项目摘要，P8-4 后没有服务器任务写入，正常值为 0，不能作为当前任务事实来源。活动/归档列表索引都限定 workspace 并排除软删除。

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
- `source='worker'` 可作为历史 change 的兼容枚举保留，但 P8-4 后没有运行时写入者。

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

P8-4 后保存 `asset_id`、`workspace_id`、`project_id`、非空 `node_id`、reference role 和时间戳。`0029` 删除旧 `task_id` 列、任务唯一索引/外键，并把 `node_id` 恢复为必填；因此每条当前引用都属于同项目节点。

图 upsert 先删除节点旧引用，再写入去重的新引用；delete 节点同步删除引用。checkpoint 的历史引用集合在 manifest 中保护，不在本表复制。

### 对象诊断与 GC

维护命令默认只读。completed 资产缺失对象只报告，不能据此静默改库。只有 pending 已过期、failed、quarantined 或软删除资产在宽限期后可成为候选；提交模式逐资产加排他锁并用新语句快照复查当前引用和有效 checkpoint manifest。任一保护引用存在都必须保留。

对象存储与 PostgreSQL 不能形成一个事务，收敛顺序固定为“锁后复查 -> 幂等删除对象 -> 更新数据库状态”。提交失败由后续幂等运行收敛。

## 目录包迁移

### `migration_imports`

保存可信 workspace/创建者、package/source/project 摘要、幂等键和请求指纹、内容 hash、状态、冲突快照、计数、validated manifest/ProjectRecord/graph/asset manifest/可选 checkpoint、错误与终态时间。

prepare 只写 import 行，不创建正式项目、图、资产、引用、change 或 checkpoint。`ProjectRecord.taskQueue` 可保留历史本地任务结构用于往返兼容，但 Cloud commit 不拆分为服务器任务表，也不执行其中任务。

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

### 站点配置与品牌资产

`admin.site_config_revisions` 保存不可变结构配置，`admin.site_config_current` 保存当前 revision 指针。配置只允许版本化纯数据，不接受 HTML、JavaScript 或任意 CSS。

`admin.site_assets` 保存 Logo/Favicon 私有对象元数据。完成确认复核对象 metadata、hash、魔数和真实尺寸。`public.site_config_publications` 是普通 API 唯一可读的最小投影；Admin 发布事务原子更新 current 和投影。

普通 API 角色没有 `admin` schema USAGE，只对公开投影有 SELECT；Admin 角色不能读取 public 普通身份表。

## P8-4 删除后的 schema

`0029_remove_server_generation.sql` 删除以下运行时对象：

- `generation_tasks`、`task_attempts`、`task_commands`、`task_queue_outbox`、`generation_task_events`、`usage_ledger`。
- `provider_credentials` 及其 legacy metadata trigger/function。
- `public.official_model_publications`、`workspace_official_credit_periods`、`official_credit_ledger`。
- `admin.official_providers`、Provider revisions/secrets/tests、official models/revisions。
- 官方任务预留、执行凭据读取、积分余额和积分调整函数。
- `asset_references.task_id` 及对应索引/约束。
- 当前站点配置若仍有旧 `features.officialModeEnabled`，则保留原不可变修订，创建删除该字段的新修订，并原子切换 `admin.site_config_current` 与 `public.site_config_publications`。

历史迁移 `0007`–`0024` 仍必须保留，保证旧数据库可按顺序升级到 0029。迁移测试可在 0029 之前创建并验证旧对象，但当前 schema、应用角色和新备份中不得存在这些对象或可用凭据。

0029 不删除普通认证/工作区、项目图/change/checkpoint、资产、目录包迁移、Admin 认证/审计、品牌资产或站点配置历史。迁移先前向发布不含旧官方模式开关的当前站点修订，再删除旧任务资产引用、列和任务表；本次 P8-4 的前提是没有需要保留的真实 Provider/任务数据。

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

## 0029 发布、回滚与前向修复

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

## 浏览器本地状态

P8-5 尚未完成。目标状态是：Provider、endpoint、API Key、本地模型、绑定和可恢复异步任务只存在浏览器内存或按 Origin/可信用户分区的加密 IndexedDB。项目图最终只保存匿名本地模型引用；Cloud 数据库、API 请求、日志、诊断、迁移包和 Admin 均不保存真实 Provider 配置。
