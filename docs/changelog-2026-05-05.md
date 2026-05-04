# myMusic 更新日志 — 2026-05-05

## 概述

推荐系统质量大升级。从「随机候选池 + LLM 主观挑选」升级为「分层打分 + 反馈闭环 + 对话意图识别」的推荐系统。

## 变更文件

| 文件 | 增/删 | 说明 |
|---|---|---|
| `server/dj.mjs` | +609 / -?? | 重写：分层配额 + 源打分 + chatTurn + 天气缓存 |
| `server/db.mjs` | +132 | 新增 `track_feedback_events` 表 + `recordTrackFeedback` + `getFeedbackSummaryMap` + `profile_json` 列 |
| `server/library.mjs` | +410 | 结构化画像：`buildProfileStats` + `getProfilePlaylists` + `generateAIPortrait` 输出 JSON |
| `server/radio.mjs` | +26 | 新增 `submitFeedback` + `chatRadio` 改调 `chatTurn` |
| `server/index.mjs` | +6 | 新增 `/api/feedback` 路由 |
| `public/app.js` | +130 | 喜欢/不喜欢按钮 + 跳过/完整播放反馈 + 纯聊天不切歌 |
| `server/player.mjs` | +3 | `playUrl \|\| originalId` 双重检查 |

## 功能详情

### 1. 反馈闭环
- 新增 `track_feedback_events` 表：记录 `skip`/`complete`/`like`/`dislike`
- 前端：「喜欢」「不喜欢」按钮 + 切歌自动上报 skip + 播完自动上报 complete
- 推荐时查询 `getFeedbackSummaryMap()` 扣分、降权
- 路线图：暂时只做了事件记录和打分扣减，还未接入同艺人冷却和长期偏好学习

### 2. 候选池分层 + 固定配额
- 自动推荐：`本地最近 18 + 本地深度 22 + AI 发现 20`（共 60 首）
- 用户搜索：`社区搜索 24 + AI 发现 12 + 本地最近 12 + 本地深度 12`
- 源基础分：搜索结果 70 > AI 发现 45 > 本地最近 42 > 本地深度 35
- 解决了「发现歌曲被本地曲库挤掉」的问题

### 3. chatTurn：对话优先
- 新增 `chatTurn()`：先分析用户意图 → 决定是否推歌
- `analyzeConversationMood()` / `hasExplicitMusicIntent()` / `canProactivelyRecommend()`
- 闲聊只聊天不切歌，点歌/歌曲结束才切歌
- 解决了之前「问名字就被推歌」的问题

### 4. 结构化画像
- `music_profile` 新增 `profile_json` 列
- LLM 输出结构化 JSON：
  ```json
  {
    "genres": [{"name":"华语流行","weight":0.8,"evidence":["陈奕迅","苏打绿"]}],
    "moods": [{"name":"内省","weight":0.7}],
    "artists": [...], "albums": [...], "languages": [...],
    "discoveryDirections": [...], "avoidSignals": [...]
  }
  ```
- `buildProfileStats` + `getProfilePlaylists` 提供歌单级分析
- 画像从纯文本升级为可计算的结构化数据

### 5. 其他
- 天气缓存：10 分钟 TTL，避免每次请求都调 API
- `sessionId` 加入响应体
- `player.mjs`：`playUrl || originalId` 双重存在性检查
- 纯聊天响应不再把 `state.current` 清空
- 播放状态：纯聊天时显示「继续播放中」

## Git 提交建议

```
feat: 推荐系统重构 — 分层打分 + 反馈闭环 + 对话意图识别

- 候选池分层配额：自动18+22+20，搜索24+12+12+12
- 源基础分：搜索70 > 发现45 > 本地42 > 深度35
- 新增 chatTurn()：对话意图识别，闲聊不切歌
- 反馈闭环：track_feedback_events 表 + 喜欢/不喜欢按钮
- 结构化画像：profile_json 列，LLM 输出 JSON
- 天气缓存 10 分钟
- 新增 /api/feedback 路由
```
