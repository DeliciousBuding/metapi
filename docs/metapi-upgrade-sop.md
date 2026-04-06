# Metapi Upgrade SOP

[返回文档中心](./README.md)

---

## 适用范围

本 SOP 面向当前这类“单台 Docker / Docker Compose 生产实例”的升级窗口，尤其适用于：

- 生产运行在 `sgp1`
- 公网入口由独立 `hk` 反向代理承接
- Metapi 使用官方镜像 `1467078763/metapi:latest`
- 稳态生产槽位固定在 `100.117.129.78:4000`
- 临时升级 canary 槽位固定在 `100.117.129.78:4001`
- 运行数据来自挂载的数据目录（例如 SQLite `hub.db`）

它不覆盖：

- K3s / Helm 更新中心流程
- Desktop 客户端自更新
- Render / Zeabur 这类托管平台的一键升级

## 核心原则

1. 不要原地覆盖唯一生产实例。
2. 不要把浮动 `latest` 当成“已锁定版本”。
3. 不要让两个活跃实例同时写同一份 SQLite 数据目录。
4. 不要在未准备回滚前切默认流量。
5. 不要在当前依赖 live Metapi 的会话里做最终 cutover。

## 当前标准拓扑

如果你的 live 环境不是这个形态，先不要直接套本 SOP：

- `sgp1`
  - 生产容器：`metapi`
  - 生产绑定：`100.117.129.78:4000:4000`
  - canary 绑定：`100.117.129.78:4001:4000`
  - 生产数据目录：`/opt/proxy-stack/sgp1-migration/data/metapi-live`
  - compose 文件：`/opt/proxy-stack/sgp1-migration/compose/docker-compose.metapi-official.yml`
- `hk`
  - 对外承接 `metapi.vectorcontrol.tech`
  - 对外承接 `api.vectorcontrol.tech`
  - 通过 `X-Metapi-Canary: 1` 做灰度分流

## 升级前必须确认的事实

### 1. 当前 live 到底在跑哪个镜像修订

先在 `sgp1` 上看 live 容器：

```bash
ssh sgp1 "sudo docker inspect metapi --format 'image={{.Config.Image}} revision={{index .Config.Labels \"org.opencontainers.image.revision\"}} network={{.HostConfig.NetworkMode}} status={{.State.Status}}'"
```

至少要确认：

- 镜像名
- revision label
- 网络模式
- 容器状态

### 2. 当前公开行为是否正常

从 `hk` 或其他稳定控制面检查：

```bash
curl -I https://api.vectorcontrol.tech/v1/models
curl -I https://metapi.vectorcontrol.tech/
```

典型预期：

- `/v1/models` 返回鉴权相关状态，例如 `401`
- Web UI 根路径按现网策略返回登录跳转或已登录页面

### 3. 目标版本是否已锁定

不要只说“升级到 latest”。至少要锁定其中之一：

- Git commit / release tag
- 镜像 digest
- 容器 label 里的 `org.opencontainers.image.revision`

示例：

```bash
git ls-remote https://github.com/cita-777/metapi.git refs/heads/main refs/tags/v1.3.0
ssh sgp1 "sudo docker pull 1467078763/metapi:latest"
ssh sgp1 "sudo docker image inspect 1467078763/metapi:latest --format '{{index .RepoDigests 0}} {{index .Config.Labels \"org.opencontainers.image.revision\"}}'"
```

## 升级前准备

### 1. 备份生产 compose 与灰度入口配置

```bash
ssh sgp1 'TS=$(date +%Y%m%d-%H%M%S); sudo mkdir -p /opt/proxy-stack/sgp1-migration/backup/$TS && sudo cp /opt/proxy-stack/sgp1-migration/compose/docker-compose.metapi-official.yml /opt/proxy-stack/sgp1-migration/backup/$TS/'
ssh hk 'TS=$(date +%Y%m%d-%H%M%S); sudo cp /etc/nginx/conf.d/metapi-slot-map.conf /etc/nginx/conf.d/metapi-slot-map.conf.bak-$TS'
```

如果你的 `hk` 配置还改动了站点文件，也要一并备份对应的 `sites-available/*.conf`。

### 2. 准备 canary 数据目录

前提：

- 当前生产使用 SQLite 或其他文件型数据目录
- canary 只读验证或短时灰度，不与生产共享写路径

做法：

```bash
ssh sgp1 'TS=$(date +%Y%m%d-%H%M%S); sudo rm -rf /opt/proxy-stack/sgp1-migration/data/metapi-canary-next && sudo mkdir -p /opt/proxy-stack/sgp1-migration/data && sudo cp -a /opt/proxy-stack/sgp1-migration/data/metapi-live /opt/proxy-stack/sgp1-migration/data/metapi-canary-next'
```

规则：

- 生产实例继续使用 `metapi-live`
- canary 实例使用 `metapi-canary-next`
- 绝不把两者都挂到同一个 live 数据目录

### 3. 准备 canary compose

推荐单独的 compose 文件，例如：

- `/opt/proxy-stack/sgp1-migration/compose/docker-compose.metapi-canary.yml`

最小形态：

```yaml
services:
  metapi-canary:
    image: 1467078763/metapi:latest
    container_name: metapi-canary
    restart: unless-stopped
    ports:
      - "100.117.129.78:4001:4000"
    environment:
      AUTH_TOKEN: ${AUTH_TOKEN}
      PROXY_TOKEN: ${PROXY_TOKEN}
      CHECKIN_CRON: "0 8 * * *"
      BALANCE_REFRESH_CRON: "0 * * * *"
      DATA_DIR: /app/data
      TZ: Asia/Shanghai
    volumes:
      - /opt/proxy-stack/sgp1-migration/data/metapi-canary-next:/app/data
```

### 4. 准备 `hk` 灰度分流

使用 slot map：

```nginx
map $http_x_metapi_canary $metapi_slot_upstream {
    default 100.117.129.78:4000;
    1       100.117.129.78:4001;
}
```

所有 Metapi 相关代理位置都应走：

```nginx
proxy_pass http://$metapi_slot_upstream;
```

至少覆盖：

- `/`
- `/api/`
- `/monitor-proxy/`
- `/v1/`

改完先执行：

```bash
ssh hk 'sudo nginx -t'
```

## Canary 启动与验证

### 1. 拉取目标镜像

```bash
ssh sgp1 'sudo docker pull 1467078763/metapi:latest'
ssh sgp1 "sudo docker image inspect 1467078763/metapi:latest --format '{{index .RepoDigests 0}} {{index .Config.Labels \"org.opencontainers.image.revision\"}}'"
```

把 digest 和 revision 记到变更记录里。

### 2. 启动 canary

```bash
ssh sgp1 'cd /opt/proxy-stack/sgp1-migration/compose && sudo docker compose --env-file .env.runtime -f docker-compose.metapi-canary.yml up -d'
```

### 3. 先做直连检查

```bash
ssh sgp1 'for u in http://100.117.129.78:4001/ http://100.117.129.78:4001/v1/models; do code=$(curl -sS -o /dev/null -w "%{http_code}" "$u" || true); echo "$code $u"; done'
```

典型预期：

- `/` 返回 `200`
- `/v1/models` 返回鉴权状态，例如 `401`

### 4. 再做灰度入口检查

```bash
curl -I https://metapi.vectorcontrol.tech/ -H 'X-Metapi-Canary: 1'
curl -I https://api.vectorcontrol.tech/v1/models -H 'X-Metapi-Canary: 1'
curl -I https://api.vectorcontrol.tech/api/accounts -H 'X-Metapi-Canary: 1'
curl -I https://api.vectorcontrol.tech/monitor-proxy/ -H 'X-Metapi-Canary: 1'
```

### 5. 做认证后的管理面检查

优先从 `sgp1` 本机或可信控制面直连 Tailnet 地址：

```bash
export METAPI_ADMIN_BASE_URL="http://100.117.129.78:4001"
export METAPI_AUTH_TOKEN="<AUTH_TOKEN>"

curl -sS "${METAPI_ADMIN_BASE_URL}/api/sites" -H "Authorization: Bearer ${METAPI_AUTH_TOKEN}" | head
curl -sS "${METAPI_ADMIN_BASE_URL}/api/accounts" -H "Authorization: Bearer ${METAPI_AUTH_TOKEN}" | head
curl -sS "${METAPI_ADMIN_BASE_URL}/api/routes" -H "Authorization: Bearer ${METAPI_AUTH_TOKEN}" | head
```

### 6. 做至少一次真实代理请求

```bash
curl https://api.vectorcontrol.tech/v1/responses \
  -H 'Authorization: Bearer <DOWNSTREAM_PROXY_TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'X-Metapi-Canary: 1' \
  -d '{"model":"gpt-5.4","input":"ping"}'
```

### 7. 看 canary 日志

```bash
ssh sgp1 'sudo docker logs --tail 100 metapi-canary'
```

确认：

- 请求确实命中 canary
- 没有明显启动错误
- 没有静态资源 / API 路径断裂

## 最终 cutover

最终 cutover 必须从独立控制面执行，且先准备回滚。

### 1. 回滚前置

至少准备好：

- `hk` 上的回滚 map 或完整 nginx 备份
- `nginx -t` 可通过的回滚命令
- 生产 `4000` 仍保持存活，直到 canary 通过

### 2. 默认流量切换

如果 canary 已稳定，保持 map 形态不变即可：

```nginx
map $http_x_metapi_canary $metapi_slot_upstream {
    default 100.117.129.78:4000;
    1       100.117.129.78:4001;
}
```

对于“用 canary 替换生产”的窗口，有两种方式，二选一：

- 方式 A：停旧生产，把新镜像重启到 `4000`
- 方式 B：在 `4001` 验证完成后，用同一目标镜像更新生产 compose，再重启生产槽位 `4000`

推荐方式 B，因为公开入口和默认 upstream 不用再改。

### 3. 生产更新

示例：

```bash
ssh sgp1 'cd /opt/proxy-stack/sgp1-migration/compose && sudo docker compose --env-file .env.runtime -f docker-compose.metapi-official.yml pull && sudo docker compose --env-file .env.runtime -f docker-compose.metapi-official.yml up -d'
```

更新后立即检查：

```bash
ssh sgp1 "sudo docker inspect metapi --format 'revision={{index .Config.Labels \"org.opencontainers.image.revision\"}} status={{.State.Status}}'"
curl -I https://api.vectorcontrol.tech/v1/models
curl -I https://metapi.vectorcontrol.tech/
```

### 4. 回滚条件

出现以下任一情况，直接回滚：

- Web UI 根路径异常
- `/api/*` 管理接口异常
- `/v1/models`、`/v1/responses` 异常
- 关键管理数据缺失
- canary 或正式生产日志出现持续性错误

## 回滚 SOP

### 1. 流量回滚

如果默认流量已经指向异常实例，先恢复 `hk` 的旧配置并 reload：

```bash
ssh hk 'sudo nginx -t && sudo systemctl reload nginx'
```

### 2. 容器回滚

如需回退生产容器：

```bash
ssh sgp1 'cd /opt/proxy-stack/sgp1-migration/compose && sudo docker compose --env-file .env.runtime -f docker-compose.metapi-official.yml up -d'
```

如果你是因为错误地替换了数据目录而回滚，则先恢复备份数据目录，再重启容器。

### 3. 回滚后复核

```bash
curl -I https://api.vectorcontrol.tech/v1/models
curl -I https://metapi.vectorcontrol.tech/
ssh sgp1 'sudo docker logs --tail 50 metapi'
```

## 升级完成后要记录什么

每次升级完成后至少记录：

- 升级时间
- 操作人 / 控制面
- 旧 revision / 新 revision
- 目标 tag / digest
- 是否使用了 canary
- 数据目录来源
- 验证命令与结果
- 是否发生回滚

## 常见错误

### 1. 直接 `docker compose pull && up -d`

问题：

- 你不知道拉到的是哪个 revision
- 没有 canary
- 没有回滚演练

### 2. 让 canary 和生产共用一个 SQLite 目录

问题：

- 运行时写入互相污染
- 出问题后无法判断数据漂移来源

### 3. 只验证 `/`

问题：

- Web UI 能打开，不代表 `/api/*`、`/v1/*` 都正常

### 4. 在依赖当前 live Metapi 的会话里直接切流

问题：

- 一旦切坏，控制链也可能一起断

## 关联文档

- [部署指南](./deployment.md)
- [运维手册](./operations.md)
- [管理 API](./management-api.md)
