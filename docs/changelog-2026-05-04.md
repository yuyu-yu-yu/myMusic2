# myMusic 更新日志 — 2026-05-04

## 概述

上一次提交（`ce04143 更改了播放思路，可以播放VIP歌曲`）之后，本次进行了**交互模式重构**，将单向「AI 主持词 + 播放」改为**双向对话式 AI DJ（灿灿）**，并接入了 RYM 5947 音乐流派数据库。

## 变更文件

### 新增
| 文件 | 说明 |
|---|---|
| `server/dj.mjs` | 对话式 DJ 引擎：单次 LLM 调用完成聊天 + 选歌 |
| `server/genre.mjs` | RYM 5947 流派数据库封装（搜索、匹配、发现） |
| `docs/playback-architecture.md` | 播放架构文档 |
| `docs/changelog-2026-05-04.md` | 本更新日志 |
| `.claude/skills/music-genre-finder/` | RYM 流派数据（49 主分类 + 578 子分类） |
| `.claude/skills/find-skills/` | Skill 发现工具 |

### 修改
| 文件 | 改动 |
|---|---|
| `server/radio.mjs` | 从 400+ 行简化为 40 行薄封装，选歌/主持词/推荐理由合并为 `djTurn()` 单次调用 |
| `server/db.mjs` | `radio_sessions` 表新增 `mode_json` 列；新增 `getSessionMode`/`setSessionMode` |
| `server/library.mjs` | `updateProfile` 接入 LLM 生成详细画像（流派/情绪/偏好）；画像仅分析歌单同步数据，排除 AI 推荐污染；缓存逻辑：>24h 或曲库变化 >5% 才重新生成 |
| `server/index.mjs` | `updateProfile` 传 LLM config |
| `public/index.html` | 播放器改为左右分栏布局：左侧封面+控制，右侧聊天面板 |
| `public/app.js` | 新增聊天气泡 UI、`sendChat`/`handleRadioResponse`/`appendChat`；纯聊天不切歌；歌曲卡片嵌入气泡 |
| `public/styles.css` | 聊天面板、气泡、歌曲卡片、恢复正常按钮样式 |

## 架构变化

```
之前：
  用户输入 → 正则匹配 → LLM 选歌 → LLM 主持词 → LLM 理由 → 播放
  （三次独立 LLM 调用，每次无上下文）

现在：
  用户输入 → DeepSeek 生成搜索词 → 在线搜索 + 候选池
       ↓
  单次 LLM 调用：聊天 → 选歌 → 理由 三合一
       ↓
  <CHAT>对话文本</CHAT><JSON>{"pick": 3, "mode": null}</JSON>
       ↓
  pick=null → 纯聊天不切歌
  pick=N → 播放候选池第 N 首
```

## 新功能详情

### 对话式 DJ（灿灿）
- 自然对话 + 智能切歌：闲聊时只聊天，歌播完或点歌时切歌
- 对话历史：加载最近 20 条 messages，LLM 完整上下文
- 模式持久化：`radio_sessions.mode_json` 存储用户偏好，LLM 自动遵守
- 「恢复正常」按钮：一键清除偏好模式

### 搜索引擎
- DeepSeek 自动理解用户意图生成搜索词（不再手工正则）
- 搜索到的歌自动 saveTrack 入库，候选池最前面优先选
- 搜索结果标注：「候选 0-N 是针对"xxx"的在线搜索结果，优先从这里选」

### 流派数据库
- RYM 5947 流派接入发现流程，流派名作为在线搜索关键词
- 系统提示注入「听众可能喜欢的风格：Dream Pop, Shoegaze...」

### 音乐画像
- LLM 生成 7 维度画像（整体风格/流派偏好/情绪倾向/艺人偏好/风格分布/惊喜建议/补充）
- 只用歌单同步数据，排除 AI 推荐和测试搜索
- 不再编造用户行为习惯

## 提交建议

```
feat: 对话式 AI DJ 灿灿 + 5947 流派数据库

- 新增 server/dj.mjs：对话+选歌单次 LLM 调用
- 新增 server/genre.mjs：RYM 流派查询/匹配/发现
- radio.mjs 简化为薄封装
- 前端聊天面板 + 聊天气泡 UI
- 画像排除 AI 推荐数据，LLM 7 维度分析
- DeepSeek 自动理解意图生成搜索词
- 模式持久化 + 恢复正常按钮
```
