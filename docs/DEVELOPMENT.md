# AI Canvas Cloud 开发指南

本文档只维护当前架构不变量、开发流程和验证规则。目录职责见 [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md)，数据库事实见 [`DATA_MODEL.md`](DATA_MODEL.md)，HTTP 契约见 [`API.md`](API.md)，阶段状态见 [`ROADMAP.md`](ROADMAP.md)。不要在本文记录单次完成清单、测试数量或阶段复盘。

## 产品与仓库边界

AI Canvas Cloud 是账号制 AI 画布 SaaS，提供账号、个人空间、云端项目图、私有媒体资产、目录包迁移和独立 Admin。它不承载 Electron、本地 SQLite、File System Access API、官方模型、积分计费、Provider 代理或服务端模型生成。

本仓库与本地版 `136909482/ai-canvas` 独立：

- 本地版维护桌面交互、本地目录和 Electron SQLite。
- Cloud 使用 PostgreSQL、Redis 和 OSS/S3 兼容私有对象存储。
- 两端只通过版本化 `ProjectRecord` 和目录包显式导入导出。
- 登录、退出和网络恢复不得隐式上传本地工作区。
- Cloud 运行时不得依赖另一个仓库的源码路径。

## 运行拓扑

```text
Browser -> Web -> API -> PostgreSQL
                       -> Redis (rate limiting/readiness only)
                       -> Private object storage
                       -> Managed SMTP (verification/reset only)

Admin Browser -> Admin Web -> Admin API -> PostgreSQL admin schema
                                      -> Private site assets
                                      -> Managed SMTP tests
```

常驻进程只有 Web、API、Admin Web 和 Admin API。迁移、备份、恢复和资产维护按需运行。不存在 Worker、BullMQ Consumer、服务端任务 dispatcher、服务器 Provider 调用或 Worker readiness。

## 前端加载与静态缓存

普通 Web 的 `App.tsx` 只静态依赖公开页面、认证门和轻量加载恢复界面。登录后工作区由独立 `AuthenticatedApp` 动态入口承载画布、工具栏、项目管理器、图片编辑器、浏览器任务运行器、设置 Store 和 `ReactFlowProvider`；`AuthGate` 只有在会话状态为 `authenticated`、存在可信 session 且当前不是密码重置流程时才渲染该入口。会话检查中、匿名、登录失败、注册和重置密码不得触发动态导入。登录后运行时负责注册登出、会话失效和换账号时的项目 Store 与 Vault 内存清理，不允许认证 Store 静态反向依赖工作区 Store。

动态入口使用轻量 `Suspense` 等待态和错误边界。浏览器因发布切换、旧 HTML 或网络问题无法取得 Chunk 时显示“版本已更新，请刷新”和刷新按钮，不得白屏。公开首页、认证、帮助与法律模块不得导入画布、工具栏、项目 Store、React Flow、编辑器或全景模块。

Web 生产构建保留 React、React Flow、编辑器、Three.js、全景、图标、状态库和工具栏分组，分组不得递归吞并公开入口依赖。`npm run build -w @ai-canvas-cloud/web` 在 Vite 输出后自动检查 `dist/index.html`：禁止 modulepreload `AuthenticatedApp`、`app-toolbar`、`vendor-flow`、`vendor-editor`、`vendor-three` 和 `vendor-panorama`，并按 `index.html` 实际引用的模块脚本、modulepreload 和样式计算 Gzip 总量，匿名入口上限固定为 200 KiB。普通 Web 使用系统无衬线与等宽字体栈，不下载首屏 Web 字体；构建产物中的全部 Web 字体原始总量上限固定为 256 KiB，超过即阻止发布。需要恢复品牌字体时必须使用子集化 WOFF2 并继续满足该门禁，不得把完整 CJK TTF/OTF 放入 `public`。站点配置与 HTTP 常量使用 contracts 轻量子路径，禁止为单个公开常量重新引入 contracts 根 Barrel。

Node 静态站点对 `index.html`、`/` 和所有 SPA 回退 HTML 返回 `Cache-Control: no-store`；`/assets/*` 返回 `Cache-Control: public, max-age=31536000, immutable`，其他静态文件使用 `no-cache`。Hash 文件名变化即创建新 URL，新旧资源可同时缓存一年。EdgeOne 必须使用源站缓存头，不得配置覆盖 `/assets/*` 的短 TTL；HTML 不得在 EdgeOne 缓存。

## 版本与更新日志

应用版本遵循语义化版本，根 `package.json`、全部 workspace、内部依赖和 `package-lock.json` 必须保持同一版本。公共 API 与 Admin API 的 OpenAPI `info.version` 在运行时读取各自 package 版本，不维护独立常量。

准备新版本时运行 `npm run version:set -- <semver>`，随后在根目录 `CHANGELOG.md` 的 `Unreleased` 下整理用户可见变化并创建带发布日期的版本段。完成 `npm run check`、`npm test`、`npm run lint` 和 `npm run build` 后才能构建发布镜像；发布成功再创建同版本 `v<semver>` Git 标签。版本命令不创建提交或标签，也不代替更新日志和发布门禁。

`CHANGELOG.md` 只记录用户可见的新增、变化、修复和安全边界，不复制路线图、架构文档、测试数量或单次开发复盘。阶段状态仍只在 `docs/ROADMAP.md` 维护。

## Docker 生产部署

### 2 核 2G 拓扑

轻量生产 Compose 位于 `infra/deploy/production`。2 核 2G ECS 只运行四个无状态应用容器，数据库、限流状态和媒体必须使用托管服务：

```text
Internet -> Baota Nginx (HTTPS)
             |-> 127.0.0.1:8080 -> Web -> API
             \-> 127.0.0.1:8081 -> Admin Web -> Admin API

API/Admin API -> RDS PostgreSQL (private network)
API           -> Aliyun Redis (private network)
API/Admin API -> Private OSS bucket
```

Compose 不发布 `8787` 或 `8788`，Web 入口也只绑定宿主机回环地址。常驻容器内存上限合计约 864 MB，给 Linux、宝塔、宿主 Nginx 和 Docker 留出余量。该规格适合初期低流量；出现持续 swap、OOM、readiness 超时或 API 延迟后，应升级到至少 2 核 4G，不得通过取消内存限制掩盖资源不足。

ECS 安全组只开放 `22`、`80`、`443`。RDS 与 Redis 使用 VPC 私网地址，并只允许 ECS 安全组访问。OSS Bucket 保持私有读写，RAM 用户只授予目标 Bucket 所需的读取、写入、列举、分片上传和删除权限。

### 构建和配置

不要在 2G ECS 构建镜像。在本地 Docker Desktop 或 CI 中，以同一个不可变 Git SHA 分别构建并推送五个 Docker Hub target：

```bash
docker buildx build --platform linux/amd64 --target api -t <docker-hub-namespace>/ai-canvas-cloud-api:<git-sha> --push .
docker buildx build --platform linux/amd64 --target web -t <docker-hub-namespace>/ai-canvas-cloud-web:<git-sha> --push .
docker buildx build --platform linux/amd64 --target admin-api -t <docker-hub-namespace>/ai-canvas-cloud-admin-api:<git-sha> --push .
docker buildx build --platform linux/amd64 --target admin-web -t <docker-hub-namespace>/ai-canvas-cloud-admin-web:<git-sha> --push .
docker buildx build --platform linux/amd64 --target release -t <docker-hub-namespace>/ai-canvas-cloud-release:<git-sha> --push .
```

把 `infra/deploy/production` 上传到服务器固定目录，将 `production.env.example` 复制为 `production.env`，权限设置为 `600`，再填写域名、五个 Docker Hub 镜像、RDS、Redis、OSS、邮件和密钥配置。`BETTER_AUTH_SECRET` 至少 32 字符；`SMTP_CREDENTIAL_KEYS` 与 `OBJECT_STORAGE_CREDENTIAL_KEYS` 中每个值都是独立的 32 字节 Base64 密钥。数据库和 Redis 密码中的保留字符必须进行 URL 编码。

阿里云 OSS 使用区域 endpoint 和虚拟主机样式：`S3_FORCE_PATH_STYLE=false`，`S3_PUBLIC_ENDPOINT` 填 `https://oss-<region>.aliyuncs.com`，`S3_PUBLIC_ORIGIN` 填 `https://<bucket>.oss-<region>.aliyuncs.com`。Bucket CORS 至少允许普通站点和管理站点两个 HTTPS Origin、`GET/PUT/HEAD` 方法、`Content-Type` 与 `x-amz-*` 请求头，并暴露 `ETag`；不要把 Bucket 改成公共读。

对象存储环境变量可作为启动和故障回退配置。设置 `OBJECT_STORAGE_ENVIRONMENT_FALLBACK=false` 时允许不提供 `S3_*`，此时服务可以启动和登录，但 readiness 保持 degraded，资产上传、读取和站点媒体操作在后台发布首个托管配置前不可用。API/Admin API 每次对象操作通过 `public.object_storage_config_publications` 的短缓存选择当前 revision，后台发布后无需重启；发布前必须完成随机探针对象的写入、读回比对和删除。AccessKey ID/Secret 作为同一 AES-256-GCM 信封保存，主密钥只能来自服务端环境。已有正式资产后存储身份不可在后台切换，避免历史 object key 指向另一 Bucket。通用生产部署的 `S3_PUBLIC_ORIGIN` 同时进入 Web/Admin Web 的 CSP，因此调整签名域名时必须先更新 Bucket CORS、生产环境变量并重建两个 Web 容器，再发布后台配置；无环境回退的单机 Admin CSP 允许托管配置使用 HTTPS 对象存储来源。

无引用资产清理由普通 API 拥有，Admin API 只提供受 `asset_maintenance.write` 保护的控制入口。两个服务使用同一份至少 32 字符的 `ASSET_MAINTENANCE_TOKEN`，Admin API 通过仅部署网络可达的 `ASSET_MAINTENANCE_API_URL` 调用普通 API；该密钥不得进入浏览器、日志或审计。后台必须先 preview，再由超级管理员二次确认 apply。候选资产须超过固定 7 天宽限期，且没有当前 `asset_references` 或有效 checkpoint manifest 引用；apply 对每个候选加锁并重新检查后才删除 OSS 对象、收敛数据库状态。Admin 响应和审计只保留聚合数量与容量，不返回用户、项目、asset ID 或 object key。

### 首次发布

先创建 RDS 数据库、Redis 实例、私有 OSS Bucket 和两个已签发 HTTPS 证书的域名。进入服务器上的 `infra/deploy/production` 目录；公开 Docker Hub 仓库无需登录，然后依次执行：

```bash
docker compose --env-file production.env --profile release pull
docker compose --env-file production.env --profile release run --rm release-check
docker compose --env-file production.env --profile release run --rm migrate
docker compose --env-file production.env --profile release run --rm database-roles
docker compose --env-file production.env --profile release run --rm database-role-check
docker compose --env-file production.env --profile release run --rm admin-bootstrap
docker compose --env-file production.env up -d
docker compose --env-file production.env ps
```

`database-roles` 会原地更新 `production.env` 中的普通 API/Admin API 最小权限数据库 URL，并在留空时生成独立的 `ADMIN_BETTER_AUTH_SECRET`；因此该文件必须可写，且角色配置后必须新建应用容器。`admin-bootstrap` 要求交互终端，只用于创建首个 `super_admin`。

宝塔为普通站点和管理站点分别创建网站、申请 HTTPS 并启用强制 HTTPS。普通站点反向代理到 `http://127.0.0.1:8080`，管理站点反向代理到 `http://127.0.0.1:8081`；可使用同目录的 `baota-web.location.conf.example` 和 `baota-admin.location.conf.example`。两个公网站点都必须在兜底反向代理前用精确 `location = /metrics` 返回 `404`，不得暴露应用指标；受控监控系统应从部署内网直接抓取 API 容器。宝塔不直接代理 API 端口，容器内 Web Nginx 分别代理 `/api/` 和 `/admin/`。

### 升级和回滚

升级前创建 RDS 快照并确认 OSS 版本控制或备份策略有效。把 `production.env` 中五个镜像更新为同一新 Git SHA，先 `pull`、运行 `release-check`，再依次运行 `migrate`、`database-roles` 和 `database-role-check`，最后执行 `docker compose --env-file production.env up -d`。发布后检查四个容器 health、普通登录、Admin 登录、资产上传和签名读取。

应用回滚只把四个常驻镜像改回与当前数据库 schema 兼容的旧 SHA，再执行 `pull` 和 `up -d`；不要自动反向执行 SQL。若新迁移与旧应用不兼容，按 [`DATA_MODEL.md`](DATA_MODEL.md) 的回滚或前向修复要求处理，必要时从发布前 RDS 快照恢复到隔离实例验证后再切换。

## 单机 Docker 生产部署

`infra/deploy/single-host` 面向宝塔和 2 核 2 GB 的单台低流量服务器。它只常驻普通应用、后台应用、PostgreSQL 和 Redis：普通应用在 `127.0.0.1:8080` 同时提供 Web 与 `/api/`，后台应用在 `127.0.0.1:8081` 同时提供 Admin Web 与 `/admin/`。两个应用使用同一个不可变镜像，但保留独立 Cookie、认证密钥、数据库角色、运行时环境文件和域名；数据库与 Redis 不发布宿主机端口，媒体继续存储在私有 OSS。

2 GB 机器必须启用至少 2 GB swap。四个常驻容器的内存上限合计为 896 MB，给 Linux、宝塔和 Docker 留出余量；出现持续 swap、OOM、readiness 失败或明显延迟后必须升级到至少 2 核 4 GB。宝塔已安装的 PostgreSQL/Redis 服务应停止，避免端口、内存和数据来源混淆。

### 当前推荐拓扑

单机方案固定为四个 Docker 容器，程序镜像只构建和上传一次，普通站点与管理站点分别复用它：

| 位置         | 组件            | 是否为 Docker 容器 | 作用                                          |
| ------------ | --------------- | ------------------ | --------------------------------------------- |
| 服务器       | `public`        | 是                 | 普通 Web 与普通 API，监听 `127.0.0.1:8080`    |
| 服务器       | `admin`         | 是                 | Admin Web 与 Admin API，监听 `127.0.0.1:8081` |
| 服务器       | `postgres`      | 是                 | 账号、项目图、资产元数据和后台数据            |
| 服务器       | `redis`         | 是                 | 普通 API 安全限流与 readiness                 |
| 阿里云       | 私有 OSS Bucket | 否                 | 图片和视频文件，不占服务器 Docker 容器        |
| 服务器宿主机 | 宝塔 Nginx      | 否                 | HTTPS 站点和反向代理                          |
| 公网         | Cloudflare      | 否                 | DNS、代理与边缘 HTTPS                         |

访问链路固定为 `Cloudflare -> 宝塔 HTTPS 站点 -> 127.0.0.1:8080/8081 -> 应用容器`。公网只开放 `22`、`80`、`443`；`8080`、`8081`、PostgreSQL 和 Redis 都不得直接暴露公网。Cloudflare DNS 分别把普通域名和 Admin 域名指向服务器；宝塔已经安装有效证书时，Cloudflare SSL/TLS 模式使用 `Full (strict)`。

开发电脑与生产服务器使用两套独立配置。本地未跟踪的 `.env` 可以连接 NAS 上的 PostgreSQL、Redis 和 MinIO，用于开发与测试；生产服务器只读取 `secrets/release.env` 和两个生成的 runtime env，并使用服务器 Docker PostgreSQL/Redis 与后台发布的阿里云 OSS。禁止把本地 `.env`、NAS 地址或 NAS 密钥上传到生产服务器。

### 镜像构建

默认发布源是 Docker Hub 公共仓库 `hao136909482/ai-canvas-cloud`。发布前在 Windows PowerShell 中进入仓库根目录，以当前 Git SHA 和 `stable` 同时标记并推送 `linux/amd64` 镜像；服务器的 `deploy.sh` 会把 `stable` 解析成不可变 digest 后再启动。

无法访问公共仓库时，在开发电脑上执行离线构建：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-single-host-offline-image.ps1
```

脚本会自动寻找并启动 Docker Desktop，构建 `linux/amd64` 的 `single-host-app`，实际运行一次服务端依赖导入冒烟检查，再把程序镜像写入 `.tmp/ai-canvas-cloud-single-host-image.tar`，并输出文件大小和 SHA256。这个归档不包含 PostgreSQL、Redis、服务器密钥或本地 `.env`。服务器不构建源码；arm64 电脑同样必须保留脚本中的 `linux/amd64` 目标，供 x86_64 ECS 使用。

PostgreSQL 与 Redis 继续使用 Compose 中固定版本的 Docker 官方镜像。服务器已经存在 `postgres:17.6-alpine3.22` 和 `redis:8.2.1-alpine3.22` 时不需要本地重复导出；缺少时首次启动会从 Docker Hub 拉取，因此国内服务器需要可用的 Docker 镜像加速。

单机新安装默认使用 `APP_IMAGE_SOURCE=registry` 和 `APP_REPOSITORY=hao136909482/ai-canvas-cloud`，公共 Docker Hub 仓库不要求服务器登录。国内服务器可通过 Docker daemon 的 registry mirror 使用 `https://docker.1ms.run` 拉取加速。离线安装时把 `release.env.example` 改为 `APP_IMAGE_SOURCE=archive`，并把镜像 tar 上传到部署目录。GitHub Actions 只运行质量检查，不发布镜像。

### 单机首次发布

先创建两个 DNS 记录和宝塔 HTTPS 站点；OSS Bucket 可以在安装前或安装后创建。把 `infra/deploy/single-host` 中的部署文件上传到服务器固定目录，例如 `/www/wwwroot/ai-canvas-cloud-single-host`。目录中必须直接看到 `setup.sh`、`deploy.sh`、`docker-compose.yml` 和 `release.env.example`，不能再多套一层文件夹；只有离线安装才需要同时上传镜像归档。进入目录后执行：

```bash
sudo bash setup.sh
```

脚本只询问普通站点和 Admin 站点两个域名；镜像仓库、端口、数据库名称和资源标识来自仓库默认配置，数据库、Redis、认证、加密密钥与内部资产维护密钥在服务器自动生成。master 配置保存在 `secrets/release.env`，普通/后台使用两个独立运行时环境文件。旧安装升级时 `deploy.sh` 会在缺少 `ASSET_MAINTENANCE_TOKEN` 时自动补齐，不要求人工填写。脚本拉取公共镜像并固定 digest；离线模式则加载归档并确认镜像为 `linux/amd64`。随后脚本创建数据库角色和首个 `super_admin`，并等待两个应用进程启动。一个程序镜像会被普通应用和后台应用两个容器复用，加上 PostgreSQL、Redis，最终仍是四个常驻容器。`secrets/` 与 `backups/` 均为本机私有目录，权限必须保持为 `700`/`600`。

首次登录 Admin 后进入“对象存储”，填写 Endpoint、签名 Endpoint、Bucket Origin、Region、Bucket 和 RAM AccessKey，先执行读写删除测试，再保存启用。发布前普通站点和 Admin 均可登录，但依赖 readiness 显示 degraded，图片和视频上传不可用；发布后无需重启容器。单机模式没有环境 OSS 回退，因此后台不会提供“恢复环境配置”操作。

宝塔普通站点反向代理到 `http://127.0.0.1:8080`，管理站点反向代理到 `http://127.0.0.1:8081`；使用目录中的 `baota-public.location.conf.example` 和 `baota-admin.location.conf.example`。两个模板都在兜底反向代理前用精确 `location = /metrics` 返回 `404`，单机应用运行时也不注册该路由，公网不得访问应用指标。分离部署需要监控时，只能从部署内网直接抓取不承载静态站点的 API 容器。安全组只开放 `22`、`80` 和 `443`。

首次安装按以下顺序验收：

1. `sudo bash status.sh` 显示四个容器运行，`public service` 与 `admin service` 均为 `running`。
2. 宝塔建立两个独立站点，普通域名代理到 `127.0.0.1:8080`，Admin 域名代理到 `127.0.0.1:8081`。
3. 两个站点分别申请并启用 HTTPS，Cloudflare SSL/TLS 使用 `Full (strict)`。
4. 登录 Admin，在“对象存储”填写 OSS Endpoint、Region、Bucket、访问 Origin 和 RAM AccessKey，先测试连接，再保存启用。
5. 阿里云 OSS CORS 至少允许普通站点 Origin，方法包含 `GET`、`PUT`、`HEAD`，允许请求头可设为 `*`，暴露响应头包含 `ETag`。不要把 Origin 写成带路径的 URL。
6. `sudo bash status.sh` 显示两个应用的 dependencies 均为 `ready`。
7. 用普通账号上传一张测试图片，刷新画布后仍可显示；再确认登录、项目保存和 Admin 登录正常。

`setup.sh` 只用于第一次安装。服务器已经存在 `secrets/release.env` 后禁止再次运行 `setup.sh`，否则脚本会拒绝覆盖；日常更新统一使用 `deploy.sh`。

服务器已经部署过旧开发迁移链、但尚未正式运营且确认可以丢弃全部数据库数据时，先发布当前镜像并上传全部单机部署文件，再执行 `sudo bash reset-prelaunch.sh --confirm-empty-database`。脚本停止两个应用，启动 PostgreSQL 完成最终自包含备份，校验备份非空并通过 `pg_restore --list` 解析，再核对固定 volume 名、Compose 项目标记和 volume key；只有全部检查通过才停止整套 Compose、删除 `ai-canvas-cloud-single-host-postgres`，随后调用当前 `deploy.sh` 创建单一基线、配置和校验角色、重建应用，并交互创建首个 `super_admin`。任一步骤在删卷前失败会尝试恢复原服务；删卷后失败必须从脚本打印的备份恢复或修复后继续，不自动回滚。该脚本不删除 Redis volume、OSS 对象、`secrets/` 或旧备份；重建后需要在 Admin 重新配置对象存储、Managed SMTP 和网站设置。正式运营后严禁运行该脚本，只能通过追加迁移和常规 `deploy.sh` 更新。

### 日常发布与故障处理

升级时先在本地更新代码、完成验证，再以 Git SHA 和 `stable` 两个标签发布镜像：

```powershell
npm run check
$gitSha = git rev-parse --short=12 HEAD
docker build --platform linux/amd64 --target single-host-app `
  --build-arg CONTAINER_REGISTRY=docker.1ms.run `
  --tag "hao136909482/ai-canvas-cloud:$gitSha" `
  --tag "hao136909482/ai-canvas-cloud:stable" .
docker run --rm --platform linux/amd64 --entrypoint node `
  "hao136909482/ai-canvas-cloud:$gitSha" `
  -e "import('./server/dist/modules/admin/postgresAdminService.js')"
docker push "hao136909482/ai-canvas-cloud:$gitSha"
docker push "hao136909482/ai-canvas-cloud:stable"
```

镜像推送完成后记录 Docker Hub 返回的 digest。部署脚本有变化时，用仓库当前版本覆盖服务器同目录的以下文件：

- `deploy.sh`
- `reset-prelaunch.sh`
- `docker-compose.yml`
- `status.sh`
- `setup.sh`
- `release.env.example`
- `baota-public.location.conf.example`
- `baota-admin.location.conf.example`

只覆盖上述部署文件，绝不能删除或覆盖服务器的 `secrets/`、`backups/` 和 Docker volumes。`secrets/` 保存数据库密码、认证密钥、配置加密密钥和当前部署状态；丢失后不能靠重新运行安装脚本恢复原站点。

旧安装首次切换到公共仓库时，只修改服务器已有的 `secrets/release.env`：

```bash
APP_IMAGE_SOURCE=registry
APP_REPOSITORY=hao136909482/ai-canvas-cloud
```

随后执行更新：

```bash
cd /www/wwwroot/ai-canvas-cloud-single-host
sudo bash deploy.sh
sudo bash status.sh
```

`deploy.sh` 拉取 `stable` 并按仓库 digest 固定本次部署，等待 PostgreSQL 和 Redis healthcheck 通过后创建 PostgreSQL 自包含备份，再校验配置、运行迁移和数据库角色校验、刷新两个运行时环境文件、重建两个应用并等待存活检查。离线模式则加载归档并按实际 Image ID 固定本次部署。普通站点和 Admin 全部存活后，脚本通过 release 容器读取 `/app/apps/web/dist` 与 `/app/apps/admin-web/dist`，先真实 `GET` 两个正式域名的 HTML，再枚举两套 `/assets/*` 通过对应正式域名预热 EdgeOne，包括懒加载 Chunk。预热固定并发 4、单请求超时 15 秒、失败最多重试 2 次；日志只包含域名、无查询参数的资源路径、状态码和成功/失败汇总。个别资源失败只产生警告，不回滚健康版本；预热无需 Cookie、Token、腾讯云 SecretId/SecretKey 或 EdgeOne 管理 API。

发布脚本不会在服务器构建源码，也不会自动回滚 SQL；迁移后的失败保留备份和失败状态，必须按 `DATA_MODEL.md` 的前向修复或隔离恢复流程处理。备份必须复制到另一台设备或独立 OSS Bucket，同机备份不能覆盖整机故障。`status.sh` 分别显示应用是否运行和 PostgreSQL、Redis、OSS 是否全部 ready。正式发布后还应连续请求同一 Hash 资源两次，确认一年 `immutable` 响应头且第二次由 EdgeOne 命中；该项必须在真实域名和真实 EdgeOne 响应头上验收，本地模拟不能代替。

更新完成后依次打开普通域名和 Admin 域名，检查登录、已有项目、图片显示和新图片上传。Admin“对象存储”应保持原配置，无需重复填写；`deploy.sh` 不删除 PostgreSQL volume、Redis volume、OSS 文件或服务器密钥。

如果 `deploy.sh` 失败，不要重新运行 `setup.sh`，不要删除容器、volume、`secrets/` 或 `backups/`。保留终端错误信息和本次自动生成的 `.dump` 备份；数据库迁移已经执行时优先做前向修复，不能直接换回旧程序镜像。确认迁移未执行或旧镜像与新 schema 兼容后，才能按 `secrets/release-state.env` 记录的镜像与备份制定回退操作。

## 分层职责

- `apps/web` 负责画布 UI、Cloud 平台适配、浏览器 Vault、受控 Provider 协议和本地任务恢复。
- `apps/api` 负责普通用户 HTTP、Cookie/CORS/CSRF、Redis 限流、健康检查和错误映射。
- `apps/admin-web` 与 `apps/admin-api` 使用独立 Origin、Cookie、认证、RBAC、数据库角色和审计。
- `packages/contracts` 是 HTTP 运行时 schema 和共享类型来源。
- `packages/project-graph` 只保存图操作、检查点和 `ProjectRecord` 纯转换。
- `server/modules` 拥有认证、邮件传输、工作区、账号画布偏好、项目图、检查点、资产、站内通知、生成运营遥测、迁移和 Admin 领域事务。

Web 不得 import `server/`、数据库驱动、Redis 或对象存储管理 SDK。API 路由只解析 HTTP、可信会话与 schema，再调用领域服务；不得直接写项目图、资产引用、迁移或 Admin 表。

## 认证与租户

- 普通认证由 Better Auth username 插件管理不可变用户名，并管理邮箱密码、HttpOnly Cookie、session 和密码重置 token；注册与密码重置均通过认证领域服务的邮箱验证码完成，后者只在短期挑战表中保存 AES-256-GCM 加密的内部 token。用户名用小写规范值唯一与登录、用保留原始大小写的展示值进入用户响应；兼容 `name` 和 `image` 不作为昵称或头像能力。
- 注册必须同时提供用户名、邮箱、密码和严格为 `true` 的 `acceptedTermsAndPrivacy`；Web 用单个必选勾选框同时确认用户协议与隐私政策，认证领域在调用 Better Auth 创建账号前再次校验。登录标识包含 `@` 时走邮箱，否则走不区分大小写的用户名。失败统一为账号或密码错误，不新增可枚举的用户名查询接口。
- 公开帮助中心、问题反馈、用户协议和隐私政策分别由 Web 固定路由 `/help`、`/feedback`、`/yonghuxieyi`、`/yinsizhengce` 承载；站点配置对应 URL 为空时使用当前 Origin 的固定路由，发布完整安全 HTTP(S) 地址后统一覆盖首页、公共页导航和注册链接。
- 注册、登录和 session 恢复后幂等确保 personal workspace、owner membership 和 user state。
- 所有资源访问从可信 session 解析用户，再按 `workspace_id` 和成员关系授权；客户端 `user_id` 不可信。
- 同账号只允许一个有效 session；同浏览器或超过 10 分钟未活跃的异设备可静默接管，最近活跃或活跃状态未知的异设备必须确认；封禁用户不能登录、恢复 session 或通过 workspace 授权。
- `deviceId` 是每个浏览器独立保存的随机非认证标识，用于设备管理记录；不采集硬件指纹、不跨浏览器共享或合并 ID，也不作为凭据。它不改变浏览器 Vault 按 Origin、可信用户和项目隔离的边界。
- 跨 workspace 与不存在资源使用相同的非披露错误语义。
- 密码、Cookie、token、完整邮件链接、正文和 Provider Key 不得进入日志。

Admin 认证和普通认证完全隔离。Admin 只读取普通用户的用户名、邮箱、UID、状态、session 时间、workspace 与存储聚合，不读取兼容 `name`、密码哈希、session token、项目正文、资产 object key 或浏览器 Provider 配置。仅 `super_admin` 可通过账号恢复入口写入新的 Better Auth 密码哈希；输入密码只在请求内存中短期存在，更新与 session 撤销、脱敏审计同事务提交，响应和审计不返回密码或哈希。

站内通知使用共享 `announcements` 领域模块：`super_admin` 与 `operator` 可保存草稿、发布和下线，普通用户只读取当前发布集合并为自己写幂等已读回执。发布不创建每用户收件箱副本，用户端通知中心把 Cloud 公告与浏览器内存中的任务/错误消息分源合并；时间线只展示 Cloud 公告，正文不写入 Admin 审计。

画布管理和外观设置的九项非敏感偏好通过 `/api/v1/settings` 保存到当前用户的 `workspace_user_state.ui_state_json`，跨设备在登录或刷新时同步。浏览器缓存必须按可信用户和工作区隔离；云端未初始化时才允许以旧本地配置首次写入，云端已有值时不得由旧全局缓存覆盖。保存失败使用字段级待同步补丁重试。Provider、模型身份、endpoint、Key、匿名绑定和本地任务不属于该配置，仍只进入浏览器 Vault 或任务缓存。

认证邮件只支持 `development|managed` 两种传输模式。`managed` 每次发送前读取 `public.smtp_config_publications`，按 revision 缓存解密后的运行配置和 Nodemailer transporter，并在每次发送前重新校验 DNS；后台新 revision 或公网目标变化后下一封邮件立即替换缓存，不要求重启。没有已启用的后台 revision 时邮件服务不可用，不读取环境 SMTP 配置。注册邮箱验证码仅在站点设置开启后发送，发送与已有账号均保持不披露账号状态的响应语义；注册与密码重置验证码均由 PostgreSQL 挑战记录一次性消费，10 分钟有效、60 秒冷却、连续 5 次错误失效。密码重置表不保存 Better Auth token 明文，只保存 AES-256-GCM 密文；SMTP `sendMail` 不自动重试。

只有 `super_admin` 拥有 `smtp_config.write`。后台测试和发布只接受用户名/密码 SMTP、`SSL/TLS` 或强制 `STARTTLS`，证书校验和 TLS 1.2 不可关闭；每次连接先解析全部 DNS 结果并拒绝本机、私网、链路本地和保留地址。密码只以 AES-256-GCM 信封密文进入数据库，`SMTP_CREDENTIAL_KEYS` 与活动 key version 只能由 API/Admin API 服务器环境提供，不能从后台填写或返回前端。

只有 `super_admin` 拥有 `object_storage_config.write`。后台 GET 不返回 AccessKey；测试每管理员 10 分钟最多 5 次且不保存探针 object key。保存会重新测试并以 revision 乐观锁原子发布；恢复环境配置撤销 current/publication 并立即回到 `S3_*`。普通 API 仅可 SELECT 发布投影，Admin 仍不能读取资产 object key 或项目内容。

## 项目图、检查点与资产

当前项目图以 `projects`、`project_nodes`、`project_edges`、`project_changes`、`assets` 和引用表为事实来源。自动保存提交 ID 级节点/连线操作，每批携带 `baseVersion`、batch/client ID 和幂等键。

图变更必须在单个事务内完成授权、项目锁、版本校验、拓扑与资产校验、节点/连线更新、引用同步、change 追加和 version/sequence 递增。版本不一致返回稳定 `409 PROJECT_VERSION_CONFLICT`；客户端只自动追平不触碰相同实体的远端变更，否则保留本地副本并让用户选择。

手动或定期 checkpoint 由服务端从关系化图组装。恢复先校验 version/sequence、record 和资产 manifest，再创建 pre-restore、替换当前图、重建引用和追加 restore change。只有可恢复检查点才能保护资产或允许裁剪更早 change。

媒体只存私有对象存储。上传流程为创建会话、无 Cookie 预签名直传、服务端重新读取 metadata 并完成确认。仍被当前节点或有效 checkpoint 引用的资产不得 GC；删除采用软删除和宽限期。

浏览器图片预览以 `cloud-assets/<asset-id>` 为稳定身份，不把 OSS 签名 URL 当作长期来源。高清原图和持久缩略图按稳定资产 ID 合并下载到有容量上限的会话内 Blob LRU；同一登录会话和项目往返优先复用 Blob，签名读取失败只失效并刷新当前资产后重试一次。退出、换账号或 workspace 变化清空私有 Blob，不写入未加密的浏览器持久缓存。

目录包导入必须先预检、暂存上传，再事务化 commit。导出从冻结版本组装包。包和 API 均不得包含 object key、签名 URL、租户内部字段、Provider 配置、Key 或浏览器任务缓存。

## 浏览器 Vault 与本地生成

- Provider、endpoint、真实模型 ID、API Key、匿名引用绑定和可恢复本地任务只进入按 Origin、可信用户和项目隔离的加密 IndexedDB。任务缓存当前为 v3，兼容读取 v2；Provider 已返回但尚未入云的图片 Blob 也按用户、项目和任务加密暂存，保存成功后立即删除。
- Vault 当前使用 `schemaVersion=2`、`cipherVersion=1`、不可导出的 AES-256-GCM `CryptoKey`；Key 凭据与 Provider 配置分槽保存。
- 登出或换账号清除内存明文，但保留按账号隔离的设备密文；清除网站数据会删除密文、CryptoKey、绑定和任务缓存。
- 浏览器只实现固定 OpenAI Compatible/DashScope chat、image、video 协议，不接受任意脚本、Header/Body 模板或 target URL。
- 普通服务商配置固定使用同步图像请求，不向用户暴露异步任务协议；受控异步 adapter 仅保留给未来明确适配并验证过协议能力的服务商。
- 云端图只保存 `local:<uuid>` 匿名模型引用。新设备必须由用户明确绑定本机同类型模型，不按名称或 ID 猜测。
- 图片与视频分别使用独立 FIFO 执行通道；本地并发策略固定为图片 8、视频 1。调度器通过原子 claim 领取任务，Provider 请求、异步轮询、结果下载和 Cloud 入库完成后才释放槽位；第 9 个图片任务继续留在当前项目的浏览器队列。
- 图片 Provider 通过受控 adapter 注册表统一返回同步完成结果或受控 remote task ID，不自动探测协议。Provider POST 不自动重试；异步查询 GET 只对网络错误、429 和 5xx 执行有限退避，Cloud 保存失败只从加密临时 Blob 继续保存，不重新调用 Provider。
- OpenAI Compatible 图片模型的真实模型 ID 原样透传；可识别的 GPT Image 与 Gemini 家族使用各自扩展参数，服务商自定义且无法识别的图片模型 ID 使用最小通用 Images 请求，不以官方模型 ID 白名单阻断执行。
- 每次生成都创建 UUID 任务和独立结果节点。来源节点状态聚合全部关联任务，并只选择创建时间最新且成功的图片作为当前输出，旧任务即使后返回也不能覆盖较新的成功结果；排队任务可取消，运行中任务首期不提供统一取消。
- 无 remote task ID 的同步任务在页面关闭后中断；已有受控 remote task ID 的异步任务在重新取得并发槽位后，只可于同一设备恢复轮询。切换项目会保存并停止当前运行时，返回项目后恢复其排队、轮询或待保存任务；同步图片运行时离开页面或切换项目必须提示可能中断且仍可能计费。
- 新任务冻结生成参数、`modelEntryId`、受控 adapter、执行模式和 Provider 绑定指纹，但不复制真实模型 ID、endpoint 或 Key 到任务。Provider 配置变化后，旧远程任务不得使用新配置继续轮询；v2 排队任务首次执行时绑定当前配置。
- Provider 请求真正开始时发送随机 attempt 的脱敏遥测，终态只回传类别、耗时、结果数或受限失败分类。遥测失败不得阻断生成，也不得携带 Prompt、输出、Provider、模型、endpoint、Key、上游正文或 remote task ID。

平台 API 不新增 Provider 测试、发现、代理或生成任务路由，也不接收 Key、endpoint、真实模型 ID、remote task ID 或任意 target URL。`/telemetry/generations` 是不可执行的有限运营入口，不改变浏览器生成和本地任务的事实边界。

## 安全与运行

普通 API 统一处理精确 Origin、Cookie CSRF、安全响应头、严格 JSON、固定路由组和 Redis Lua 原子限流。Redis 故障时普通读可 fail-open，高风险认证和写请求必须 fail-closed。

HTTP 接入层仅使用 Fastify，普通 API 与 Admin API 均不提供旧 Node HTTP handler、双适配配置或运行时切换开关。请求 ID、安全头、CORS/CSRF、严格 JSON、限流、指标和稳定错误映射属于接入层共用约束；Cookie、User-Agent、客户端 IP 和请求 ID 通过共用请求上下文适配器传给认证服务，同一请求的会话只解析一次。领域服务依赖仍由服务启动入口一次组装并注入，路由不得直接访问 PostgreSQL、Redis 或对象存储。

Fastify JSON parser 必须使用 fatal UTF-8 解码，拒绝重复键、无效 Unicode、超过 64 层或 100,000 entries 的结构，并由路由声明独立 body limit。AJV 不得删除字段、强转类型或注入默认值；TypeBox 描述传输结构，现有领域验证器继续接收原始解析结果并作为复杂语义的权威。TypeBox Schema 只从 `@ai-canvas-cloud/contracts/http-schema` 和 `@ai-canvas-cloud/contracts/admin-http-schema` 服务端子路径导入，Contracts 根入口和浏览器入口不得重新导出。开发 Fastify 模式注册 `/docs` 与 `/docs/json`；production/staging 不注册 OpenAPI 路由。普通 API 与 Admin API build 分别生成并检查 OpenAPI 产物，Schema 或 `operationId` 缺失及重复都会失败。

公共 API 与 Admin API 契约测试必须覆盖各自路由清单中的全部方法和路径，并验证状态码、响应头、响应体、可信 actor、错误结构和请求体边界。真实 PostgreSQL/对象存储 E2E 使用独立 Schema、账号和资源验证 Fastify 路径，不共享可变测试数据。

普通 API readiness 检查 PostgreSQL、Redis 和对象存储；Admin API 只检查 PostgreSQL 和对象存储。指标只使用低基数标签，不包含用户、workspace、project、动态 URL、主机、邮箱、正文或凭据；邮件指标只按 `verification|password_reset|test`、结果、失败类别和配置来源区分。

生产应用启动不自动迁移。当前数据库只从 `0001_current_schema.sql` 创建，首次正式运营前必须重建空库、应用基线并重新配置数据库角色。基线不提供开发期数据库的原地升级；正式运营后所有 schema 变更必须追加显式迁移。回滚与前向修复详细语义只在 [`DATA_MODEL.md`](DATA_MODEL.md) 维护。

## 开发命令

开发服务：

```bash
npm run dev:web
npm run dev:api
npm run dev:admin-web
npm run dev:admin-api
npm run dev:start
npm run dev:stop
npm run dev:restart
npm run dev:status
```

代码验证：

```bash
npm run test:unit -- <test-file-or-directory>
npm run lint:files -- <changed-ts-or-tsx-files>
npm run format:files -- <changed-files>
npm run typecheck
npm run check
npm test
npm run lint
npm run build
npm run format:check
```

`test:unit` 排除 `*.integration.test.*`，并允许用仓库内测试文件或目录限制范围。`npm test` 包含全部测试；两者只构建测试运行时需要的共享、server、API 和 Admin API 工作区，不做 Web/Admin Web 的 Vite 生产打包。`typecheck` 使用 TypeScript project references；`check` 组合全部非集成测试、当前 Git 改动文件的 Lint/Prettier 和增量类型检查。`npm run build` 还会对 Web 生产产物执行匿名入口 200 KiB Gzip 预算和禁止 preload 登录后 Chunk 的检查。

数据库与运维：

```bash
npm run db:migrate
npm run db:roles:provision
npm run db:roles:check
npm run admin:bootstrap
npm run db:migrate:test
npm run db:migrate:compat
npm run db:repair:checkpoint-assets
npm run db:maintain:assets
npm run db:maintain:accounts
npm run deploy:staging:check
npm run deploy:staging:gate
npm run deploy:staging:backup
npm run deploy:staging:restore:drill
```

账户注销采用两阶段清理：管理员请求会立即撤销普通会话、清空身份数据并软删除个人空间；7 天后由应用数据库角色运行 `npm run db:maintain:accounts -- --apply` 删除个人项目历史、关系元数据和私有对象。命令默认仅预检，删除对象失败时任务保持可重试状态，且不会写入完成时间。Admin API 必须配置独立于 `ADMIN_BETTER_AUTH_SECRET` 的普通 `BETTER_AUTH_SECRET`，只用于删除按 HMAC 索引的注册和重置邮箱挑战，绝不写入日志、审计或浏览器。

每增加或修改真实命令，必须同步更新 `README.md`、`AGENTS.md` 和本文。

## 验证矩阵

验证按改动风险逐级增加，不再让每次编辑都运行发布级门禁。

| 改动范围                                  | 编辑中                         | 交付前最低要求                                                                  |
| ----------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| 仅 Markdown、注释、静态文案               | 格式或链接检查                 | `npm run format:files -- <files>`；不要求代码测试、构建或迁移                   |
| 单模块纯逻辑或 UI                         | 相关 `test:unit`、`lint:files` | `npm run check`                                                                 |
| 共享包、跨模块契约、API 行为              | 相关测试                       | `npm test`、`npm run lint`、`npm run build`                                     |
| 认证、权限、项目图、资产、Vault、本地任务 | 相关单元/集成                  | 上一行，加对应两账号隔离、双设备或浏览器 E2E                                    |
| SQL schema、迁移器、数据库角色            | 相关数据库测试                 | `db:migrate:test`、`db:migrate:compat`、`db:roles:check`，并写回滚/前向修复说明 |
| staging 或发布配置                        | 本地配置检查                   | `deploy:staging:check`、`deploy:staging:gate` 和真实环境恢复演练                |

补充规则：

- `npm run check` 是常规改动的统一收尾；它只检查本次 Git 改动文件的格式和 Lint，不替代全仓门禁、风险项集成或 E2E。
- 没有数据库 schema、迁移器或角色变更时，不重复运行迁移门禁。
- 没有认证、租户、Vault、任务恢复或跨设备行为变更时，不重复两账号/双设备 E2E。
- 生产 `build` 用于跨模块、打包边界和发布前验证，不要求在每次局部编辑后执行。
- 无法运行的门禁必须说明缺少的环境和剩余风险，不能用本地 fake 代替真实 staging 验收。
