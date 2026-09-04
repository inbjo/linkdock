# Rust Linkwarden 兼容书签服务实施计划

## 1. 项目目标

构建一个面向个人和小团队的多租户书签管理服务：

- 后端使用 Rust、Axum 和 SQLite。
- 管理前端复用 Linkwarden 的视觉设计、React 组件和多语言资源，并改造成 Vite SPA。
- 前端静态资源在编译时嵌入 Rust 二进制。
- 实现 Floccus 所需的 Linkwarden 兼容 API，直接使用官方 Floccus 扩展完成 Chrome、Firefox、Edge 等浏览器之间的书签同步。
- 支持用户注册登录、工作区、成员权限、书签和目录管理、导入、导出、搜索、回收站及 Access Token 管理。
- 默认以单个 Rust 进程运行，持久化内容存放在独立的数据目录中。

## 2. 第一阶段不做的功能

以下能力不属于首版范围：

- 兼容已有 Linkwarden 用户、Cookie、NextAuth JWT/JWE 或数据库。
- Playwright、Chromium、网页截图、PDF、Readability 和 Monolith 网页归档。
- AI 自动标签。
- RSS 订阅。
- Stripe、App Store、Google Play 等支付能力。
- OAuth、OIDC、SSO 和邮件找回密码。
- Linkwarden 移动客户端完整 API 兼容。
- 自研浏览器扩展或修改 Floccus 扩展。
- 浏览器书签的同目录手工排序同步。Floccus 的 Linkwarden 适配器目前声明不保留顺序。

## 3. 总体架构

```text
浏览器管理界面                         Floccus 官方扩展
       |                                     |
       | Session Cookie                      | Bearer Access Token
       v                                     v
+----------------------------------------------------------------+
|                        Rust / Axum                           |
|                                                              |
|  /api/app/v1/*              /api/v1/*                        |
|  管理界面 API                Linkwarden 兼容 API               |
|            \                 /                                |
|             +-------- 业务服务层 --------+                    |
|                       |                                      |
|          SQLite + FTS5 + 本地文件存储                         |
|                                                              |
|  非 API 路径 -> 内嵌 React SPA / index.html fallback          |
+----------------------------------------------------------------+
```

设计原则：

- Floccus 兼容层与管理 API 共享同一业务服务，不能维护两套书签规则。
- 所有业务查询必须包含服务端解析出的 `tenant_id`。
- Floccus 兼容路由保持上游所需的 HTTP 方法、状态码和 JSON 外形。
- SQLite 数据库和用户数据不嵌入二进制，升级二进制不能覆盖运行数据。
- 优先保持实现简单、可备份和可恢复，再考虑横向扩展。

## 4. 建议目录结构

```text
.
├── Cargo.toml
├── build.rs
├── migrations/
├── src/
│   ├── main.rs
│   ├── config.rs
│   ├── error.rs
│   ├── state.rs
│   ├── auth/
│   ├── db/
│   ├── domain/
│   ├── services/
│   ├── routes/
│   │   ├── app/
│   │   └── linkwarden/
│   └── web_assets.rs
├── web/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
├── tests/
│   ├── api_contract/
│   ├── integration/
│   └── fixtures/
├── Dockerfile
└── plan.md
```

建议依赖：

- `axum`、`tokio`、`tower-http`
- `serde`、`serde_json`、`thiserror`
- `sqlx`，启用 SQLite 和 migrations
- `argon2`，用于密码哈希
- `sha2` 或 `blake3`，用于 Access Token 哈希
- `rand`、`base64`，用于安全随机 Token
- `time` 或 `chrono`
- `uuid`
- `rust-embed` 或 `include_dir`
- `tracing`、`tracing-subscriber`
- `csv`、HTML 书签解析库或受控的流式解析实现

## 5. 多租户和权限模型

### 5.1 租户定义

使用 Workspace/Tenant 作为数据隔离边界，而不是直接以用户作为边界：

- 每位新用户注册时自动创建个人工作区。
- 一个用户可以加入多个工作区。
- 一个工作区可以有多个成员。
- Web 界面允许切换当前工作区。
- 每个 Floccus Access Token 固定绑定一个工作区，Floccus 不需要额外传递租户参数。

### 5.2 角色

| 角色 | 权限 |
| --- | --- |
| `owner` | 工作区全部权限、转移所有权、删除工作区 |
| `admin` | 管理成员、Token、Collection、书签、标签和导入导出 |
| `member` | 管理 Collection、书签和标签 |
| `viewer` | 只读访问 |

系统管理员与租户角色分离。系统管理员只能通过专用后台管理用户、工作区和运行状态，不自动读取租户的书签内容；如以后需要支持排障访问，必须增加显式审计机制。

### 5.3 安全边界

- `tenant_id` 只能来自服务端 Session 或 Access Token，不能相信请求体和查询参数中的租户标识。
- 数据库查询统一通过带租户上下文的 repository/service 方法执行。
- 更新和删除时使用 `WHERE id = ? AND tenant_id = ?`，不能先按全局 ID 查询再做权限判断。
- Collection 的父节点、Link 的目标 Collection 和 Tag 必须属于相同租户。
- Access Token 仅在创建时显示一次，数据库只保存哈希。

## 6. SQLite 数据设计

### 6.1 核心表

#### `users`

- `id INTEGER PRIMARY KEY`
- `uuid TEXT UNIQUE NOT NULL`
- `username TEXT UNIQUE NOT NULL COLLATE NOCASE`
- `password_hash TEXT NOT NULL`
- `display_name TEXT`
- `is_system_admin INTEGER NOT NULL DEFAULT 0`
- `created_at`、`updated_at`

#### `tenants`

- `id INTEGER PRIMARY KEY`
- `uuid TEXT UNIQUE NOT NULL`
- `name TEXT NOT NULL`
- `slug TEXT UNIQUE NOT NULL COLLATE NOCASE`
- `created_at`、`updated_at`

#### `tenant_members`

- `tenant_id`
- `user_id`
- `role TEXT NOT NULL`
- `created_at`、`updated_at`
- 主键为 `(tenant_id, user_id)`

#### `sessions`

- `id INTEGER PRIMARY KEY`
- `session_hash TEXT UNIQUE NOT NULL`
- `user_id INTEGER NOT NULL`
- `active_tenant_id INTEGER NOT NULL`
- `expires_at`、`last_used_at`、`created_at`

#### `access_tokens`

- `id INTEGER PRIMARY KEY`
- `uuid TEXT UNIQUE NOT NULL`
- `tenant_id INTEGER NOT NULL`
- `user_id INTEGER NOT NULL`
- `name TEXT NOT NULL`
- `token_prefix TEXT NOT NULL`
- `token_hash TEXT UNIQUE NOT NULL`
- `scopes TEXT NOT NULL`
- `expires_at`、`last_used_at`、`revoked_at`、`created_at`
- 同一租户同一用户的有效 Token 名称应唯一

#### `collections`

- `id INTEGER PRIMARY KEY`
- `uuid TEXT UNIQUE NOT NULL`
- `tenant_id INTEGER NOT NULL`
- `parent_id INTEGER NULL`
- `name TEXT NOT NULL`
- `description TEXT NOT NULL DEFAULT ''`
- `color TEXT`
- `position INTEGER NOT NULL DEFAULT 0`
- `created_by INTEGER NOT NULL`
- `deleted_at NULL`
- `created_at`、`updated_at`

约束：

- 父 Collection 必须属于同一租户。
- 移动 Collection 时禁止将其移动到自身或后代下面。
- 同一父目录下可对名称使用 `(tenant_id, parent_id, name)` 唯一约束；根目录的 `NULL` 需要额外索引或业务校验。

#### `links`

- `id INTEGER PRIMARY KEY`
- `uuid TEXT UNIQUE NOT NULL`
- `tenant_id INTEGER NOT NULL`
- `collection_id INTEGER NOT NULL`
- `url TEXT NOT NULL`
- `name TEXT NOT NULL DEFAULT ''`
- `description TEXT NOT NULL DEFAULT ''`
- `position INTEGER NOT NULL DEFAULT 0`
- `created_by INTEGER NOT NULL`
- `deleted_at NULL`
- `created_at`、`updated_at`

`url` 不设置唯一约束，因为不同目录可以包含相同 URL，浏览器本身也允许重复书签。

#### `tags` 与 `link_tags`

- Tag 在 `(tenant_id, normalized_name)` 上唯一。
- Link 与 Tag 的关联使用复合主键。
- 标签首版供 Web 管理界面使用；Floccus Linkwarden 适配器不依赖标签接口。

#### `import_jobs`

- 保存上传格式、状态、总数、成功数、跳过数、失败数和错误摘要。
- 任务状态至少包含 `pending`、`running`、`completed`、`failed`。
- 导入过程按受控批次事务提交，失败时结果必须可解释，不能留下未知的半完成状态。

### 6.2 搜索

- 使用 SQLite FTS5 为书签名称、URL 和描述建立全文索引。
- FTS 索引通过 migration 中的 trigger 或明确的 service 写入保持一致。
- 搜索结果必须再次按 `tenant_id` 过滤。
- API 使用稳定游标分页，禁止用会在数据变化时大量跳项的裸 offset 作为 Floccus 游标。

### 6.3 运行参数

启动时设置：

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- 合理的 `busy_timeout`
- 可配置的连接池上限

发布前验证正常退出、崩溃恢复、WAL checkpoint 和在线备份流程。

## 7. 认证设计

### 7.1 Web 会话

- 用户名和密码登录。
- 密码使用 Argon2id 哈希并设置合理参数。
- 登录成功生成高熵随机 Session Token。
- 浏览器使用 `HttpOnly`、`Secure`、`SameSite=Lax` Cookie。
- 对修改请求实施 CSRF 防护和 Origin 校验。
- 支持退出当前会话和撤销其他会话。

### 7.2 Floccus Access Token

- 用户在 Web 界面选择工作区并创建 Token。
- Token 建议格式：`lw_<public-prefix>_<secret>`。
- 返回完整 Token 一次，之后只显示名称、前缀、创建时间、上次使用时间和状态。
- 首版 scopes 至少提供 `bookmarks:read` 和 `bookmarks:write`。
- Floccus 请求通过 `Authorization: Bearer <token>` 认证。
- 浏览器端无效 Token 返回 `403`，以匹配 Floccus Linkwarden 适配器的认证错误判断。

## 8. Floccus / Linkwarden 兼容 API

兼容目标以 Floccus 正式版中 `LinkwardenAdapter` 的契约测试固定，不追求整个 Linkwarden API 兼容。

### 8.1 必需路由

```text
GET    /api/v1/search
GET    /api/v1/collections
GET    /api/v1/collections/:id
POST   /api/v1/collections
PUT    /api/v1/collections/:id
DELETE /api/v1/collections/:id
POST   /api/v1/links
PUT    /api/v1/links/:id
DELETE /api/v1/links/:id
```

### 8.2 必需 JSON 外形

Collection 列表：

```json
{
  "response": [
    {
      "id": 1,
      "name": "Floccus",
      "parentId": null,
      "ownerId": 1
    }
  ]
}
```

Collection 单项及创建/更新：

```json
{
  "response": {
    "id": 1,
    "name": "Floccus",
    "parentId": null,
    "ownerId": 1
  }
}
```

搜索分页：

```json
{
  "data": {
    "links": [
      {
        "id": 10,
        "name": "Rust",
        "url": "https://www.rust-lang.org/",
        "collectionId": 1
      }
    ],
    "nextCursor": null
  }
}
```

Link 创建/更新：

```json
{
  "response": {
    "id": 10,
    "name": "Rust",
    "url": "https://www.rust-lang.org/",
    "collectionId": 1
  }
}
```

### 8.3 行为契约

- `POST /links` 接受 `collection.id`。
- `PUT /links/:id` 接受 `id`、`url`、`name`、`tags` 和 `collection`；不认识但无害的兼容字段可以忽略。
- `POST /collections` 接受 `name` 和可选 `parentId`。
- `PUT /collections/:id` 支持改名和移动目录。
- `GET /search` 接受空的 `searchQueryString` 并分页返回全部有效书签。
- 删除不存在或已经删除的资源尽量保持幂等。
- 所有返回 ID 使用 JSON number，父 ID 为 number 或 `null`。
- 不向 `/api/v1/*` 返回 SPA HTML；未知 API 必须返回 JSON 404。
- 必须正确处理 OPTIONS/CORS、反向代理 HTTPS 和尾部斜杠。

### 8.4 兼容性测试

- 为每个路由建立请求/响应快照测试。
- 使用无效 Token 验证 `403`。
- 验证 Floccus 指定的服务端根目录不存在时可逐级创建。
- 验证同 URL 多份书签不会互相覆盖。
- 验证跨 Collection 移动。
- 验证嵌套目录创建、改名、移动和删除。
- 验证超过单页数量后的 cursor 分页不会漏项或重复。
- 使用独立浏览器测试配置真实 Floccus 扩展，不能仅用 curl 证明兼容。

## 9. Web 管理 API

管理界面使用 `/api/app/v1/*`。核心单项 CRUD 可以复用 Linkwarden service，但管理 API 提供更适合批量操作的接口。

### 9.1 用户和工作区

```text
POST   /api/app/v1/auth/register
POST   /api/app/v1/auth/login
POST   /api/app/v1/auth/logout
GET    /api/app/v1/me
GET    /api/app/v1/tenants
POST   /api/app/v1/tenants
PUT    /api/app/v1/tenants/:id
POST   /api/app/v1/tenants/:id/select
GET    /api/app/v1/tenants/:id/members
POST   /api/app/v1/tenants/:id/members
PUT    /api/app/v1/tenants/:id/members/:user_id
DELETE /api/app/v1/tenants/:id/members/:user_id
```

### 9.2 书签、目录和标签

```text
GET    /api/app/v1/links
POST   /api/app/v1/links
GET    /api/app/v1/links/:id
PUT    /api/app/v1/links/:id
DELETE /api/app/v1/links/:id
POST   /api/app/v1/links/batch/move
POST   /api/app/v1/links/batch/tag
POST   /api/app/v1/links/batch/delete
POST   /api/app/v1/links/batch/restore

GET    /api/app/v1/collections/tree
POST   /api/app/v1/collections
PUT    /api/app/v1/collections/:id
DELETE /api/app/v1/collections/:id

GET    /api/app/v1/tags
POST   /api/app/v1/tags
PUT    /api/app/v1/tags/:id
DELETE /api/app/v1/tags/:id
```

批量移动、目录移动和导入必须使用事务。

### 9.3 Token 和会话

```text
GET    /api/app/v1/tokens
POST   /api/app/v1/tokens
DELETE /api/app/v1/tokens/:id
GET    /api/app/v1/sessions
DELETE /api/app/v1/sessions/:id
```

### 9.4 系统管理

```text
GET    /api/admin/v1/stats
GET    /api/admin/v1/users
PUT    /api/admin/v1/users/:id/status
GET    /api/admin/v1/tenants
GET    /api/admin/v1/health
```

系统管理接口使用单独的 middleware 和角色检查。

## 10. 管理前端

### 10.1 技术方案

- Vite + React + TypeScript。
- React Router。
- TanStack Query。
- Tailwind CSS。
- i18next。
- 复用 Linkwarden 的布局、主题、Sidebar、Modal、Drawer、LinkCard、Collection、Tag 和搜索组件。
- 移除 `next-auth`、`getServerSideProps`、Prisma、Next API Routes、`next/router` 和其他 Node 服务端依赖。

原则上逐个迁移并简化组件，不直接复制整个 Next.js 应用后再尝试静态导出。

### 10.2 页面

```text
/login
/register
/bookmarks
/collections/:id
/tags/:id
/search
/trash
/settings/profile
/settings/workspace
/settings/members
/settings/tokens
/settings/import-export
/settings/sync
/admin
```

### 10.3 书签工作台

- 左侧：工作区切换、Collection 树、标签和系统入口。
- 中间：书签列表或卡片视图。
- 右侧：书签详情和编辑抽屉。
- 支持新增、编辑、删除、恢复、搜索、筛选和多选。
- 支持拖拽移动书签和调整 Collection 层级。
- 拖拽完成后采用乐观更新；服务端失败必须回滚界面状态。
- 移动目录前后都要防止循环父子关系。

### 10.4 Floccus 引导

同步设置页提供：

- 创建专用 Access Token。
- 一键复制服务器地址和 Token。
- Floccus 中选择 Linkwarden 账户类型的配置说明。
- 建议将服务端目录设置为 `Floccus`。
- Token 权限、过期时间和最后使用时间。
- 常见错误说明：403、URL 重定向、反向代理、证书和同步根目录。

## 11. 导入与导出

### 11.1 导入格式

首版优先级：

1. Netscape Bookmark HTML，保留浏览器目录层级。
2. Linkwarden JSON。
3. CSV。
4. XBEL。

导入流程：

```text
上传 -> 格式识别 -> 解析预览 -> 选择目标目录
     -> 选择重复策略 -> 确认 -> 后台导入 -> 结果报告
```

重复策略：

- 跳过同 URL。
- 更新目标目录中的同 URL 记录。
- 保留副本。

导入安全要求：

- 限制上传体积、记录数、目录深度和单字段长度。
- 流式解析大文件，不能无上限读入内存。
- 拒绝危险 URL 或根据明确配置允许 `javascript:`、`file:` 等协议。
- 错误报告提供行号或书签路径，不包含敏感数据。

### 11.2 导出格式

- Bookmark HTML：用于浏览器重新导入，保留目录树。
- JSON：完整保留 UUID、Collection、Tag、描述和时间。
- CSV：便于表格处理。
- XBEL：用于通用书签工具。

导出范围：

- 整个工作区。
- 一个 Collection 及所有子目录。
- 当前搜索结果。
- 用户勾选的书签。

导出查询始终使用当前租户上下文。

## 12. 前端嵌入与运行部署

### 12.1 构建流程

```text
npm ci
npm run build
      |
      v
web/dist
      |
      v
cargo build --release
      |
      v
linkwarden 单二进制（包含 SPA）
```

- `build.rs` 检查前端产物是否存在，避免悄悄构建出不含前端的二进制。
- 开发模式下允许将 Vite dev server 代理到 Rust API。
- 发布构建使用锁定的 Node 和 Rust 依赖。

### 12.2 静态资源路由

- `/api/*` 永远不进入 SPA fallback。
- 已存在的静态文件返回正确 MIME、ETag 和缓存头。
- 带内容哈希的 JS/CSS 使用长期缓存。
- `index.html` 使用短缓存或 no-cache。
- React Router 深层路径返回 `index.html`。
- `/health/live` 和 `/health/ready` 单独处理。

### 12.3 数据目录

建议默认：

```text
data/
├── linkwarden.sqlite3
├── imports/
├── exports/
└── backups/
```

临时导入、导出文件定期清理。数据库、配置和备份不编入二进制。

## 13. 分阶段实施

### 阶段 0：契约冻结和工程骨架

任务：

- 初始化 Cargo workspace 和 Web 工程。
- 固定目标 Floccus 正式版本并保存 `LinkwardenAdapter` 的行为清单。
- 建立 CI：Rust fmt、clippy、test，前端 lint、typecheck、test、build。
- 建立统一错误 JSON、日志和配置加载。
- 添加 SQLite migration runner。

验收：

- Rust 服务可启动并执行 migration。
- `/health/live`、`/health/ready` 返回正确状态。
- 空 SPA 可以通过 Rust 服务访问。
- CI 在干净环境可重复构建。

### 阶段 1：用户、工作区和 Token

任务：

- 实现用户注册、登录、退出和 Session。
- 新用户自动创建个人工作区和 owner membership。
- 实现工作区创建、切换和基本权限 middleware。
- 实现 Access Token 创建、列出和撤销。
- 增加登录限流、密码哈希和 Cookie 安全设置。

验收：

- 两个租户的数据不能互相访问。
- Token 只显示一次且数据库中没有明文。
- 撤销 Token 后立即返回 403。
- 非 owner/admin 不能管理成员和 Token。

### 阶段 2：Collection 和 Link 核心服务

任务：

- 实现 Collection 树 CRUD 和循环检测。
- 实现 Link CRUD、移动、软删除和恢复。
- 实现 FTS5 搜索和 cursor 分页。
- 实现批量移动和批量删除事务。
- 增加 Tag CRUD。

验收：

- 支持多层目录。
- 支持相同 URL 的多个书签。
- Collection 和 Link 不能跨租户移动。
- 批量操作失败不会只提交一部分。
- 搜索分页无重复、无漏项。

### 阶段 3：Floccus 兼容层

任务：

- 实现全部 9 个 Linkwarden 兼容路由。
- 为请求体容忍 Floccus 携带的兼容字段。
- 固定 JSON 外形和认证状态码。
- 编写 API 契约测试。
- 准备真实浏览器测试环境。

验收：

- Floccus 可用 Access Token 连接。
- Floccus 可自动创建指定服务端根目录。
- 浏览器 A 新建、改名、移动、删除书签后可同步到服务端。
- 浏览器 B 能拉取相同目录树和书签。
- 浏览器 B 的修改能同步回浏览器 A。
- 两个租户使用不同 Token 时完全隔离。
- 进行破坏性同步测试前使用独立浏览器 profile。

### 阶段 4：管理前端 MVP

任务：

- 迁移 Linkwarden 主题、基础布局和通用组件。
- 实现登录、注册和工作区切换。
- 实现 Collection 树、书签列表/卡片和详情编辑。
- 实现搜索、标签、批量选择、移动、删除和回收站。
- 实现 Token 管理和 Floccus 配置引导。

验收：

- 用户可仅通过 Web 界面完成全部日常书签操作。
- 页面刷新和深层 URL 不返回 404。
- 桌面和移动布局可用。
- 键盘操作、焦点和表单错误提示满足基本无障碍要求。

### 阶段 5：导入和导出

任务：

- 实现 Bookmark HTML 导入和导出。
- 实现 JSON、CSV 和 XBEL。
- 实现解析预览、重复策略和导入结果报告。
- 实现导出范围选择。

验收：

- Chrome/Firefox 导出的 Bookmark HTML 能保留目录层级导入。
- 导出的 HTML 可重新导入浏览器。
- JSON 导出再导入后核心字段一致。
- 大文件不会导致无界内存增长。
- 导入失败可定位且不会破坏已有数据。

### 阶段 6：成员管理和系统后台

任务：

- 实现成员邀请或管理员添加、角色调整和移除。
- 实现工作区设置。
- 实现系统用户、租户和运行统计页面。
- 增加关键管理操作审计日志。

验收：

- 角色权限矩阵有完整测试。
- 删除成员不会删除其为工作区创建的书签。
- 唯一 owner 不能直接退出或被移除。
- 系统管理员接口不能被租户管理员调用。

### 阶段 7：发布和运维

任务：

- 实现 release 构建和前端嵌入检查。
- 提供 Dockerfile、systemd 示例和反向代理示例。
- 提供 migration、备份、恢复和升级文档。
- 增加结构化日志、请求 ID 和基础指标。
- 建立 SQLite 在线备份和恢复演练。

验收：

- 新机器使用一个二进制和数据目录即可运行。
- 离线启动不依赖 CDN 或 Node.js。
- 二进制中确实包含完整前端资源。
- 数据库升级前备份可恢复。
- 反向代理下 Cookie、Origin、HTTPS 和 Floccus 请求正常。

## 14. 测试策略

### 14.1 Rust 单元测试

- Collection 循环检测。
- 租户权限矩阵。
- Token 生成、哈希、过期和撤销。
- URL 和输入验证。
- cursor 编码与解析。
- 导入格式解析。

### 14.2 集成测试

- 每个测试使用独立临时 SQLite 数据库。
- migration 从空数据库完整执行。
- API 从 HTTP 层验证状态码、Header 和 JSON。
- 并发创建、移动和删除。
- 多租户越权 ID 测试。
- 软删除和恢复。
- 导入、导出 round trip。

### 14.3 前端测试

- 数据请求 hooks 和权限显示。
- Collection 树移动。
- 批量选择和移动。
- 导入预览与错误提示。
- Token 创建后的一次性显示。

### 14.4 端到端测试

- Web 注册、登录、创建 Token、创建目录和书签。
- 使用真实 Floccus 扩展完成双浏览器同步。
- 浏览器和 Web 双向修改。
- Token 撤销后 Floccus 明确提示认证失败。
- 备份、迁移、升级后重新同步不产生大规模误删。

## 15. 安全检查清单

- Argon2id 参数经过基准测试，既不能过弱也不能阻塞服务过久。
- Session 和 Access Token 使用 CSPRNG。
- Token、密码和 Cookie 不写日志。
- 登录和 Token API 有限流。
- 所有写操作验证角色和租户。
- 导入文件限制大小、深度、数量和格式。
- 导出文件路径不可由用户直接控制。
- API 错误不泄露数据库 SQL 和内部路径。
- 配置密钥支持环境变量或权限受限配置文件。
- 默认安全 Header、CORS 和反向代理信任边界明确。

## 16. 性能和容量边界

首版定位为单机个人和小团队服务：

- SQLite 单写者模型可以接受，但必须缩短写事务。
- Floccus 获取远端树时会读取全部 Collection 并分页读取全部 Link，应确保相应索引有效。
- 不在数据库事务中执行网络请求或大文件解析。
- 默认分页大小应稳定且可配置上限。
- 对大租户测试至少覆盖数万条书签和多层目录。
- 若未来需要多实例部署，再评估 PostgreSQL；首版不为尚未出现的横向扩展增加复杂度。

## 17. 关键风险与处理方式

| 风险 | 处理方式 |
| --- | --- |
| Floccus 上游改变 LinkwardenAdapter | 固定目标版本、保存契约测试、升级前对比适配器源码 |
| 错误同步导致大量删除 | 使用 Floccus failsafe、软删除、备份，并用独立浏览器 profile 做测试 |
| 跨租户数据泄露 | tenant-aware repository、复合条件更新、越权集成测试 |
| Collection 循环或孤儿 | 事务、父节点租户校验、循环检测和外键 |
| SQLite 写锁 | WAL、busy timeout、短事务、限制后台并发写入 |
| Next.js 前端难以直接静态化 | 迁移可复用组件到 Vite SPA，不保留 SSR/NextAuth/Prisma 依赖 |
| Linkwarden API 兼容漂移 | 只承诺 Floccus 所需子集，并在文档中注明目标 Floccus 版本 |
| 排列顺序无法同步 | Web 内部保留 position，但明确 Floccus Linkwarden 模式不保证顺序 |

## 18. 完成定义

首个稳定版本只有在以下条件全部满足后才算完成：

- Rust 单二进制包含管理前端，运行时不需要 Node.js。
- SQLite migration、备份和恢复经过验证。
- 多租户隔离和角色矩阵测试通过。
- Web 管理界面支持书签和目录的增删改、移动、搜索、回收站、导入和导出。
- Access Token 可创建、撤销并绑定指定工作区。
- 未修改的官方 Floccus 正式扩展可以连接服务。
- Chrome/Firefox 至少两个独立 profile 完成真实双向同步。
- 新增、改名、移动、删除和嵌套目录均通过同步验证。
- API 契约、Rust 测试、前端测试和构建全部通过。
- 文档明确说明备份、升级、Floccus 配置、限制和故障排查方式。

## 19. 实施顺序摘要

```text
工程骨架
  -> 用户/工作区/Token
  -> Collection/Link/搜索
  -> Floccus 兼容和真实双浏览器验证
  -> 管理前端
  -> 导入导出
  -> 成员与系统后台
  -> 发布、备份和运维
```

必须优先完成阶段 3 的真实 Floccus 验证，再继续扩展大量管理功能。核心同步契约如果存在偏差，应尽早暴露，而不是等完整前端完成后才发现。
