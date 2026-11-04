# Linkdock Cloudflare 部署与维护教程

Cloudflare 版保留多用户密码登录、设备令牌、Floccus 同步锁、XBEL 导入导出和历史恢复。
管理员可设置注册方式、邀请、默认与个人配额，并查看存储统计、清理状态和写入失败记录。
不提供书签树编辑、标签、Passkey 和 SMTP 找回密码。

## 1. 准备环境与资源

准备 Node.js 24、Git、Cloudflare 账号和可访问的 HTTPS 域名。
Cloudflare 需要启用 Workers、D1、SQLite Durable Objects 和 R2。
R2 保持私有，不需要公开访问域名。建议先用 Workers Paid；密码派生和大 XML
校验需实测 CPU，不能据此承诺免费套餐运行。

| 绑定 | 用途 |
|---|---|
| DB | D1：账号、哈希会话、哈希令牌、邀请、配额、统计快照 |
| USER_FILES | 每用户一个 SQLite Durable Object：文件指向、历史、锁、清理和失败记录 |
| FILES | R2：不可变的 XBEL 原始文件 |
| ASSETS | React 静态资源 |
| AUTH_LIMITER | 每 IP 每分钟 30 次认证请求 |

在仓库根目录安装：

```bash
cd web
npm ci
npm run build
cd ../cloudflare
npm ci
```

新安装时，在正确账号中创建一次资源（升级时不要重建）：

```bash
npx wrangler login
npx wrangler d1 create linkdock-accounts
npx wrangler r2 bucket create linkdock-files
```

记录返回的 D1 ID。修改 `cloudflare/wrangler.jsonc` 中的 `database_id`、R2 桶名
和 `PUBLIC_URL`，或使用后文的环境变量覆盖。不改 `DB`、`FILES`、`USER_FILES`
绑定名和 Durable Object 类名，避免切换到另一套数据。

## 2. 本地试运行

在 `cloudflare/` 下执行：

```bash
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，把 SETUP_TOKEN 改为至少 32 字符的随机值。
npm run preflight
npm run db:local
npm run dev
```

访问 `http://localhost:8787`，首次注册输入初始化密钥，首个账号成为管理员。
所有资源在本地模拟；`.wrangler/` 状态和 `.dev.vars` 不进入 Git。
前端热更新可单独运行 `web/npm run dev`，同时在 `.dev.vars` 将 PUBLIC_URL 设为
`http://localhost:5173`。正常本地运行仍使用 8787。

## 3. 命令行正式部署

部署脚本使用 API Token 身份认证，创建一个只用于此项目的 Token，按用途授予
Workers 编辑、D1 编辑、R2 编辑；使用自定义域名时还需要相应 Zone/DNS/路由权限。
不要把密钥写进 `wrangler.jsonc`、Git 或 shell 脚本。

在终端设置下列环境变量；密钥建议由密码管理器或 CI Secret 注入，避免出现在 shell 历史。
非敏感配置示例：

```bash
export WORKER_NAME='linkdock-cloudflare'
export PUBLIC_URL='https://bookmarks.example.com'
export D1_DATABASE_ID='填入创建数据库返回的 UUID'
export R2_BUCKET_NAME='linkdock-files'
export CUSTOM_DOMAIN='true'
```

另外注入 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，首次部署必须准备至少
32 字符的 `SETUP_TOKEN`。例如用 `openssl rand -hex 32` 生成并保存到密码管理器。
使用 `workers.dev` 时把 PUBLIC_URL 改为该 Worker 的确切域名，并省略 CUSTOM_DOMAIN。
自定义域名需已接入当前 Cloudflare 账号，脚本会通过 Workers custom-domain route 配置。

先检查，再测试、部署：

```bash
npm run preflight -- --production
npm run typecheck
npm run test:scripts
npm test
npm run deploy
```

`preflight` 只读本地配置，不访问远程；正式模式会拒绝占位 D1 ID、localhost、非 HTTPS
地址、无效绑定和公开 vars 中的私密密钥。
`deploy` 会构建前端，检查既有 D1/R2，执行 dry-run、应用增量 D1 迁移，然后发布 Worker
并轮询公网 `/health/ready`。失败时命令返回非零状态，必须查看日志确认失败阶段。
部署脚本不创建新资源，不清空数据。

Secrets 使用 Wrangler `--secrets-file` 随版本上传，临时文件权限为 0600，完成后删除。
没有传入的 Secret 保留原值；不要在升级时生成新初始化密钥。
`npm run build` 只构建和 dry-run，不迁移或部署。

## 4. GitHub Actions 手动部署

1. 将代码提交、推送到 GitHub 的 `cloudflare` 分支。
2. 在仓库 Settings → Environments 创建 `cloudflare-production`，按需要添加审批人。
3. 在这个 Environment 中设置 Variables：

| Variable | 必填 | 说明 |
|---|---|---|
| PUBLIC_URL | 是 | 正式 HTTPS origin，不带路径 |
| D1_DATABASE_ID | 是 | 已存在 D1 UUID |
| R2_BUCKET_NAME | 建议 | 已存在私有桶，默认 linkdock-files |
| WORKER_NAME | 建议 | 固定 Worker 名，不要随升级变更 |
| CUSTOM_DOMAIN | 否 | true 时管理自定义域名路由 |
| TURNSTILE_SITE_KEY | 否 | Turnstile 公钥 |

4. 设置 Secrets：CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID、首次安装的 SETUP_TOKEN；
   启用 Turnstile 时再添加 TURNSTILE_SECRET_KEY。
5. 打开 Actions → Deploy Cloudflare → Run workflow，选择 `cloudflare` 分支。

工作流只允许该分支手动触发，执行配置检查、类型检查、脚本测试和集成测试后才部署。
同一生产环境的部署按顺序进行，不会互相取消。不会在 push 时自动创建资源或上线。
workflow_dispatch 文件首次出现于非默认分支时，GitHub 可能不在默认 Actions 列表提供入口；
需先让默认分支包含该工作流文件（保留分支保护条件），或使用命令行部署。不要因此改动
原 Rust 默认分支的其他业务文件。

## 5. 首次注册、邀请与验证

首次注册需要 SETUP_TOKEN。注册完成后进入“管理 → 实例管理”：

- 关闭注册：已有用户仍可登录，不能注册新用户。
- 仅限邀请：管理员创建有次数和有效期的邀请码；代码只显示一次，数据库只存哈希。
- 开放注册：普通用户可自行注册。

邀请消耗与账号写入在同一个 D1 事务中；重复账号、过期或撤销的邀请码不应消耗次数。
管理员不能通过修改请求里的 user_id 给另一个用户签发设备令牌。

初始注册方式兼容 REGISTRATION_ENABLED；一旦管理员保存设置，以 D1 设置为准。
不要再靠修改该环境变量覆盖后台已保存的注册方式。

可选 Turnstile：

1. 在 Cloudflare Turnstile 创建 widget，并加入正式 PUBLIC_URL 的主机名。
2. 设置 TURNSTILE_SITE_KEY 为公钥，TURNSTILE_SECRET_KEY 为 Secret；重新部署。
3. 在后台勾选注册验证并保存。

只有两项密钥同时配置时才能启用。服务器检查 Siteverify 的 success、hostname 和
`action=register`，网络失败时拒绝注册并提示重试。前端失败或 token 过期后重新验证。
开发环境可使用 Cloudflare 官方测试 widget，生产勿使用测试密钥。

## 6. 配额、统计与清理

默认每用户：100 个文件、100 MiB 存储、20 个有效设备令牌。
管理员可以修改默认值，或为单个用户覆盖；个人设置留空表示继承默认值。
降低配额不删除已有文件，也不撤销既有令牌；超额时阻止继续增长。

存储配额计入每个唯一 R2 对象的字节，包括当前文件、历史版本、临时上传和待清理对象。
同一个对象被多个版本引用只计一次。新文件上传前预留空间，因此覆盖文件也需要容纳
“旧版本 + 新上传”。上传失败的预留对象会暂时占用保守额度，清理后释放。
文件数检查也包括临时上传目标，避免用无限 .temp 绕过上限。

文件或空间不足时返回 507，令牌数量不足返回 409。删除和下载仍可用；已有同步锁继续
生效。HISTORY_LIMIT 是保留的“旧版本数量”，默认 20；MAX_FILE_BYTES 默认 10 MiB。

用户文件页显示实时占用。管理页的全站统计来自定时快照，显示已采集用户数和最早采集
时间，不是实时 Cloudflare 账单。每小时 cron 最多采集 25 个用户并持久化游标；大实例
需要多轮才覆盖全站。打开个人“用量与配额”可以即时采集该用户并刷新快照。

定时维护每轮最多清理 1000 个过期会话和一批过期邀请。每个用户的 Durable Object alarm
负责过期 staging 和 R2 清理，一次处理最多 100 个待清理对象，另扫描最多 100 个该用户
前缀对象寻找遗留孤立文件。旧对象至少保留一天宽限；只删除无当前文件、版本或 staging
引用的对象，失败记录错误并安排重试。管理页也可以手动执行同一套安全清理。

最近写入失败最多保留 100 条，后台显示最近 50 条；只记录方法、状态码和时间。
无书签内容、文件名、密码、令牌或请求头。读取失败及认证前拒绝可在 Workers 日志排查。

## 7. Floccus 配置与验收

每台设备创建独立令牌，填写：

- WebDAV 地址：`https://你的域名/webdav/`
- 用户名：任意非空值
- 密码：该设备令牌
- 文件名：`bookmarks.xbel`
- 格式：XBEL

导入 XBEL 后先让一台设备从服务器同步，再配置另一台设备。验收新增、删除、排序、
多端连续同步；同步中网页导入/删除应被锁拒绝（423），过期条件写入返回 412。
下载导出检查原始文件字节；部署健康检查通过不代表真实 Floccus 双端已验收。

## 8. 版本升级与代码回退

升级前暂停客户端同步，导出关键 XBEL，并保留现有 D1/R2/DO 资源和配置。
记录当前 Git commit、Workers 版本及健康状态。用同一个 Worker 名、D1 ID、R2 桶名及
DO 绑定执行部署；新迁移只追加，不能改历史迁移或重新初始化已有库。

```bash
git switch cloudflare
git pull --ff-only
cd web && npm ci && npm run build
cd ../cloudflare && npm ci
npm run preflight -- --production
npm run typecheck
npm run test:scripts
npm test
npm run deploy
```

迁移成功、部署失败时不要删除数据库或回滚 SQL，修复后重试部署。已有迁移会被记录，
重试不会重复初始化。当前新增 schema 是向后兼容扩展，旧字段保留。

需要回退代码时，先在 Cloudflare Workers 的 Deployments 查看并选择已知正常的旧版本，
或在正确配置下使用 `npx wrangler rollback <旧版本ID>`。代码回退不会撤销 D1/DO schema
或还原 R2 数据；有破坏性数据迁移时不能仅靠代码回退，必须单独评估数据恢复。
回退后重新检查 `/health/ready`、登录、文件导出和 Floccus 同步。

## 9. 文件恢复与灾难恢复边界

单文件误覆盖：网页打开“历史版本”，先导出核对，再恢复；恢复会创建新修订并保留原当前
版本。文件删除同时删除历史元数据，不能依靠网页历史撤销删除，应使用独立 XBEL 导出。
从导出恢复时重新导入同名文件，先暂停各设备同步，避免客户端旧副本覆盖恢复结果。

D1 可以独立导出：

```bash
npx wrangler d1 export linkdock-accounts --remote --output accounts.sql
```

导出包含密码哈希、会话哈希和邀请码哈希，按敏感数据保存。仅恢复 D1 无法恢复 DO 文件
指向和 R2 内容。使用 D1 Time Travel 或导入 SQL 前，暂停所有写入并核对恢复时间及用户 ID；
账号 ID 与 DO/R2 路径关联，不能随意重建或重新分配 ID。

本项目尚未提供 D1 + DO + R2 的一致性全站备份／恢复工具。DO 元数据应通过 Cloudflare
提供的 SQLite Durable Objects PITR 能力按官方文档恢复；这需要受控维护操作，当前没有
公开恢复 API。即使 DO 元数据能恢复，已被 R2 清理删除的对象也需外部对象备份。
因此生产运行必须额外保存 XBEL 导出；R2 桶复制本身也不等于完整系统备份。

## 10. 故障排查

| 现象 | 检查 |
|---|---|
| preflight 失败 | D1 ID、HTTPS origin、绑定名、数值限制；不应先创建新库 |
| 部署后健康检查失败 | 自定义域名/DNS、PUBLIC_URL、Worker 日志、D1 迁移是否完成 |
| 注册 503 | 首次缺 SETUP_TOKEN，或 Turnstile 配置/验证服务不可用 |
| 注册 403 | 注册关闭、初始化密钥错误，或邀请失效 |
| WebDAV 401 | 是否使用设备令牌而非登录密码，令牌是否过期/撤销、账号是否停用 |
| 423 | 别的设备持锁；每设备独立令牌，等同步结束或五分钟过期 |
| 412 | 旧版本覆盖被拒绝；刷新后核对文件，勿盲目重试覆盖 |
| 507 | 查看个人存储、历史和待清理对象；删除后等待宽限期清理，或提高配额 |
| 统计用户数不完整 | 等待后续 cron 批次，查看采集时间；不是文件丢失 |
| 清理失败 | 后台查看错误时间，再检查 R2 绑定、Worker 日志及 alarm 重试 |
| 跨域 403 | PUBLIC_URL 必须与浏览器 origin 一致；同域部署无需开放 CORS |

可使用 `npx wrangler tail` 查看 Worker 日志。不要把密钥、完整账号导出或带凭据请求贴到
公开 issue。应用配额限制不能覆盖 Workers/D1/DO 请求费用；仍应监控 Cloudflare 账单。

参考：[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)、
[Turnstile 服务端校验](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)、
[Durable Objects PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)。
