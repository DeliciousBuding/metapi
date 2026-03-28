# 管理 API（脚本化管理）

本文档面向需要用 `curl`、Shell、CI 或其他脚本直接管理 Metapi 的场景。

当前实现里，Web 管理后台调用的也是这一组 `/api/*` 接口；目前没有单独维护一套“公开版 admin SDK”或独立版本化的管理 API。因此，脚本接入前应先按本文档核对当前请求体和返回体。

## 前置条件

- 管理接口默认基址：`http://127.0.0.1:4000`
- 所有受保护的 `/api/*` 接口都需要：
  - `Authorization: Bearer <AUTH_TOKEN>`
  - `Content-Type: application/json`
- 如果你配置了 `admin_ip_allowlist`，请求来源 IP 还必须在白名单中

推荐先设置环境变量：

```bash
export METAPI_BASE_URL="http://127.0.0.1:4000"
export AUTH_TOKEN="your-admin-token"
```

后续示例默认复用这两个变量：

```bash
curl -sS "$METAPI_BASE_URL/api/sites" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json"
```

## 认证与通用错误

如果没有携带管理员令牌，会返回：

```json
{
  "error": "Missing Authorization header"
}
```

如果令牌错误，会返回：

```json
{
  "error": "Invalid token"
}
```

如果开启了管理端 IP 白名单且当前来源 IP 不在白名单中，会返回：

```json
{
  "error": "IP not allowed"
}
```

## 当前适合脚本化管理的接口

下表只列出当前代码里已经实现、且对脚本管理最直接的一组接口。

| 场景 | 方法 | 路径 |
| --- | --- | --- |
| 列出站点 | `GET` | `/api/sites` |
| 检测站点平台 | `POST` | `/api/sites/detect` |
| 创建站点 | `POST` | `/api/sites` |
| 更新站点 | `PUT` | `/api/sites/:id` |
| 删除站点 | `DELETE` | `/api/sites/:id` |
| 查看站点禁用模型 | `GET` | `/api/sites/:id/disabled-models` |
| 更新站点禁用模型 | `PUT` | `/api/sites/:id/disabled-models` |
| 查看站点可用模型 | `GET` | `/api/sites/:id/available-models` |
| 列出账号/连接 | `GET` | `/api/accounts` |
| 账号密码登录并自动建连接 | `POST` | `/api/accounts/login` |
| 验证 Token / API Key | `POST` | `/api/accounts/verify-token` |
| 手动创建连接 | `POST` | `/api/accounts` |
| 更新连接 | `PUT` | `/api/accounts/:id` |
| 删除连接 | `DELETE` | `/api/accounts/:id` |
| 重新绑定 Session | `POST` | `/api/accounts/:id/rebind-session` |
| 刷新余额 | `POST` | `/api/accounts/:id/balance` |
| 获取连接模型 | `GET` | `/api/accounts/:id/models` |
| 补充手动模型 | `POST` | `/api/accounts/:id/models/manual` |
| 刷新连接健康状态 | `POST` | `/api/accounts/health/refresh` |

## 常用流程

### 1. 检测站点平台

在不知道平台类型时，先调用检测接口：

```bash
curl -sS "$METAPI_BASE_URL/api/sites/detect" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example-newapi.com"
  }'
```

成功时返回：

```json
{
  "url": "https://example-newapi.com",
  "platform": "new-api"
}
```

无法识别时返回：

```json
{
  "error": "Could not detect platform"
}
```

说明：

- 返回结果会去掉 URL 结尾多余的 `/`
- 如果站点被防护页、跳转链或自定义入口干扰，检测可能失败，此时请在建站时手动指定 `platform`

### 2. 创建站点

最常见的建站请求如下：

```bash
curl -sS "$METAPI_BASE_URL/api/sites" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Example New API",
    "url": "https://example-newapi.com",
    "platform": "new-api",
    "useSystemProxy": false,
    "status": "active",
    "globalWeight": 1
  }'
```

返回值是新创建的站点记录本身：

```json
{
  "id": 12,
  "name": "Example New API",
  "url": "https://example-newapi.com",
  "externalCheckinUrl": null,
  "platform": "new-api",
  "proxyUrl": null,
  "useSystemProxy": false,
  "customHeaders": null,
  "status": "active",
  "isPinned": false,
  "sortOrder": 11,
  "globalWeight": 1,
  "apiKey": null,
  "createdAt": "2026-03-29 09:12:33",
  "updatedAt": "2026-03-29 09:12:33"
}
```

如果你希望让服务端自动探测平台，可以省略 `platform`：

```bash
curl -sS "$METAPI_BASE_URL/api/sites" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Auto Detect Site",
    "url": "https://example-oneapi.com"
  }'
```

常用字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 站点显示名称 |
| `url` | 是 | 站点根地址，服务端会去掉末尾 `/` |
| `platform` | 否 | 未传时服务端会尝试自动检测 |
| `proxyUrl` | 否 | 站点级代理，支持 `http(s)` 或 `socks` |
| `useSystemProxy` | 否 | 是否继承系统代理 |
| `customHeaders` | 否 | 额外请求头，使用 JSON 字符串 |
| `externalCheckinUrl` | 否 | 外部签到地址，必须为 `http(s)` |
| `status` | 否 | `active` 或 `disabled` |
| `isPinned` | 否 | 是否置顶 |
| `sortOrder` | 否 | 非负整数 |
| `globalWeight` | 否 | 正数，服务端会归一到合理范围 |

重复绑定同一 `platform + url` 时会返回 `409`：

```json
{
  "error": "A new-api site with URL https://example-newapi.com already exists."
}
```

如果请求字段不合法，会返回 `400`，例如：

```json
{
  "error": "Invalid proxyUrl. Expected a valid http(s)/socks proxy URL."
}
```

### 3. 验证 Token / API Key

在手动创建连接前，推荐先单独调用验证接口，确认凭证到底是 Session Token 还是 API Key。

#### 3.1 验证 Session Token

```bash
curl -sS "$METAPI_BASE_URL/api/accounts/verify-token" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": 12,
    "accessToken": "session=eyJhbGciOi...",
    "credentialMode": "session"
  }'
```

成功时返回：

```json
{
  "success": true,
  "tokenType": "session",
  "userInfo": {
    "id": 10001,
    "username": "alice@example.com"
  },
  "balance": 42.5,
  "apiToken": "sk-upstream-managed-token"
}
```

#### 3.2 验证 API Key

```bash
curl -sS "$METAPI_BASE_URL/api/accounts/verify-token" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": 12,
    "accessToken": "sk-site-api-key",
    "credentialMode": "apikey"
  }'
```

成功时返回：

```json
{
  "success": true,
  "tokenType": "apikey",
  "modelCount": 3,
  "models": [
    "gpt-4.1",
    "gpt-4o-mini",
    "claude-3-7-sonnet"
  ]
}
```

#### 3.3 常见失败返回

站点要求额外填写用户 ID 时：

```json
{
  "success": false,
  "needsUserId": true,
  "message": "This site requires a user ID. Please fill in your site user ID."
}
```

传入的用户 ID 与 Token 不匹配时：

```json
{
  "success": false,
  "invalidUserId": true,
  "message": "The provided user ID does not match this token. Please check your site user ID."
}
```

上游被防护页拦截、建议改走 API Key 时：

```json
{
  "success": false,
  "shieldBlocked": true,
  "message": "This site is shielded by anti-bot challenge. Create an API key on the target site and import that key."
}
```

如果把 API Key 当成 Session Token 来验，会收到：

```json
{
  "success": false,
  "message": "当前凭证是 API Key，请切换到 API Key 模式，或改用 Session Token"
}
```

### 4. 手动创建连接

验证通过后，可以直接创建连接。

#### 4.1 用 Session Token 创建

```bash
curl -sS "$METAPI_BASE_URL/api/accounts" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": 12,
    "username": "alice@example.com",
    "accessToken": "session=eyJhbGciOi...",
    "credentialMode": "session",
    "checkinEnabled": true
  }'
```

成功时返回新建连接，以及后台初始化任务状态。典型响应字段如下：

```json
{
  "id": 31,
  "siteId": 12,
  "username": "alice@example.com",
  "status": "active",
  "checkinEnabled": true,
  "tokenType": "session",
  "credentialMode": "session",
  "apiTokenFound": true,
  "usernameDetected": false,
  "queued": true,
  "jobId": "<background-task-id>",
  "message": "账号已添加，后台正在同步令牌、余额和模型信息。"
}
```

#### 4.2 用 API Key 创建

```bash
curl -sS "$METAPI_BASE_URL/api/accounts" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": 12,
    "accessToken": "sk-site-api-key",
    "credentialMode": "apikey"
  }'
```

如果 API Key 校验成功，返回体同样会包含连接记录，并带上：

- `tokenType: "apikey"`
- `credentialMode: "apikey"`
- `modelCount`
- `apiTokenFound`

如果你明确知道这是 API Key，且暂时不想在创建时拉模型，可以加上：

```json
{
  "skipModelFetch": true
}
```

### 5. 用账号密码登录并自动建连接

对于支持账号密码登录的平台，可以直接调用：

```bash
curl -sS "$METAPI_BASE_URL/api/accounts/login" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": 12,
    "username": "alice@example.com",
    "password": "your-password"
  }'
```

成功时返回：

```json
{
  "success": true,
  "account": {
    "id": 31,
    "siteId": 12,
    "username": "alice@example.com"
  },
  "apiTokenFound": true,
  "tokenCount": 2,
  "reusedAccount": false
}
```

如果登录被站点防护拦截，可能返回：

```json
{
  "success": false,
  "shieldBlocked": true,
  "message": "This site is shielded by anti-bot challenge. Account/password login is blocked. Create an API key on the target site and import that key."
}
```

## 常见脚本组合

### 先探测再建站

```bash
SITE_URL="https://example-newapi.com"
DETECTED_PLATFORM="$(curl -sS "$METAPI_BASE_URL/api/sites/detect" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$SITE_URL\"}" | jq -r '.platform // empty')"

curl -sS "$METAPI_BASE_URL/api/sites" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Example Site\",
    \"url\": \"$SITE_URL\",
    \"platform\": \"$DETECTED_PLATFORM\"
  }"
```

### 先验证再建连接

```bash
curl -sS "$METAPI_BASE_URL/api/accounts/verify-token" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": 12,
    "accessToken": "session=eyJhbGciOi...",
    "credentialMode": "session"
  }'

curl -sS "$METAPI_BASE_URL/api/accounts" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": 12,
    "username": "alice@example.com",
    "accessToken": "session=eyJhbGciOi...",
    "credentialMode": "session"
  }'
```

## 维护说明

- 本文档只描述当前代码里已实现的管理接口，不承诺独立于实现长期冻结不变。
- 如果你需要长期维护自动化脚本，建议在升级 Metapi 后先重新验证 `site detect -> create site -> verify token -> create account` 这条链路。
- 如果后续新增了真正面向外部的稳定管理 API，应单独开文档页，不要继续把 UI 私有约定直接混进这里。
