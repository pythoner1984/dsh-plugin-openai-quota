# dsh-plugin-openai-quota

[English](README.md) · **简体中文** · [更新日志](CHANGELOG.md) · [问题反馈](https://github.com/pythoner1984/dsh-plugin-openai-quota/issues)

给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）用的一行额度提示。贴在 Web UI 顶部边缘，不弹面板、不需要点击展开：

```
DeepSeek余额：65.2元 | OpenAI额度26%（80%） 重置时间：12:10（11月7日） | 重置卡：1张 11月7日 05:23到期
```

数据全部来自你已经登录的账号，插件不创建、不复制、不保存任何 API key。

## 显示什么

| 片段 | 来源 | 说明 |
| --- | --- | --- |
| DeepSeek 余额 | DSH `deepseekAccount.getBalance()` | 人民币钱包，保留一位小数 |
| OpenAI 当前额度 + 重置时间 | `GET https://chatgpt.com/backend-api/wham/usage` → `rate_limit.primary_window` | 5 小时窗口剩余百分比，重置时间 `HH:mm` |
| OpenAI 周额度 + 周重置 | 同一响应 → `rate_limit.secondary_window` | 每周窗口剩余百分比与重置日期 |
| 重置卡 | `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` | 状态为 `available` 且套餐支持的卡里最近的一张到期时间 |

点击「重置卡」片段会用系统默认浏览器打开 ChatGPT 使用情况页。插件只做**提示**，不会替你消耗重置卡。

## 工作原理

- **Host 半（`index.js`）**从 DSH 凭据库读取已有的 ChatGPT OAuth 授权（`llm-pi-ai/openai-codex`），调用两个 `chatgpt.com/backend-api/wham/*` 接口，通过官方 `deepseekAccount` 服务读取余额，并注册四个需鉴权的路由。
- **Client 半（`client.js`）**在 `shell.overlay` 注册一个条目（`id: openai-quota`，`order: 600`），拉取 `/openai-quota/summary`，渲染一条固定、可穿透点击、不可交互的状态行。每 15 分钟刷新一次，页面重新可见时立即刷新。

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `/openai-quota/summary` | GET | 提示行需要的全部数据 |
| `/openai-quota/usage` | GET | 仅额度窗口原始数据 |
| `/openai-quota/health` | GET | 脱敏自检（见「排查」） |
| `/openai-quota/reset-card/open` | POST | 用默认浏览器打开使用情况页 |

## 环境要求

- 带 Web UI 的 DeepSeek Harness（桌面应用或 `dsh web`）。
- DSH 里已经配置好的 ChatGPT / Codex 登录 —— OpenAI 额度就来自它。
- 可选：已登录的 DeepSeek 账号用于余额片段；没有时余额显示为 `—`。

## 安装

先把仓库克隆到一个固定位置，再用 DSH 插件管理器安装本地 bundle：

```bash
git clone https://github.com/pythoner1984/dsh-plugin-openai-quota.git
```

```
plugin_manager install_bundle   target: <克隆目录绝对路径>
```

`git pull` 之后重新安装一次 bundle（或重启 DSH）才会加载新代码。

或者写进自己的 Cordis 组合：

```yaml
- insert:
    - id: openai-quota
      name: 'dsh-plugin-openai-quota'
```

卸载 bundle 即移除该浮层条目，不残留状态。

## 配置

没有配置项。刷新间隔、时区（`Asia/Shanghai`）和目标 URL 都是常量，插件无法被指向别的主机，也不会变成开放重定向。需要别的行为请 fork。

## 安全与隐私

- **永远不需要 admin key。** 复用 DSH 已持有的 OAuth 授权，从不索取 `sk-…`。
- **凭据只留在 Host 端。** 浏览器只会拿到百分比、时间戳和卡数量，access token 不离开 Host 进程。
- **所有路由都在本地信任检查之后**，且失败关闭：没有 connection 服务 → `503 local-auth-unavailable`，被拒绝 → `401/403`，守卫抛异常 → `403 local-auth-failed`。
- **逐路由方法白名单**，浏览器 `GET` 无法触发打开动作（`405 method-not-allowed`）。
- **请求内容不会进入浏览器命令。** URL 是 Host 常量，作为独立参数传给 `spawn`，请求里的任何内容都不会拼进命令行。
- **上游数据最小化。** 账号邮箱、套餐类型、额度明细在 Host 端就被丢弃，不会返回给浏览器。

## 已知限制

- `chatgpt.com/backend-api/wham/*` 是 ChatGPT 网页版的内部接口，可能随时变化或下线；届时提示行降级成 `—` / `暂不可用`，不会把 UI 弄坏。
- **桌面应用**里，外壳会把 `window.open` 交给系统默认浏览器并且不返回窗口句柄，因此使用情况页只能停在顶部，无法自动滚到「使用限额重置」区块。当 GUI 跑在真实浏览器标签页里时，插件会用文本片段指令重新导航该标签页，可以精确落在重置卡区块。
- 重置时间固定按 `Asia/Shanghai` 渲染，不随机器时区变化。
- 额度窗口按 ChatGPT 自己的标签解释（`primary_window` = 5 小时，`secondary_window` = 每周）。如果你的套餐暴露别的窗口，文案会跟着数据走。

## 排查

`GET /openai-quota/health` 返回脱敏快照：

```json
{
  "ok": true,
  "plugin": "dsh-plugin-openai-quota",
  "version": "1.8.0",
  "routes": { "usage": true, "summary": true, "health": true, "openResetCard": true },
  "credentialConfigured": true,
  "openaiReachable": true,
  "usageError": null,
  "windows": { "primary_window": true, "secondary_window": true },
  "resetCredits": { "status": "ready", "count": 1, "nextExpiresAt": "2026-11-06T21:23:57.312Z" }
}
```

| 现象 | 含义 |
| --- | --- |
| `credentialConfigured: false` | 没找到 `llm-pi-ai/openai-codex` 的登录凭据，先在 DSH 里登录 ChatGPT |
| `usageError: "upstream-http"` + `upstreamStatus: 401` | OAuth 授权过期，重新登录 |
| `usageError: "upstream-unreachable"` | 网络/代理挡住了 `chatgpt.com` |
| `windows.primary_window: false` | 上游响应结构变了，提示行显示 `—` |
| 提示行显示 `读取失败` | summary 路由失败，或浏览器丢了本地鉴权 cookie |
| 点重置卡没反应 | 提示行压在桌面窗口拖拽条上；链接已设置 `-webkit-app-region: no-drag`，仍失败请带 DSH 版本提 issue |

## 开发

```bash
npm test        # node --test，两半共 22 项断言
```

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：凭据、上游请求、路由、打开浏览器 |
| `client.js` | Client 半：浮层注册、渲染、轮询、打开浏览器 |
| `host.test.mjs` | 路由注册与回滚、信任检查、重置卡解析、打开命令参数 |
| `client.test.mjs` | 各渲染状态、重置卡文案、浏览器与桌面外壳下的点击行为 |
| `cordis.patch.yml` | 插入插件的组合补丁 |
| `locale/{zh,en}.json` | 插件管理器元数据 |

Client 半是包在 `window.__ModuleLoader__.load` 里的普通 ESM；测试用 `new Function` 加假 React 直接加载，不需要打包器。

## 许可

MIT，见 [LICENSE](LICENSE)。非官方项目，与 OpenAI、DeepSeek 无关，使用风险自负。
