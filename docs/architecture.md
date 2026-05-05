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

### 记忆 & 偏好

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/memories` | 列出所有长期记忆 |
| DELETE | `/api/memories` | 清除全部记忆 |
| DELETE | `/api/memories/:id` | 删除单条记忆 |
| GET | `/api/preferences` | 用户偏好 + 反馈统计摘要 |
| PUT | `/api/preferences` | 更新用户偏好 |

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
| `user_memories` | 长期记忆（偏好、边界、口味、聊天风格等） |
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
1. 检索长期记忆 + 更新会话摘要
2. 在线搜索（用户说的话 → DeepSeek 生成搜索词 → 社区 API 搜索）
3. 构建候选池（分层配额 + 源打分）
4. 单次 LLM 调用：
   输入：System Prompt + 候选池 + 对话历史 + 画像 + 天气 + 偏好 + 记忆上下文
   输出：<CHAT>对话</CHAT><JSON>{"pick":N,...}</JSON>
5. pick=null → 纯聊天
   pick=N → 播放第 N 首
6. 异步提取长期记忆（scheduleMemoryExtraction）
7. resolvePlayableTrack → 社区 API song_url_v1 → 浏览器 <audio> 播放
```

### 播放链路

```
社区 API song_url_v1 (MUSIC_U cookie)
  → 拿到 mp3 直链（VIP 歌也能播）
  → 浏览器 <audio> 播放（crossOrigin="anonymous" 启用 Web Audio 可视化）
  → 播完 / 切歌 → 上报 feedback
  → 反馈数据进入候选打分系统
```

### 性能优化（2026-05-05）

**问题：** 一轮对话/推荐 3 次 LLM + 15+ 次串行搜索 = 13-19 秒延迟。

**方案 A — discover() 搜索并行化：**
原 4 个阶段串行 `for...of`（情绪关键词 → 画像关键词 → 流派关键词 → LLM 关键词），每个词依次等待。改为所有关键词去重后 `Promise.all` 一批并行发出。10-18 次串行 → 1 批并行。

**方案 B — 砍掉 discover() 中的 LLM 关键词生成：**
`discover()` 额外调用一次 DeepSeek 生成 3 个搜索词。画像关键词 + 流派关键词已覆盖发现需求。节省 1 次 LLM + 1-3 次串行搜索。

| | 优化前 | 优化后 |
|---|---|---|
| LLM 调用 | 3 次 | 2 次 |
| 搜索 API | 15+ 次串行 | ~10 次并行 |
| discover() 耗时 | ~10s | ~0.5s |
| 总延迟 | 13-19s | 3-6s |

### AI 记忆系统

灿灿具备三层记忆架构，使其能跨会话记住用户偏好、聊天风格和个人信息。

**数据库：** `user_memories` 表

| 字段 | 说明 |
|---|---|
| `kind` | 记忆类型（`chat_style` / `music_taste` / `personal_fact` / `boundary` / `mood_pattern` / `music_preference`）|
| `content` | 自然语言描述（如"用户多次喜欢《晚风里的城市》，后续可把相近气质的歌曲作为安全推荐方向"）|
| `confidence` | 置信度 0-1 |
| `importance` | 重要度 0-1 |
| `evidence_count` | 被证据加强的次数 |
| `source_session_id` | 产生该记忆的会话 ID |
| `tags_json` | 标签数组 |

#### 第一层：长期记忆（跨会话持久化）

**写入：** 两个来源
- **反馈触发** — `maybeRecordFeedbackMemory()`：喜欢 ≥3 次 / 完整听完 ≥4 次 / 跳过 ≥3 次 / 不喜欢 ≥2 次 → 自动生成 `music_preference` 记忆
- **LLM 异步提取** — `scheduleMemoryExtraction()`：每轮对话结束后，异步调 DeepSeek 分析对话内容，提取结构化记忆（聊天风格、口味、个人信息、边界、情绪模式）。已有相关记忆时走 `recordOrMergeUserMemory()` 去重合并

**读取：** 每次 `djTurn()` 和 `chatTurn()` 调用 `retrieveRelevantMemories()` 做语义检索，上限 8 条 / 800 字，通过 `buildMemoryContext()` 拼入 LLM System Prompt

#### 第二层：会话摘要（实时滚动）

`updateSessionSummary()` — 当前 session 消息数 ≥12 条且上次摘要后新增 ≥6 条时触发。LLM 将最近 60 条对话压缩成 200-500 字中文摘要，存入 session context。每次对话都传给 LLM，灿灿能感知"这轮聊了什么"。

#### 第三层：反馈即时学习

`maybeRecordFeedbackMemory()` 在 `submitFeedback()` 中同步触发。达到阈值即写入 `user_memories`，下次推荐时生效，无需等待 LLM 提取。

#### 内存管理 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/memories` | 列出所有长期记忆 |
| DELETE | `/api/memories` | 清除全部记忆 |
| DELETE | `/api/memories/:id` | 删除单条记忆 |
| GET | `/api/preferences` | 用户偏好 + 反馈统计摘要 |
| PUT | `/api/preferences` | 更新用户偏好 |

#### 用户偏好

```js
{
  chatMusicBalance: 'friend' | 'balanced' | 'dj',   // 聊天/音乐平衡
  recommendationFrequency: 'low' | 'medium' | 'high', // 推荐频率
  voiceMode: 'off' | 'recommendations' | 'all',       // 语音模式
  moodMode: 'auto' | 'comfort' | 'focus' | 'calm' | 'night' | 'random' // 情绪模式
}
```

### 前端视觉系统

**赛博朋克主题：**
- 配色：`--cyan #00f0ff`（霓虹青，主色调）、`--magenta #ff00ff`（霓虹紫，强调）、`--bg #06060e`（深层黑底）
- CRT 扫描线：全屏 `#crt-overlay`，`repeating-linear-gradient` + `scanlines` 动画
- 像素角标：`.now-panel` / `.chat-panel` / `.lyric` 四角 `::before`/`::after` 伪元素边框

**按钮反馈：**
- hover：霓虹青发光 `box-shadow` + 字变白
- active：紫红发光 + `btn-press` 缩放回弹动画（0.93x 缩放）
- 全局 `mousedown`/`mouseup` 监听添加/移除 `.btn-pressed` class

**加载动画：**
- `statusLocked` 锁机制防止轮询覆盖
- 8 条文案池每 2.8s 轮换：`灿灿正在帮你挑选歌曲...` → `灿灿正在解码你的音乐DNA...` 等
- `<span class="glitch-text">` 故障文字效果（`::before`/`::after` 紫红/青色 clip-path 偏移）
- `<span class="loading-dots">` 三点跳动 CSS 动画

### 歌词显示

**LRC 解析与时间同步：**
- `buildLyricDOM(lrcText)` — 正则 `/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g` 解析 LRC 格式
- `syncLyricTime(currentTimeSec)` — 监听 `<audio>.timeupdate`，二分查找当前行
- <audio> 需设 `crossOrigin="anonymous"`，否则 Web Audio API 因 CORS 返回零数据

**视觉设计（Apple Music 风格）：**
- `.lyric-viewport`：顶部/底部 `mask-image` 线性渐隐遮罩
- `.lyric-line`：默认 opacity 0.32 / 字号 17px / 居中
- `.lyric-line.near`：相邻行 opacity 0.6 / 字号 18px
- `.lyric-line.active`：当前行 opacity 1 / 字号 20px / font-weight 600 / 青色 text-shadow 发光
- `scrollIntoView({ block: 'center', behavior: 'smooth' })` 自动居中

> **注意：** `server/dj.mjs` 中 `resolvePlayableTrack` 的 `includeLyric` 必须为 `true`，否则不获取歌词。

### 音频频率可视化

**架构：**
- 持久层 `#audio-layer`（在 `#app` 内、`#view` 外）存放 `<audio>`、`<canvas>` 和 fallback `<div>`
- SPA 导航时 `render()` 调 `view.__audioCleanup()` 将元素移回 `#audio-layer`，`renderPlayer()` 再将它们插入 `.left-col`
- 元素引用不变，Web Audio graph 和播放状态在页面切换间保持

**Canvas 真实可视化：**
- `buildAudioGraph()` — 一次性创建 `AudioContext`，`sourceCache` Map 缓存每个 `<audio>` 的 `createMediaElementSource`
- `switchVisualizerTo(kind)` — 断开所有旧连接，创建新 `AnalyserNode`(fftSize=64)，重连目标 source → analyser → destination
- `startDrawLoop(canvas)` — `requestAnimationFrame` 循环，`getByteFrequencyData` 取 18 个频率 bin，Canvas 青→紫渐变柱状图
- TTS 播放切 `host` 源，歌曲播放切 `song` 源

**CSS 回退可视化：**
- Web Audio 不可用时自动使用 `.equalizer-fallback`（20 条 `eq-bar` 动画）
- 默认 `display: none`，仅在需要时显示

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
| 电台 | `/` | 左侧：封面 + 播放控制 + 可视化 + 歌词；右侧：聊天面板 |
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
- [x] **发现层性能优化**：discover() 搜索全部 Promise.all 并行化 + 砍掉 LLM 关键词生成调用（延迟从 ~10s → ~0.5s）
- [x] **赛博朋克前端主题**：霓虹青/紫红配色、CRT 扫描线、mono 字体、像素角标、按钮按压反馈动画
- [x] **歌词滚动显示**：LRC 时间戳解析 + Apple Music 风格逐行高亮 + 渐隐遮罩
- [x] **加载动画**：8 条随机文案轮播 + 故障文字效果 + 三点跳动
- [x] **音频频率可视化**：Web Audio API AnalyserNode + Canvas 柱状图 + CSS 动画回退
- [x] **SPA 导航音频持久化**：音乐播放中切换页面不中断
- [x] **三层 AI 记忆系统**：长期记忆（跨会话持久化）+ 会话摘要（滚动压缩）+ 反馈自动提取
- [x] **用户偏好体系**：聊天/音乐平衡、推荐频率、语音模式、情绪模式可配置
