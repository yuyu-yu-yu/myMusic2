# myMusic 播放架构

## 整体流程

```
用户输入（"富士山下" / "安静的歌" / 不输入）
    │
    ▼
┌──────────────────────────────────────────────────┐
│                  选歌（radio.mjs）                 │
│                                                    │
│  本地曲库文本搜索（歌名/艺人/专辑）                   │
│       ↓ 没找到                                      │
│  社区 API 在线搜索（NeteaseCloudMusicApi）           │
│       ↓ 返回结果                                    │
│  DeepSeek LLM 从 40 首候选中精确匹配                 │
│       ↓                                            │
│  自动跳过不可播歌曲（最多 10 次）                     │
└──────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────┐
│            获取播放链接（library.mjs）              │
│                                                    │
│  优先：社区 API song_url_v1（MUSIC_U cookie）       │
│        → exhigh 品质，VIP 歌也能播                   │
│       ↓ 失败                                       │
│  备选：OpenAPI playUrl（320→128→96 逐级降）          │
└──────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────┐
│              AI 主持词（radio.mjs）                 │
│                                                    │
│  DeepSeek LLM 生成 40 字内串场词                    │
│  → 火山引擎 TTS / 浏览器语音合成播报                 │
│  → 用户点的歌没找到？主持词不再乱提                    │
└──────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────┐
│              播放（public/app.js）                  │
│                                                    │
│  playUrl 存在 → 浏览器 <audio> 直接播               │
│  playUrl 不存在 → ncm-cli + mpv 降级播放             │
└──────────────────────────────────────────────────┘
```

## 服务架构

```
npm run dev
    │
    ├── 社区 API（NeteaseCloudMusicApi）
    │   └── localhost:4000
    │       ├── 内部使用 song_url_v1 模块获取播放链接
    │       └── 用 MUSIC_U cookie 鉴权（VIP 权限）
    │
    └── myMusic（主服务）
        └── localhost:3000
            ├── 选歌、AI 主持、数据库
            └── 启动时加载 cookie（netease_cookie.txt）
```

## 认证体系

| 用途 | 方式 | 存储位置 |
|---|---|---|
| 网易云曲库同步 | OpenAPI accessToken（从 ncm-cli 偷的） | SQLite settings 表 |
| VIP 歌曲播放链接 | MUSIC_U cookie（浏览器 F12 拿的） | `netease_cookie.txt` |
| AI 主持词 | DeepSeek API Key | `.env.local` |

## Cookie 获取方式

1. 浏览器打开 `music.163.com` 并登录
2. F12 → Application → Cookies → music.163.com
3. 找到 `MUSIC_U`，复制完整值
4. 写入项目根目录 `netease_cookie.txt`，格式：
   ```
   MUSIC_U=你的值; __remember_me=true
   ```

## 关键文件

| 文件 | 作用 |
|---|---|
| `server/community.mjs` | 社区 API 封装：获取播放链接、在线搜索、歌词 |
| `server/radio.mjs` | 电台核心：选歌逻辑、LLM 匹配、主持词生成 |
| `server/library.mjs` | 曲库：同步、画像、播放链接解析 |
| `server/ai.mjs` | AI 服务：LLM、TTS（火山引擎/OpenAI）、天气 |
| `server/player.mjs` | 播放控制：ncm-cli + mpv 降级方案 |
| `server/netease.mjs` | OpenAPI 客户端：签名、请求、自动续期 |
| `server/index.mjs` | HTTP 路由、token 管理 |
| `public/app.js` | 前端：播放器 UI、状态轮询 |
| `start.mjs` | 一键启动脚本（社区 API + myMusic） |
