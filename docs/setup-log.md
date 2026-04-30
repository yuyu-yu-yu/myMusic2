# myMusic 配置记录

## 项目简介

myMusic = 本地 AI 音乐电台（PWA），读取你的网易云曲库，DeepSeek 做 AI DJ 推荐和串场。

## 已配置的服务

| 服务 | 配置项 | 状态 |
|---|---|---|
| DeepSeek LLM | `LLM_BASE_URL=https://api.deepseek.com` | ✅ |
| DeepSeek LLM | `LLM_MODEL=deepseek-chat` | ✅ |
| 网易云 OpenAPI | `NETEASE_APP_ID=b3010d...` | ✅ |
| 网易云 OpenAPI | `NETEASE_APP_SECRET=de63...` | ✅ |
| 网易云 OpenAPI | `NETEASE_PRIVATE_KEY=MIIE...` | ✅ |
| TTS | 未配置，浏览器语音合成兜底 | — |
| 天气 | 未配置 | — |

## 启动

```powershell
cd C:\myMusic2
npm run dev
```

打开 `http://127.0.0.1:3000`

---

## 网易云登录（重点）

### 背景

网易云 OpenAPI 要求每个请求携带**设备参数**（`channel`、`os`、`brand`、`deviceType`），这些值不是随便填的，必须和你的 AppID 绑定，由网易云后台分配。

文档里给出的 `hm`、`didi`、`iotapitest` 等示例值对普通开发者 app **无效**。

### 解决方案：利用 ncm-cli

**ncm-cli**（`@music163/ncm-cli`）是网易云官方的命令行工具，它已经内置了合法的设备参数（`channel=ncmcli`、`os=ncmcli`、`brand=ncmcli`）。

```powershell
# 1. 安装
npm install -g @music163/ncm-cli

# 2. 配置凭证
ncm-cli config set appId <你的AppID>
ncm-cli config set privateKey <你的私钥>

# 3. 扫码登录
ncm-cli login
# → 终端输出一个 163cn.tv 短链接，用网易云 App 打开扫码即可
```

扫码成功后，ncm-cli 把 token 加密保存在 `~/.config/ncm-cli/` 目录。

### 如何把 token 搬到 myMusic

ncm-cli 的 token 是 AES 加密的，直接读不出来。实际做法是：

1. 用 Node.js 脚本拦截 ncm-cli 发出的 HTTP 请求
2. 从请求头中提取明文 `accessToken`
3. 把 token 写入 myMusic 的 SQLite 数据库

> 具体脚本见项目根目录的 `capture.js`

### 当前状态

Token 已经写入数据库，服务器启动时自动加载，重启不丢。Token 有效期 7 天，代码里有自动续期逻辑。

> 如果将来 token 过期，需要重新打开 ncm-cli 扫码，再用 `capture.js` 抓取新 token 注入。

---

## 本次改动的文件

| 文件 | 改动内容 |
|---|---|
| `.env.local` | DeepSeek + 网易云凭证 + 设备参数（ncmcli） |
| `server/config.mjs` | 公开配置状态接口增加 `neteaseToken` |
| `server/db.mjs` | 增加 `getSetting`/`setSetting`，token 持久化到 settings 表 |
| `server/netease.mjs` | 增加 `setTokens`/`hasToken`/`anonymousLogin`；token 过期自动续期重试；调试日志 |
| `server/index.mjs` | 启动时从 DB 加载 token；QR 扫码轮询+保存；token 续期接口 |
| `server/library.mjs` | 曲库数量展示上限提高到 5000；增加 `totalTracks` 真实总数 |
| `public/app.js` | 设置页：扫码登录+轮询+状态反馈；曲库展示真实总数 |
| `public/styles.css` | QR 登录区域样式 |
| `capture.js` | 抓包脚本，拦截 ncm-cli 的 HTTP 请求提取 device params 和 token |

## Token 生命周期

```
ncm-cli 扫码 → token 被抓取 → 注入 myMusic SQLite
                                    ↓
                              每次启动自动加载
                                    ↓
                              7天内到期自动续期
```

## 已知限制

- TTS 未配置，使用浏览器内置语音合成（Windows 自带中文语音）
- 天气未配置，AI 推荐不包含天气维度
- 如果 token 续期失败，需要重新用 ncm-cli 扫码
## 2026-04-30 TTS 与天气接入

- TTS 默认 provider 已切到 `volcengine`，使用火山/豆包 HTTP 一次性合成接口：`https://openspeech.bytedance.com/api/v1/tts`。
- `.env.local` 只预设非密钥项：`TTS_PROVIDER=volcengine`、`VOLCENGINE_TTS_CLUSTER=volcano_tts`、`VOLCENGINE_TTS_ENDPOINT=...`；真实 `VOLCENGINE_TTS_APP_ID`、`VOLCENGINE_TTS_ACCESS_TOKEN`、`VOLCENGINE_TTS_VOICE_TYPE` 需要本机填写。
- 天气默认使用 Open-Meteo 免 Key：`WEATHER_PROVIDER=openmeteo`、`WEATHER_CITY=上海`、`WEATHER_COUNTRY_CODE=CN`。
- 电台主持人 prompt 现在明确包含当前小时、实时天气摘要、用户对话、音乐画像和即将播放歌曲。
- TTS 或天气请求失败不会中断电台流程；TTS 回退到浏览器语音合成，天气回退到带错误原因的中文摘要。
