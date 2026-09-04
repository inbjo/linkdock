# Floccus LinkwardenAdapter 行为契约

## 目标版本

- **Floccus**: v5.9.2 (发布于 2026-06-21)
- **源码**: https://github.com/floccusaddon/floccus/blob/v5.9.2/src/lib/adapters/Linkwarden.ts
- **适配器引入版本**: floccus v5.3.0

## 1. 认证

- 请求头: `Authorization: Bearer <token>`，其中 `<token>` 是用户在 Linkdock 创建的 Access Token（floccus 配置中的 `password` 字段）。
- 浏览器环境: HTTP `403` → `AuthenticationError`；`>= 400` 或 `503` → `HttpError`。
- Native 环境: HTTP `401` 或 `403` → `AuthenticationError`；`>= 400` 或 `503` → `HttpError`。
- **结论**: 无效 Token 必须返回 `403`（浏览器路径），以便 Floccus 抛出认证错误。

## 2. 重定向

- 默认 `allowRedirects = false`，任何重定向（浏览器 `res.redirected`，native `3xx`）→ `RedirectError`。
- 反向代理必须由代理层终止 HTTPS，后端不应发出 3xx。

## 3. 路由与 JSON 外形

### 3.1 GET /api/v1/search

- 查询参数: `searchQueryString`（可为空字符串）、`cursor`（可选）。
- 响应:
```json
{
  "data": {
    "links": [
      { "id": 10, "name": "Rust", "url": "https://...", "collectionId": 1 }
    ],
    "nextCursor": null
  }
}
```
- `nextCursor` 为 `null` 表示最后一页；否则继续用该值请求。
- Floccus 会循环分页直到 `nextCursor` 为 null，拉取全部书签。

### 3.2 GET /api/v1/collections

- 响应:
```json
{
  "response": [
    { "id": 1, "name": "Floccus", "parentId": null, "ownerId": 1 }
  ]
}
```
- 返回当前 Token 绑定租户的全部有效 Collection。

### 3.3 GET /api/v1/collections/:id

- 响应:
```json
{
  "response": { "id": 1, "name": "Floccus", "parentId": null, "ownerId": 1 }
}
```
- 用于 `updateBookmark` / `updateFolder` 前获取完整 Collection 信息。

### 3.4 POST /api/v1/collections

- 请求体: `{ "name": "Floccus", "parentId": null }`
- 响应: `{ "response": { "id": 1, "name": "Floccus", "parentId": null, "ownerId": 1 } }`
- Floccus 用返回的 `id` 作为新文件夹的 server id。

### 3.5 PUT /api/v1/collections/:id

- 请求体: `{ ...原collection, "name": "新名", "parentId": 新父id }`
- Floccus 先 GET 单项再合并字段后 PUT。
- 响应: `{ "response": { ... } }`

### 3.6 DELETE /api/v1/collections/:id

- Floccus `removeFolder` 重试最多 3 次；`401` 视为成功（已删除）。
- 其他 `>= 400`（非 401）重试 3 次后抛出。
- **结论**: 删除已不存在的 Collection 应返回 `401` 或 `204`/`200`，保持幂等。

### 3.7 POST /api/v1/links

- 请求体:
```json
{
  "url": "https://...",
  "name": "标题",
  "collection": { "id": 1 }
}
```
- 响应: `{ "response": { "id": 10, "name": "标题", "url": "https://...", "collectionId": 1 } }`
- Floccus 用返回的 `id` 作为新书签的 server id。

### 3.8 PUT /api/v1/links/:id

- Floccus 先 `GET /api/v1/collections/:parentId` 取 collection，再发送:
```json
{
  "id": 10,
  "url": "https://...",
  "name": "标题",
  "tags": [],
  "collection": { "id": 1, "name": "Floccus", "ownerId": 1 }
}
```
- 响应: `{ "response": { "id": 10, ... } }`
- 不认识但无害的兼容字段应忽略。

### 3.9 DELETE /api/v1/links/:id

- Floccus `removeBookmark`: `404`、`401`、`403` 视为成功（已删除/无权）。
- 其他 `>= 400` 抛 `HttpError`。
- **结论**: 删除已不存在的 Link 应返回 `404` 或 `204`/`200`，保持幂等。

## 4. getBookmarksTree 行为

1. 分页拉取全部 Link（`searchQueryString=''`，循环直到 `nextCursor == null`）。
2. 拉取全部 Collection。
3. 查找 `name === serverFolder && parentId == null` 的根 Collection。
   - 注意: `parentId == null` 是松散比较，`null` 和 `undefined` 都匹配。
4. 若不存在，`POST /api/v1/collections { name: serverFolder }` 创建。
5. 递归构建树:
   - 子 Collection: `String(col.parentId) === String(parent.id)`
   - 书签: `String(link.collectionId) === String(collection.id)`
   - **ID 比较使用字符串**，所以 ID 必须是 JSON number 但比较时转为 string。

## 5. 能力声明

- `preserveOrder: false` — Floccus Linkwarden 模式不保证书签顺序同步。
- `isAtomic: false`
- `acceptsBookmark`: 接受 `http:`、`https:`、`ftp:`、`javascript:` 协议。

## 6. CORS / 预检

- Floccus 是浏览器扩展，会从 `moz-extension://` 或 `chrome-extension://` origin 发起请求。
- 服务端必须处理 `OPTIONS` 预检并返回允许的 CORS 头。
- `Authorization` 头会触发预检，需在 `Access-Control-Allow-Headers` 中允许。

## 7. 兼容性测试要点

- 无效 Token → `403`。
- 服务端根目录不存在时自动创建。
- 同 URL 多份书签不互相覆盖。
- 跨 Collection 移动。
- 嵌套目录创建、改名、移动、删除。
- cursor 分页无漏项无重复。
- 删除幂等（404/401/403 不报错）。
