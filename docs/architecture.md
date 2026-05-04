# myMusic 架构与功能总览

## 项目简介

myMusic 是一个本地 AI 音乐电台 PWA（Progressive Web App）。核心体验：AI DJ「灿灿」根据你的网易云曲库、天气、时间和口味，像朋友一样跟你聊天并推荐音乐。

- 后端：纯 Node.js（≥25），零框架，SQLite 存储
- 前端：Vanilla JS SPA + Service Worker
- AI：DeepSeek（LLM）+ 火山引擎（TTS）
- 音乐源：社区 API（NeteaseCloudMusicApi）+ 网易云 OpenAPI + ncm-cli

## 启动

```powershell
cd C:\myMusic2
npm run dev
```

一条命令同时启动两个服务：
- myMusic 主服务：`http://127.0.0.1:3000`
- 社区 API：`http://127.0.0.1:4000`

## 服务架构

```
┌─────────────────────────────────────────────────┐
│                   npm run dev                     │
│                      │                            │
│      ┌───────────────┴───────────────┐            │
│      │                               │            │
│  community API (:4000)          myMusic (:3000)   │
│  NeteaseCloudMusicApi            主服务           │
│      │                               │            │
│  song_url_v1 (获取链接)        HTTP Server        │
│  search (在线搜索)             路由 + API          │
│  lyric (歌词)                  │                  │
│      │                    ┌─────┼─────┐           │
│  MUSIC_U cookie           │     │     │           │
│                      DeepSeek  SQLite  浏览器     │
│                      (LLM)   (DB)    (前端)      │
└─────────────────────────────────────────────────┘
```

## 目录结构

```
server/
├── index.mjs       HTTP 路由、token 管理
├── config.mjs      环境变量加载、配置读取
├── db.mjs          SQLite 数据库、CRUD、反馈记录
├── ai.mjs          LLM 调用、TTS 合成（火山引擎/OpenAI）、天气查询
├── dj.mjs          【核心】对话式 DJ 引擎：聊天+选歌+候选池
├── radio.mjs       DJ 路由薄封装 + 反馈提交
├── library.mjs     曲库同步、画像生成、播放链接解析
├── community.mjs   社区 API 封装：搜索、播放链接、歌词、Cookie
├── netease.mjs     网易云 OpenAPI 客户端：签名、请求、Token 续期
├── player.mjs      ncm-cli + mpv 播放器封装
├── genre.mjs       RYM 5947 流派数据库：搜索、匹配、发现
└── diary.mjs       每日音乐日记（LLM 生成）

public/
├── index.html      SPA 入口 + 播放器模板
├── app.js          前端逻辑：聊天 UI、播放控制、反馈
├── styles.css      样式：聊天气泡、面板、播放器
└── sw.js           Service Worker（PWA 离线缓存）

.claude/skills/
├── music-genre-finder/  RYM 5947 流派参考数据
└── find-skills/         Skill 发现工具
```

## API 接口

### 电台

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/radio/start` | 启动电台，创建新 session |
| POST | `/api/radio/chat` | 发送聊天消息（含点歌） |
| POST | `/api/radio/next` | 请求下一首 |
| POST | `/api/play/report` | 播放数据回传 |
| POST | `/api/feedback` | 用户反馈（like/dislike/skip/complete） |

### 曲库

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/library/sync` | 同步网易云歌单到本地 |
| GET | `/api/library` | 获取曲库（画像+歌曲+歌单） |
| GET | `/api/library/profile` | 获取音乐画像 |

### 播放器

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/player/play` | 播放（传 trackId） |
| POST | `/api/player/pause` | 暂停 |
| POST | `/api/player/resume` | 继续 |
| POST | `/api/player/stop` | 停止 |
| GET | `/api/player/state` | 播放器状态 |

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/netease/qrcode` | 获取登录二维码 |
| POST | `/api/auth/netease/qrcode/check` | 轮询扫码状态 |
| POST | `/api/auth/netease/refresh` | 刷新 token |

### 系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 + 配置状态 |
| GET | `/api/config/status` | 各服务配置状态 |
| GET | `/api/diary` | 日记列表 |
| GET | `/api/diary/today` | 今日日记 |
| POST | `/api/diary/generate` | 生成日记 |
| GET | `/api/tts/:id.mp3` | TTS 缓存音频文件 |

## 数据库

### 核心表

| 表 | 用途 |
|---|---|
| `tracks` | 歌曲库 |
| `playlists` | 歌单 |
| `playlist_tracks` | 歌单-歌曲关联 |
| `plays` | 播放记录 |
| `music_profile` | 音乐画像（文本 + 结构化 JSON） |
| `radio_sessions` | 电台会话（含 `mode_json` 模式配置） |
| `messages` | 聊天历史（用户 ↔ DJ） |
| `track_feedback_events` | 反馈事件（like/dislike/skip/complete） |
| `settings` | 键值配置（token、偏好等） |
| `tts_cache` | TTS 音频缓存 |
| `diary_entries` | 每日音乐日记 |

## 认证体系

| 用途 | 方式 | 存储 |
|---|---|---|
| 网易云曲库同步 | OpenAPI accessToken（从 ncm-cli 获取） | SQLite `settings` 表 |
| 歌曲播放链接 | 社区 API `MUSIC_U` cookie（浏览器登录获取） | 项目根目录 `netease_cookie.txt` |
| AI 主持词/推荐/画像 | DeepSeek API Key | `.env.local` |

## 核心流程

### 候选池构建（每次选歌）

```
自动推荐模式（120首 → 取60首）：
  本地最近 18 + 本地深度 22 + AI发现 20

用户搜索模式：
  社区搜索 24 + AI发现 12 + 本地最近 12 + 本地深度 12

源基础分：搜索70 > 发现45 > 本地42 > 深度35
排除已播放 300 首 + 反馈负向曲目
```

### 对话流程

```
用户消息 → chatTurn()
  ↓
analyzeConversationMood()       ← 分析对话情绪
hasExplicitMusicIntent()        ← 是否明确点歌
canProactivelyRecommend()       ← 是否可以主动推歌
  ↓
是点歌/该推歌？→ djTurn() 走完整推荐
纯聊天？→ 只生成聊天回复，当前歌继续播
```

### DJ 选歌（djTurn）

```
1. 在线搜索（用户说的话 → DeepSeek 生成搜索词 → 社区 API 搜索）
2. 构建候选池（分层配额 + 源打分）
3. 单次 LLM 调用：
   输入：System Prompt + 候选池 + 对话历史 + 画像 + 天气 + 偏好
   输出：<CHAT>对话</CHAT><JSON>{"pick":N,...}</JSON>
4. pick=null → 纯聊天
   pick=N → 播放第 N 首
5. resolvePlayableTrack → 社区 API song_url_v1 → 浏览器 <audio> 播放
```

### 播放链路

```
社区 API song_url_v1 (MUSIC_U cookie)
  → 拿到 mp3 直链（VIP 歌也能播）
  → 浏览器 <audio> 播放
  → 播完 / 切歌 → 上报 feedback
  → 反馈数据进入候选打分系统
```

### 音乐画像

```
数据源：仅用户网易云歌单同步的歌曲（排除 AI 推荐和测试搜索）
LLM 分析：7 个维度 + 结构化 JSON

结构：
  { genres: [{name, weight, evidence}], moods, artists,
    albums, languages, scenes, eras, energy,
    discoveryDirections, avoidSignals }

刷新条件：>24h 或曲库变化 >5% 或画像不存在
```

## 前端页面

| 页面 | 路径 | 内容 |
|---|---|---|
| 电台 | `/` | 左侧：封面 + 播放控制 + 歌词；右侧：聊天面板 |
| 曲库 | `/library` | 画像摘要 + 流派标签 + 歌曲网格 + 同步按钮 |
| 日记 | `/diary` | AI 生成的每日音乐日记 |
| 设置 | `/settings` | 配置状态 + 扫码登录 + Token 管理 |

## 已实现功能清单

- [x] 对话式 AI DJ（灿灿）
- [x] 对话意图识别（闲聊不切歌）
- [x] 候选池分层配额 + 源打分
- [x] DeepSeek 自动生成搜索词
- [x] 社区 API 播放链接（含 VIP 歌曲）
- [x] 音乐画像（LLM 7 维度 + 结构化 JSON）
- [x] RYM 5947 流派数据库集成
- [x] 用户偏好存储 + 模式持久化
- [x] 反馈闭环（like/dislike/skip/complete）
- [x] Token 持久化 + 自动续期
- [x] 天气缓存（10 分钟 TTL）
- [x] TTS 语音合成（火山引擎/OpenAI）
- [x] PWA（Service Worker + 离线缓存）
- [x] 网易云曲库同步（歌单、收藏、最近播放）
