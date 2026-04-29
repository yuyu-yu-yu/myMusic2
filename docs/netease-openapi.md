# 网易云音乐 OpenAPI 接入说明

本文档服务于 myMusic 项目。内容来自网易云音乐开放平台文档中心，并补充 myMusic 实现时的阅读结论。

- 抓取时间：2026-04-29T12:02:31.223Z
- 开放平台域名：`https://openapi.music.163.com`
- 文档中心：`https://developer.music.163.com/st/developer/document`
- 重点范围：音乐 API、登录、收藏、歌单、歌曲、播放地址、歌词、搜索、推荐、播放记录、回传、AIDJ，以及应用签名。

## myMusic 接入结论

- 所有请求都需要公共参数：`appId`、`signType`、`sign`、`timestamp`、`bizContent`、`device`，需要登录态的接口还要 `accessToken`。
- `bizContent` 和 `device` 都是 JSON 字符串，发送前需要 URL encode。
- 播放能力会受会员身份、版权、音质、地区、登录策略影响；播放器必须准备不可播放和降级逻辑。
- myMusic 第一版优先接：二维码登录或匿名登录、用户基本信息、红心歌单、用户收藏/创建歌单、歌单详情、歌单歌曲、歌曲详情、歌词、歌曲播放 URL、搜索歌曲、日推/相似/更多推荐、最近播放歌曲、播放数据回传。
- TTS 电台主持人先走项目自己的 LLM/TTS；网易云 AIDJ 的“歌曲口播信息”和“音色列表”可作为后续增强。

## 文档目录索引

### 应用签名

- 生成密钥并上传：`56fb9f543d6f4cc3b48a862ed408a075`
- 签名sign：`45aac8d12ccb4a98b14e2ea34a1a9cdb`
- python签名：`62d2c09579c241fa966de6fbd739d574`
- java签名：`af60cf06b7e944189116d08f6ccd6a29`

### 公共

- 访问方式：`d5ab035d4b9d4a088ff9f4ef3ea5005a`
- HTTPDNS接入：`c46ab3181cc348bdb1df1324aec66f88`，`/openapi/music/basic/httpdns/d`
- 公共错误码：`920866a9a2c2439da4d85ee5c4d23700`
- IOT端公共参数：`0f7801d7d6d24180b8fc9058d1ffe593`

### 用户登录API

- 匿名登录：`1a5fb2c7b30b44609fa81129a8e1908d`，`/openapi/music/basic/oauth2/login/anonymous`
- 获取登录二维码：`2bb12a93e71a4be0842243b930c2f33c`，`/openapi/music/basic/user/oauth2/qrcodekey/get/v2`
- 轮询二维码状态：`4d0301c68c5d45d8811d7787ee37d2f6`，`/openapi/music/basic/oauth2/device/login/qrcode/get`
- 获取用户基本信息：`8ed9b2f123e44923979596a277733421`，`/openapi/music/basic/user/profile/get/v2`
- 回调code换取accessToken：`2fa5a885d2644910a4b823dba0c5acf5`，`/openapi/music/basic/user/oauth2/token/get/v2`
- 查询用户是否实名：`dffbc59f96d147d49e1bb41a157daaea`，`/openapi/music/basic/user/id/info`
- 刷新AccessToken：`2066d57bbed2445baeb18429e44b8689`，`/openapi/music/basic/user/oauth2/token/refresh/v2`
- H5登录&唤端登录：`78eb8f6bec12427d90b120e21b569b16`

### 推荐-歌曲类API

- 每日推荐封面：`b23243d8debf4333ad7f3cb15b071900`，`/openapi/music/basic/recommend/daily/image`
- 获取相似歌曲（新）：`afd1a27abcda4d36b464b7871a44159b`，`/openapi/music/song/simulation/get`
- 心动模式：`6e99f4d7cc68445cbbda72ef0c22b528`，`/openapi/music/basic/song/play/intelligence/get`
- 推荐更多歌曲：`c1b71075ac0f42d2bbd9704f23f1f8de`，`/openapi/music/basic/recommend/more/song`
- 获取场景音乐标签：`8e151e88295e46c195c4786ad382cc5f`，`/openapi/music/basic/scene/radio/tags/get`
- 获取场景音乐标签下的歌曲：`4f5e35ad719a46f9bc0b43e81f6e1786`，`/openapi/music/basic/scene/radio/get`
- 私人定制：`a7db4997ab77438cbce63df7a60734e3`，`/openapi/music/basic/recommend/style/songlist/get`
- 每日推荐：`6b8a63554d5b4e89a98ee703018c15c2`，`/openapi/music/basic/recommend/songlist/get/v2`

### 推荐-歌单类API

- 获取推荐歌单列表：`9d7ae747fa0246088cdf7ac21cdb7b46`，`/openapi/music/basic/recommend/playlist/get`
- 获取雷达歌单：`7be7ab491ae04c299584d88ad1ba4e55`，`/openapi/music/basic/playlist/radar/get`
- 获取榜单列表：`662be3936dc84a28957d547755eca385`，`/openapi/music/basic/toplist/get/v2`
- 获取banner资源：`09ce2cf38edd42deabaa8290de8b1ffc`，`/openapi/music/banner/get`
- 最近常听：`1840785a832d4a9e9bd46620927a215f`，`/openapi/music/common/recently/heard/get`

### 日推MIX

- 日推mix：`83c94b535264425b9b0788c18f6b7043`，`/openapi/music/basic/recommend/daily/mix`
- 获取相似歌曲-歌曲列表（日推mix）：`4f7214fbb2534c69aad759095283d108`，`/openapi/music/basic/private/fm/roaming/song/list`
- 获取风格日推-歌曲列表（日推mix）：`b5419158b92d4310b0d4c02c696d7841`，`/openapi/music/basic/song/daily/style/get`
- 获取相似艺人-歌曲列表（日推mix）：`183e1200829b46869ef1674881a90d8a`，`/openapi/music/basic/private/fm/roaming/song/list`

### 私人漫游API

- 获取私人漫游场景模式：`999a99898fa44785baf4cbda2d8d58af`，`/openapi/music/basic/private/fm/roaming/category`
- 获取私人漫游(不建议使用)：`bb07d0cea0ab4cc2bda2e26fa0e5337e`，`/openapi/music/basic/radio/fm/get/v2`
- 获取私人漫游场景歌曲：`65df691d1b284d92b29038b34daca95b`，`/openapi/music/basic/private/fm/roaming/song/list`

### 查询歌单及歌曲API

- 获取歌单详情：`730b0a8b80e745dea3b9f354eddb467e`，`/openapi/music/basic/playlist/detail/get/v2`
- 批量查询歌单详情：`cc0c3b1000eb4c969b5e5393ea83a9a0`，`/openapi/music/basic/playlist/detail/list`
- 获取歌单里的歌曲列表：`1d0537d7facc4c398834810d2955123c`，`/openapi/music/basic/playlist/song/list/get/v3`

### 查询歌曲API

- 获取歌曲音质：`4e6a21da27a64becb778484ce2068fd0`，`/openapi/music/basic/song/music/quality/sound/get`
- 全曲试听：`1549413ffa5548b8a646a1eb2ea4da5b`
- 批量获取歌曲信息：`b8bdaa8e40b946ecbc1d08978f3f12b0`，`/openapi/music/basic/song/list/get/v2`
- 获取歌词：`803202bd65bc469587d05b507dcd31e7`，`/openapi/music/basic/song/lyric/get/v2`
- 全曲试听改版：`2863fdc2ce2047c2bfcee49f1b6c65e6`
- 获取歌曲音质（新版）：`548179f7ecbc417d8acd35d604aea3c9`，`/openapi/music/basic/song/music/quality/sound/sp/get`
- 获取逐字歌词：`ac69c8c9c1b04a7f8704d6ccb78580dc`，`/openapi/music/basic/song/lyric/word/by/word/get`
- 获取歌曲详情：`2f583c5e2d764bbabaa221865f62dbc4`，`/openapi/music/basic/song/detail/get/v2`

### 获取播放地址API

- 获取歌曲播放url：`3d2c9f695ff24f4ea37611614b7f7856`，`/openapi/music/basic/song/playurl/get/v2`
- 批量获取歌曲播放url：`70ada04216d64b0d88e80740dee23a77`，`/openapi/music/basic/batch/song/playurl/get`
- 获取歌曲无法播放toast文案：`7261533300a645ea99aaf0f860f19dd5`，`/openapi/music/basic/song/text/play/get/v2`

### 文字搜索API

- 获取热搜榜：`ece9c6aa05544190ad840b2acc2e438e`，`/openapi/music/basic/search/charts/list/get`
- 获取搜索热词：`11dc8523a53a4e288d8bb056d224878d`，`/openapi/music/basic/search/hot/keyword/get/v2`
- 获取搜索提示词：`45c71d401d6c4eb5bd17d1775f1b8b5e`，`/openapi/music/basic/search/suggest/keyword/get/v2`
- 根据关键字综合搜索：`ffd83c003331452d9d0bdb45e8ab1261`，`/openapi/music/basic/complex/search`
- 根据关键字搜索歌曲：`b175e0d52550427cbb7cd4735a9de765`，`/openapi/music/basic/search/song/get/v3`
- 根据关键字搜索歌单：`7aae16d1be194e628666dd4ced17f283`，`/openapi/music/basic/search/playlist/get/v2`
- 根据关键字搜索专辑：`ca7eda92ab634c0fbc1436c99fdaad5d`，`/openapi/music/basic/search/album/get/v2`
- 根据关键字搜索歌手：`a1c2bcb0e9b44c09a45b614c3d4f1784`，`/openapi/music/basic/search/artists/get/v2`
- 根据标签搜索歌单：`60d52ebe087b45218dedca1afdcaf49c`，`/openapi/music/basic/search/playlist/bytag/get/v2`
- 根据艺人关键字搜索歌曲（不建议使用）：`4eabf69b081548499d0d3e57f255bcf4`，`/openapi/music/basic/search/song/byartist/get/v2`
- 根据艺人名、歌曲名搜索歌曲信息（不建议使用）：`4a4a9ef7d6ce4c39ad2685b321cc7d22`，`/openapi/music/basic/search/song/by/artist/song/get/v2`
- 根据艺人、专辑关键字搜索专辑列表(不建议使用)：`44a151d8c432445984d8dbaf06467f7c`，`/openapi/music/basic/search/song/by/album/artist/get/v2`

### 获取播放记录API

- 获取最近播放歌单列表：`e185b8877e144eba82d8eefd7a7f1081`，`/openapi/music/basic/playlist/play/record/list`
- 获取最近播放专辑列表：`d90400e28fab4fbb834959650ec8d93d`，`/openapi/music/basic/album/play/record/list`
- 获取听歌排行数据：`bc35878b52134cfbb6739fcff7de5f9e`，`/openapi/music/basic/query/song/record/get`
- 获取近期内容推荐：`e878b43948834b47b93b0025cf947fce`，`/openapi/music/basic/mix/recent/get`
- 获取最近播放歌曲列表：`1811d8f3db124c65a66edddcef7e70fc`，`/openapi/music/basic/song/play/record/list`

### 用户资产API

- 获取用户已购歌曲：`393b4acad0f0443094e42b27340a71ad`，`/openapi/music/basic/song/paid/get`
- 获取用户已购专辑：`99900726c96d4c0c8b3724d939b7e0f3`，`/openapi/music/basic/album/paid/get/v2`
- 获取用户网盘歌曲：`4a3a24a059894e2bbded639b891d44a1`，`/openapi/music/basic/private/cloud/song/list/get`

### 播放数据回传API

- 音乐/长音频播放数据回传：`eb0ddaf2efc649e99dffe0677472466a`，`/openapi/music/basic/play/data/record`

### 收藏&创建API

- 用户取消收藏歌单：`5f2aa23db2aa411b8ccec5fa40ad501a`，`/openapi/music/basic/playlist/unsub/v2`
- 添加或删除红心歌曲：`f9a2353b14de42cd925c61de66095e0e`，`/openapi/music/basic/playlist/song/like/v2`
- 获取用户收藏的歌单列表：`1b3d86a47f2e45c7bd631bcd26052382`，`/openapi/music/basic/playlist/subed/get/v2`
- 批量删除歌单内歌曲：`19b352625a9843f9b86521f49b856542`，`/openapi/music/basic/playlist/song/batch/delete`
- 获取用户红心歌单：`f0b639bf1494424188a8360d4a22fdd4`，`/openapi/music/basic/playlist/star/get/v2`
- 获取用户创建的歌单列表：`e4fef4e5cc564fc1adbcfcf02140f0d5`，`/openapi/music/basic/playlist/created/get/v2`
- 批量添加歌曲到歌单：`81deeef0f74147dba249531b5e08042d`，`/openapi/music/basic/playlist/song/batch/like`
- 用户收藏歌单：`eb8bef1f8603489f8c31b4b9720eda24`，`/openapi/music/basic/playlist/sub/v2`

### AIDJ

- 获取行为口播信息（暂不支持）：`23515286a8b14ddaa2438eed712f4128`，`/openapi/music/basic/action/aidj/audio/get`
- 获取音色列表：`4db4e338fe524c6b91017996b5ed9197`，`/openapi/music/basic/aidj/audio/timbre/get`
- 获取歌曲口播信息：`5bfd65db8f1d4290908269884c7a81a4`，`/openapi/music/basic/song/aidj/audio/get`

## 原始接口章节摘录

# 应用签名

## 生成密钥并上传

- docId：`56fb9f543d6f4cc3b48a862ed408a075`
- 来源：https://developer.music.163.com/st/developer/document?docId=56fb9f543d6f4cc3b48a862ed408a075

## 生成密钥并上传


### 第一步 生成RSA密钥


```text
公私钥生成工具：http://web.chacuo.net/netrsakeypair
==》2048位，pkcs#8
```


- 以下为老方式，可直接用上面的工具生成


```text
首先进入OpenSSL工具，输入以下命令：

OpenSSL> genrsa -out app_private_key.pem  2048  #生成私钥

OpenSSL> pkcs8 -topk8 -inform PEM -in app_private_key.pem -outform PEM -nocrypt -out app_private_key_pkcs8.pem #Java开发者需要将私钥转换成PKCS8格式

OpenSSL> rsa -in app_private_key.pem -pubout -out app_public_key.pem #生成公钥

OpenSSL> exit #退出OpenSSL程序

经过以上步骤，开发者可以在当前文件夹中（OpenSSL运行文件夹），看到 app_private_key.pem（开发者RSA私钥，非 Java 语言适用）、app_private_key_pkcs8.pem（pkcs8格式开发者RSA私钥，Java语言适用）和app_public_key.pem（开发者RSA公钥）3个文件。开发者将私钥保留，将公钥提交给云音乐开放平台，用于验证签名。以下为私钥文件和公钥文件示例。
```


TIPS：对于使用Java的开发者，需将生成的pkcs8格式的私钥去除头尾、换行和空格，作为私钥填入代码中，对于.NET和PHP的开发者来说，无需进行pkcs8命令行操作。


- 会生成公钥和私钥两组密钥，共构成一堆密钥


标准的私钥文件示例（PHP、.NET使用）


```text
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA10TZZd81MJhTFY/HPD6LDTznT8N/fQDw6DUq3BdicmwDDkrM
IK5XIZYj5UJ7K/UmH5LxuXdDc6nw76CbhSaMVSCBndtDcAiFl3SuKFSkMkhhEs+j
YB8onnWMaPUmE0RlmTHA15XvJCKt/Ar5Bgn2pbxbWL/lEkUeTzMmzd2UplD3cjhN
AM1ovPBVB7dW9LmRHWXm8MUtcDQKBXMtv+NdNWG4TCUi/u28TogKBs45+Wi6tWNr
GSbyg+XtlhzdN3HGCXXAFN6d0ohVIM3K2N+DzpLJ61ac/wlzt2SA4mo3FOeoqfLY
0+N+Um8/Hiykxq7raSRe7J0BYOJkwTAVeFyU4QIDAQABAoIBAACogNiO1ze9NbfT
b/89cClLz+CVudV09asrpuRJRyEsGmBJ+l8HbsXFWeu/JcrvHa7kefbZYR4kXWH0
aZjhIQRiuo8s80pWdhxVDisMLd+umNzxzl2wtV3PHW0uuygg7MyaZPQOd5XH3gg2
F7YOvPa3/cbYanmdxUPmLKQInZRamiSnFxtuLs41UK9BT/kgqs3WmmyY7TrkBCqB
NMx+h+76YC1oPnyLo61vbeui8zHT5k5YrgCSdvwjuFWV8/Agzd64XGmuECwb80HM
QzySb1SlPya0kEljNNgc12h/6XquCSfOnKI9gh6Js1HCP+LqUGAjjQeUACkzym46
4zklyV8CgYEA87Qu2lW1acnPPSYX/uYQWw8jD61rIQrKDefMxd/7lmdSBrAch4Ow
GT2KcMxwHdoQ1of2XKLts7YIwVYLIn+Tb8V+KIeOVfEGAox05JHjs9P2sp2AzjfH
lB1ls9KW9+Z3G0LPfItcqQnS6AA0xG5khVvumJfsqo7QXvpyV2BrJ38CgYEA4iFi
isXVwrDUAuzpOCADFFYiJEvqxSjX2YZtc9NrK0qUNwhMBpCVtrOYbuoxC3GfZzv+
Y839Dufu4Ol4U32lIpDkC+VHqzxpOiGzWJz/M5ft5hwp2aDwz13thyS1QI3zSENP
XlFJsRluUbRFsLlo5oCQed6xYdiXNhUdZy1vc58CgYEAmE4dkfpKvGiRigfKq1Uh
F6eoI94fu7DAglxBz9ChrWe5DdD2o4Kbhcq+QKyjzSRBrbGfOFni8JNteVbK8q6E
eDAXHkFJpVBSjzk0vLyob/SikxJ4M2kM4/ZTX0TXcOqpuXHRtmZqbIJlOvUWBUVw
sR+5R8h68kT62MDwwMbTcQUCgYB36LwYWk+/rYS/CGGjIVaAsivok1kqsz3CW0Yu
5S0vB50QkZW+5Wx+NT3fks/vAZFFbMq4ocJO5S4Glcb4fufSLILAzBP0+VPTP4ua
saWh9i5wlv6aKH2JeIU75Hs4gA1BhG/R08j/4DxflvhdffPiRspV1YC6IeANDaVJ
0Q4IgQKBgQCiDfsoaEXhPXZhx38r8n7A5Em1wl4rutyreQ//znYsIoT8owbipBUF
eG9i6uwCOKvEGdgSgrjy8RVRLhrWrT7aRjdDx0wpGFCOyZZiZbtIf1Ti79/ItvMy
Zx0hJOUu2yXRUQrBYxzNOlEmoyPE76Fj4Kw+1yjnM1iDiuKC/8DkIQ==
-----END RSA PRIVATE KEY-----
```


PKCS8处理后的私钥文件示例（Java使用）


```text
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDdG06P8HSIy9sU
GFFqeta/WWf912GX3s7afEzmcthozOcGmE9I0PPVNP/pQDlBHFy2Lkr2/vO7V171
Y/zAe6mysShXyK0D4LnBjjzYdls+/wAhAoBe8HCWJi/omjYbMPPB5eaE4vFZhq3M
+CKJ+Tb2QHpGBco9pL2cdrAHha1xYdnhVC9JsTuVdNfakHIv8ell8A7WooNEcl/E
K7hHH0CkgxIP3x0T+DRvjp8D7c1E5tmK8Z4E+DDd8KucqaVOYgRG8aIfyIQolOkj
4CrqeiqD+7NI/zEhJEiTNoDdaiw2PC+/YzquJHHhPoDhofgBXD8aMkbkfWuzoa1t
I/W/mhrfAgMBAAECggEAXAXdcLLXDYgqqfZlDDgL4J/JVDCsAZVN6kkJiHAL+bIu
BOSnOtscYIQqbl24dozjWT9zG9GIh1QZxW/T5hiRzDlHXSG8QHzrUs9sK3s3BsUC
vLpZyymu8g76qYhlNHPvP6f7hRse7+/JriEn3tzGLz8upK4MOhOyhsgvAzJzuVgG
LJkiWBNlEAaAKex6Eb9Ayv3xlu4L7EOQ4Z6JYgCQc4HYcQjamNEAOnN26M0hwjDz
1WZwuWcmlID5ZSzRT+NKeGD1CC5URuJE95PF1t3dwbZPZf0vMOhS1wnz0C411afq
zrxbE6EI63gGmtixhdNVEvbtOGrcKNfXkuzgMbH3oQKBgQD4ASy8EyNKT9dmLN1p
31/qs9vsE40zthCiAkveUh3Com6S4UdOBa6FzEcaVjJ144mTDm29RMpxzGroTYlx
6ZloqDty7iW+BM8EzAd0ZnLEMei03lqUWViKhhSrAxx/gbR4vR7M/TqIoORmNmaY
8LwW6N7aPSiKClEEpOR4LmLQOwKBgQDkPCOOO2sq8S/RtRbR0fc45wZj0H08/Rky
8+xv+HEBx8sG+4YEbNKgTUXtwbQvLdTAxtPJBoisc2YsEa+gQmOsJEEm9iMzkFIw
PG8OVvGLV1RYI7hsca2/olE5bp0OsQWzt8EDjzzC9CHr8ID4lrfbP0qjSJyoHK6f
mJCz1D75rQKBgFKZ8ZBiv2pM1W1OnCBbKdM+PI2QpYMHrNqI8UQHDap592Isbldq
RQqDU1tOQlhJhNTaBWr4soTclO7yhEjQiSv2fHZ3I1L6vwjV+9WlGayHAv7a4Ehw
ybC5n8CltKQzSyy7sLqNzSUckXYJwHpIFB19Slxd6lavwPRPB1mP+ZFpAoGBAMLa
1UBJWmV/JORVRvY73GWoV7w/86xuKWVm+yVdZp2uhZeghfqhLfHOBzXFeqAM8Obk
2Ut3WJhirYhSUS7xf0cobLdmzQbo4EJuViJX+ECOfmQBmyJ6q2xAmDgAR/aTC9sz
toXjdGy9IXjeDD4v7ygwEPj2tUiRtERtbJ0bR+jBAoGAHY7UZGGl2kD8aL0IxD0s
/LHrGZqO4f7e69pX//5atqP13ZJvjWGWhCGu/OdbcDhnUJEZxtiPfmngx6TlVhoy
cq5eQUJNTJoAvtvKlaqjIIUBCWrI7UZJ32689o41aYkzGGPyOQuF/903srBa0GyW
PEnDrb2/OEhzag7APAJOfkM=
-----END PRIVATE KEY-----
```


公钥文件示例


```text
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3RtOj/B0iMvbFBhRanrW
v1ln/ddhl97O2nxM5nLYaMznBphPSNDz1TT/6UA5QRxcti5K9v7zu1de9WP8wHup
srEoV8itA+C5wY482HZbPv8AIQKAXvBwliYv6Jo2GzDzweXmhOLxWYatzPgiifk2
9kB6RgXKPaS9nHawB4WtcWHZ4VQvSbE7lXTX2pByL/HpZfAO1qKDRHJfxCu4Rx9A
pIMSD98dE/g0b46fA+3NRObZivGeBPgw3fCrnKmlTmIERvGiH8iEKJTpI+Aq6noq
g/uzSP8xISRIkzaA3WosNjwvv2M6riRx4T6A4aH4AVw/GjJG5H1rs6GtbSP1v5oa
3wIDAQAB
-----END PUBLIC KEY-----
```


### 第二步 处理应用公钥格式


将公钥文件去除头尾、换行和空格，转成一行字符串。把该字符串提供给云音乐开放平台账号管理者，登录开放平台上传应用公钥


例如转换前公钥pem文件格式：


```text
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3RtOj/B0iMvbFBhRanrW
v1ln/ddhl97O2nxM5nLYaMznBphPSNDz1TT/6UA5QRxcti5K9v7zu1de9WP8wHup
srEoV8itA+C5wY482HZbPv8AIQKAXvBwliYv6Jo2GzDzweXmhOLxWYatzPgiifk2
9kB6RgXKPaS9nHawB4WtcWHZ4VQvSbE7lXTX2pByL/HpZfAO1qKDRHJfxCu4Rx9A
pIMSD98dE/g0b46fA+3NRObZivGeBPgw3fCrnKmlTmIERvGiH8iEKJTpI+Aq6noq
g/uzSP8xISRIkzaA3WosNjwvv2M6riRx4T6A4aH4AVw/GjJG5H1rs6GtbSP1v5oa
3wIDAQAB
-----END PUBLIC KEY-----
```


转换后得到的字符串为：


```text
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3RtOj/B0iMvbFBhRanrWv1ln/ddhl97O2nxM5nLYaMznBphPSNDz1TT/6UA5QRxcti5K9v7zu1de9WP8wHupsrEoV8itA+C5wY482HZbPv8AIQKAXvBwliYv6Jo2GzDzweXmhOLxWYatzPgiifk29kB6RgXKPaS9nHawB4WtcWHZ4VQvSbE7lXTX2pByL/HpZfAO1qKDRHJfxCu4Rx9ApIMSD98dE/g0b46fA+3NRObZivGeBPgw3fCrnKmlTmIERvGiH8iEKJTpI+Aq6noqg/uzSP8xISRIkzaA3WosNjwvv2M6riRx4T6A4aH4AVw/GjJG5H1rs6GtbSP1v5oa3wIDAQAB
```


### 第三步 在控制台-应用管理中上传密钥


进入控制台的应用管理，选择对应的应用，在【接口加密方式（秘钥）】中，将客户端公钥和服务端公钥填入上面获取到的公钥


- 客户端公钥和服务端公钥填一样的，就是上面步骤处理后的公钥
![图片](https://p5.music.126.net/gMiOhyG3XzkaFsS1yuIosQ==/109951172482480158)

## 签名sign

- docId：`45aac8d12ccb4a98b14e2ea34a1a9cdb`
- 来源：https://developer.music.163.com/st/developer/document?docId=45aac8d12ccb4a98b14e2ea34a1a9cdb

## 签名sign


### 筛选并排序


获取所有请求参数，不包括字节类型参数，如文件、字节流，剔除sign字段，剔除值为空的参数，并按照第一个字符的键值ASCII码递增排序（字母升序排序），如果遇到相同字符则按照第二个字符的键值ASCII码递增排序，以此类推。


### 拼接


将排序后的参数与其对应值，组合成“参数=参数值”的格式，并且把这些参数用&字符连接起来，此时生成的字符串为待签名字符串。


### 请求示例：


**则待签名排序后字符串为：**


```text
appId=a3010100000000008593fd9a2f1c8e44&appSecret=decef822e5766517cd1f47d01a84ad04&bizContent={"appId":"a3010100000000008593fd9a2f1c8e44","appSecret":"decef822e5766517cd1f47d01a84ad04"}&signType=RSA_SHA256&timestamp=1591172872339
```


### 调用签名函数


使用各自语言对应的SHA256WithRSA签名函数利用商户私钥对待签名字符串进行签名。

把生成的签名赋值给sign参数，拼接到请求参数中。


### java代码 参数排序过程


```text
public static String getSignCheckContent(Map<String, String> params) {
        if (params == null) {
            return null;
        }

        params.remove("sign");

        StringBuffer content = new StringBuffer();
        List<String> keys = new ArrayList<String>(params.keySet());
        Collections.sort(keys);

        for (int i = 0; i < keys.size(); i++) {
            String key = keys.get(i);
            String value = params.get(key);
            content.append((i == 0 ? "" : "&") + key + "=" + value);
        }

        return content.toString();
    }
```


### java代码 sign生成过程


```text
import org.apache.commons.codec.binary.Base64;
    import org.apache.commons.io.IOUtils;

    import java.io.ByteArrayInputStream;
    import java.io.InputStream;
    import java.security.KeyFactory;
    import java.security.PrivateKey;
    import java.security.Signature;
    import java.security.spec.PKCS8EncodedKeySpec;
    import java.util.*;

class Test{

    /**
    * 生成sign
    */
    public static String rsa256Sign(String content, String privateKey,
                                    String charset) throws RuntimeException {
        try {
            PrivateKey priKey = getPrivateKeyFromPKCS8("RSA",
                    new ByteArrayInputStream(privateKey.getBytes()));

            Signature signature = Signature.getInstance("SHA256WithRSA");

            signature.initSign(priKey);

            signature.update(content.getBytes(charset));

            byte[] signed = signature.sign();
            return Base64.encodeBase64String(signed);
        } catch (Exception e) {
            throw new RuntimeException("RSA content = " + content + "; charset = " + charset, e);
        }

    }


 		public static PrivateKey getPrivateKeyFromPKCS8(String algorithm,
                                                    InputStream ins) throws Exception {
        if (ins == null) {
            return null;
        }
        KeyFactory keyFactory = KeyFactory.getInstance(algorithm);
        String key = IOUtils.toString(ins);
        byte[] encodedKey = Base64.decodeBase64(key);
        return keyFactory.generatePrivate(new PKCS8EncodedKeySpec(encodedKey));
    }

}
```


### java代码 sign校验过程


```text
public static boolean rsaCheck(Map<String, String> params, String publicKey,
                                   String charset, String signType) throws RuntimeException {
        String sign = params.get("sign");

        String content = getSignCheckContent(params);

        return rsaCheck(content, sign, publicKey, charset,signType);
    }

    public static boolean rsaCheck(String content, String sign, String publicKey, String charset,
                                   String signType) throws RuntimeException {

        if ("RSA_SHA256".equalsIgnoreCase(signType)) {
            return rsa256CheckContent(content, sign, publicKey, charset);
        } else {
            throw new RuntimeException("Sign Type is Not Support : signType=" + signType);
        }

    }

    public static boolean rsa256CheckContent(String content, String sign, String publicKey,
                                             String charset) throws RuntimeException {
        try {
            PublicKey pubKey = getPublicKeyFromX509("RSA",
                    new ByteArrayInputStream(publicKey.getBytes()));

            java.security.Signature signature = java.security.Signature
                    .getInstance("SHA256WithRSA");

            signature.initVerify(pubKey);

            signature.update(content.getBytes(charset));

            return signature.verify(Base64.decodeBase64(sign));
        } catch (Exception e) {
            throw new RuntimeException(
                    "RSAcontent = " + content + ",sign=" + sign + ",charset = " + charset, e);
        }
    }

    public static PublicKey getPublicKeyFromX509(String algorithm,
                                                 InputStream ins) throws Exception {
        KeyFactory keyFactory = KeyFactory.getInstance(algorithm);

        StringWriter writer = new StringWriter();
        IOUtils.copy(ins, writer);


        byte[] encodedKey = Base64.decodeBase64(writer.toString());

        return keyFactory.generatePublic(new X509EncodedKeySpec(encodedKey));
    }
```


### java代码 sign自我验证


可以使用以下的参数，仅仅将 私钥和公钥替换成业务自己生成的，看看是否校验通过


```text
class Test {
    public static void main(String[] args) throws Exception {
        test();
    }

   // 填写业务方自己的秘钥对
   String pubKey = "";
   String privateKey = "";

    private static String test() throws Exception {
        JsonObject jsonObject = new JsonObject();
        Map<String, String> params = new HashMap<String, String>();
        params.put("timestamp", String.valueOf(System.currentTimeMillis()));
        params.put("signType", "RSA_SHA256");
        params.put("appId", "a301010000000000");
        params.put("appSecret", "de6882f913d5956");
        jsonObject.addProperty("appId", "a30101000000000");
        jsonObject.addProperty("appSecret", "de6882f913d5956");
        params.put("bizContent", jsonObject.toString());

        String signCheckContent = getSignCheckContent(params);
        String sign = rsa256Sign(signCheckContent, privateKey, "UTF-8");
        params.put("sign", sign);

        // sign校验
        // result = true 说明sign校验通过
        String signType = params.get("signType");
        boolean result = rsaCheck(params, pubKey, "UTF-8", signType);

    }
}
```


### 安卓代码 生成sign


```text
//私钥
String KEY = "";

String sign = rsa256Sign(sortData(query, formBody));

private static String sortData(String query, FormBody formBody) {
    if (TextTool.isNullOrEmpty(query) && (formBody == null || formBody.size() == 0)) {
        return null;
    }
    HashMap<String, String> queries = new HashMap<>();
    queries.put("signType", SIGN_TYPE);
    if (!TextTool.isNullOrEmpty(query)) {
        int start = 0;
        do {
            int next = query.indexOf('&', start);
            int end = next == -1 ? query.length() : next;
            int separator = query.indexOf('=', start);
            if (separator > end || separator == -1) {
                separator = end;
            }
            String name = query.substring(start, separator);
            String value = separator + 1 >= end ? "" : query.substring(separator + 1, end);
            queries.put(Uri.decode(name), Uri.decode(value));
            // Move start to end of name.
            start = end + 1;
        } while (start < query.length());
    }

    if (formBody != null && formBody.size() > 0) {
        for (int i = 0; i < formBody.size(); i++) {
            queries.put(formBody.name(i), formBody.value(i));
        }
    }

    StringBuilder content = new StringBuilder();
    List<String> keys = new ArrayList<>(queries.keySet());
    Collections.sort(keys);

    for (int i = 0; i < keys.size(); i++) {
        String key = keys.get(i);
        String value = queries.get(key);
        content.append(i == 0 ? "" : "&").append(key).append("=").append(value);
    }
    return content.toString();

}


private static String rsa256Sign(String content) throws NoSuchAlgorithmException, InvalidKeySpecException, InvalidKeyException, SignatureException {

    byte[] keyBytes = Base64.getDecoder().decode(KEY);
    PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(keyBytes);
    KeyFactory keyFactory = KeyFactory.getInstance("RSA");
    PrivateKey priKey = keyFactory.generatePrivate(spec);

    Signature signature = Signature.getInstance("SHA256withRSA");

    signature.initSign(priKey);
    signature.update(content.getBytes(StandardCharsets.UTF_8));

    byte[] signed = signature.sign();
    return Base64.getEncoder().encodeToString(signed);
}
```


### ios代码 生成sign


```text
/// 筛选并排序
+ (NSString *)sortDataWithQuery:(NSDictionary *)query formBody:(NSDictionary *)formBody {
    if ((query == nil || [query count] == 0) && (formBody == nil || [formBody count] == 0)) {
        return nil;
    }

    NSMutableDictionary *queries = [NSMutableDictionary dictionary];
    [queries setObject:SIGN_TYPE forKey:@"signType"];

    if (query != nil && [query count] > 0) {
        [queries addEntriesFromDictionary:query];
    }

    if (formBody != nil && [formBody count] > 0) {
        [queries addEntriesFromDictionary:formBody];
    }

    NSMutableString *content = [NSMutableString string];
    NSArray *keys = [[queries allKeys] sortedArrayUsingSelector:@selector(compare:)];

    for (NSInteger i = 0; i < [keys count]; i++) {
        NSString *key = keys[i];
        NSString *value = queries[key];
        [content appendFormat:@"%@%@=%@", (i == 0 ? @"" : @"&"), key, value];
    }

    return content;
}


/// 对参数进行签名
/// - Parameters:
///   - content: 待签名的请求信息
///   - key: 私钥
+ (NSString *)rsa256Sign:(NSString *)content key:(NSString *)key {

    if (key.length <= 0 || content <= 0) {
        return @"";
    }

    // 先排序内容的移除转义符号
    content = [content stringByReplacingOccurrencesOfString:@"\\"  withString:@""];

    NSRange spos;
    NSRange epos;
    spos = [key rangeOfString:@"-----BEGIN RSA PRIVATE KEY-----"];
    if(spos.length > 0){
        epos = [key rangeOfString:@"-----END RSA PRIVATE KEY-----"];
    }else{
        spos = [key rangeOfString:@"-----BEGIN PRIVATE KEY-----"];
        epos = [key rangeOfString:@"-----END PRIVATE KEY-----"];
    }
    if(spos.location != NSNotFound && epos.location != NSNotFound){
        NSUInteger s = spos.location + spos.length;
        NSUInteger e = epos.location;
        NSRange range = NSMakeRange(s, e-s);
        key = [key substringWithRange:range];
    }
    key = [key stringByReplacingOccurrencesOfString:@"\r" withString:@""];
    key = [key stringByReplacingOccurrencesOfString:@"\n" withString:@""];
    key = [key stringByReplacingOccurrencesOfString:@"\t" withString:@""];
    key = [key stringByReplacingOccurrencesOfString:@" "  withString:@""];

    NSData *keyData = [[NSData alloc] initWithBase64EncodedString:key options:NSDataBase64DecodingIgnoreUnknownCharacters];
    NSError *error = nil;
    keyData = [self stripHeaderIfAny:keyData error:&error];

    key = [keyData base64EncodedStringWithOptions:NSDataBase64Encoding64CharacterLineLength];

    return [self sign:content withPriKey:key];
}

#pragma mark - 私钥预处理
+ (NSData *)stripHeaderIfAny:(NSData *)keyData error:(NSError **)error {
    const unsigned char *bytes = (const unsigned char *)[keyData bytes];
    NSUInteger length = [keyData length];
    NSUInteger offset = 0;

    if (bytes[offset] != 0x30) {
        if (error) {
            *error = [NSError errorWithDomain:@"YourErrorDomain" code:0 userInfo:@{NSLocalizedDescriptionKey: @"ASN1Parse"}];
        }
        return nil;
    }
    offset += 1;

    if (bytes[offset] > 0x80) {
        offset += bytes[offset] - 0x80;
    }
    offset += 1;

    if (bytes[offset] != 0x02) {
        if (error) {
            *error = [NSError errorWithDomain:@"YourErrorDomain" code:0 userInfo:@{NSLocalizedDescriptionKey: @"ASN1Parse"}];
        }
        return nil;
    }
    offset += 3;

    if (bytes[offset] == 0x02) {
        return keyData;
    }

    unsigned char OID[15] = {0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
                            0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00};
    unsigned char slice[15];
    memcpy(slice, &bytes[offset], sizeof(slice));

    if (memcmp(slice, OID, sizeof(slice)) != 0) {
        if (error) {
            *error = [NSError errorWithDomain:@"YourErrorDomain" code:0 userInfo:@{NSLocalizedDescriptionKey: @"ASN1Parse"}];
        }
        return nil;
    }

    offset += sizeof(slice);
    if (bytes[offset] != 0x04) {
        if (error) {
            *error = [NSError errorWithDomain:@"YourErrorDomain" code:0 userInfo:@{NSLocalizedDescriptionKey: @"ASN1Parse"}];
        }
        return nil;
    }

    offset += 1;
    if (bytes[offset] > 0x80) {
        offset += bytes[offset] - 0x80;
    }
    offset += 1;

    if (bytes[offset] != 0x30) {
        if (error) {
            *error = [NSError errorWithDomain:@"YourErrorDomain" code:0 userInfo:@{NSLocalizedDescriptionKey: @"ASN1Parse"}];
        }
        return nil;
    }

    return [keyData subdataWithRange:NSMakeRange(offset, length - offset)];
}


#pragma mark - 签名
+ (NSString *)sign:(NSString *)content withPriKey:(NSString *)priKey
{
    if (!content || !priKey) {
        NSLog(@"签名");
        return nil;
    }

    SecKeyRef privateKeyRef = [self addSignPrivateKey:priKey];
    if (!privateKeyRef) { NSLog(@"添加私钥失败"); return  nil; }

    NSData *plainTextBytes = [content dataUsingEncoding:NSUTF8StringEncoding];
    NSData *signData = [self sha256WithRSA:plainTextBytes privateKey:privateKeyRef];

    NSString *ret = [signData base64EncodedStringWithOptions:NSDataBase64Encoding64CharacterLineLength];

    //干掉字符串中的\r和\n
    NSMutableString *mutString = [NSMutableString stringWithString:ret];
    NSString *oneString = [mutString stringByReplacingOccurrencesOfString:@"\r" withString:@""];
    NSString *twoString = [oneString stringByReplacingOccurrencesOfString:@"\n" withString:@""];
    NSString *finalString = [NSString stringWithString:twoString];
    return finalString;

}

+ (NSData *)sha256WithRSA:(NSData *)plainData privateKey:(SecKeyRef)privateKey {

    size_t signedHashBytesSize = SecKeyGetBlockSize(privateKey);
    uint8_t* signedHashBytes = malloc(signedHashBytesSize);
    memset(signedHashBytes, 0x0, signedHashBytesSize);

    size_t hashBytesSize = CC_SHA256_DIGEST_LENGTH;
    uint8_t* hashBytes = malloc(hashBytesSize);
    if (!CC_SHA256([plainData bytes], (CC_LONG)[plainData length], hashBytes)) {
        return nil;
    }

    SecKeyRawSign(privateKey,
                  kSecPaddingPKCS1SHA256,
                  hashBytes,
                  hashBytesSize,
                  signedHashBytes,
                  &signedHashBytesSize);

    NSData* signedHash = [NSData dataWithBytes:signedHashBytes
                                        length:(NSUInteger)signedHashBytesSize];

    if (hashBytes)
        free(hashBytes);
    if (signedHashBytes)
        free(signedHashBytes);

    return signedHash;
}

+ (SecKeyRef)addSignPrivateKey:(NSString *)key{

    // This is a base64 encoded key. so, decode it.
    NSData *data = [[NSData alloc] initWithBase64EncodedString:key options:NSDataBase64DecodingIgnoreUnknownCharacters];

    if(!data){ return nil; }
    //a tag to read/write keychain storage
    NSString *tag = @"RSA_PRIVATE_KEY";
    NSData *d_tag = [NSData dataWithBytes:[tag UTF8String] length:[tag length]];

    // Delete any old lingering key with the same tag
    NSMutableDictionary *privateKey = [[NSMutableDictionary alloc] init];
    [privateKey setObject:(__bridge id) kSecClassKey forKey:(__bridge id)kSecClass];
    [privateKey setObject:(__bridge id) kSecAttrKeyTypeRSA forKey:(__bridge id)kSecAttrKeyType];
    [privateKey setObject:d_tag forKey:(__bridge id)kSecAttrApplicationTag];
    SecItemDelete((__bridge CFDictionaryRef)privateKey);

    // Add persistent version of the key to system keychain
    [privateKey setObject:data forKey:(__bridge id)kSecValueData];
    [privateKey setObject:(__bridge id) kSecAttrKeyClassPrivate forKey:(__bridge id)kSecAttrKeyClass];
    [privateKey setObject:[NSNumber numberWithBool:YES] forKey:(__bridge id)kSecReturnPersistentRef];

    CFTypeRef persistKey = nil;
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)privateKey, &persistKey);
    if (persistKey != nil){ CFRelease(persistKey); }
    if ((status != noErr) && (status != errSecDuplicateItem)) { return nil; }

    [privateKey removeObjectForKey:(__bridge id)kSecValueData];
    [privateKey removeObjectForKey:(__bridge id)kSecReturnPersistentRef];
    [privateKey setObject:[NSNumber numberWithBool:YES] forKey:(__bridge id)kSecReturnRef];
    [privateKey setObject:(__bridge id) kSecAttrKeyTypeRSA forKey:(__bridge id)kSecAttrKeyType];

    // Now fetch the SecKeyRef version of the key
    SecKeyRef keyRef = nil;
    status = SecItemCopyMatching((__bridge CFDictionaryRef)privateKey, (CFTypeRef *)&keyRef);
    if(status != noErr){
        return nil;
    }
    return keyRef;
}
```


### postman请求验证


```text
GET /openapi/music/basic/oauth2/login/anonymous?appId=a301010000000000aadb4e5a28b45a67&signType=RSA_SHA256&timestamp=1652417800038&device={"deviceType":"andrwear","os":"otos","appVer":"0.1","channel":"hm","model":"kys","deviceId":"357","brand":"hm","osVer":"8.1.0"}&bizContent={"clientId":"a301010000000000aadb4e5a28b45a67"}&sign=ny1SQZV%2FW25FCGzngEmFK4ms2slBl6I7%2BzKE0jyGzmjL%2BTbfIpOf4txOyek3tG7xOrfzAsUoZxv%2BFfkum57Im6%2Bae6pwYxEoDJLiVTDIbuVJDrJ5ROUoAuO9NtomxU0cfcG2f7SsONBCVWnS9XRn6waTqw%2FYMyAcA8cCVkiifevc37l2XQ6nNRhWc0H23Zx2kJD7S9PFPYb5BMJT7ps4wg5itGFV%2BhN39S4o8UJU%2BKZRiUIH3t146aVxGoemmLUP211CRaUIRWSk0cwHJIuykwlwhE99d6DZ5mRiMY7s0jHMUhMDXrP079NnfFmxwZikaCVLVneCGgQ7tnVGI3MdrQ%3D%3D%0A%0A HTTP/1.1
Host: openapi.music.163.com
Content-Type: application/json
Cookie: NMTID=00O4P4UIh4SmW6Te00dnT3zeKuMRYYAAAF9DrYQWA
```


其中sign是进行了url编码


将如上数据导入到postman，导入入口：
![](https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/14451645092/2682/e346/e848/a0112fe38d2e67abeec142c00e2b1930.jpg)


导入之后，点击发送， 提示 非法timestamp参数， 说明通过sign验签。


然后将上面参数换成业务方自己的参数

## python签名

- docId：`62d2c09579c241fa966de6fbd739d574`
- 来源：https://developer.music.163.com/st/developer/document?docId=62d2c09579c241fa966de6fbd739d574

### 1、生成签名


```text
from typing import Optional

from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15
from Crypto.Hash import SHA256
import base64


class RSASignature:

    @staticmethod
    def _format_key(key_string: str, key_type: str) -> str:
        """
        格式化密钥字符串为PEM格式
        :param key_string: 原始密钥字符串
        :param key_type: 'PRIVATE' 或 'PUBLIC'
        :return: PEM格式的密钥字符串
        """
        # 移除所有空白字符
        key_string = ''.join(key_string.split())

        # 添加头尾和换行
        formatted_key = f"-----BEGIN {key_type} KEY-----\n"
        for i in range(0, len(key_string), 64):
            formatted_key += key_string[i:i + 64] + '\n'
        formatted_key += f"-----END {key_type} KEY-----"

        return formatted_key

    @staticmethod
    def rsa_sign(content: str, private_key: str) -> Optional[str]:
        """
        使用RSA私钥对内容进行签名
        :param content: 要签名的内容
        :param private_key: 原始X509格式的RSA私钥 (无头尾和换行)
        :return: Base64编码的签名
        """
        try:
            # 格式化私钥
            formatted_private_key = RSASignature._format_key(private_key, "PRIVATE")

            # 将私钥字符串转换为RSA key对象
            key = RSA.import_key(formatted_private_key)

            # 创建SHA256哈希对象
            hash_obj = SHA256.new(content.encode('utf-8'))

            # 使用私钥进行签名
            signature = pkcs1_15.new(key).sign(hash_obj)

            # 将签名转换为Base64编码
            return base64.b64encode(signature).decode('utf-8')
        except Exception as e:
            print(f"签名过程中出现错误: {str(e)}")
            return None

    @staticmethod
    def rsa_sign_check(content: str, sign: str, public_key: str) -> bool:
        """
        使用RSA公钥验证签名
        :param content: 原始内容
        :param sign: Base64编码的签名
        :param public_key: 原始X509格式的RSA公钥 (无头尾和换行)
        :return: 验证结果 (True/False)
        """
        try:
            # 格式化公钥
            formatted_public_key = RSASignature._format_key(public_key, "PUBLIC")

            # 将公钥字符串转换为RSA key对象
            key = RSA.import_key(formatted_public_key)

            # 创建SHA256哈希对象
            hash_obj = SHA256.new(content.encode('utf-8'))

            # 将Base64编码的签名解码
            signature = base64.b64decode(sign)

            # 验证签名
            pkcs1_15.new(key).verify(hash_obj, signature)
            return True
        except (ValueError, TypeError):
            return False
        except Exception as e:
            print(f"验证过程中出现错误: {str(e)}")
            return False


    @staticmethod
    def format_parameters(params: dict) -> str:
        """
        格式化参数为待签名字符串

        :param params: 包含所有参数的字典
        :return: 格式化后的待签名字符串
        """
        # 步骤1：过滤和排序参数
        filtered_params = {}
        for key, value in params.items():
            # 剔除 sign 字段、值为空的参数、字节类型参数
            if key != 'sign' and value != '' and not isinstance(value, bytes):
                filtered_params[key] = value

        # 按照键的ASCII码值排序
        sorted_params = sorted(filtered_params.items(), key=lambda x: x[0])

        # 步骤2：组合参数
        param_pairs = []
        for key, value in sorted_params:
            # 将布尔类型转换为小写字符串
            if isinstance(value, bool):
                value = str(value).lower()
            # 将其他类型转换为字符串
            else:
                value = str(value)
            param_pairs.append(f"{key}={value}")

        # 用&连接所有参数对
        return "&".join(param_pairs)
```


### 2、发送请求


```text
import time
import requests

from urllib.parse import quote

from sign_utils import RSASignature

# 1.RSA Secret
# private_key(Excluding the head and tail)
private_key = "MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCzo/tRTqjJp3DBAk1JCQwAZkDpBGsi9j7zwNM2l/Yl9uPvP+HuSD7mL00vUDfqGntiydc4g1PUI+CzInMokqgTo0NqYuDOALDJH1nbnTGW7ndCfsYipLD69AT0gpz5zoSw8yNDh9J2otuecaT3Foj0Qj+3XwUP8mbSwCfCkAvxoBtcwF/72dGDi7DfLIwqydn+UnAmVhHh6PL428W2eZsAlt9AqJ0E9B11MOVT3Xv1p7MKUPsRahfdyoV5cJGag+WJJ3mTFHkmEGKTeERmNbux6OxxdxAGYpL0AFMr9Bj7zoXG+gTEYWCVWNp/27cjGVKy7q3i0hBH52bdK69Of6FdAgMBAAECggEAB/thT1uPZGZsPCc+B+C/B8WDXNc1a3hFk88dk29tIIK33gmYoF3VbaTsaQ3Hbj9+/AS762bqcqKleVAujb72eOjoNfHuyzh8onMiKv/xFCPEaM/5PdDTjFMLZVHoZ7EldDdZecavM1ZJK+Eg01nM/A11h1BRiUPcDcE8AwkjfrjrVnoFpG20JlDO6RLoUgENzGFpZa9lHx0OHLdpi1sUfphZ0bIQrT6KfqyH/8uWxgTIuOGuc4KNhRffKMO8jAIO/TSVMvA9P/JV6f1XSyTS8W+v11kemqTaYbscmVZNEblqrKj/4Gl2xJQJDDP/nbaW/QeyDqvTGoLBj8qjKDHKgQKBgQDtXAd5AcIP3pYdh3HfcNlJAwLAppUFnfpPZyzx1Cpmt0yTQyHGgGWiCBEv5F4GiXjIm6nFCYic9tbW3MS5b/0BRNWj+jmW4s2jZG2S0QFQq4U2ctCsxZ0/lrl0MmLyXm2ZPk0RUA1q/GJnZF+0xDnog6+gSI85Pr9P3hBqY8/wQwKBgQDBv4w7gjz69hsYGa3kjur1E0r1NG6D9Pi6n0NgTM3PkU3G4ynLU2UCtD4RL+K/1KlmauzlZgjGL57pogsGmy1PO5DrcP4IOXN2XSxW0J98wqRNSdF4BWPUMTCDJ7rJEvZW5pgoE9vEifJwRfEfwjH9jwKmXI6j12kjbo/B2sdd3wKBgAkXMzoRNSuCbOFopJXYLpo7QUm7l42FhWaxHumMJKuWbZpeQdbmZ/4SrQXWiztY3IViYNgpC1Bnq8bC4c3wWhJIXp5PIRGEUjflysSKuLAsQYfaUd+sGd+rmCK5I00BDNWHq0/0bu8gB2zKTVgRA97B3GIZJVMd8hnO+XX5qKcdAoGAViQl4ydqmWHmdfak2+O3DzN+tjqTkFPQapj4yc4cC1ddLzo8kMwJMwSUO+wAcq3Ii2Kq5OtSp1rw2otTP6KqqHmhWyynpVx1u4B9gDPNVRjtF/fkC+rJkcQ0/3sgjtnBcK2hpN//bAixI73VEPu0Yjm9Qd4RBUN22WwEunnc/h0CgYABdzqEvin+eCJX9EQXE13T+p+4v+OUwM37kuHyoo6hyG6cBp2cql/7/OeY6aBIlFXMCeYZn7OOGvQrpYHm6r5HogCbU8CBpqBFKf4q3lvFZGGuWIVG3NwsjbS+E6Zfn1i9UgPLfOtCUu/apQ4PS5MYKhbbYhPzNdiw9qceCCMG3A=="
# public_key（Excluding the head and tail）
public_key = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0co7fAOKt8MHncUCJEkC86FrtGcd6H85YgGA5P8BvG0yj1zDnprPbcyHENJinTSUf55K11qw+Adh1g/pLnMmuz5Rf2YXnlozeVhu0zWXmvbQ5wwaKsFdw/4ttSgxUDThc5mFOEbKCkVKRHk0dphniAg/6uWf07cu4vhqWETVUnmBf2kdxRwLjNg7EeClOVr4W9UgyEltbnATZ30L9iKX6aTxPvha5CfYalJJP5rVHFMlv3HYhBclQlgwpi1gIs/R7KUixeBLCbixsCUsrfLf618Rf6YPQBq19PMlyHjiJuyMmTclxUzOpQhwo+ufHn81sf1EtHiTwxzXBoQXzSNAqwIDAQAB"
# 2.check rsa secret
# new RSASignature class
rsa_signature = RSASignature()
# sign content
content = "Hello, World!"
# sign
# signature = rsa_signature.rsa_sign(content, private_key)
# print(f"sign result: {signature}")
# check sign
# is_valid = rsa_signature.rsa_sign_check(content, signature, public_key)
# print(f"check sign result: {is_valid}")

# 3.params
params = {
    'appId': 'a3010200000000004b96bd1465e5b5ef',
    # 'appSecret': 'de3a47677aa3396205ee15ec80302a6f',
    # If prompted with '非法timestamp参数'(Illegal timestamp parameter)，Less than 5 minutes away from Beijing time，UTC-8
    'timestamp': int(time.time() * 1000),
# 'timestamp': '1748244221272',
    # device(Please do not change)
    # 'device': '{"deviceType":"mobile","os":"mobilegame","appVer":"0.1","channel":"LostLight","model":"one","deviceId":"one","brand":"LostLight","osVer":"8.1.0","clientIp":"192.168.0.1"}',
    'device': '{"clientIp":"191.1.1.3","deviceType":"mobile","os":"mobilegame","appVer":"0.1","channel":"yanyun","model":"xtc","deviceId":"123321","brand":"yanyun","osVer":"8.1.0"}',
    # accessToken(Important:anonymous Access credentials,Please do not change)
    # 'accessToken': 'wdbaaf4f5108ec03d911701ccfc8cd8d972bea30201cb763dv',
    'signType': 'RSA_SHA256'
}


# 4.getChartDetail
# a. Dictionary order sorting and concatenation parameters
#         云音乐欧美热歌榜id(Cloud Music Europe and America Hot Song Chartid)：77493A072BD5817BC98EA8B4578A9A97    https://music.163.com/#/discover/toplist?id=2809513713
          # 云音乐欧美新歌榜id(Cloud Music Europe and America New Song Chartid)：EBDF703D3CAC5D2F2C5BAC1C40AC21E2    https://music.163.com/#/discover/toplist?id=2809577409
#          热歌榜(Hot Song Chartid)：133DB30670BBDFB8B912A06FA44F6522            https://music.163.com/#/discover/toplist?id=3778678
params['bizContent']='{"clientId":"a3010200000000004b96bd1465e5b5ef"}'
content = rsa_signature.format_parameters(params)
# b. sign
sign = rsa_signature.rsa_sign(content, private_key)
print(sign)
# c. Signature field with separate URL encoding
params['sign'] = quote(sign)
url = 'https://openapi.music.163.com/openapi/music/basic/oauth2/login/anonymous?' + "&".join(
    [f"{k}={v}" for k, v in params.items()])
print(url)
song_detail_res = requests.get(url)
print(song_detail_res.text)
result = rsa_signature.rsa_sign_check(content,sign,public_key)
print(result)
```

## java签名

- docId：`af60cf06b7e944189116d08f6ccd6a29`
- 来源：https://developer.music.163.com/st/developer/document?docId=af60cf06b7e944189116d08f6ccd6a29

## 签名sign


## 1、生成待签名字符串


### 筛选并排序


获取所有请求参数，不包括字节类型参数，如文件、字节流，剔除sign字段，剔除值为空的参数，并按照第一个字符的键值ASCII码递增排序（字母升序排序），如果遇到相同字符则按照第二个字符的键值ASCII码递增排序，以此类推。


### 拼接


将排序后的参数与其对应值，组合成“参数=参数值”的格式，并且把这些参数用&字符连接起来，此时生成的字符串为待签名字符串。


### java代码示例：


```text
public static String getSignCheckContent(Map<String, String> params) {
        if (params == null) {
            return null;
        }

        params.remove("sign");

        StringBuffer content = new StringBuffer();
        List<String> keys = new ArrayList<String>(params.keySet());
        Collections.sort(keys);

        for (int i = 0; i < keys.size(); i++) {
            String key = keys.get(i);
            String value = params.get(key);
            content.append((i == 0 ? "" : "&") + key + "=" + value);
        }

        return content.toString();
    }
```


**则待签名排序后字符串为：**


```text
appId=a3010200000000008fded78f47c1db11&bizContent={"clientId":"a3010200000000008fded78f47c1db11"}&device={"channel":"iotapitest","deviceId":"3371722400792710","deviceType":"openapi","appVer":"500121.2025-10-16","os":"openapi","osVer":"13","brand":"iotapitest","model":"OBE_C2D","clientIp":"192.168.31.194"}&signType=RSA_SHA256&timestamp=1770619952903
```


## 2、调用签名函数


使用各自语言对应的SHA256WithRSA签名函数利用应用私钥对待签名字符串进行签名。

把生成的签名赋值给sign参数，再拼接到请求参数中。


### java代码 sign生成过程


```text
import org.apache.commons.codec.binary.Base64;
    import org.apache.commons.io.IOUtils;

    import java.io.ByteArrayInputStream;
    import java.io.InputStream;
    import java.security.KeyFactory;
    import java.security.PrivateKey;
    import java.security.Signature;
    import java.security.spec.PKCS8EncodedKeySpec;
    import java.util.*;

class Test{

    /**
    * 生成sign
    */
    public static String rsa256Sign(String content, String privateKey,
                                    String charset) throws RuntimeException {
        try {
            PrivateKey priKey = getPrivateKeyFromPKCS8("RSA",
                    new ByteArrayInputStream(privateKey.getBytes()));

            Signature signature = Signature.getInstance("SHA256WithRSA");

            signature.initSign(priKey);

            signature.update(content.getBytes(charset));

            byte[] signed = signature.sign();
            return Base64.encodeBase64String(signed);
        } catch (Exception e) {
            throw new RuntimeException("RSA content = " + content + "; charset = " + charset, e);
        }

    }


 		public static PrivateKey getPrivateKeyFromPKCS8(String algorithm,
                                                    InputStream ins) throws Exception {
        if (ins == null) {
            return null;
        }
        KeyFactory keyFactory = KeyFactory.getInstance(algorithm);
        String key = IOUtils.toString(ins);
        byte[] encodedKey = Base64.decodeBase64(key);
        return keyFactory.generatePrivate(new PKCS8EncodedKeySpec(encodedKey));
    }

}
```


## 3、签名校验


### java代码


云音乐sign校验过程，接入方也可按照此规则本地校验


```text
public static boolean rsaCheck(Map<String, String> params, String publicKey,
                                   String charset, String signType) throws RuntimeException {
        String sign = params.get("sign");

        String content = getSignCheckContent(params);

        return rsaCheck(content, sign, publicKey, charset,signType);
    }

    public static boolean rsaCheck(String content, String sign, String publicKey, String charset,
                                   String signType) throws RuntimeException {

        if ("RSA_SHA256".equalsIgnoreCase(signType)) {
            return rsa256CheckContent(content, sign, publicKey, charset);
        } else {
            throw new RuntimeException("Sign Type is Not Support : signType=" + signType);
        }

    }

    public static boolean rsa256CheckContent(String content, String sign, String publicKey,
                                             String charset) throws RuntimeException {
        try {
            PublicKey pubKey = getPublicKeyFromX509("RSA",
                    new ByteArrayInputStream(publicKey.getBytes()));

            java.security.Signature signature = java.security.Signature
                    .getInstance("SHA256WithRSA");

            signature.initVerify(pubKey);

            signature.update(content.getBytes(charset));

            return signature.verify(Base64.decodeBase64(sign));
        } catch (Exception e) {
            throw new RuntimeException(
                    "RSAcontent = " + content + ",sign=" + sign + ",charset = " + charset, e);
        }
    }

    public static PublicKey getPublicKeyFromX509(String algorithm,
                                                 InputStream ins) throws Exception {
        KeyFactory keyFactory = KeyFactory.getInstance(algorithm);

        StringWriter writer = new StringWriter();
        IOUtils.copy(ins, writer);


        byte[] encodedKey = Base64.decodeBase64(writer.toString());

        return keyFactory.generatePublic(new X509EncodedKeySpec(encodedKey));
    }
```


### java代码 完整demo


可以使用以下的参数，仅仅将 私钥和公钥替换成业务自己生成的，看看是否校验通过


```text
class Test {
    public static void main(String[] args) throws Exception {
        test();
    }

   // 填写业务方自己的秘钥对
   String pubKey = "";
   String privateKey = "";

    private static String test() throws Exception {
        JsonObject jsonObject = new JsonObject();
        Map<String, String> params = new HashMap<String, String>();
        params.put("timestamp", String.valueOf(System.currentTimeMillis()));
        params.put("signType", "RSA_SHA256");
        params.put("appId", "a301010000000000");
        params.put("appSecret", "de6882f913d5956");
        jsonObject.addProperty("appId", "a30101000000000");
        jsonObject.addProperty("appSecret", "de6882f913d5956");
        params.put("bizContent", jsonObject.toString());

        String signCheckContent = getSignCheckContent(params);
        String sign = rsa256Sign(signCheckContent, privateKey, "UTF-8");
        params.put("sign", sign);

        // sign校验
        // result = true 说明sign校验通过
        String signType = params.get("signType");
        boolean result = rsaCheck(params, pubKey, "UTF-8", signType);

    }
}
```


## 4、postman请求验证


```text
GET /openapi/music/basic/oauth2/login/anonymous?appId=a3010200000000008fded78f47c1db11&bizContent={"clientId":"a3010200000000008fded78f47c1db11"}&device={"channel":"iotapitest","deviceId":"3371722400792710","deviceType":"openapi","appVer":"500121.2025-10-16","os":"openapi","osVer":"13","brand":"iotapitest","model":"OBE_C2D","clientIp":"192.168.31.194"}&signType=RSA_SHA256&timestamp=1769595629089&sign=It8ngRenuNAushsHwBNJXxMuJem+ifW9j+xd4RaylpKsDd1inaej5MW5xjnsdU4iPgyOAWbuwWMrLt1zdu+dviVmpx/l0ZET/TQYYp6NZnB6oGewGaSn9MRMSYWLRrIRHB02om5zqGXL4WWwuC7pRgGPF2ouvcR/3CqTIc5TdVxxZX4efKqwpnt7I+zZcU1DmgCkR79BiFX3iP6Pxih3Zx1tZpvZUg9DZ2s3ZXjwD5wvH5TMNthi6CjKBMLOdqJq6s35kvkf7OXKJIs8ANh1hVPcQNT8F8zAvwOgB4yLlJ7eDZ8Ioc3y+VPh219vfFKf0JAf6L4wqrZ8NtrlbBHHRA==
Host: openapi.music.163.com
Content-Type: application/json
Cookie: NMTID=00O4P4UIh4SmW6Te00dnT3zeKuMRYYAAAF9DrYQWA
```


其中sign是进行了url编码


将如上数据导入到postman，导入入口：
![](https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/14451645092/2682/e346/e848/a0112fe38d2e67abeec142c00e2b1930.jpg)


导入之后，点击发送， 提示 非法timestamp参数， 说明通过sign验签。


然后将上面参数换成业务方自己的参数

# 公共

## 访问方式

- docId：`d5ab035d4b9d4a088ff9f4ef3ea5005a`
- 来源：https://developer.music.163.com/st/developer/document?docId=d5ab035d4b9d4a088ff9f4ef3ea5005a

## 请求说明


- 统一采用https、get/post请求，加密形式：[RSA加密](?docId=56fb9f543d6f4cc3b48a862ed408a075)

- 线上环境域名：openapi.music.163.com

- 无论是客户端还是服务端发起的请求，请用生成的私钥进行加密，并将对应的公钥上传至开放平台->应用管理 -> 进入应用详情页 -> 接口加密方式


## 访问方式


不同的接口会要求使用GET或POST方式请求，文档中如果没有特殊标识，默认是使用GET请求


## 权限控制


为规范接口调用、保障服务安全、实现精细化运营及商业化策略，在OpenAPI体系中有一套完整的权限控制机制


<table>
<thead>
<tr>
<th>模块</th>
<th>核心功能</th>
<th>实现逻辑</th>
</tr>
</thead>
<tbody>
<tr>
<td>接口鉴权</td>
<td>验证请求合法性</td>
<td>1. 签名校验：业务方需使用预置密钥，对请求参数和当前 Unix 时间戳生成 sign。服务端校验其正确性。<br>2. 时效性校验：校验 timestamp，拒绝过期请求（如 >5 分钟）</td>
</tr>
<tr>
<td>访问频率限制</td>
<td>防盗刷</td>
<td>1. 限流对象：AppID中的各个接口为单位进行限流。2. 触发机制：当调用频率超过约定阈值50，触发限流，返回-444、-445、-446。</td>
</tr>
<tr>
<td>用户会员身份</td>
<td>内容差异化</td>
<td>身份识别：解析用户登录态，返回差异化数据：仅向会员返回可播放的音频链接，非会员返回试听片段或无链接）。具体字段见各接口文档。</td>
</tr>
<tr>
<td>默认登录策略</td>
<td>优化算法推荐</td>
<td>网易云将根据部分接口类型，强制要求登录策略。</td>
</tr>
</tbody>
</table>

## HTTPDNS接入

- docId：`c46ab3181cc348bdb1df1324aec66f88`
- 来源：https://developer.music.163.com/st/developer/document?docId=c46ab3181cc348bdb1df1324aec66f88

## HTTPDNS接入


### /openapi/music/basic/httpdns/d


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 前置条件


- openapi httpdns在local dns得到的ip，访问出现问题时作为备用方式获取ip


访问异常指以下两类异常：


SocketTimeout


ConnectionTimeout


注意，openapi httpdns并不接受所有请求，只解析云音乐相关域名。


比如：music.126.net


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>domain</td>
<td>是</td>
<td>String</td>
<td>云音乐相关域名</td>
</tr>
<tr>
<td>ip</td>
<td>否</td>
<td>Int</td>
<td>若未填会尝试获取请求发起的ip</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/httpdns/d?bizContent={"domain":"m107.music.126.net"}&appId=a301010000000000aadb4e5a28b45a67&signType=RSA_SHA256&accessToken=9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd&appSecret=de6882f913d59560c9f37345f4cb0053&device={"deviceType":"andrwear","os":"otos","appVer":"0.1","channel":"hm","model":"kys","deviceId":"357","brand":"hm","osVer":"8.1.0"}&timestamp=1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>ip</td>
<td>String</td>
<td>ipv4列表</td>
</tr>
<tr>
<td>ipv6</td>
<td>String</td>
<td>ipv6列表</td>
</tr>
<tr>
<td>prefer</td>
<td>String</td>
<td>推荐ipv4或ipv6</td>
</tr>
<tr>
<td>ttl</td>
<td>String</td>
<td>过期时间</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
    "code": 200,
    "subCode": null,
    "message": null,
    "data": {
        "ip": [
            "122.225.209.221",
            "122.225.209.220",
            "122.225.209.222",
            "122.225.209.224",
            "122.225.209.218",
            "122.225.209.225",
            "122.225.209.219",
            "122.225.209.223"
        ],
        "ipv6": null,
        "prefer": "ipv4",
        "ttl": 600
    }
}
```

## 公共错误码

- docId：`920866a9a2c2439da4d85ee5c4d23700`
- 来源：https://developer.music.163.com/st/developer/document?docId=920866a9a2c2439da4d85ee5c4d23700

## 公共错误码


<table>
<thead>
<tr>
<th>code</th>
<th>message</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>成功</td>
</tr>
<tr>
<td>300</td>
<td>应用未授权当前接口</td>
</tr>
<tr>
<td>2403</td>
<td>缺少signType参数</td>
</tr>
<tr>
<td>2402</td>
<td>缺少sign参数</td>
</tr>
<tr>
<td>2404</td>
<td>缺少timestamp参数</td>
</tr>
<tr>
<td>2405</td>
<td>缺少appId参数</td>
</tr>
<tr>
<td>2406</td>
<td>应用未完成加密配置</td>
</tr>
<tr>
<td>2501</td>
<td>缺少channel参数</td>
</tr>
<tr>
<td>2502</td>
<td>缺少deviceId参数</td>
</tr>
<tr>
<td>2503</td>
<td>缺少deviceType参数</td>
</tr>
<tr>
<td>2504</td>
<td>缺少appVer参数</td>
</tr>
<tr>
<td>2505</td>
<td>缺少os参数</td>
</tr>
<tr>
<td>2506</td>
<td>缺少osVer参数</td>
</tr>
<tr>
<td>2507</td>
<td>缺少brand参数</td>
</tr>
<tr>
<td>2508</td>
<td>缺少model参数</td>
</tr>
<tr>
<td>401</td>
<td>非法参数</td>
</tr>
<tr>
<td>402</td>
<td>非法业务参数</td>
</tr>
<tr>
<td>1401</td>
<td>不支持的HTTP方法</td>
</tr>
<tr>
<td>1402</td>
<td>非法sign参数</td>
</tr>
<tr>
<td>1403</td>
<td>非法signType参数</td>
</tr>
<tr>
<td>1404</td>
<td>非法timestamp参数</td>
</tr>
<tr>
<td>1405</td>
<td>非法appId参数</td>
</tr>
<tr>
<td>1406</td>
<td>accessToken过期</td>
</tr>
<tr>
<td>1407</td>
<td>对应账号不存在或者账号被封禁，grantcode(授权码错误或者已过期)；</td>
</tr>
<tr>
<td>1408</td>
<td>accesstoken 无效</td>
</tr>
<tr>
<td>-444</td>
<td>请求太过频繁</td>
</tr>
<tr>
<td>-445</td>
<td>请求太过频繁</td>
</tr>
<tr>
<td>-446</td>
<td>请求太过频繁</td>
</tr>
<tr>
<td>-461</td>
<td>请求总量超限</td>
</tr>
</tbody>
</table>

## IOT端公共参数

- docId：`0f7801d7d6d24180b8fc9058d1ffe593`
- 来源：https://developer.music.163.com/st/developer/document?docId=0f7801d7d6d24180b8fc9058d1ffe593

## IOT端公共参数


```text
使用范围：车载、手表、音箱、电视、智能硬件等所有iot设备（移动端app亦可）
```


### 公共参数：


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>必选</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>appId</td>
<td>String</td>
<td>是</td>
<td>云音乐分配给开发者的应用ID  ，控制台上有</td>
</tr>
<tr>
<td>signType</td>
<td>String</td>
<td>是</td>
<td>应用生成签名字符串所使用的签名算法类型，目前支持RSA_SHA256</td>
</tr>
<tr>
<td>sign</td>
<td>String</td>
<td>是</td>
<td>请求参数的签名串，签名生成方式详见<a href="?docId=45aac8d12ccb4a98b14e2ea34a1a9cdb">RSA加密</a></td>
</tr>
<tr>
<td>timestamp</td>
<td>Long</td>
<td>是</td>
<td>UNIX时间戳，毫秒级</td>
</tr>
<tr>
<td>bizContent</td>
<td>String</td>
<td>是</td>
<td>请求参数的集合，json格式化后**<s>需要encode</s>**，最大长度不限，除公共参数外所有业务请求参数都必须放在这个参数中传递，具体参照各Api文档</td>
</tr>
<tr>
<td>accessToken</td>
<td>String</td>
<td>否（按接口要求传）</td>
<td>登录令牌 ，匿名和二维码登录接口不需要，其他接口必传。匿名登录时，每台设备需生成唯一的accessToken</td>
</tr>
<tr>
<td>device</td>
<td>String</td>
<td>是</td>
<td>设备信息，json格式化后**<s>需要encode</s>**</td>
</tr>
</tbody>
</table>


-

accessToken至少要保留512个字符空间，且支持base64 字符集(数字、大小写字母、+、/、=)


**device设备信息**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>必选</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>channel</td>
<td>String</td>
<td>是</td>
<td>厂商标识，<strong>由云音乐分配，需线下联系云音乐同事确认</strong></td>
</tr>
<tr>
<td>deviceId</td>
<td>String</td>
<td>是</td>
<td>设备唯一Id（每台设备需保持唯一，可传sn、mac、IMEI、vin、iccid等值）</td>
</tr>
<tr>
<td>deviceType</td>
<td>String</td>
<td>是</td>
<td>设备类型，<strong>需线下联系云音乐产品确认</strong></td>
</tr>
<tr>
<td>appVer</td>
<td>String</td>
<td>是</td>
<td>客户端版本号（自研的云音乐版本号）</td>
</tr>
<tr>
<td>os</td>
<td>String</td>
<td>是</td>
<td>操作系统类型，<strong>由云音乐分配，需线下联系云音乐同事确认</strong></td>
</tr>
<tr>
<td>osVer</td>
<td>String</td>
<td>是</td>
<td>操作系统版本（ 车机系统，如：8.1.0）</td>
</tr>
<tr>
<td>brand</td>
<td>String</td>
<td>是</td>
<td>品牌，<strong>需线下联系云音乐同事确认</strong></td>
</tr>
<tr>
<td>model</td>
<td>String</td>
<td>是</td>
<td>设备型号（车型、产品型号）</td>
</tr>
<tr>
<td>clientIp</td>
<td>String</td>
<td>是</td>
<td>终端IP，设备调用接口时的IP地址</td>
</tr>
<tr>
<td>netStatus</td>
<td>String</td>
<td>是</td>
<td>网络状态，wifi/2g/3g/4g/5g</td>
</tr>
<tr>
<td>flowFlag</td>
<td>String</td>
<td>否</td>
<td>是否初始化，默认：init，该字段决定本次请求是否被计算成日活</td>
</tr>
</tbody>
</table>


- deviceId：不超过64个字符，只能包含数字、字母(区分大小写)，不允许传入=、；、空格、+、|

- appVer：必须是x.x.x，三段数字，“.”分隔，每段不超过四位，且总长度应该小于15个字符（会影响播放记录同步）


最佳实践：{"netStatus":"4g","flowFlag":"init","channel":"netease","deviceId":"bnVsbAkwMjowMDowMDowMDowMDowMAk5NTQ5NzA3YTg1NmE1MDY2CW51bGw=","deviceType":"andrcar","appVer":"6.0.0","os":"andrcar","osVer":"14","brand":"netease","model":"GDI-W09","clientIp":"127.0.0.1"}


### 公共出参


返回参数均为JSON格式：


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>必选</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>code</td>
<td>String</td>
<td>是</td>
<td>错误码</td>
</tr>
<tr>
<td>message</td>
<td>String</td>
<td>是</td>
<td>错误信息</td>
</tr>
<tr>
<td>data</td>
<td>Object</td>
<td>是</td>
<td>数据记录</td>
</tr>
</tbody>
</table>


如若是列表数据则是在data下：


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>必选</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>recordCount</td>
<td>Int</td>
<td>是</td>
<td>总数</td>
</tr>
<tr>
<td>records</td>
<td>List</td>
<td>是</td>
<td>列表数据</td>
</tr>
</tbody>
</table>

# 用户登录API

## 匿名登录

- docId：`1a5fb2c7b30b44609fa81129a8e1908d`
- 来源：https://developer.music.163.com/st/developer/document?docId=1a5fb2c7b30b44609fa81129a8e1908d

## 匿名登录


### /openapi/music/basic/oauth2/login/anonymous


```text
获取设备的匿名token
游客模式：不需要用户完成云音乐登录即可使用部分功能，如获取内容、播放等。
```


**注意：为保证匿名情况下数据统计准确性，只要deviceid唯一，该接口会自动为每台设备生成唯一的匿名token（永不过期），token在云音乐内部会对应一个匿名的uid**


请求接口时需要使用设备唯一的token进行，即实现游客模式


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>clientId</td>
<td>是</td>
<td>string</td>
<td>控制台上的的appId</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"clientId":"a3010200000000008fded78f47c1db11"}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/oauth2/login/anonymous?appId=a301020000000000746f96a196e52e07&signType=RSA_SHA256&timestamp=1688525994455&device=%7B%22deviceType%22:%22andrcar%22,%22os%22:%22andrcar%22,%22appVer%22:%220.1%22,%22channel%22:%22didi%22,%22model%22:%22kys%22,%22deviceId%22:%22357%22,%22brand%22:%22didi%22,%22osVer%22:%228.1.0%22,%22clientIp%22:%22192.168.0.1%22%7D&bizContent=%7B%22clientId%22:%22a301020000000000746f96a196e52e07%22%7D&sign=B6K8C6smhkTrsRscJpixm%2BNg7JHmdykx4eUpZ%2FA1uZo37Uw9JNLkMz1sX96N1FZGG%2BUCuSDDBjqcNWE2CUNAMkARQ0VCv53MKa%2BnmOuHit%2BkZJyDU%2FbAT98OZt8zStgp48txOeo8FMo2S%2FJWUovbBsgr%2FDDXBDg97mNL9tMlJnfUEiWDAMWKzGT%2F1ZWJDrvPojMKayua%2BxR%2FFvUcXtGl%2FHXsapPvLcYsnp5VbhTn3n815%2Fgg2qQRfPhMfm55bZ2NeLUTJP4hlWlDOesdcsCvDs4wgyq1GVaqrUnBsiu%2BazSj%2BV9CTtNJaMzd4uZkgJskbXsyQN9lw0PMTYf0DWTlJg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>accessToken</td>
<td>String</td>
<td>下发的token（永不过期）</td>
</tr>
<tr>
<td>refreshToken</td>
<td>String</td>
<td>下发的refreshToken（不用管）</td>
</tr>
<tr>
<td>expireTime</td>
<td>String</td>
<td>有效期（不用管）</td>
</tr>
</tbody>
</table>


- accessToken至少要保留512个字符空间，支持base64 字符集(数字、大小写字母、+、/、=)

- 请缓存在客户端，和deviceid强绑定


### 返回示例


```text
{
  "code": 200,
  "data": {
    "accessToken": "p75a62ce615c0166e3ef37e496507165da42c65bf6c006563j",
    "refreshToken": "m052d7f63b53d9189dfa0a653463b5d4934496cc0950f63f5x",
    "expireTime": 604800,
    "scopes": null
  },
  "message": ""
}
```

## 获取登录二维码

- docId：`2bb12a93e71a4be0842243b930c2f33c`
- 来源：https://developer.music.163.com/st/developer/document?docId=2bb12a93e71a4be0842243b930c2f33c

## 获取登录二维码


### /openapi/music/basic/user/oauth2/qrcodekey/get/v2


```text
实时展示二维码，使用云音乐app进行登录（或第三方app扫码）
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>type</td>
<td>是</td>
<td>int</td>
<td>设备类型, 固定传入type = 2</td>
</tr>
<tr>
<td>expiredKey</td>
<td>是</td>
<td>string</td>
<td>二维码过期时间（单位s，固定传300）</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"type":2,"expiredKey":"300"}


### 请求事例：


```text
http://openapi.music.163.com/openapi/music/basic/user/oauth2/qrcodekey/get/v2?bizContent=%7B%22type%22%3A2%2C%22expiredKey%22%3A%22604800%22%7D&appId=a301010000000000aadb4e5a28b45a67&signType=RSA_SHA256&accessToken=9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd&appSecret=de6882f913d59560c9f37345f4cb0053&device=%7B%22deviceType%22%3A%22andrwear%22%2C%22os%22%3A%22otos%22%2C%22appVer%22%3A%220.1%22%2C%22channel%22%3A%22hm%22%2C%22model%22%3A%22kys%22%2C%22deviceId%22%3A%22357%22%2C%22brand%22%3A%22hm%22%2C%22osVer%22%3A%228.1.0%22%7D&timestamp=1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>qrCodeUrl</td>
<td>String</td>
<td>登录二维码url</td>
</tr>
<tr>
<td>uniKey</td>
<td>String</td>
<td>二维码key</td>
</tr>
</tbody>
</table>


- 有效期：5分钟，后续可间隔2~3s轮询一次

- qrCodeUrl需预留8~512个字符，短链/长链都有概率返回


### 返回示例


正常情况


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "qrCodeUrl": "https://163cn.tv/ZJPF4sQ",
    "uniKey": "d74de297-ea5d-4e3b-94bc-0c2e6839814d"
  }
}
```


```text
{
    "code": 200,
    "subCode": null,
    "message": null,
    "data": {
        "qrCodeUrl": "https://163cn.tv/L5cVGU?uniKey=969fe941-6c5f-4fce-8e65-ed4d4bd07d2e",
        "uniKey": "4aed7939-5741-4569-94b0-37af46846415"
    }
}
```


异常情况


```text
{
  "code": 500,
  "message": "获取登录二维码失败，请重试",
  "debugInfo": null,
  "data": null,
  "failData": null
}
```

## 轮询二维码状态

- docId：`4d0301c68c5d45d8811d7787ee37d2f6`
- 来源：https://developer.music.163.com/st/developer/document?docId=4d0301c68c5d45d8811d7787ee37d2f6

## 轮询二维码状态


### /openapi/music/basic/oauth2/device/login/qrcode/get


```text
1、有效期5min，只能扫一次
2、要用一个匿名token去轮询
3、accessToken、refreshToken至少要保留512个字符空间，且支持base64 字符集(数字、大小写字母、+、/、=)
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>key</td>
<td>是</td>
<td>String</td>
<td>二维码的unikey</td>
</tr>
<tr>
<td>clientId</td>
<td>是</td>
<td>String</td>
<td>对应appId</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"key":"d74de297-ea5d-4e3b-94bc-0c2e6839814d","clientId":"a3010200000000008fded78f47c1db11"}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/oauth2/device/login/qrcode/get?bizContent%3d%7b%22key%22%3a%22123%22%2c%22clientId%22%3a%22appId%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>accessToken</td>
<td>AccessToken</td>
<td>token相关数据</td>
</tr>
<tr>
<td>status</td>
<td>Int</td>
<td>二维码状态(800:不存在或过期, 801:等待扫码, 802:授权中, 803:授权登录成功, 804:未知错误)</td>
</tr>
<tr>
<td>msg</td>
<td>Int</td>
<td>二维码状态说明</td>
</tr>
</tbody>
</table>


**AccessToken数据**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>accessToken</td>
<td>String</td>
<td>下发的token</td>
</tr>
<tr>
<td>refreshToken</td>
<td>String</td>
<td>用于刷新的refresh token</td>
</tr>
<tr>
<td>expireTime</td>
<td>Long</td>
<td>token过期时间（秒）</td>
</tr>
</tbody>
</table>


**备注**


accessToken默认过期时间是7天，
refreshToken默认过期时间是20天


- 可以在到期前预判刷新，或者过期后提示刷新


### 返回示例


等待扫码


```text
{
    "code":200,
    "data":{
        "accessToken":{
            "accessToken":"null",
            "refreshToken":"null",
            "expireTime":null,
            "scopes":null
        },
        "status":801,
        "msg":"等待扫码"
    },
    "message":""
}
```


授权中


```text
{
    "code":200,
    "data":{
        "accessToken":{
            "accessToken":"null",
            "refreshToken":"null",
            "expireTime":null,
            "scopes":null
        },
        "status":802,
        "msg":"授权中"
    },
    "message":""
}
```


扫码成功


```text
{
    "code":200,
    "data":{
        "accessToken":{
            "accessToken":"l0c2f2825b121dc0a62c695c2f892543b7e53d075f4ee780bv",
            "refreshToken":"lb1fc7343fc28398f40fd80c47b21b14b90a81571b22835a5r",
            "expireTime":604800,
            "scopes":null
        },
        "status":803,
        "msg":"扫码成功"
    },
    "message":""
}
```


已扫过码


```text
{
    "code":200,
    "data":{
        "accessToken":{
            "accessToken":"null",
            "refreshToken":"null",
            "expireTime":null,
            "scopes":null
        },
        "status":800,
        "msg":"二维码不存在或过期，请刷新"
    },
    "message":""
}
```


如果使用实名token轮询


```text
{
    "code":400,
    "message":"device has login success",
    "debugInfo":null,
    "data":null,
    "failData":null
}
```

## 获取用户基本信息

- docId：`8ed9b2f123e44923979596a277733421`
- 来源：https://developer.music.163.com/st/developer/document?docId=8ed9b2f123e44923979596a277733421

## 获取用户基本信息


```text
车端、手表等iot场景：
   1、优先判断15，如果有15则显示黑胶SVIP有效期至：** ** **  ，打svip标和等级
   2、如果有6，显示黑胶会员有效期至：** ** **，打vip标和等级
   3、如果只有13等单端，则显示单端会员有效期至：** ** **，不打标，只展示信息
```


![图片](https://p5.music.126.net/mS74yMNEhU1xW4MZ32n0og==/109951172631272067?imageView&thumbnail=600x600)


### /openapi/music/basic/user/profile/get/v2


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


- 无


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/user/profile/get/v2?bizContent%3d%7b%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>用户Id</td>
</tr>
<tr>
<td>nickname</td>
<td>String</td>
<td>用户昵称</td>
</tr>
<tr>
<td>avatarUrl</td>
<td>String</td>
<td>头像</td>
</tr>
<tr>
<td>gender</td>
<td>String</td>
<td>性别,  未知： 0;  男：1;   女：2;</td>
</tr>
<tr>
<td>signature</td>
<td>String</td>
<td>签名</td>
</tr>
<tr>
<td>redVipLevel</td>
<td>int</td>
<td>黑胶会员等级</td>
</tr>
<tr>
<td>vipDetail</td>
<td>List<VipOpenDetailDto></td>
<td>当前生效的vip类型</td>
</tr>
<tr>
<td>fullVipDetail</td>
<td>List<FullVipOpenDetailDto></td>
<td>所有vip类型（包含已过期的会员类型）</td>
</tr>
</tbody>
</table>


**VipOpenDetailDto、FullVipOpenDetailDto**


<table>
<thead>
<tr>
<th>type值</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>音乐包会员/畅听会员（不用管，iot场景用不了）</td>
</tr>
<tr>
<td>6</td>
<td>黑胶VIP会员</td>
</tr>
<tr>
<td>15</td>
<td>黑胶SVIP会员</td>
</tr>
<tr>
<td>13</td>
<td>车载端会员</td>
</tr>
<tr>
<td>16</td>
<td>手表端会员</td>
</tr>
<tr>
<td>17</td>
<td>TV端会员</td>
</tr>
<tr>
<td>18</td>
<td>音箱端会员</td>
</tr>
</tbody>
</table>


- svip=车载端会员+音箱端会员+tv端会员+手表端会员+黑胶会员+大部分数字专辑

- 目前各个端会员都是云音乐运营做活动时赠送获取，不可购买


### 返回示例


- 正常用户


```text
{
   "code": 200,
   "subCode": null,
   "message": null,
   "data": {
   	"id": "ED048AA6F4BA798A2874090498E38416",
   	"nickname": "热心市民_Potter",
   	"avatarUrl": "http://p1.music.126.net/hbauXe5LeuC5Ylwl5SZTSA==/109951165791651162.jpg",
   	"gender": 1,
   	"signature": "我爱夏天~",
   	"vipDetail": [{
   		"type": 1,
   		"expireTime": 1806681599000
   	}, {
   		"type": 6,
   		"expireTime": 1806681599000
   	}],
   	"fullVipDetail": [{
   		"type": 1,
   		"expireTime": 1806681599000
   	}, {
   		"type": 6,
   		"expireTime": 1806681599000
   	}, {
   		"type": 16,
   		"expireTime": 1769097599000
   	}, {
   		"type": 17,
   		"expireTime": 1711900799000
   	}, {
   		"type": 18,
   		"expireTime": 1711900799000
   	}, {
   		"type": 13,
   		"expireTime": 1760889599000
   	}],
   	"redVipLevel": 6
   }
}
```


- 匿名用户


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": null
}
```


- token过期


```text
{
  "msg": "accessToken过期，请重新授权登录",
  "code": 1406,
  "message": "accessToken过期，请重新授权登录"
}
```

## 回调code换取accessToken

- docId：`2fa5a885d2644910a4b823dba0c5acf5`
- 来源：https://developer.music.163.com/st/developer/document?docId=2fa5a885d2644910a4b823dba0c5acf5

## 回调code换取accessToken


### /openapi/music/basic/user/oauth2/token/get/v2


```text
用于接入H5/唤端授权登录后，拿到的临时code，来换取用户accessToken
最好服务端调用
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>grantCode</td>
<td>是</td>
<td>string</td>
<td>登录code，就是回调的code</td>
</tr>
</tbody>
</table>


- 回调的code只有10分钟有效期

- 最佳实践：


{"grantCode":"xxxx"}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/user/oauth2/token/get/v2?bizContent={"grantCode":"123"}&appId=a301010000000000aadb4e5a28b45a67&signType=RSA_SHA256&appSecret=de6882f913d59560c9f37345f4cb0053&device={"deviceType":"andrwear","os":"otos","appVer":"0.1","channel":"hm","model":"kys","deviceId":"357","brand":"hm","osVer":"8.1.0"}&timestamp=1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>accessToken</td>
<td>String</td>
<td>用户token</td>
</tr>
<tr>
<td>refreshToken</td>
<td>String</td>
<td>刷新token</td>
</tr>
<tr>
<td>openId</td>
<td>String</td>
<td>对于同一个接入方客户端来讲, 同一用户返回的openId是一致的（已失效）</td>
</tr>
<tr>
<td>unionId</td>
<td>String</td>
<td>对于同一个接入方来讲, 同一用户返回的unionId是一致的（已失效）</td>
</tr>
<tr>
<td>expireIn</td>
<td>String</td>
<td>有效期（秒）</td>
</tr>
</tbody>
</table>


- accessToken、refreshToken至少要保留512个字符空间，且支持base64 字符集(数字、大小写字母、+、/、=)


### 返回示例


正常情况


```text
{
    "code":200,
    "data":{
        "accessToken":"l0c2f2825b121dc0a62c695c2f892543b7e53d075f4ee780bv",
        "refreshToken":"lb1fc7343fc28398f40fd80c47b21b14b90a81571b22835a5r",
        "openId":"123",
        "unionId":"123",
        "expireIn":604800
    }
}
```


grantcode失效等异常情况


```text
{
  "code": 400,
  "message": "获取accessToken失败，请确认grantCode是否有效",
  "debugInfo": "获取accessToken失败，请确认grantCode是否有效",
  "data": null,
  "failData": null
}
```

## 查询用户是否实名

- docId：`dffbc59f96d147d49e1bb41a157daaea`
- 来源：https://developer.music.163.com/st/developer/document?docId=dffbc59f96d147d49e1bb41a157daaea

## 查询用户是否实名


### /openapi/music/basic/user/id/info


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?category=api&type=common&docId=iotCommonParam)


### 业务参数（bizContent）：


- 无

- 公共参数accessToken必须传入


### 请求示例：


```text
https://openapi.music.163.com/openapi/music/basic/user/id/info?appId=a301020000000000746f96a196e52e07&device={"deviceType":"andrcar","os":"andrcar","appVer":"0.1","channel":"didi","model":"kys","deviceId":"357","brand":"didi","osVer":"8.1.0","clientIp":"192.168.0.1"}&timestamp=1742980685296&signType=RSA_SHA256&accessToken=c762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&sign=eXRnKAq2ABQ59s9mWf%2BXSJ2yqYiNp5W48ivydrqEybc9de%2F4ydpmZNI9BGv1Peoe03Jmy4rnTL2TXJM63%2B4jus8SwoZPD%2FKyx%2BPl87Ep076yYpLkcInsat676jTzALKUIa6p%2FuZJ1hKc6md70KGef9POZe7wzPOH7Fwm%2FfL8OmfyYymMl7RtsQIbS9qHuYTKyfh3Y8awPmi2MTP8xarWtnqlnScJaWY0g5E5kWrorXkPCSp9Pgt3Fre%2FOnHK4yjjtloSqKnLspJTKv7ZQWwGSVoP251NxgHsZCOHCNkMuN%2B927eoId3BxpLio1d7SurVGphou9wej4KEbhM4pvqmdw%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>userId</td>
<td>String</td>
<td>明文用户id</td>
</tr>
<tr>
<td>anonymous</td>
<td>Boolean</td>
<td>是否匿名用户</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
 "code": 200,
 "subCode": null,
 "message": null,
 "data": {
   "userId": 1333350067,
   "anonymous": false
 }
}
```

## 刷新AccessToken

- docId：`2066d57bbed2445baeb18429e44b8689`
- 来源：https://developer.music.163.com/st/developer/document?docId=2066d57bbed2445baeb18429e44b8689

## 通过RefreshToken来刷新AccessToken


### /openapi/music/basic/user/oauth2/token/refresh/v2


```text
给用户accessToken续期，AT默认7天，RT默认20天，需要调用该接口续期
有特殊需要可延长
```


- 最好服务端调用

- 刷新逻辑：7天内可用token，7-20天可用refresh token刷新，20天后不活跃可引导用户重新登录

- 注意：任意接口提示token过期，则先用refresh token去刷新，如果还是提示token过期，则引导重登
![图片](https://p5.music.126.net/BLYO-aSxFOZLcUGkOdDhlw==/109951172631291349)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?category=api&type=common&docId=iotCommonParam)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>clientId</td>
<td>是</td>
<td>String</td>
<td>控制台上的appId</td>
</tr>
<tr>
<td>clientSecret</td>
<td>是</td>
<td>String</td>
<td>控制台上的appSecret</td>
</tr>
<tr>
<td>refreshToken</td>
<td>是</td>
<td>String</td>
<td>token对应的refreshToken</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"clientId":"xxx","clientSecret":"xxx","refreshToken":"xxx"}


### 请求事例：


```text
https://openapi.music.163.com/openapi/music/basic/user/oauth2/token/refresh/v2?accessToken=s9bea2debceadb9d6e4eb4a1c85529cc8fb7c4e3e91863147b&appId=a3010200000000008fded78f47c1db11&bizContent={"clientId":"a3010200000000008fded78f47c1db11","clientSecret":"deb69f5d1f196616166fc7d43dc56fe3","refreshToken":"h6c4bcecfd9d0502a39b225bb064d5a43b3cdf0535d09b9ect"}&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"one","deviceId":"one","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&signType=RSA_SHA256&timestamp=1754549049839&sign=z6YsmbjkwOT8alFPJA3v/2HJAP4Nxi4IeDE+vm+aLJh9v2wpTGtvRagDuYCpF0qwx9a2WysaILWbzFSe5Nq7ZPD3IbWpQdwNnaTsC3l9PnpPYvQjVgGyyhUByGnimjZ2H4mD05GWte5vJ9XfqrV+PE9cu/eX6zGRMwQuGe3FbDlgDe8xPxPThmqLS5lMIcnHlWQLRWGG47ukXiqmeuvby9gyvOLlXfgyePnKYSDnCbpzryXzEz2cVOZLsQTrL+xxjvxs6BqG17Cvwvj7M3xN+awXVmA8aH/I6j+KTaHeoZsG7mt30X1mBYX+JXRqbeXlcqaW37Qw8YZTQuQClEpkMg==
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>accessToken</td>
<td>String</td>
<td>下发的token</td>
</tr>
<tr>
<td>refreshToken</td>
<td>String</td>
<td>用于刷新的refresh token</td>
</tr>
<tr>
<td>expiresTime</td>
<td>Long</td>
<td>token过期时间（秒）</td>
</tr>
</tbody>
</table>


- AT和RT会同时刷新续期

- accessToken、refreshToken至少要保留512个字符空间，且支持base64 字符集(数字、大小写字母、+、/、=)


token异常时，任意接口都会提示以下情况：


<table>
<thead>
<tr>
<th>code</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>1406</td>
<td>accessToken过期，或者refresh Token过期</td>
</tr>
<tr>
<td>1407</td>
<td>对应账号不存在或者账号被封禁，grantcode(授权码错误或者已过期)</td>
</tr>
<tr>
<td>1408</td>
<td>accesstoken 无效</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
    "code":200,
    "data":{
        "accessToken":"l0c2f2825b121dc0a62c695c2f892543b7e53d075f4ee780bv",
        "refreshToken":"lb1fc7343fc28398f40fd80c47b21b14b90a81571b22835a5r",
        "expiresTime":604800
    }
}
```


- appid混用


该接口会校验refresh token来源appid，需保持和传入的clientid一致


```text
{
  "code": 400,
  "message": "parameter error",
  "debugInfo": null,
  "data": null,
  "failData": null
}
```


- 匿名token去刷新，会提示1406


```text
{
    "code": 1406,
    "message": "accessToken过期，请重新授权登录",
    "debug": null,
    "data": null,
    "failData": null,
}
```


### FAQ


1、token快速失效


```text
适用场景：快速测试用户token和refresh token失效
路径：云音乐移动端-设置-账号与安全-授权管理-找到目标应用-点解除授权，大概几分钟后，token就失效了
```

## H5登录&唤端登录

- docId：`78eb8f6bec12427d90b120e21b569b16`
- 来源：https://developer.music.163.com/st/developer/document?docId=78eb8f6bec12427d90b120e21b569b16

## 一、背景


```text
移动端app等可以通过直接打开h5授权页登录或者拉起云音乐app授权登录
```


-

h5：进入【控制台】>【应用详情】，填写授权回调域名(接收授权后的临时code)


**后续使用的redirectUrl必须与该地址一致或以该地址为前缀**

- **有多个地址时，只需和其中一个地址保持一致，即为指定该回调地址**

- **回调地址必须是公网地址**


-

唤端：需提供安卓和ios的schemaurl给云音乐同事进行配置后才能跳转


**一旦走唤端，上述h5回调地址将失效，直接由客户端解析出code**


整体授权时序图：


![图片](https://p5.music.126.net/tKZeR3iNEmyfiHl2P_tTvw==/109951172631345068?imageView&thumbnail=600x600)


## 二、接入h5&唤端授权


### 1. 接入授权


-

接入方（app或h5）拉起h5授权登录组件，唤起时需将自己的AppId、授权回调地址、端类型、随机码等信息传给组件，具体接入方式分为以下两种：


H5接入：云音乐 h5 授权页：


```text
https://music.163.com/st/platform/oauth/authorize?clientId=xxx&state=xxxx&clientType=xxx&redirectUrl=xxx
```


-

App唤端接入：在三方App内调用如下协议唤起云音乐 App，在云音乐App中打开授权页：


```text
orpheus://openurl?url=${encode(auth_h5)}   // auth_h5 见下述 h5 协议
```


```text
auth_h5：https://music.163.com/st/platform/oauth/authorize?clientId=xxx&state=xxxx&clientType=xxx&redirectUrl=xxx&schemaUrl=xxx
```


-

H5 授权页参数：


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>必选</th>
<th>描述</th>
<th>备注</th>
</tr>
</thead>
<tbody>
<tr>
<td>clientId</td>
<td>String</td>
<td>是</td>
<td>应用id</td>
<td>AppId</td>
</tr>
<tr>
<td>state</td>
<td>String</td>
<td>是</td>
<td>自定义随机字符串，会在oauth的回跳步骤带回给接入方</td>
<td>长度30以内，数字或字母（不允许传入=、；、空格、+、</td>
</tr>
<tr>
<td>clientType</td>
<td>String</td>
<td>是</td>
<td>接入方端类型</td>
<td>和当前应用创建时选择的类型保持一致，大多数固定传web（会和控制台上的应用类型做校验）</td>
</tr>
<tr>
<td>redirectUrl</td>
<td>String</td>
<td>是</td>
<td>接入方重定向地址</td>
<td>重定向的http地址，<strong>控制台上填的授权回调域名为前缀或者保持一致，申请时为原始地址，传参时需要进行encode()</strong></td>
</tr>
<tr>
<td>schemaUrl</td>
<td>String</td>
<td>否</td>
<td>打开接入方App的schema协议 (唤端必传)</td>
<td>示例：iSchema://openurl?url=，授权完成后如果需要唤起接入方app，需接入方传入打开已方的schema协议，该字段需要进行encode()，<strong>目前仅在云音乐App内有效</strong></td>
</tr>
</tbody>
</table>


- 调试工具：[https://st.music.163.com/g/oauth-tool](https://st.music.163.com/g/oauth-tool)

- schemaUrl目前仅在云音乐App内支持唤起，H5接入方式不支持。


示例:
接入方的redirectUrl为`https://xxx.com`，
唤起已方App打开h5页面的schema协议为 ` iSchema://openurl?url=`


则对应的云音乐H5授权页的访问地址为：


https://music.163.com/st/platform/oauth/authorize?clientId=xxx&state=xxx&clientType=xxx&redirectUrl=encode('https://xxx.com')


则对应的云音乐唤端授权页的访问地址为：


orpheus://openurl?url=encode(https://music.163.com/st/platform/oauth/authorize?clientId=xxx&state=xxx&clientType=xxx&redirectUrl=encode('https://xxx.com')&schemaUrl=encode('iSchema://openurl?url=')
)


授权完成后，若在云音乐App中授权完成会直接访问：iSchema://openurl?url=encode(https://xxx.com?code=xx&state=xx)，若在云音乐App外完成授权，则直接重定向到https://xxx.com?code=xx&state=xx


- 唤端是redirectUrl和schemaUrl都需要encode，然后把整个url整体再encode一遍


-

若唤起云音乐App失败场景需要打开云音乐下载页，下载页的链接为


安卓


pkgName：com.netease.cloudmusic

- 云音乐统一下载页面链接：https://music.163.com/m/download?type=tenvideo


- iOS（以下两种链接根据业务情况自选）


云音乐统一下载页面链接：
https://music.163.com/m/download?type=tenvideo

- 直接跳转Appstore 链接：https://apps.apple.com/app/id590338362?ls=1&mt=8


-

成功唤起授权登录组件后，组件会先判断当前云音乐用户是否处于登录态，未登录会展示云音乐登录页面引导用户登录


-

clientId校验通过，会展示授权页，该授权页包括接入方logo、权限文案列表和授权按钮


### 2.用户授权


    授权登录展示授权页，等待用户点击授权按钮进行授权，当用户点击授权按钮时会请求授权接口，该接口会生成一个临时授权凭证即授权码code，redirectUrl中会拼接code和state（与接入方传入的state一致）返回给接入方


示例：
接入方的传入的 `redirectUrl为encode(http://xxx.com)， state为'xxx'`，接口拼接后的redirectUrl为 ` http://xxx.com?code=xxx&state=xxx`


## 三、用授权码code换取授权令牌accessToken


Api接口：[获取用户accessToken](?docId=2fa5a885d2644910a4b823dba0c5acf5)


- 建议服务端调用


    可以看到该接口的返回不仅仅有accessToken，还有refreshToken和unionId，其中refreshToken是用来进行accessToken续期的，unionId是云音乐用户对该接入方的唯一标识，即同一个云音乐用户，对同一个接入方的不同接入端，授权后颁发的unionId是相同的。


### 错误码


<table>
<thead>
<tr>
<th>code</th>
<th>类型</th>
<th>msg</th>
</tr>
</thead>
<tbody>
<tr>
<td>400</td>
<td>integer</td>
<td>grantCode参数错误</td>
</tr>
</tbody>
</table>


## 四、使用accessToken获取用户基本信息（建议服务端调用）


    接入方获取到accessToken后，可以通过调用：[获取用户基本信息](?docId=8ed9b2f123e44923979596a277733421)，拿到用户昵称等信息


### 错误码


<table>
<thead>
<tr>
<th>code</th>
<th>类型</th>
<th>msg</th>
</tr>
</thead>
<tbody>
<tr>
<td>1406</td>
<td>integer</td>
<td>accessToken过期，请重新授权登录</td>
</tr>
<tr>
<td>1407</td>
<td>integer</td>
<td>accessToken非法</td>
</tr>
<tr>
<td>1408</td>
<td>integer</td>
<td>账户已封禁或注销</td>
</tr>
<tr>
<td>400</td>
<td>integer</td>
<td>accessToken参数错误</td>
</tr>
</tbody>
</table>


## 五、accessToken续期（建议服务端调用）


    获取到accessToken后，可以通过调用：[刷新用户AccessToken](?docId=2066d57bbed2445baeb18429e44b8689)，获取到新的accessToken和refreshToken


### 错误码


<table>
<thead>
<tr>
<th>code</th>
<th>类型</th>
<th>msg</th>
</tr>
</thead>
<tbody>
<tr>
<td>1406</td>
<td>integer</td>
<td>accessToken过期，请重新授权登录</td>
</tr>
<tr>
<td>1407</td>
<td>integer</td>
<td>accessToken非法</td>
</tr>
<tr>
<td>1408</td>
<td>integer</td>
<td>账户已封禁或注销</td>
</tr>
<tr>
<td>400</td>
<td>integer</td>
<td>refreshToken参数错误</td>
</tr>
</tbody>
</table>


### FAQ


1、获取应用信息失败


```text
appid写错了或者clientType写错了,类型或者填写的和控制台上不一致(clientType=web)
```


2、授权失败


```text
没有写redirectUrl，或者该地址和控制台上填的授权回调地址不一致
```

# 推荐-歌曲类API

## 每日推荐封面

- docId：`b23243d8debf4333ad7f3cb15b071900`
- 来源：https://developer.music.163.com/st/developer/document?docId=b23243d8debf4333ad7f3cb15b071900

## 每日推荐封面


### /openapi/music/basic/recommend/daily/image


- 获取每日推荐封面


### 请求方式：


- GET


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


无


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/recommend/daily/image?appId=a3010300000000003b091&appSecret=de070e&device=%7B%22deviceType%22%3A%22andrwear%22%2C%22os%22%3A%22otos%22%2C%22appVer%22%3A%220.1%22%2C%22channel%22%3A%22hm%22%2C%22model%22%3A%22kys%22%2C%22deviceId%22%3A%22321%22%2C%22brand%22%3A%22hm%22%2C%22osVer%22%3A%228.1.0%22%2C%22clientIp%22%3A%221.1.1.1%22%7D&timestamp=1645531427920&signType=RSA_SHA256&accessToken=x6c1d8ef35669ee23eedf8dcbff22f
```


### 返回参数说明


- ImageVO


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>name</td>
<td>String</td>
<td>名称</td>
</tr>
<tr>
<td>ImgUrl</td>
<td>String</td>
<td>封面</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
"code":200,
"subCode":null,
"message":null,
"data":{
"name":"他爱他",
"imgUrl":"http://p1.music.126.net/r2Kcy4gNw2ctpy7gpvcBrw==/109951165226366294.jpg"
}
}
```

## 获取相似歌曲（新）

- docId：`afd1a27abcda4d36b464b7871a44159b`
- 来源：https://developer.music.163.com/st/developer/document?docId=afd1a27abcda4d36b464b7871a44159b

## 获取相似歌曲（新）


### /openapi/music/song/simulation/get


```text
需申请接口组：开放平台专区能力
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songId</td>
<td>是</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>limit</td>
<td>否</td>
<td>Int</td>
<td>数量，非必传 默认1,不要超过30</td>
</tr>
</tbody>
</table>


#### 请求示例：


```text
http://openapi.music.163.com/openapi/music/song/simulation/get?appId=a301030000000000cd68e19ab49ac514&appSecret=de76ee6e52feeef3c392234128493bb1&signType=RSA_SHA256&timestamp=1648022382041&bizContent=%7B%22songId%22%3A%22DBB38F21DAC3F7C89BD2E2EC77EFC085%22%7D&device=%7B%22deviceType%22%3A%22andrwear%22%2C%22os%22%3A%22otos%22%2C%22appVer%22%3A%220.1%22%2C%22channel%22%3A%22hm%22%2C%22model%22%3A%22kys%22%2C%22deviceId%22%3A%22321%22%2C%22brand%22%3A%22hm%22%2C%22osVer%22%3A%228.1.0%22%7D
```


### 返回参数说明


- Records参数（列表）


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>albumName</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>albumId</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>albumArtistId</td>
<td>String</td>
<td>专辑艺人Id</td>
</tr>
<tr>
<td>albumArtistName</td>
<td>String</td>
<td>专辑艺人名</td>
</tr>
<tr>
<td>artistId</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>artistName</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面Url</td>
</tr>
<tr>
<td>mvId</td>
<td>String</td>
<td>mvId</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放url</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载歌曲（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持试听</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>试听起止时间，单位：s</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>songSize</td>
<td>int</td>
<td>歌曲的大小</td>
</tr>
<tr>
<td>songMd5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>br</td>
<td>int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效信息（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
<tr>
<td><strong>Artist</strong></td>
<td></td>
<td></td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**Album**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
    "code": 200,
    "subCode": null,
    "message": null,
    "data": [
        {
            "id": "EBFC316AFF3A2BC5611B3038B986560E",
            "name": "一荤一素",
            "duration": 281346,
            "artists": [
                {
                    "id": "C7BAD226165098602FEF6904CFC25C03",
                    "name": "毛不易"
                }
            ],
            "album": {
                "id": "EC0A96AA28741DDF8CBE517CDD978263",
                "name": "平凡的一天"
            },
            "playFlag": true,
            "downloadFlag": false,
            "payPlayFlag": false,
            "payDownloadFlag": true,
            "vipFlag": false,
            "liked": false,
            "coverImgUrl": "http://p1.music.126.net/vmCcDvD1H04e9gm97xsCqg==/109951163350929740.jpg",
            "vipPlayFlag": false,
            "songMaxBr": 999000,
            "songTag": null,
            "visible": true
        },
        {
            "id": "A8BFF81099439A9444FD0B0D91FE0973",
            "name": "这世界那么多人",
            "duration": 285884,
            "artists": [
                {
                    "id": "09429A8601AA370E1679D10F723A3B53",
                    "name": "莫文蔚"
                }
            ],
            "album": {
                "id": "B1B1C85BCA91ADD2AD03211B2DB53F05",
                "name": "这世界那么多人"
            },
            "playFlag": true,
            "downloadFlag": false,
            "payPlayFlag": false,
            "payDownloadFlag": true,
            "vipFlag": false,
            "liked": false,
            "coverImgUrl": "http://p1.music.126.net/LOTxqRjFm03VJEOHJbUqMw==/109951165944804127.jpg",
            "vipPlayFlag": false,
            "songMaxBr": 320000,
            "songTag": null,
            "visible": true
        }
    ]
}
```


## 备注


暂无

## 心动模式

- docId：`6e99f4d7cc68445cbbda72ef0c22b528`
- 来源：https://developer.music.163.com/st/developer/document?docId=6e99f4d7cc68445cbbda72ef0c22b528

## 心动模式


### /openapi/music/basic/song/play/intelligence/get


```text
1.会根据您红心的所有歌曲和正在播放的单曲数据，更精准地为你推荐相似风格的其他歌曲
2.仅支持红心歌单使用
3.心动模式重点关注开启时正在播放的那首单曲，比如此刻你在听摇滚，算法将优先推荐摇滚歌曲
4.入口：日推卡片-心动模式，红心歌单-播放器入口
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>playlistId</td>
<td>是</td>
<td>String</td>
<td>红心歌单id</td>
</tr>
<tr>
<td>songId</td>
<td>是</td>
<td>String</td>
<td>当前正在播放歌曲（也是fromPlayOne场景下，进行单曲推荐的歌曲）</td>
</tr>
<tr>
<td>type</td>
<td>否</td>
<td>String</td>
<td>fromPlayAll(播放全部的推荐) 或者 fromPlayOne（单曲推荐模式），默认fromPlayAll</td>
</tr>
<tr>
<td>count</td>
<td>否</td>
<td>Int</td>
<td>数量，默认20，最多150首，播完了也只能在150首内循环</td>
</tr>
</tbody>
</table>


- 心动模式下，需要在播放列表中给推荐歌单打“荐”标，liked = false

- 数据回传，记得携带alg

- 心动模式的前提条件（包含匿名用户）：
1：有红心歌单
2：红心歌单有红心歌曲


### 请求示例：


```text
http://openapi.music.163.com//openapi/music/basic/song/play/intelligence/get?appId=a301020000000000746f96a196e52e07&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&accessToken=762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&timestamp=1741665549729&playlistId=3C80FFB1BB4D095FE15D8934D04B9CEB&songId=&type=fromPlayAll&startMusicId=65954BD80337D5392894D75053DAA260&count=2
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>albumName</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>albumId</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>albumArtistId</td>
<td>String</td>
<td>专辑艺人Id</td>
</tr>
<tr>
<td>albumArtistName</td>
<td>String</td>
<td>专辑艺人名</td>
</tr>
<tr>
<td>artistId</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>artistName</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面Url</td>
</tr>
<tr>
<td>mvId</td>
<td>String</td>
<td>mvId</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放url</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载歌曲（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持试听</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>试听起止时间，单位：s</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>songSize</td>
<td>int</td>
<td>歌曲的大小</td>
</tr>
<tr>
<td>songMd5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>fullArtists</td>
<td>List<Artist></td>
<td>完整艺人列表（包含已下线艺人）</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>br</td>
<td>int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效信息（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>language</td>
<td>String</td>
<td>语种</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**FreeTrail**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>start</td>
<td>Int</td>
<td>试听开始时间</td>
</tr>
<tr>
<td>end</td>
<td>Int</td>
<td>试听结束时间</td>
</tr>
</tbody>
</table>


**Qualities**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>dolbyMusic</td>
<td>String</td>
<td>杜比</td>
</tr>
<tr>
<td>skMusic</td>
<td>String</td>
<td>沉浸环绕声</td>
</tr>
<tr>
<td>jyMasterMusic</td>
<td>String</td>
<td>超清母带</td>
</tr>
<tr>
<td>jyEffectMusic</td>
<td>String</td>
<td>高清臻音</td>
</tr>
<tr>
<td>hrMusic</td>
<td>String</td>
<td>hi-res</td>
</tr>
<tr>
<td>sqMusic</td>
<td>String</td>
<td>无损</td>
</tr>
<tr>
<td>hmusic</td>
<td>String</td>
<td>极高</td>
</tr>
<tr>
<td>mmusic</td>
<td>String</td>
<td>较高</td>
</tr>
<tr>
<td>lmusic</td>
<td>String</td>
<td>标准</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**maxBrLevel、plLevel、dlLevel、level**


<table>
<thead>
<tr>
<th>值</th>
<th>音质</th>
<th>比特率</th>
</tr>
</thead>
<tbody>
<tr>
<td>dobly</td>
<td>杜比</td>
<td>无</td>
</tr>
<tr>
<td>hires</td>
<td>hires</td>
<td>1999</td>
</tr>
<tr>
<td>lossless</td>
<td>无损</td>
<td>999</td>
</tr>
<tr>
<td>exhigh</td>
<td>极高</td>
<td>320</td>
</tr>
<tr>
<td>higher</td>
<td>较高</td>
<td>192</td>
</tr>
<tr>
<td>standard</td>
<td>标准</td>
<td>128</td>
</tr>
<tr>
<td>none</td>
<td>不能播放/下载</td>
<td>0</td>
</tr>
</tbody>
</table>


**songFee**


<table>
<thead>
<tr>
<th>值</th>
<th>说明</th>
<th>详细描述</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>免费</td>
<td>免费歌曲</td>
</tr>
<tr>
<td>1</td>
<td>会员</td>
<td>普通用户无法免费收听下载；会员可收听和下载所有音质</td>
</tr>
<tr>
<td>4</td>
<td>数字专辑</td>
<td>所有用户只能在商城购买数字专辑后，才能收听下载</td>
</tr>
<tr>
<td>8</td>
<td>128K</td>
<td>普通用户可免费收听128k音质（大部分歌曲已支持320k），但不能下载；会员可收听和下载所有音质</td>
</tr>
<tr>
<td>16</td>
<td>只能付费下载</td>
<td>普通用户只能付费下载后使用，不提供在线收听；会员只能下载后使用，不能在线收听</td>
</tr>
<tr>
<td>32</td>
<td>只能付费播放</td>
<td>普通用户只能付费后收听，不能下载；会员可以直接收听，但不能下载</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "id": "553CCB15018D231F9BE9F622E24D8D6B",
      "name": "张三的歌",
      "duration": 288227,
      "artists": [
        {
          "id": "08B9A4DAE07B5431150571EF556CF890",
          "name": "蔡琴"
        }
      ],
      "fullArtists": [
        {
          "id": "08B9A4DAE07B5431150571EF556CF890",
          "name": "蔡琴"
        }
      ],
      "album": {
        "id": "9F6912E2AC81D28A826A4CBDB6AA31BD",
        "name": "遇见"
      },
      "playFlag": true,
      "downloadFlag": true,
      "payPlayFlag": false,
      "payDownloadFlag": false,
      "vipFlag": true,
      "liked": true,
      "coverImgUrl": "http://p1.music.126.net/K0oKgStgUfWJbNg284mECQ==/109951169302936812.jpg",
      "vipPlayFlag": true,
      "accompanyFlag": null,
      "songMaxBr": 999000,
      "userMaxBr": 999000,
      "maxBrLevel": "lossless",
      "plLevel": "lossless",
      "dlLevel": "lossless",
      "songTag": [
        "流行",
        "民谣",
        "华语流行"
      ],
      "alg": "Alg_AI_all_0_redheart",
      "privateCloudSong": false,
      "freeTrailFlag": true,
      "songFtFlag": false,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "songFee": 1,
      "playMaxbr": 999000,
      "qualities": null,
      "emotionTag": null,
      "vocalFlag": null,
      "payed": null,
      "visible": true
    },
    {
      "id": "1F8035FE862EBD4E131417A19B46528E",
      "name": "漠河舞厅·2022",
      "duration": 304195,
      "artists": [
        {
          "id": "FD38D027094D86F6CD71895C27BF48EC",
          "name": "柳爽"
        }
      ],
      "fullArtists": [
        {
          "id": "FD38D027094D86F6CD71895C27BF48EC",
          "name": "柳爽"
        }
      ],
      "album": {
        "id": "44916B71662C255059D6B68BE73DFDB4",
        "name": "漠河舞厅·2022"
      },
      "playFlag": true,
      "downloadFlag": true,
      "payPlayFlag": false,
      "payDownloadFlag": false,
      "vipFlag": false,
      "liked": true,
      "coverImgUrl": "http://p1.music.126.net/m8BMzRWR53lMu2uaMYV2mA==/109951166609630672.jpg",
      "vipPlayFlag": false,
      "accompanyFlag": null,
      "songMaxBr": 999000,
      "userMaxBr": 999000,
      "maxBrLevel": "hires",
      "plLevel": "hires",
      "dlLevel": "hires",
      "songTag": [
        "流行",
        "华语流行"
      ],
      "alg": "Alg_AI_all_0_redheartCommon",
      "privateCloudSong": false,
      "freeTrailFlag": false,
      "songFtFlag": false,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "songFee": 8,
      "playMaxbr": 999000,
      "qualities": null,
      "emotionTag": null,
      "vocalFlag": null,
      "payed": null,
      "visible": true
    }
  ]
}
```

## 推荐更多歌曲

- docId：`c1b71075ac0f42d2bbd9704f23f1f8de`
- 来源：https://developer.music.163.com/st/developer/document?docId=c1b71075ac0f42d2bbd9704f23f1f8de

## 推荐更多歌曲


### /openapi/music/basic/recommend/more/song


```text
需申请：云音乐推荐能力
根据不同的场景，为用户推送更多的歌曲
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>是否必填</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songIds</td>
<td>String</td>
<td>是</td>
<td>上次推荐的歌曲列表</td>
</tr>
<tr>
<td>source</td>
<td>String</td>
<td>是</td>
<td>来源，算法字段，私人定制：CAR_PAGE_RECOMMEND_PRIVATE_RCMD_SONG</td>
</tr>
<tr>
<td>currentPlaySongId</td>
<td>String</td>
<td>否</td>
<td>当前播放的歌曲列表</td>
</tr>
<tr>
<td>limit</td>
<td>int</td>
<td>否</td>
<td>请求数量，默认12</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>Boolean</td>
<td>否</td>
<td>是否获取音质列表</td>
</tr>
<tr>
<td>extFlags</td>
<td>String</td>
<td>否</td>
<td>保留字段</td>
</tr>
</tbody>
</table>


- 最佳实践


{"qualityFlag":true,"limit":2,"songIds":"["B9070AADBD946C035819850E3DB1B9A6","C1688FA30C791211D5B0AE3D2BFC1BE3","1B05834659818A420BA3CDE85B3AAE21","C78C27254E17FBD3D6B869D7DCD56D67","C0F8FAF6428D5B2F616C5FABBAAE5DD7","9258B1F24854D4D19052DEF3123F65C2","F593236AADA130AAABA84E75D1B9A7F4","FF387B2E079488FC043C016EE98D5FAB","027EE67A422ADD6606E3EF4CBFAD1C84","CF399574BF225AD68B80B03D50D112F9","9EC213E27A37CC0A6B27CD245A6DA717","875C5946A8ECD9237676ED9705408FDA"]","currentPlaySongId":"B9070AADBD946C035819850E3DB1B9A6","source":"CAR_PAGE_RECOMMEND_PRIVATE_RCMD_SONG"}


### 请求示例：


```text
https://music.163.com/openapi/music/basic/recommend/more/song?appId=a30102000000000037b6f93f337049b7&signType=RSA_SHA256&timestamp=1775035423596&accessToken=xd13ba2fe1fe1f8e378b6f0c8db07e0e06003a6b05d5122u&device={"channel":"byd","deviceId":"bnVsbAkwMjowMDowMDowMDowMDowMAllYTYzMmM0NTZlNmNhZTFkCW51bGw=","deviceType":"andrcar","appVer":"6.2.51","os":"andrcar","osVer":"14","brand":"vivo","model":"iPA2375","clientIp":"183.136.182.138"}&bizContent={"qualityFlag":true,"limit":2,"songIds":"[\"B9070AADBD946C035819850E3DB1B9A6\",\"C1688FA30C791211D5B0AE3D2BFC1BE3\",\"1B05834659818A420BA3CDE85B3AAE21\",\"C78C27254E17FBD3D6B869D7DCD56D67\",\"C0F8FAF6428D5B2F616C5FABBAAE5DD7\",\"9258B1F24854D4D19052DEF3123F65C2\",\"F593236AADA130AAABA84E75D1B9A7F4\",\"FF387B2E079488FC043C016EE98D5FAB\",\"027EE67A422ADD6606E3EF4CBFAD1C84\",\"CF399574BF225AD68B80B03D50D112F9\",\"9EC213E27A37CC0A6B27CD245A6DA717\",\"875C5946A8ECD9237676ED9705408FDA\"]","currentPlaySongId":"B9070AADBD946C035819850E3DB1B9A6","source":"CAR_PAGE_RECOMMEND_PRIVATE_RCMD_SONG"}
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>albumName</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>albumId</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>albumArtistId</td>
<td>String</td>
<td>专辑艺人Id</td>
</tr>
<tr>
<td>albumArtistName</td>
<td>String</td>
<td>专辑艺人名</td>
</tr>
<tr>
<td>artistId</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>artistName</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面Url</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放url</td>
</tr>
<tr>
<td>playUrlExpireTime</td>
<td>String</td>
<td>播放url到期时间</td>
</tr>
<tr>
<td>br</td>
<td>int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载歌曲（true，false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>是否vip歌曲</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持片段试听</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>片段试听起止时间，单位：s</td>
</tr>
<tr>
<td>freeTrialPrivilege</td>
<td>FreeTrialPrivilegeVO</td>
<td>全曲试听</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>gain</td>
<td>Float</td>
<td>音频增益</td>
</tr>
<tr>
<td>peak</td>
<td>Float</td>
<td>音频peak</td>
</tr>
<tr>
<td>type</td>
<td>String</td>
<td>文件类型</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>songSize</td>
<td>long</td>
<td>歌曲的大小</td>
</tr>
<tr>
<td>songMd5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>artists</td>
<td>List<SongArtistVo></td>
<td>艺人集合</td>
</tr>
<tr>
<td>fullArtists</td>
<td>List<SongArtistVo></td>
<td>艺人Id</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效信息（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>歌曲音质列表</td>
</tr>
<tr>
<td>vocalFlag</td>
<td>Boolean</td>
<td>是否有干声  false:没有  true 有</td>
</tr>
<tr>
<td>originCoverType</td>
<td>Integer</td>
<td>原唱标签，1:原唱</td>
</tr>
<tr>
<td>payed</td>
<td>SongPrivilegePayedVO</td>
<td>付费信息</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**FreeTrail**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>start</td>
<td>Int</td>
<td>试听开始时间</td>
</tr>
<tr>
<td>end</td>
<td>Int</td>
<td>试听结束时间</td>
</tr>
</tbody>
</table>


**FreeTrialPrivilegeVO**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>cannotListenReason</td>
<td>Integer</td>
<td>不可试听原因</td>
</tr>
<tr>
<td>resConsumable</td>
<td>Boolean</td>
<td>资源维度是否支持全曲试听，全曲试听标记大于0为支持</td>
</tr>
<tr>
<td>userConsumable</td>
<td>Boolean</td>
<td>用户维度是否支持全曲试听</td>
</tr>
</tbody>
</table>


**SongArtistVo**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>艺人封面</td>
</tr>
</tbody>
</table>


**maxBrLevel、plLevel、dlLevel、level**


<table>
<thead>
<tr>
<th>值</th>
<th>音质</th>
<th>比特率</th>
</tr>
</thead>
<tbody>
<tr>
<td>vivid</td>
<td>Audio Vivid</td>
<td>无</td>
</tr>
<tr>
<td>dolby</td>
<td>杜比</td>
<td>无</td>
</tr>
<tr>
<td>sky</td>
<td>沉浸环绕声</td>
<td>无</td>
</tr>
<tr>
<td>jymaster</td>
<td>超清母带</td>
<td>待定</td>
</tr>
<tr>
<td>jyeffect</td>
<td>高清臻音</td>
<td>无</td>
</tr>
<tr>
<td>hires</td>
<td>hires</td>
<td>1999</td>
</tr>
<tr>
<td>lossless</td>
<td>无损</td>
<td>999</td>
</tr>
<tr>
<td>exhigh</td>
<td>极高</td>
<td>320</td>
</tr>
<tr>
<td>standard</td>
<td>标准</td>
<td>128</td>
</tr>
<tr>
<td>none</td>
<td>不能播放/下载</td>
<td>0</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "songListVos": [
      {
        "id": "650D057AADF3AAB6FD1F63798689066A",
        "name": "至少还有你",
        "duration": 274504,
        "artists": [
          {
            "id": "A1A6E96049AA73E2E85181E8C1718A30",
            "name": "林忆莲",
            "coverImgUrl": null
          }
        ],
        "fullArtists": [
          {
            "id": "A1A6E96049AA73E2E85181E8C1718A30",
            "name": "林忆莲",
            "coverImgUrl": null
          }
        ],
        "album": {
          "id": "455490B6F413147EEB0042CFD83F0638",
          "name": "林夕字传2"
        },
        "playFlag": true,
        "downloadFlag": true,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": false,
        "liked": false,
        "coverImgUrl": "http://p1.music.126.net/thXkupdKJtuSswDv4u-sow==/68169720928612.jpg",
        "vipPlayFlag": false,
        "accompanyFlag": null,
        "songMaxBr": 999000,
        "userMaxBr": 320000,
        "maxBrLevel": "sky",
        "plLevel": "exhigh",
        "dlLevel": "lossless",
        "songTag": [
          "流行"
        ],
        "alg": "alg-music-rec-lms_hp2023_style_rec_iot-red_i2i",
        "privateCloudSong": false,
        "freeTrailFlag": false,
        "songFtFlag": false,
        "freeTrialPrivilege": {
          "cannotListenReason": null,
          "resConsumable": false,
          "userConsumable": false,
          "listenType": null,
          "freeLimitTagType": null
        },
        "songFee": 0,
        "playMaxbr": 999000,
        "qualities": [
          "vividMusic",
          "skMusic",
          "jyMasterMusic",
          "jyEffectMusic",
          "sqMusic",
          "hmusic",
          "mmusic",
          "lmusic"
        ],
        "emotionTag": null,
        "vocalFlag": null,
        "payed": {
          "payed": 0,
          "vipPackagePayed": 0,
          "singlePayed": 0,
          "albumPayed": 0
        },
        "openApiTraceInfo": null,
        "dirty": false,
        "visible": true
      }
    ]
  }
}
```

## 获取场景音乐标签

- docId：`8e151e88295e46c195c4786ad382cc5f`
- 来源：https://developer.music.163.com/st/developer/document?docId=8e151e88295e46c195c4786ad382cc5f

## 获取场景音乐标签


### /openapi/music/basic/scene/radio/tags/get


```text
- 根据特定场景选择音乐，用户可以根据场景或情感类型浏览音乐推荐
```


![图片](https://p5.music.126.net/UlqLyCQrtAOAkaqwFqnrcw==/109951172630818911)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


- 无


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/scene/radio/tags/get?appId=a301020000000000746f96a196e52e07&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&accessToken=sbea2debceadb9d6e4eb4a1c85529cc8fb7c4e3e91863147b&timestamp=1713855249160&sign=Uv6a7FVuFeHBONc6cIbYLrvj0pigbBBbPQEFyDaEz5GxohYtaz3v16Ygy%2BLyXiYlZq729lIcQEMNSvE2i%2Flls9t0R6geIvcQKeexUUjmlVfvNiz5JQB1LBqu0SqXGEHOD1yp%2FSkgDtaW48DDnueJKmR%2BOy7Deg0eG0vvE%2B%2FVlUA1K95HEyqRAMc4XnQ0FwwsdAvnlxW01d51Hd8C%2FgI%2BtiQVv8f0CdYn0tWPYl1pETfmik9CcLDLZ4wcHbN6zCLs3XhmQBKIuJxSNF3scvyDzRwmjEZFa3VNumM4%2FJuZI7Nmji3rRlGe1s3UkvuGQyyrO1oAkUHRqQGJV4Nz9NDvGg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>tag</td>
<td>String</td>
<td>标签</td>
</tr>
<tr>
<td>image</td>
<td>String</td>
<td>封面</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "tag": "通勤节奏",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35959383856/aa0f/ebe0/6347/803e4ee2425dc928d496b99d478ef787.jpg",
      "name": "通勤节奏"
    },
    {
      "tag": "尽情欢乐",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35959660331/fb8d/0851/0831/84244a9f115feef9721a4287272f1523.jpg",
      "name": "尽情欢乐"
    },
    {
      "tag": "放松时刻",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35960382103/1c73/bd04/8731/c1849db1ea783994a6746c20d435e3fc.jpg",
      "name": "放松时刻"
    },
    {
      "tag": "激情摇滚",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35960585460/c2b4/b695/7f20/c5773b521a1daa2a6705dd1928027416.jpg",
      "name": "激情摇滚"
    },
    {
      "tag": "纵享说唱",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35960581820/eb8f/6785/a7a9/dccaa7c7d648c742926732ef213e1677.jpg",
      "name": "纵享说唱"
    },
    {
      "tag": "华语岁月",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35959283100/1a2f/e229/ad6c/46f57726622b3f4815464e90aef98276.jpg",
      "name": "华语岁月"
    },
    {
      "tag": "粤语声浪",
      "image": "http://p1.music.126.net/ZfERtoJhfDVW9TZ2xu0wWw==/109951169287304782.jpg",
      "name": "粤语声浪"
    },
    {
      "tag": "欧美风情",
      "image": "http://p1.music.126.net/b5EwxjMbvic6VDDd1td4EQ==/109951169287318506.jpg",
      "name": "欧美风情"
    },
    {
      "tag": "日语弦歌",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35959308788/d061/7bc1/7e7e/57845acca2fd9c1bb11f8112477fd98c.jpg",
      "name": "日语弦歌"
    },
    {
      "tag": "伤感",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35960053934/c5db/c6ea/4f6d/e9426164911f32ec9debfb28576730e8.png",
      "name": "伤感"
    },
    {
      "tag": "浪漫时光",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35960393330/4fd9/13ea/c6c5/03e536e31e8be1db98035295c1bf1f97.jpg",
      "name": "浪漫时光"
    },
    {
      "tag": "专注",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35960501816/fc63/e794/ee1d/2bb0e9de0ccb36f29cf1d68904d05871.jpg",
      "name": "专注"
    },
    {
      "tag": "电子浪潮",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35960572766/b5da/0e32/8174/ee34395b991868ac8080eef754c4eb01.jpg",
      "name": "电子浪潮"
    },
    {
      "tag": "韩语潮流",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35959330325/0c10/c713/d04a/4d429938b5e1617662c8990fcceb3cd5.jpg",
      "name": "韩语潮流"
    },
    {
      "tag": "派对",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35960544671/630c/0d27/bf0f/f9b25edf181111a91847595c0008f5d1.jpg",
      "name": "派对"
    },
    {
      "tag": "无尽爵响",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35960590601/368b/06f6/0334/a541b54b2f32762fd0f46f5f23e9700f.jpg",
      "name": "无尽爵响"
    },
    {
      "tag": "儿歌精选",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35960594617/f0ac/0971/78f5/1fb2b59f3b597c2009c914986bbee79b.jpg",
      "name": "儿歌精选"
    },
    {
      "tag": "慢摇DJ",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/35960607153/85bf/e58b/3634/dfa4a14ede32fb7ffc506d23020e5563.jpg",
      "name": "慢摇DJ"
    },
    {
      "tag": "活力清晨",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/59978787487/b49e/3f3f/efc1/50ef58bd32549efaafa0ff5d31518e9b.jpg",
      "name": "活力清晨"
    },
    {
      "tag": "落日时分",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/59978785677/c2e1/3983/2714/537830009527ca7aec560fac569af3ad.png",
      "name": "落日时分"
    },
    {
      "tag": "深夜驾驶",
      "image": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/59978787497/75ff/9943/5220/552734dc6e3b21d45130d5944c6c2f8e.jpg",
      "name": "深夜驾驶"
    },
    {
      "tag": "随心旅行",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/59978788049/2ae5/581b/db07/703adab4df1fa3195bd1692a24ad65f5.jpg",
      "name": "随心旅行"
    },
    {
      "tag": "房车生活",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/59978789044/2884/64dd/fae5/66fc158e02bc53c5d6680ee77c5e9b7d.jpg",
      "name": "房车生活"
    },
    {
      "tag": "品味古典",
      "image": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/59978784581/4783/fe55/3967/ff8f746b81beb6455fc26c538de07d29.jpg",
      "name": "品味古典"
    },
    {
      "tag": "咖啡时光",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/59978785658/d77d/b972/a7a3/b051ac3e1199cba1164864acd3c6a10e.jpg",
      "name": "咖啡时光"
    },
    {
      "tag": "雨天路上",
      "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/59978789046/1458/5698/2ab2/6ba503a9bd2321d15f1e6e289156f4d9.jpg",
      "name": "雨天路上"
    },
    {
      "tag": "电竞时刻",
      "image": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/59978785662/598e/52ab/6222/79b5aecca1787626a7f81443dd94d6f9.jpg",
      "name": "电竞时刻"
    },
    {
      "tag": "驾车逐风",
      "image": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/59978786586/2e8f/d48d/7c51/4ae90d9a311bcd2c7bb1190e908e2d5c.jpg",
      "name": "驾车逐风"
    }
  ]
}
```

## 获取场景音乐标签下的歌曲

- docId：`4f5e35ad719a46f9bc0b43e81f6e1786`
- 来源：https://developer.music.163.com/st/developer/document?docId=4f5e35ad719a46f9bc0b43e81f6e1786

## 获取场景音乐标签下的歌曲


### /openapi/music/basic/scene/radio/get


![图片](https://p5.music.126.net/UlqLyCQrtAOAkaqwFqnrcw==/109951172630818911)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>scene</td>
<td>是</td>
<td>String</td>
<td>场景标签</td>
</tr>
<tr>
<td>limit</td>
<td>否</td>
<td>Int</td>
<td>获取数据量（建议3，最多10）</td>
</tr>
<tr>
<td>withPlayUrl</td>
<td>否</td>
<td>Boolean</td>
<td>是否返回播放URL</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质</td>
</tr>
</tbody>
</table>


- 算法接口，最好实名登录

- 最佳实践：


{"limit":"3","scene":"驾车逐风"}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/scene/radio/get?appId=a301020000000000746f96a196e52e07&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&timestamp=1713856845880&accessToken=sbea2debceadb9d6e4eb4a1c85529cc8fb7c4e3e91863147b&bizContent={"qualityFlag":true,"scene":"欧美","limit":1,"withPlayUrl":true}&sign=Uv6a7FVuFeHBONc6cIbYLrvj0pigbBBbPQEFyDaEz5GxohYtaz3v16Ygy%2BLyXiYlZq729lIcQEMNSvE2i%2Flls9t0R6geIvcQKeexUUjmlVfvNiz5JQB1LBqu0SqXGEHOD1yp%2FSkgDtaW48DDnueJKmR%2BOy7Deg0eG0vvE%2B%2FVlUA1K95HEyqRAMc4XnQ0FwwsdAvnlxW01d51Hd8C%2FgI%2BtiQVv8f0CdYn0tWPYl1pETfmik9CcLDLZ4wcHbN6zCLs3XhmQBKIuJxSNF3scvyDzRwmjEZFa3VNumM4%2FJuZI7Nmji3rRlGe1s3UkvuGQyyrO1oAkUHRqQGJV4Nz9NDvGg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>albumName</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>albumId</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>albumArtistId</td>
<td>String</td>
<td>专辑艺人Id</td>
</tr>
<tr>
<td>albumArtistName</td>
<td>String</td>
<td>专辑艺人名</td>
</tr>
<tr>
<td>artistId</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>artistName</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面Url</td>
</tr>
<tr>
<td>mvId</td>
<td>String</td>
<td>mvId</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放url</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载歌曲（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持试听</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>试听起止时间，单位：s</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>songSize</td>
<td>int</td>
<td>歌曲的大小</td>
</tr>
<tr>
<td>songMd5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>br</td>
<td>int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效信息（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "id": "DF3BF2BFD183E218AB3D2A9D890F33DF",
      "name": "这一生关于你的风景",
      "duration": 276234,
      "albumName": "这一生关于你的风景",
      "albumId": "CD4D07FA0979A6997C8DD0FF00F3634C",
      "albumArtistId": "08E4EF9D235DB86C975132C9105CB9D1",
      "albumArtistName": "隔壁老樊",
      "artistId": "08E4EF9D235DB86C975132C9105CB9D1",
      "artistName": "隔壁老樊",
      "coverImgUrl": "http://p1.music.126.net/72pkxsrTN_zUscdzMk5mMA==/109951164289743850.jpg",
      "mvId": null,
      "playUrl": "http://iot102.music.126.net/Yml6PWlvdCZjaGFubmVsPWlvdGFwaXRlc3Qmc2NlbmU9b3BlbmFwaQ/20240424152046/11e21a8971ee787b8323569f4d3f53e8/jdymusic/obj/wo3DlMOGwrbDjj7DisKw/14096464854/f9e3/1d0a/6be0/23e8ac25f47e8e6fc83707430c3cf14f.mp3",
      "br": 320000,
      "playFlag": true,
      "downloadFlag": false,
      "payPlayFlag": false,
      "payDownloadFlag": true,
      "vipFlag": false,
      "vipPlayFlag": false,
      "freeTrailFlag": false,
      "songFtFlag": false,
      "freeTrail": null,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "playMaxbr": 0,
      "liked": false,
      "songMaxBr": 999000,
      "userMaxBr": 320000,
      "maxBrLevel": "hires",
      "plLevel": "exhigh",
      "dlLevel": "none",
      "level": "exhigh",
      "songSize": 11051565,
      "songMd5": "23e8ac25f47e8e6fc83707430c3cf14f",
      "songTag": [
        "流行",
        "华语流行"
      ],
      "emotionTag": null,
      "artists": [
        {
          "id": "08E4EF9D235DB86C975132C9105CB9D1",
          "name": "隔壁老樊"
        }
      ],
      "songFee": 8,
      "alg": "alg-music-rec_cm_openFM_ns",
      "audioFlag": null,
      "effects": null,
      "privateCloudSong": false,
      "qualities": [
        "skMusic",
        "jyMasterMusic",
        "jyEffectMusic",
        "hrMusic",
        "sqMusic",
        "hmusic",
        "mmusic",
        "lmusic"
      ],
      "visible": true
    }
  ]
}
```


### 备注


公共参数需要传入accessToken

## 私人定制

- docId：`a7db4997ab77438cbce63df7a60734e3`
- 来源：https://developer.music.163.com/st/developer/document?docId=a7db4997ab77438cbce63df7a60734e3

## 私人定制


### /openapi/music/basic/recommend/style/songlist/get


```text
为用户推送更优质的专属歌曲列表
会下发标题，每次请求拿到的列表不一样
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>limit</td>
<td>否</td>
<td>Int</td>
<td>请求资源数，默认5，最多12首</td>
</tr>
<tr>
<td>trialScene</td>
<td>否</td>
<td>String</td>
<td>全曲试听相关，默认null</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质，默认false</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/recommend/style/songlist/get?appId=a301020000000000746f96a196e52e07&bizContent={"limit":"1"}&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&timestamp=1729580727195&accessToken=6c762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&sign=RtNOzpsS%2F7hlZBEgs7VifuoCuah5LgrjU3HtNRHgH14Jb2il4S6ag26i7odFS9tI3sK%2B3UePo7rRILCTzvmKX1AG%2F9KMcKs0TTXP1DIsn6gLg0uOmB2Dw6P%2FCWkpLgtZCUe6428jwZyt1ybm7tqGquFzxxQuT5GRUSJD50OsyMxnjFx4vzL6bKuRtXlZF%2BQjcCeqaGOyu0Qq0PpReZcZXNZ%2BbajHI54IryWrUFgzIjan82b289VWudJt288UI58mpj2qgiWpCXjBewQ1%2Boq9H20KbhcGhK0DThpfuUKtXI52bBG008oVsPMqGzJ5hje6fi7XpY%2FGfua7R3k%2Ftsx3RA%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>title</td>
<td>String</td>
<td>标题</td>
</tr>
<tr>
<td>songListVos</td>
<td>List<	SongListVo></td>
<td>歌曲列表</td>
</tr>
</tbody>
</table>


### SongListVo


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>时长</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>album</td>
<td>Album</td>
<td>专辑信息</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面url</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>alg</td>
<td>String</td>
<td>算法推荐使用，播放数据上报接口需透传该字段</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>extMap</td>
<td>List<String></td>
<td>扩展标签</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**extMap**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>recReason</td>
<td>String</td>
<td>推荐理由</td>
</tr>
</tbody>
</table>


**Qualities**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>dolbyMusic</td>
<td>String</td>
<td>杜比</td>
</tr>
<tr>
<td>skMusic</td>
<td>String</td>
<td>沉浸环绕声</td>
</tr>
<tr>
<td>jyMasterMusic</td>
<td>String</td>
<td>超清母带</td>
</tr>
<tr>
<td>jyEffectMusic</td>
<td>String</td>
<td>高清臻音</td>
</tr>
<tr>
<td>hrMusic</td>
<td>String</td>
<td>hi-res</td>
</tr>
<tr>
<td>sqMusic</td>
<td>String</td>
<td>无损</td>
</tr>
<tr>
<td>hmusic</td>
<td>String</td>
<td>极高</td>
</tr>
<tr>
<td>mmusic</td>
<td>String</td>
<td>较高</td>
</tr>
<tr>
<td>lmusic</td>
<td>String</td>
<td>标准</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**Album**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "songListVos": [
      {
        "id": "4D5C2F416B95E703484D6C8F66D6BD82",
        "name": "Extasy (狂欢)",
        "duration": 141369,
        "artists": [
          {
            "id": "06F405DA89F5B8B92ABB652F547BD947",
            "name": "KpNAk"
          },
          {
            "id": "48343918E31CD514CC5DF634C348BAD6",
            "name": "BeYMu"
          }
        ],
        "album": {
          "id": "C64F764DB361B13FDAA7500650B5B579",
          "name": "Extasy (狂欢)"
        },
        "playFlag": true,
        "downloadFlag": true,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": false,
        "liked": false,
        "coverImgUrl": "http://p1.music.126.net/cUqQurkmeZ6n5jaoh7t7KA==/109951169121966136.jpg",
        "vipPlayFlag": false,
        "accompanyFlag": null,
        "songMaxBr": 999000,
        "userMaxBr": 999000,
        "maxBrLevel": "lossless",
        "plLevel": "lossless",
        "dlLevel": "lossless",
        "songTag": [
          "电子"
        ],
        "privateCloudSong": false,
        "freeTrailFlag": false,
        "songFtFlag": false,
        "freeTrialPrivilege": {
          "cannotListenReason": null,
          "resConsumable": false,
          "userConsumable": false
        },
        "songFee": 8,
        "playMaxbr": 999000,
        "qualities": null,
        "emotionTag": null,
        "extMap": {
          "recReason": "超70%人播放"
        },
        "visible": true
      }
    ],
    "title": "根据「失恋三部曲：下雨天+删了吧+嘉宾」为你推荐"
  }
}
```


### 备注


- 公共参数需要传入accessToken

## 每日推荐

- docId：`6b8a63554d5b4e89a98ee703018c15c2`
- 来源：https://developer.music.163.com/st/developer/document?docId=6b8a63554d5b4e89a98ee703018c15c2

## 每日推荐


### /openapi/music/basic/recommend/songlist/get/v2


```text
需申请接口组：云音乐推荐能力
需要用户实名登录（匿名也可以，有默认数据）
```


### 请求方式：


- GET


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>请求数据量（建议30首），最大40</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质</td>
</tr>
</tbody>
</table>


- 取30到35首歌就行，和移动端保持一致


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/recommend/songlist/get/v2?appId=a301010000000000aadb4e5a28b45a67&bizContent=%7B%22limit%22%3A100%7D&signType=RSA_SHA256&accessToken=x46c13d33a898ad1d257c5009a1daadfced5a1160176c2309y&device=%7B%22deviceType%22%3A%22andrwear%22%2C%22os%22%3A%22andrwear%22%2C%22appVer%22%3A%220.1%22%2C%22channel%22%3A%22hm%22%2C%22model%22%3A%22kys%22%2C%22deviceId%22%3A%22321%22%2C%22brand%22%3A%22hm%22%2C%22osVer%22%3A%228.1.0%22%7D&timestamp=1615446390779
```


### 返回参数说明


**Records参数（列表）**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>时长</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>album</td>
<td>Album</td>
<td>专辑信息</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面url</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>alg</td>
<td>String</td>
<td>算法推荐使用，播放数据上报接口需透传该字段</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**Qualities**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>dolbyMusic</td>
<td>String</td>
<td>杜比</td>
</tr>
<tr>
<td>skMusic</td>
<td>String</td>
<td>沉浸环绕声</td>
</tr>
<tr>
<td>jyMasterMusic</td>
<td>String</td>
<td>超清母带</td>
</tr>
<tr>
<td>jyEffectMusic</td>
<td>String</td>
<td>高清臻音</td>
</tr>
<tr>
<td>hrMusic</td>
<td>String</td>
<td>hi-res</td>
</tr>
<tr>
<td>sqMusic</td>
<td>String</td>
<td>无损</td>
</tr>
<tr>
<td>hmusic</td>
<td>String</td>
<td>极高</td>
</tr>
<tr>
<td>mmusic</td>
<td>String</td>
<td>较高</td>
</tr>
<tr>
<td>lmusic</td>
<td>String</td>
<td>标准</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**Album**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "id": "EA0F367B5EEF238F97287FBA5011E0A3",
      "name": "风驶过之后",
      "duration": 164039,
      "artists": [
        {
          "id": "8C2B665260890DA77C04FD70AAB62CDB",
          "name": "YOUNG"
        },
        {
          "id": "2A8F4234209EDFF7BABDC3DD2CFBABC2",
          "name": "果妹"
        }
      ],
      "album": {
        "id": "D495CF6A19D85265DAF0EFA42DA04474",
        "name": "风驶过之后"
      },
      "playFlag": true,
      "downloadFlag": true,
      "payPlayFlag": false,
      "payDownloadFlag": false,
      "vipFlag": false,
      "liked": false,
      "coverImgUrl": "http://p1.music.126.net/ZX4IU3ZFSnkcfxBoJfkjkQ==/109951168636865566.jpg",
      "vipPlayFlag": false,
      "accompanyFlag": null,
      "songMaxBr": 999000,
      "userMaxBr": 999000,
      "maxBrLevel": "hires",
      "plLevel": "hires",
      "dlLevel": "hires",
      "songTag": [
        "嘻哈说唱",
        "流行说唱",
        "地域说唱"
      ],
      "alg": "alg-music-rec_cm_openDaily_pf_i2i",
      "privateCloudSong": false,
      "freeTrailFlag": false,
      "songFtFlag": false,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "songFee": 8,
      "playMaxbr": 999000,
      "qualities": [
        "skMusic",
        "jyMasterMusic",
        "jyEffectMusic",
        "hrMusic",
        "sqMusic",
        "hmusic",
        "mmusic",
        "lmusic"
      ],
      "visible": true
    }
  ]
}
```


### 备注


- 公共参数需要传入accessToken

# 推荐-歌单类API

## 获取推荐歌单列表

- docId：`9d7ae747fa0246088cdf7ac21cdb7b46`
- 来源：https://developer.music.163.com/st/developer/document?docId=9d7ae747fa0246088cdf7ac21cdb7b46

## 获取推荐歌单列表


### /openapi/music/basic/recommend/playlist/get


- 获取到推荐给当前用户的歌单信息，需要用户匿名或实名登录


```text
- 有运营位，可配置指定歌单在推荐页首页位置，联系云音乐同事
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>请求数据量，建议30</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
</tbody>
</table>


- 算法接口，每次请求都会重推，不要超过300，如果单次拿的过多，会导致推荐结果极大浪费


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/recommend/playlist/get?bizContent%3d%7b%22limit%22%3a%2210%22%2c%22offset%22%3a%220%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


**Records参数（列表）**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>String</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>createTime</td>
<td>long</td>
<td>创建时间（时间戳）</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
    "code":200,
    "subCode":null,
    "message":null,
    "data":{
        "recordCount":1301,
        "records":[
            {
                "id":"EC1C091CD575E0143D1A12672904BEB2",
                "name":"[欧美私人订制] 最懂你的欧美推荐 每日更新35首",
                "coverImgUrl":"http://p3.music.126.net/ov41Jb2wGPGo8XJsMPiabg==/109951164273699524.jpg",
                "describe":"收藏专属于你的欧美日推每天和喜欢的欧美音乐不期而遇",
                "creatorNickName":"网易云音乐",
                "playCount":210376736,
                "subscribedCount":2679925,
                "tags":[
                    "欧美"
                ],
                "createTime": 0,
                "subed":false
            }
        ]
    }
}
```

## 获取雷达歌单

- docId：`7be7ab491ae04c299584d88ad1ba4e55`
- 来源：https://developer.music.163.com/st/developer/document?docId=7be7ab491ae04c299584d88ad1ba4e55

## 获取雷达歌单


### /openapi/music/basic/playlist/radar/get


### 雷达歌单介绍


```text
- 全新的歌曲推荐功能，可以基于历史口味和实时偏好，为每位用户每天生成一份完全个性化的歌单。
- 用户虽然使用的是相同的“雷达”，但每个人看到的歌曲列表、歌单封面等都不一样，形成了在同一份歌单下听不同歌曲
```


- 需要用户实名登录，否则拿到的是默认数据


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>originalCoverFlag</td>
<td>否</td>
<td>Boolean</td>
<td>下发无水印封面，默认false</td>
</tr>
</tbody>
</table>


#### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/radar/get?accessToken=wb762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&appId=a301020000000000746f96a196e52e07&device=%7B%22deviceType%22:%22openapi%22,%22os%22:%22openapi%22,%22appVer%22:%220.1%22,%22channel%22:%22iotapitest%22,%22model%22:%22kys%22,%22deviceId%22:%22357%22,%22brand%22:%22iotapitest%22,%22osVer%22:%228.1.0%22,%22clientIp%22:%22192.168.0.1%22%7D&sign=A%2BBqA14ykTGbjTyxhceByQbtwsx7ELpD1PlZaStWowfseaTnJ0r6%2BzSnXpH58IoNJag5ZWwTL%2FUW5a6RpTT7pmdvTUEq%2F3Nd4t0JJiNUiTCOB6inXsUcP%2BU8z0bTK2nQWIGJEyb7bfWLho0nrnQdbtUnwL9XZM4AA%2FYPV7dRdMGxIA26a2%2BqXUfUT00Ihc9mJ6ZVkIP6clfdG8c9RfIqRafs8qBsZjzTVHC9Mc61Ev6FsoBreBQ39GIiwJgvY6aVITH4Kpt9jGN2bl%2BTaEhuZ0jVPvfyPUmtTEWdfAor5z%2BNJkqxwJW3LHJgRNdXlLxP%2F%2BONpijJNbzCjT9bNCkS4w%3D%3D&signType=RSA_SHA256&timestamp=1708420459736
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>String</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>createTime</td>
<td>String</td>
<td>创建时间</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>trackCount</td>
<td>int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>specialType</td>
<td>int</td>
<td>歌单类型</td>
</tr>
<tr>
<td>category</td>
<td>String</td>
<td>分类</td>
</tr>
</tbody>
</table>


- 后续会不定期新增雷达歌单


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "id": "B1C86AB6C068730F51E99C8CE6549A13",
      "name": "今天从《小小》听起|私人雷达",
      "coverImgUrl": "http://p1.music.126.net/ugsmfOIvsoL_rl0xFvwa-g==/109951165502618561.jpg",
      "describe": "你爱的歌，值得反复聆听\n私人雷达，每日更新，收藏你的最爱",
      "creatorNickName": "云音乐私人雷达",
      "playCount": 18221877248,
      "subscribedCount": 36631600,
      "tags": [],
      "createTime": 1577330551437,
      "subed": false,
      "trackCount": 35,
      "specialType": 100,
      "category": null
    },
    {
      "id": "532B326DCEF5C6722E0E9537FF243547",
      "name": "听你爱的星辰大海|华语私人雷达",
      "coverImgUrl": "http://p1.music.126.net/k5U4NnqLx6w0Qda4YBznTQ==/109951165664928995.jpg",
      "describe": "全都是耐听的华语好歌\n这里是你的专属华语精选\n收藏订阅，歌荒，不存在的事",
      "creatorNickName": "云音乐官方歌单",
      "playCount": 1903984128,
      "subscribedCount": 7274239,
      "tags": [],
      "createTime": 1559735469152,
      "subed": false,
      "trackCount": 35,
      "specialType": 100,
      "category": null
    },
    {
      "id": "4D16AE06008B50B896AA792B7243F55D",
      "name": "还在听《大海》吗|时光雷达",
      "coverImgUrl": "http://p1.music.126.net/E300Rkl6CkGgNHpvy4fgsQ==/109951165658171592.jpg",
      "describe": "你曾经挚爱的那些歌，现在还记得吗",
      "creatorNickName": "云音乐私人雷达",
      "playCount": 889814976,
      "subscribedCount": 3165669,
      "tags": [],
      "createTime": 1604556362475,
      "subed": true,
      "trackCount": 30,
      "specialType": 100,
      "category": null
    },
    {
      "id": "44050104EDB777213C6EA0B48022E9A8",
      "name": "Rohith Pai Kasturi喊你来听新歌|新歌雷达",
      "coverImgUrl": "http://p1.music.126.net/cwHGYePZUzgpTK-VERFEHw==/109951168868653210.jpg",
      "describe": "找到你爱的歌手\n新鲜发行的歌曲 \n都在新歌雷达",
      "creatorNickName": "云音乐私人雷达",
      "playCount": 146697552,
      "subscribedCount": 531152,
      "tags": [],
      "createTime": 1603418924191,
      "subed": false,
      "trackCount": 30,
      "specialType": 100,
      "category": null
    },
    {
      "id": "4387B4BC956AC7FC36980C80C1433459",
      "name": "费玉清(你的关注)与你相遇|乐迷雷达",
      "coverImgUrl": "http://p1.music.126.net/xWZScU_Tpd59Q_zDbxa6Xw==/109951165665097645.jpg",
      "describe": "你最爱的歌手在这里",
      "creatorNickName": "云音乐私人雷达",
      "playCount": 171800624,
      "subscribedCount": 804197,
      "tags": [],
      "createTime": 1604972986023,
      "subed": false,
      "trackCount": 30,
      "specialType": 100,
      "category": null
    },
    {
      "id": "A0EFE2F006290E3C2ACF46FE6F527BD2",
      "name": "从《人体艺术》开启宝藏音乐环游|宝藏雷达",
      "coverImgUrl": "http://p1.music.126.net/5sQ0Dmz4_nJMYtD0UXBs6w==/109951168645408205.jpg",
      "describe": "令你心动的宝藏歌曲\n可能都是在不经意间出现的\n每天来寻找 会有不同收获",
      "creatorNickName": "云音乐私人雷达",
      "playCount": 265300832,
      "subscribedCount": 1115602,
      "tags": [],
      "createTime": 1606987907739,
      "subed": false,
      "trackCount": 30,
      "specialType": 100,
      "category": null
    }
  ]
}
```

## 获取榜单列表

- docId：`662be3936dc84a28957d547755eca385`
- 来源：https://developer.music.163.com/st/developer/document?docId=662be3936dc84a28957d547755eca385

## 获取榜单列表


### /openapi/music/basic/toplist/get/v2


- 获取到云音乐榜单列表


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


- 无


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/toplist/get/v2?bizContent%3d%7b%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


- Records参数（列表）


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>String</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>createTime</td>
<td>long</td>
<td>创建时间</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>trackCount</td>
<td>int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>specialType</td>
<td>int</td>
<td>歌单类型</td>
</tr>
<tr>
<td>category</td>
<td>String</td>
<td>分类</td>
</tr>
<tr>
<td>updateFrequency</td>
<td>string</td>
<td>更新周期</td>
</tr>
</tbody>
</table>


category


<table>
<thead>
<tr>
<th>值</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>OFFICIAL</td>
<td>官方榜</td>
</tr>
<tr>
<td>FEATURE</td>
<td>精选榜</td>
</tr>
<tr>
<td>MUSIC_STYLE</td>
<td>曲风榜</td>
</tr>
<tr>
<td>GLOBAL</td>
<td>全球榜</td>
</tr>
<tr>
<td>MORE</td>
<td>特色榜</td>
</tr>
<tr>
<td>LANGUAGE</td>
<td>语种榜</td>
</tr>
<tr>
<td>TOPPING</td>
<td>置顶榜（榜单推荐，可不用）</td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>code</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>请求正常</td>
</tr>
<tr>
<td>400</td>
<td>参数错误</td>
</tr>
<tr>
<td>500</td>
<td>系统错误</td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>subcode</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>有返回数据</td>
</tr>
<tr>
<td>10007</td>
<td>资源不存在</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
    "code": 200,
    "subCode": "200",
    "message": null,
    "data": [
        {
            "id": "78A6A878AD1B0B4F99FC4C940A8B7C01",
            "name": "美国Billboard榜",
            "coverImgUrl": "http://p1.music.126.net/rwRsVIJHQ68gglhA6TNEYA==/109951165611413732.jpg",
            "describe": "美国Billboard排行榜",
            "creatorNickName": "Billboard公告牌",
            "playCount": 611930496,
            "subscribedCount": 1326946,
            "tags": [
                "流行",
                "欧美",
                "榜单"
            ],
            "createTime": 1358823076818,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "GLOBAL",
            "updateFrequency": "每周三更新"
        },
        {
            "id": "DFD452FC17AC37D9C1B9518EA1DC45D5",
            "name": "UK排行榜周榜",
            "coverImgUrl": "http://p1.music.126.net/fhAqiflLy3eU-ldmBQByrg==/109951165613082765.jpg",
            "describe": "UK排行榜",
            "creatorNickName": "UK排行榜",
            "playCount": 146589888,
            "subscribedCount": 289751,
            "tags": [
                "榜单",
                "欧美"
            ],
            "createTime": 1361239766844,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "GLOBAL",
            "updateFrequency": "每周一更新"
        },
        {
            "id": "9A842DEA90F28A13AB3499FF2E183762",
            "name": "日本Oricon榜",
            "coverImgUrl": "http://p1.music.126.net/aXUPgImt8hhf4cMUZEjP4g==/109951165611417794.jpg",
            "describe": "日本Oricon数字单曲周榜，每周三更新，欢迎关注。",
            "creatorNickName": "日本公信榜（Oricon）",
            "playCount": 63533684,
            "subscribedCount": 157659,
            "tags": [
                "榜单",
                "日语"
            ],
            "createTime": 1357635084874,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "GLOBAL",
            "updateFrequency": "每周三更新"
        },
        {
            "id": "7C6F2F89F3C13CF38C8888F166492C72",
            "name": "法国 NRJ Vos Hits 周榜",
            "coverImgUrl": "http://p1.music.126.net/-fyzrPWd06FfWl_0JDAxMQ==/109951165613108584.jpg",
            "describe": "法国NRJ电台（national Radio de Jeunes）成立于1981年，总部位于法国巴黎。是法国最受欢迎的音乐电台和听众最多的广播电台之一。NRJ音乐奖素有法国的“格莱美”之称。此榜单针对NRJ电台法国本土热门歌曲排行。【每周五更新】",
            "creatorNickName": "小翰子",
            "playCount": 23841604,
            "subscribedCount": 60927,
            "tags": [
                "榜单"
            ],
            "createTime": 1409825013948,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "GLOBAL",
            "updateFrequency": "每周五更新"
        },
        {
            "id": "C0D2B30491BE8FB331C457190D5F0D6D",
            "name": "俄罗斯top hit流行音乐榜",
            "coverImgUrl": "http://p1.music.126.net/KLVO8PxVZzOoLdWQQNyprA==/109951166327316568.jpg",
            "describe": "top hit榜根据俄罗斯及全球400多个无线广播的音乐播放量和YouTube播放量计算得来，每周一更新。",
            "creatorNickName": "空虚小编",
            "playCount": 3187292,
            "subscribedCount": 6423,
            "tags": [],
            "createTime": 1630035002268,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "GLOBAL",
            "updateFrequency": "每周五更新"
        },
        {
            "id": "1CB4B770E5BD490F92192FB6A86BC5B6",
            "name": "听歌识曲榜",
            "coverImgUrl": "http://p1.music.126.net/wJVUAiUuykKk7yGbQxDBug==/109951167430857712.jpg",
            "describe": "网易云音乐站内歌曲按用户“听歌识曲”次数排列，每周四更新",
            "creatorNickName": "网易云音乐",
            "playCount": 25058224,
            "subscribedCount": 41581,
            "tags": [],
            "createTime": 1617180354803,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MORE",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "FDC8BCBFF9D006E68B8D5CCE37AF589D",
            "name": "潜力爆款榜",
            "coverImgUrl": "http://p1.music.126.net/Mi4QPklg1mtbWAfq74tEqQ==/109951165498334721.jpg",
            "describe": "全民一起赏音PICK好歌，每周一更新",
            "creatorNickName": "音乐挑战小助手",
            "playCount": 11214106,
            "subscribedCount": 31141,
            "tags": [
                "流行",
                "榜单"
            ],
            "createTime": 1605594274077,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MORE",
            "updateFrequency": "每周一更新"
        },
        {
            "id": "E88D08D15EF3D72F66BDEF6BC599D544",
            "name": "云音乐ACG动画榜",
            "coverImgUrl": "http://p1.music.126.net/SkGlKQ6acixthb77VlD9eQ==/109951164432300406.jpg",
            "describe": "云音乐中每天热度上升最快的100首ACG动画单曲，每日更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 5815468,
            "subscribedCount": 49051,
            "tags": [],
            "createTime": 1569549838610,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MORE",
            "updateFrequency": "每天更新"
        },
        {
            "id": "B1AA640AFE163083DFE9E7CE250CD86A",
            "name": "云音乐ACG游戏榜",
            "coverImgUrl": "http://p1.music.126.net/hivOOHMwEmnn9s_6rgZwEQ==/109951164432303700.jpg",
            "describe": "云音乐中每天热度上升最快的100首ACG游戏单曲，每日更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 2722449,
            "subscribedCount": 10823,
            "tags": [],
            "createTime": 1569549896656,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MORE",
            "updateFrequency": "每天更新"
        },
        {
            "id": "1D25B1C9C50783D8BBDEC3EC3D80F50D",
            "name": "云音乐ACG VOCALOID榜",
            "coverImgUrl": "http://p1.music.126.net/Ag7RyRCYiINcd9EtRXf6xA==/109951164432303690.jpg",
            "describe": null,
            "creatorNickName": "网易云音乐",
            "playCount": 1060438,
            "subscribedCount": 12076,
            "tags": [],
            "createTime": 1569549925472,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MORE",
            "updateFrequency": "每天更新"
        },
        {
            "id": "2069B84AEC19FC6D7AFECF775F47F5A7",
            "name": "KTV唛榜",
            "coverImgUrl": "http://p1.music.126.net/5wDP78s43ydVTKt62C8OjQ==/109951165613100063.jpg",
            "describe": "KTV唛榜是目前国内首个以全国超过200家KTV点歌平台真实数据的当红歌曲榜单。所涉及的KTV店铺覆盖全国近100多个城市，囊括一、二、三线各级城市及地区。在综合全国各地KTV点唱数据的前提下进行汇总与统计。为了保证信息的及时性，唛榜每周五更新。提供给K迷们最新和最准确的数据。",
            "creatorNickName": "KTV唛榜",
            "playCount": 70965640,
            "subscribedCount": 250571,
            "tags": [
                "华语",
                "KTV",
                "榜单"
            ],
            "createTime": 1405653093230,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MORE",
            "updateFrequency": "每周五更新"
        },
        {
            "id": "EC7487FCFE6D430B6D6A2A4E8D54A137",
            "name": "Beatport全球电子舞曲榜",
            "coverImgUrl": "http://p1.music.126.net/oT-RHuPBJiD7WMoU7WG5Rw==/109951166093489621.jpg",
            "describe": "Beatport全球电子舞曲排行榜TOP100（本榜每周三更新）",
            "creatorNickName": "云音乐电音星球",
            "playCount": 100327440,
            "subscribedCount": 277378,
            "tags": [
                "欧美",
                "电子",
                "榜单"
            ],
            "createTime": 1378886589466,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "GLOBAL",
            "updateFrequency": "每周三更新"
        },
        {
            "id": "42F6F0FD8713A601AAF5DAB9E02186A4",
            "name": "儿歌榜",
            "coverImgUrl": "http://p1.music.126.net/7JO1qHf6ElciLA4Ec3Q0Xg==/109951166952717448.jpg",
            "describe": "云音乐小朋友最喜欢的儿歌。",
            "creatorNickName": "网易云音乐",
            "playCount": 9352399,
            "subscribedCount": 30972,
            "tags": [
                "儿童"
            ],
            "createTime": 1535017895991,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MORE",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "9D402D5EE5F8407C2AA971CC3561D86D",
            "name": "飙升榜",
            "coverImgUrl": "http://p1.music.126.net/pcYHpMkdC69VVvWiynNklA==/109951166952713766.jpg",
            "describe": "云音乐中每天热度上升最快的100首单曲，每日更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 5700514816,
            "subscribedCount": 4074435,
            "tags": [],
            "createTime": 1404115136883,
            "subed": true,
            "trackCount": 0,
            "specialType": 0,
            "category": "OFFICIAL",
            "updateFrequency": "每天更新"
        },
        {
            "id": "0B23220402BE07D8043B5AA78385C31D",
            "name": "新歌榜",
            "coverImgUrl": "http://p1.music.126.net/wVmyNS6b_0Nn-y6AX8UbpQ==/109951166952686384.jpg",
            "describe": "云音乐新歌榜：云音乐用户一周内收听所有新歌（一月内最新发行） 官方TOP排行榜，每天更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 2885098496,
            "subscribedCount": 2758949,
            "tags": [],
            "createTime": 1378721398225,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "OFFICIAL",
            "updateFrequency": "每天更新"
        },
        {
            "id": "C24FB22C6C984315151184E65BE6B207",
            "name": "原创榜",
            "coverImgUrl": "http://p1.music.126.net/iFZ_nw2V86IFk90dc50kdQ==/109951166961388699.jpg",
            "describe": "云音乐独立原创音乐人作品官方榜单，以推荐优秀原创作品为目的。每周四网易云音乐首发。申请网易音乐人：http://music.163.com/nmusician/",
            "creatorNickName": "原创君",
            "playCount": 573678976,
            "subscribedCount": 714010,
            "tags": [],
            "createTime": 1374732325894,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "OFFICIAL",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "FCB7FBF00D01DBB5AEE872AE43CB71F9",
            "name": "热歌榜",
            "coverImgUrl": "http://p1.music.126.net/ZyUjc7K_GDpD8MO1-GQkmA==/109951166952706664.jpg",
            "describe": "云音乐热歌榜：云音乐用户一周内收听所有线上歌曲官方TOP排行榜，每日更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 11791594496,
            "subscribedCount": 11947037,
            "tags": [],
            "createTime": 1378721406014,
            "subed": true,
            "trackCount": 0,
            "specialType": 0,
            "category": "OFFICIAL",
            "updateFrequency": "每天更新"
        },
        {
            "id": "6965F3CB37BEDCAF246248CA4D09B6C8",
            "name": "云音乐说唱榜",
            "coverImgUrl": "http://p1.music.126.net/xNnQzUODQs50SJ2Sm4IVVA==/109951167976981051.jpg",
            "describe": "云音乐原创说唱音乐人作品官方榜单，每周五更新。以云音乐用户一周播放热度为主，收录3个月内发行的原创说唱作品，按照综合数据排名取前50名。申请网易音乐人：http://music.163.com/nmusician",
            "creatorNickName": "网易云音乐",
            "playCount": 433919328,
            "subscribedCount": 761201,
            "tags": [
                "华语",
                "说唱"
            ],
            "createTime": 1510290389440,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "TOPPING",
            "updateFrequency": "每周五更新"
        },
        {
            "id": "0DEA3E0F086A59876584F8EF2CBF52FD",
            "name": "云音乐古典榜",
            "coverImgUrl": "http://p1.music.126.net/urByD_AmfBDBrs7fA9-O8A==/109951167976973225.jpg",
            "describe": "云音乐用户一周内收听所有古典音乐官方TOP排行榜，每周四更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 68899008,
            "subscribedCount": 433673,
            "tags": [
                "古典"
            ],
            "createTime": 1430968920537,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MUSIC_STYLE",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "F0BA57528ADB0B9E4255B22401D142FD",
            "name": "黑胶VIP爱听榜",
            "coverImgUrl": "http://p1.music.126.net/a_ekv5grIMqtuJefHVxfxA==/109951168772698738.jpg",
            "describe": "云音乐站内会员播放热度TOP100的歌曲，每周四更新。\n黑胶们都爱听什么歌曲？\n热门好歌一站式收听，让你念念不忘~\n做尊贵黑胶，畅听品味好歌~",
            "creatorNickName": "云音乐VIP",
            "playCount": 205655216,
            "subscribedCount": 1057373,
            "tags": [
                "榜单"
            ],
            "createTime": 1610087424470,
            "subed": true,
            "trackCount": 0,
            "specialType": 0,
            "category": "FEATURE",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "B705D87C91B77AB03D9AD3D7B2618EE8",
            "name": "云音乐ACG榜",
            "coverImgUrl": "http://p1.music.126.net/na1kEeCS1iZEkzOrs9r_9g==/109951167976973667.jpg",
            "describe": "云音乐用户一周内收听所有ACG音乐官方TOP排行榜，每周四更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 80334672,
            "subscribedCount": 241045,
            "tags": [],
            "createTime": 1430968935040,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MUSIC_STYLE",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "1D8AEF857EB92CD3BF81398CD11AA01A",
            "name": "云音乐韩语榜",
            "coverImgUrl": "http://p1.music.126.net/5oN9YaFznwNGXkmi8i2Ytw==/109951167430864741.jpg",
            "describe": "云音乐用户一周内收听所有韩语歌曲官方TOP排行榜，每周四更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 108373344,
            "subscribedCount": 239382,
            "tags": [
                "韩语",
                "榜单"
            ],
            "createTime": 1496201691281,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "LANGUAGE",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "38C4BAA27DE0E8D726D6AC7CA4564B03",
            "name": "云音乐国电榜",
            "coverImgUrl": "http://p1.music.126.net/6la5fQwcd3YW6ZQHvTiZqw==/109951165611482698.jpg",
            "describe": "【本榜排名按作品发行时间顺序】网易云音乐联合网易放刺、Loopy、加菲众、DJ WENGWENG（灯笼Club）、3ASiC（同步计划）、DJ Senders（沉睡电台）、East Records（华音尚韵）、电悦台（EDM Station） \n打造云音乐“国电榜” ! 每周五为大家带来网易电子音乐人优质新作！",
            "creatorNickName": "电音赫兹",
            "playCount": 92004520,
            "subscribedCount": 232149,
            "tags": [
                "电子",
                "榜单"
            ],
            "createTime": 1395988377813,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MUSIC_STYLE",
            "updateFrequency": "每周五更新"
        },
        {
            "id": "4D609348CC4D31FD9FE6FC99BBA898A9",
            "name": "云音乐欧美热歌榜",
            "coverImgUrl": "http://p1.music.126.net/70_EO_Dc7NT_hhfvsapzcQ==/109951167430862162.jpg",
            "describe": "云音乐用户一周内收听所有欧美歌曲官方TOP排行榜，每周四更新。\nWestern Hit Chart (updated every Thursday)",
            "creatorNickName": "网易云音乐",
            "playCount": 195404128,
            "subscribedCount": 746367,
            "tags": [],
            "createTime": 1558493373769,
            "subed": true,
            "trackCount": 0,
            "specialType": 0,
            "category": "LANGUAGE",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "7BE4F0639F514D726C7ADFBFCB03A19E",
            "name": "云音乐欧美新歌榜",
            "coverImgUrl": "http://p1.music.126.net/0lPWpI9Ejn1OiW2LSbg-qw==/109951167430863224.jpg",
            "describe": "云音乐用户一周内收听所有欧美新歌（一月内最新发行）官方TOP排行榜，每天更新。\nWestern New Release Chart (new songs released in last 30 days, updated daily)\n",
            "creatorNickName": "网易云音乐",
            "playCount": 93545792,
            "subscribedCount": 192233,
            "tags": [],
            "createTime": 1558493214795,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "LANGUAGE",
            "updateFrequency": "每天更新"
        },
        {
            "id": "E220892B8FCC645C279782E67C07F6C4",
            "name": "云音乐日语榜",
            "coverImgUrl": "http://p1.music.126.net/YFBFNI2F-4BveUpv6FKFuw==/109951167430864069.jpg",
            "describe": "云音乐用户一周内收听所有日语歌曲官方TOP排行榜，每周二更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 31710122,
            "subscribedCount": 103415,
            "tags": [],
            "createTime": 1591863000459,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "LANGUAGE",
            "updateFrequency": "刚刚更新"
        },
        {
            "id": "F178474018F7EA5B6CA633BD78EBEB72",
            "name": "云音乐摇滚榜",
            "coverImgUrl": "http://p1.music.126.net/UsoWOvtgwBgrofCCfS61Fw==/109951167976981586.jpg",
            "describe": "云音乐用户一周内收听所有摇滚歌曲官方TOP排行榜，每周五更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 34372228,
            "subscribedCount": 75395,
            "tags": [],
            "createTime": 1591863213389,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MUSIC_STYLE",
            "updateFrequency": "每周五更新"
        },
        {
            "id": "53FFB185E7AEC7832DE3B02F171E7EF0",
            "name": "云音乐国风榜",
            "coverImgUrl": "http://p1.music.126.net/kTJC5OBhg8I477X_ZmXyDQ==/109951168539740982.jpg",
            "describe": "云音乐用户一周内收听所有国风歌曲官方TOP排行榜，每周五更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 131836256,
            "subscribedCount": 431853,
            "tags": [],
            "createTime": 1591863258438,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MUSIC_STYLE",
            "updateFrequency": "每周五更新"
        },
        {
            "id": "7D8316F742BAEAF51E1066951334AD1C",
            "name": "云音乐民谣榜",
            "coverImgUrl": "http://p1.music.126.net/tC07mYGr0t2xz07xoHQhrQ==/109951167976973429.jpg",
            "describe": "云音乐用户一周内收听所有民谣歌曲官方TOP排行榜，每周五更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 193439536,
            "subscribedCount": 549019,
            "tags": [],
            "createTime": 1591863052757,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MUSIC_STYLE",
            "updateFrequency": "每周五更新"
        },
        {
            "id": "93CC64B09EC7F516A6CD2BEDC497F81C",
            "name": "网络热歌榜",
            "coverImgUrl": "http://p1.music.126.net/iwhTcAbujlsvhSNWYkBC8Q==/109951167430851785.jpg",
            "describe": "网罗一周热门网络歌曲，反映云音乐用户近一周网络热歌收听趋势。每周五更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 169362432,
            "subscribedCount": 313721,
            "tags": [],
            "createTime": 1619059306654,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "FEATURE",
            "updateFrequency": "每周五更新"
        },
        {
            "id": "5472D47E3C0B16BB52CF314F9201960F",
            "name": "俄语榜",
            "coverImgUrl": "http://p1.music.126.net/HbJ0BK5doY4I4pEMY6-FQw==/109951167430852698.jpg",
            "describe": "网易云音乐用户一周内收听所有俄罗斯语歌曲官方TOP排行榜，每周四更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 6375389,
            "subscribedCount": 20574,
            "tags": [],
            "createTime": 1619582712108,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "LANGUAGE",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "D3A0E39C7497BE7B9165D8E7E6D4E7DD",
            "name": "越南语榜",
            "coverImgUrl": "http://p1.music.126.net/N-Y5maLGWgrowt3TE6RtSg==/109951167430857045.jpg",
            "describe": "网易云音乐用户一周内收听所有越南语歌曲官方TOP排行榜，每周四更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 7772526,
            "subscribedCount": 16082,
            "tags": [],
            "createTime": 1619582749349,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "LANGUAGE",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "9AB9663039411219E777285D36E83A7C",
            "name": "中文DJ榜",
            "coverImgUrl": "http://p1.music.126.net/w_01BfDU012ojxnzLO6tYw==/109951167977358686.jpg",
            "describe": null,
            "creatorNickName": "云音乐DJ专区",
            "playCount": 60775448,
            "subscribedCount": 192901,
            "tags": [],
            "createTime": 1627466999260,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MUSIC_STYLE",
            "updateFrequency": "每天更新"
        },
        {
            "id": "2E66E239C9B7ED164FD5D4FD81D61166",
            "name": "泰语榜",
            "coverImgUrl": "http://p1.music.126.net/4W0WBHBgwYlYfRniuyL47A==/109951167430843284.jpg",
            "describe": "网易云音乐用户一周内收听所有泰语歌曲官方TOP排行榜，每周四更新。",
            "creatorNickName": "网易云音乐",
            "playCount": 4641026,
            "subscribedCount": 10653,
            "tags": [
                "小语种"
            ],
            "createTime": 1638166937809,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "LANGUAGE",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "863300522AA99D2A9437B2D2D1389C1C",
            "name": "BEAT排行榜",
            "coverImgUrl": "http://p1.music.126.net/yhzlQJCJ9NcT4MvJBG_HgQ==/109951167977014958.jpg",
            "describe": "嘿~朋友，欢迎来到本周的Beat排行榜\n我们挑选了近一周内热门的Beat作品，一起来感受下大家近期的“口味”吧！\n每周都会更新哦，记得按下收藏，我每天都会在这里等你来与我交流！~\n\n关于Beat的必备小知识\nQ1.什么是Beat？\nBeat即节拍，特指嘻哈音乐中的伴奏，现在也可指所有流行音乐的伴奏\nQ2.Beat有什么用？\n在Beat的帮助下，你只需要填词演唱即可完成一首歌曲的创作，而且Beat也可以作为各种流媒体的背景音乐或是多场景现场演出的得力助手，不同风格的Beat还能为你的音乐创作提供灵感哦~\n搜索关注“BEATSOUL激灵”网易云官号，探索更多炸裂音乐内容～",
            "creatorNickName": "BEATSOUL激灵",
            "playCount": 4199118,
            "subscribedCount": 19266,
            "tags": [],
            "createTime": 1648553998273,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "FEATURE",
            "updateFrequency": "每周四更新"
        },
        {
            "id": "2A55B945F953750643531E5677EE3BC6",
            "name": "编辑推荐榜VOL.70 十月的藤井风，吹开最喜欢的花 ",
            "coverImgUrl": "http://p1.music.126.net/AbZL9W3ZR5S6baMx6K5FVw==/109951168995927631.jpg",
            "describe": "云村编辑推荐度TOP10单曲，每周周五更新。每期上榜歌曲为云村编辑从30天内发行歌曲中挑选佳作并对作品质量进行打分评选得出。\n1、《花》 藤井風\n2、《阴暗面》K6刘家凯 / 洪佩瑜\n3、《Run Away》旋转保龄\n4、《 Little Ghost》Schoolgirl byebye\n5、《雨伞》 PO8 / 小老虎\n6、《月光浴》 ヨルシカ\n7、《Already Over》Mike Shinoda\n8、《很多人》苏诗丁 \n9、《너 말곤 다 싫다（Without You）》2AM \n10、《4am.》8bite / Crazy Bucket 陈楒潼 \n本期封面： 藤井風",
            "creatorNickName": "云音乐小秘书",
            "playCount": 10372735,
            "subscribedCount": 27493,
            "tags": [
                "榜单"
            ],
            "createTime": 1646796286440,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "TOPPING",
            "updateFrequency": "每周五更新"
        },
        {
            "id": "80D645EB0204F170AD62FB6F3F56E477",
            "name": "LOOK直播歌曲榜",
            "coverImgUrl": "http://p1.music.126.net/u-RQC-LyY0aoeseRumJ14A==/109951167977730469.jpg",
            "describe": "LOOK直播好歌共赏，专属你的声音聊愈场。榜单选取符合条件且近7日热度最高的前50首歌曲，每周二更新。",
            "creatorNickName": "云推歌小助手",
            "playCount": 433732,
            "subscribedCount": 1377,
            "tags": [],
            "createTime": 1661219696017,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MORE",
            "updateFrequency": "每周二更新"
        },
        {
            "id": "2A09424804117D5468B63094F3F246E9",
            "name": "赏音榜",
            "coverImgUrl": "http://p1.music.126.net/m9hQzC-d5wefBipedNPaHg==/109951168178601971.jpg",
            "describe": "云音乐歌曲赏音榜，以让用户鉴赏到更多潜力好歌为目的，以用户对歌曲互动热度为核心，按照综合数据排名取前100名，每日更新",
            "creatorNickName": "音乐挑战小助手",
            "playCount": 3021974,
            "subscribedCount": 7609,
            "tags": [],
            "createTime": 1669617979380,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "FEATURE",
            "updateFrequency": "每天更新"
        },
        {
            "id": "956AFA724BB2D8318D6956F83A1244E9",
            "name": "黑胶VIP新歌榜",
            "coverImgUrl": "http://p1.music.126.net/MoegUKHcUFRON8286NQZNg==/109951168772698178.jpg",
            "describe": "云音乐站内播放热度TOP50的7日内新晋会员歌曲，每日更新。\n更适合黑胶体质的新歌榜单来啦！\n耳机分你一只，新曲一起来听~\n成为尊贵黑胶，不错过每一首VIP新歌！",
            "creatorNickName": "云音乐VIP",
            "playCount": 3912102,
            "subscribedCount": 10758,
            "tags": [
                "流行",
                "浪漫",
                "治愈"
            ],
            "createTime": 1669978276103,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "FEATURE",
            "updateFrequency": "每天更新"
        },
        {
            "id": "D3E48C7498088D726A92B1F4F736CF6D",
            "name": "黑胶VIP热歌榜",
            "coverImgUrl": "http://p1.music.126.net/soIVOd3IWXMsOkarF-h4iw==/109951168772691177.jpg",
            "describe": "云音乐站内播放和付费热度TOP50的会员歌曲，每日更新。\n更适合黑胶体质的热歌榜单来啦！\n哪首是你的单曲循环？\n成为尊贵黑胶，随心畅听热门好歌！",
            "creatorNickName": "云音乐VIP",
            "playCount": 36167976,
            "subscribedCount": 125747,
            "tags": [
                "流行",
                "治愈",
                "放松"
            ],
            "createTime": 1669978291024,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "FEATURE",
            "updateFrequency": "每天更新"
        },
        {
            "id": "462F4D2EBFD41456FC0728453CA50197",
            "name": "黑胶VIP爱搜榜",
            "coverImgUrl": "http://p1.music.126.net/hB_5lBhL195vIh7rBCHKQg==/109951168772689339.jpg",
            "describe": "云音乐站内会员搜索播放热度TOP50的歌曲，每日更新。\n更适合黑胶体质的搜歌榜单来啦！\n热搜好歌一网打尽，只为有品位的你~\n成为尊贵黑胶，你搜我听畅听不停！",
            "creatorNickName": "云音乐VIP",
            "playCount": 3639487,
            "subscribedCount": 7648,
            "tags": [
                "流行",
                "治愈",
                "快乐"
            ],
            "createTime": 1669978303210,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "",
            "updateFrequency": "每天更新"
        },
        {
            "id": "FC9D164B1564DFD9656D9B966A8DB4D9",
            "name": "实时热度榜",
            "coverImgUrl": "http://p1.music.126.net/U7ZbdpWzRdmZVr6Khn_4ag==/109951168673982478.jpg",
            "describe": "每天9-23点为你精选当下歌曲热度最高的歌曲",
            "creatorNickName": "音乐挑战小助手",
            "playCount": 379174,
            "subscribedCount": 1323,
            "tags": [],
            "createTime": 1679279999154,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "",
            "updateFrequency": "每天更新"
        },
        {
            "id": "E5B47F06B5BBB3A9A828C9EB91A0B124",
            "name": "喜力®星电音派对潮音榜",
            "coverImgUrl": "http://p1.music.126.net/HVu2hGYvzN5XBuvFc_4Bgg==/109951168730309120.jpg",
            "describe": "乐无界，越未来！《星电音联盟》歌曲官方榜单，每周一更新，让云村村民们随时随地躁起高燃派对氛围！喜力®星电音构建狂欢永不停歇的新奇电音宇宙，激活潮流基因，释放先锋灵感，跨维开启奇妙电音之旅！",
            "creatorNickName": "网易云音乐",
            "playCount": 7794600,
            "subscribedCount": 945,
            "tags": [
                "榜单"
            ],
            "createTime": 1688698119437,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "FEATURE",
            "updateFrequency": "每周一更新"
        },
        {
            "id": "6ECF1251E16B97B1A55CA36E95870B23",
            "name": "云音乐电音榜",
            "coverImgUrl": "http://p1.music.126.net/lH6L0YhKTofSmnrEAtN9CA==/109951168204710928.jpg",
            "describe": "云音乐用户一周内收听电子音乐官方TOP排行榜，每周五更新。喜力星电音，用先锋电音带你解锁全新维度和体验！",
            "creatorNickName": "网易云音乐",
            "playCount": 374273696,
            "subscribedCount": 1309797,
            "tags": [
                "电子"
            ],
            "createTime": 1510825632233,
            "subed": false,
            "trackCount": 0,
            "specialType": 0,
            "category": "MUSIC_STYLE",
            "updateFrequency": "每周五更新"
        }
    ]
}
```

## 获取banner资源

- docId：`09ce2cf38edd42deabaa8290de8b1ffc`
- 来源：https://developer.music.163.com/st/developer/document?docId=09ce2cf38edd42deabaa8290de8b1ffc

## 获取banner资源


### /openapi/music/banner/get


```text
- 需申请：资源分享能力
- 默认尺寸：1080*420px（这个为主）
- 实际大小可以自定义，网易数帆裁剪：https://sf.163.com/help/documents/66982522786074624
- 需要联系云音乐提前配置
```


### 请求方式：


- GET


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


- 无


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/banner/get?appId=a301020000000000716cded947c64b26&timestamp=1695626700833&device={"deviceType":"andrwear","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"321","brand":"iotapitest","osVer":"8.1.0","clientIp":"127.0.0.1"}&accessToken=tfbc74e8a047500ca654348a4e91366533115440f67cf069e&GBfQzkFJxn6wNl1P5LT9XciVHuVsYrqBI7KLh3Hi1bgRz3maQAQMfyddNJJ8S88hF%2F6LHWkWZauIY6P6cLLst10RnoSGK%2FCxy0MMEA4nP1JsCGv68GzdAkcWcUeRyTe3seu1dLZT2r2x06RcYCe2RHYKJKI3BsFpL%2BuweL5F3tR5FpmFTu%2F7j%2B9brgaFcEb9uI0tZVL9rt6tt8ne01jBq2ckzl4254QIQNg3DaXlH9%2FUPfvS6w5ifrm0lPK%2Bthr0kE1u%2F1cFY3EI9nFPv9QC%2BKNAJxdlM0SPaQNDZEDyOftgA3F5LXZ6J1VzuAUsvTyeadFvdExelGL4%2Fv2%2BVaxsWw%3D%3D
```


### 返回参数说明


**Records参数（列表）**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>image</td>
<td>String</td>
<td>banner图片地址</td>
</tr>
<tr>
<td>resourceId</td>
<td>String</td>
<td>资源id（加密后的）</td>
</tr>
<tr>
<td>resourceType</td>
<td>String</td>
<td>资源类型</td>
</tr>
<tr>
<td>targetUrl</td>
<td>String</td>
<td>跳转地址</td>
</tr>
</tbody>
</table>


**resourceType**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>SONG</td>
<td>String</td>
<td>歌曲</td>
</tr>
<tr>
<td>PLAYLIST</td>
<td>String</td>
<td>歌单</td>
</tr>
<tr>
<td>ALBUM</td>
<td>String</td>
<td>专辑</td>
</tr>
<tr>
<td>ARTIST</td>
<td>String</td>
<td>艺人</td>
</tr>
<tr>
<td>H5</td>
<td>String</td>
<td>H5</td>
</tr>
<tr>
<td>VIP_PURCHASE</td>
<td>String</td>
<td>会员购买</td>
</tr>
<tr>
<td>PODCAST</td>
<td>String</td>
<td>播客</td>
</tr>
</tbody>
</table>


```text
resourceType：可以新增，主要是给一个标识，至于如何跳转由接入方决定
targetUrl：可以配置指定地址（可以是接入方的唤起地址），默认对应资源的web地址，比如歌曲：https://music.163.com/#/song?id=441491828
```


### 返回示例


```text
{
    "code": 200,
    "subCode": null,
    "message": null,
    "data": {
        "banners": [
            {
                "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/32595109344/e339/89d6/8233/e8d460d7debc5a6ca2874dc1100d5b58.png",
                "resourceId": "vip",
                "resourceType": "VIP_PURCHASE",
                "targetUrl": "nmcloudmusictv://ng/homepage/tvmain?tabCode=TAB_DOLBY"
            },
            {
                "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/32595109344/e339/89d6/8233/e8d460d7debc5a6ca2874dc1100d5b58.png",
                "resourceId": "005AB85D5BF903057B279E49F53F8A38",
                "resourceType": "PLAYLIST",
                "targetUrl": "https://music.163.com/#/playlist?id=988690134"
            },
            {
                "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/32595109344/e339/89d6/8233/e8d460d7debc5a6ca2874dc1100d5b58.png",
                "resourceId": "A1279054E29957E13B740882355B4C0F",
                "resourceType": "H5",
                "targetUrl": "https://music.163.com/#"
            },
            {
                "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/32598400922/9d95/ec4a/3654/a6f26c4d81dedf7abd6d4c079f7ed8fb.png",
                "resourceId": "80055D0742DBCB64535C2BAFDB11B254",
                "resourceType": "SONG",
                "targetUrl": "https://music.163.com/#/song?id=441491828"
            },
            {
                "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/32598558805/e219/f114/8af3/49ac168393a48ec8ba191acf63bb6d8b.jpg",
                "resourceId": "4A7D5CC698B63C263EEEA91F628C043F",
                "resourceType": "ARTIST",
                "targetUrl": "https://music.163.com/#/artist?id=2843"
            },
            {
                "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/32598408142/1f62/e44d/31b9/f7598c1bb7020fde1e215b7ca639a78f.png",
                "resourceId": "C7E692925E7A258B37EA68B1FE4B1D82",
                "resourceType": "PODCAST",
                "targetUrl": "https://music.163.com/#/radio?app_version=8.8.20&id=792731410&dlt=0846"
            },
            {
                "image": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/32598400922/9d95/ec4a/3654/a6f26c4d81dedf7abd6d4c079f7ed8fb.png",
                "resourceId": "F6B3A460CFB83DBB651C143E7E6FB3D8",
                "resourceType": "ALBUM",
                "targetUrl": "https://music.163.com/#/album?id=36836270"
            }
        ]
    }
}
```

## 最近常听

- docId：`1840785a832d4a9e9bd46620927a215f`
- 来源：https://developer.music.163.com/st/developer/document?docId=1840785a832d4a9e9bd46620927a215f

## 最近常听


### /openapi/music/common/recently/heard/get


- 需要用户实名登录


### 功能介绍


```text
- 可配置歌单、榜单、播单、有声书、每日推荐、私人漫游等
- 时间范围是最近3个月
- 移动端->车端：可直接调该接口，注意：移动端需收听有效资源类型>3
- 车端->移动端：如果需要上报车端常听数据，需要云音乐配置，并在数据回传接口：增加sourceId和sourceType
```


![图片](https://p5.music.126.net/ufD5OwZq5VOLLNpmXDA8kQ==/109951173114337506)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


无


### 请求示例：


```text
https://openapi.music.163.com//openapi/music/common/recently/heard/get?appId=a301020000000000746f96a196e52e7&device=%7B%22deviceType%22%3A%22openapi%22%2C%22os%22%3A%22openapi%22%2C%22appVer%22%3A%220.1%22%2C%22channel%22%3A%22iotaptest%22%2C%22model%22%3A%22kys%22%2C%22deviceId%22%3A%22357%22%2C%22brand%22%3A%22iotapitest%22%2C%22osVer%22%3A%228.1.0%22%2C%22clientIp%22%3A%22192.168.0.1%22%7D&accessToken=w89acacb4c3635b1334639c9d9d92b1822beab4d995fe5y&timestamp=1713252305747
```


### 返回参数说明


**Records参数（列表）**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>resourceId</td>
<td>String</td>
<td>资源Id（歌曲id、歌单id等）</td>
</tr>
<tr>
<td>resourceType</td>
<td>String</td>
<td>资源类型</td>
</tr>
<tr>
<td>title</td>
<td>String</td>
<td>标题</td>
</tr>
<tr>
<td>tag</td>
<td>String</td>
<td>封面角标</td>
</tr>
<tr>
<td>coverUrlList</td>
<td>String</td>
<td>封面</td>
</tr>
</tbody>
</table>


**resourceType**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>userfm</td>
<td>String</td>
<td>私人漫游</td>
</tr>
<tr>
<td>toplist</td>
<td>String</td>
<td>榜单</td>
</tr>
<tr>
<td>list</td>
<td>String</td>
<td>歌单</td>
</tr>
<tr>
<td>dailySongs</td>
<td>String</td>
<td>每日推荐</td>
</tr>
<tr>
<td>virtualPlaylist</td>
<td>String</td>
<td>私人推荐</td>
</tr>
<tr>
<td>voice</td>
<td>String</td>
<td>有声书（暂不支持）</td>
</tr>
<tr>
<td>voicelist</td>
<td>String</td>
<td>播客（暂不支持）</td>
</tr>
</tbody>
</table>


resource请求示例：


<table>
<thead>
<tr>
<th>类型</th>
<th>入参</th>
<th>对应接口</th>
</tr>
</thead>
<tbody>
<tr>
<td>userfm</td>
<td>resourceId</td>
<td>私人漫游 <a href="?docId=1c29124f5b6f4f879d173be0b175dded">/openapi/music/basic/private/fm/roaming/song/list</a></td>
</tr>
<tr>
<td>toplist</td>
<td>resourceId</td>
<td>榜单  <a href="?docId=25277f8b1b6f43deac8a5ccc5340757d">/openapi/music/basic/playlist/song/list/get/v3</a></td>
</tr>
<tr>
<td>list</td>
<td>resourceId</td>
<td>歌单  <a href="?docId=25277f8b1b6f43deac8a5ccc5340757d">/openapi/music/basic/playlist/song/list/get/v3</a></td>
</tr>
<tr>
<td>dailySongs</td>
<td>/</td>
<td>每日推荐 <a href="?docId=68d4ad2a5f92475f98a3cf920ea96922">/openapi/music/basic/recommend/songlist/get/v2</a></td>
</tr>
<tr>
<td>virtualPlaylist</td>
<td>/</td>
<td>私人定制 <a href="?docId=5c732bef18aa439aaf1f32f1133daa5d">/openapi/music/basic/recommend/style/songlist/get</a></td>
</tr>
</tbody>
</table>


- 私人漫游这个类型如果展示了resourceId里的信息，就需要播放这个首歌（查歌曲播放地址），再调私人漫游


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "resources": [
      {
        "resourceId": "75E18549F2A2893517BA9BBC044438C1",
        "resourceCode": null,
        "resourceType": "userfm",
        "subResourceId": "FB34DA63D321328BA9045569B5D64CDB",
        "title": "私人漫游",
        "tag": "漫游",
        "coverUrlList": [
          "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/29198956549/937d/b4f7/30c1/98de2bbd511d20e3dc29d9b5cff996ba.png"
        ]
      },
      {
        "resourceId": "4285D3D1D3CBAA90C9FD44BD97AD75E9",
        "resourceCode": null,
        "resourceType": "toplist",
        "subResourceId": "54ED3A56660B37BD1FDB63F796319E49",
        "title": "Suno AI新歌榜",
        "tag": "榜单",
        "coverUrlList": [
          "http://p1.music.126.net/Gd5K36yAelrBvyU1um2aaw==/109951169453051935.jpg"
        ]
      },
      {
        "resourceId": "48250FFB598135B80285AB179983931F",
        "resourceCode": null,
        "resourceType": "list",
        "subResourceId": "4BE68C15404480FF1DDB77B8597C4EB4",
        "title": "Suno AI热门",
        "tag": "歌单",
        "coverUrlList": [
          "http://p1.music.126.net/3Faefiw3Tp7BiA-AbWbrgg==/109951169443423342.jpg"
        ]
      },
      {
        "resourceId": null,
        "resourceCode": "7600533331000000_ae2ca2",
        "resourceType": "virtualPlaylist",
        "subResourceId": "38549441C60AB3119A7DB930A5FA4833",
        "title": "听过的赵雷 为你推荐",
        "tag": "私人推荐",
        "coverUrlList": [
          "http://p1.music.126.net/pksSYxP3e_HkbX7zwPvxjg==/7841716930323893.jpg"
        ]
      },
      {
        "resourceId": "3C80FFB1BB4D095FE15D8934D04B9CEB",
        "resourceCode": null,
        "resourceType": "list",
        "subResourceId": "5DA44AA31BC0EFECEF00E51277E36966",
        "title": "红心歌单",
        "tag": "歌单",
        "coverUrlList": [
          "http://p1.music.126.net/Tf-kWNRttUqkitvh9zvsZg==/933485372034351.jpg"
        ]
      }
    ]
  }
}
```

# 日推MIX

## 日推mix

- docId：`83c94b535264425b9b0788c18f6b7043`
- 来源：https://developer.music.163.com/st/developer/document?docId=83c94b535264425b9b0788c18f6b7043

## 日推mix


### /openapi/music/basic/recommend/daily/mix


```text
根据用户听歌喜好，推荐主体场景，默认前两个是日推和私人漫游，兜底6个卡片
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


暂无


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/recommend/daily/mix?accessToken=w6c762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&appId=a301020000000000746f96a196e52e07&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&timestamp=1739331344525&sign=aPGjxBjp43tern4RcExHChGjgXjaqm6D43%2BhxQZ6gYZyyeC890NP97RKJOVUMYtuzQkrgzQtt27Q%2Fk1ppzP76GX%2BtHRm69DJXERMNOjAkvuvRszu7mTNHnzqnS0ljxmrGfBx4vOh4WuL4v3Xy1dDoDbM9QTHwaza1aNOwBJefuUbSE8paRkLCFy5k1py0l75dObkexWnbmBhvT6b817rKDP7ic2lK9D85tTVb6xsuZB2YnFFU3V84bPk9xWH7ToEf19c%2FirBd%2BR3knfOwGQkAsqPeeVOAnQXTxCtwGk2VN736VntrrWOFfKqjhMLSqkpA%2BXRpeyv%2Bvp%2FM%2B0fvM5S1w%3D%3D
```


### 返回参数说明


**blocks（列表）**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>title</td>
<td>String</td>
<td>标题</td>
</tr>
<tr>
<td>subTitle</td>
<td>String</td>
<td>主题模块名</td>
</tr>
<tr>
<td>simplifiedTitle</td>
<td>String</td>
<td>简要描述</td>
</tr>
<tr>
<td>imageInfo</td>
<td>ImageVO</td>
<td>封面信息</td>
</tr>
<tr>
<td>resourceId</td>
<td>String</td>
<td>资源id</td>
</tr>
<tr>
<td>resourceType</td>
<td>String</td>
<td>资源类型，见下方枚举</td>
</tr>
<tr>
<td>extData</td>
<td>List</td>
<td>额外信息</td>
</tr>
</tbody>
</table>


**ImageVO**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>url</td>
<td>String</td>
<td>图片地址</td>
</tr>
<tr>
<td>onImageIconUrl</td>
<td>String</td>
<td>附加在图上的图标</td>
</tr>
</tbody>
</table>


**resourceType**


<table>
<thead>
<tr>
<th>资源类型</th>
<th>模块</th>
<th>对应接口</th>
</tr>
</thead>
<tbody>
<tr>
<td>daily_song_rec</td>
<td>每日推荐</td>
<td><a href="?docId=68d4ad2a5f92475f98a3cf920ea96922">/openapi/music/basic/recommend/songlist/get/v2</a></td>
</tr>
<tr>
<td>fm</td>
<td>私人漫游</td>
<td><a href="?docId=1c29124f5b6f4f879d173be0b175dded">/openapi/music/basic/private/fm/roaming/song/list</a></td>
</tr>
<tr>
<td>radar</td>
<td>私人雷达</td>
<td><a href="?docId=25277f8b1b6f43deac8a5ccc5340757d">/openapi/music/basic/playlist/song/list/get/v3</a></td>
</tr>
<tr>
<td>another_radar</td>
<td>其他雷达</td>
<td><a href="?docId=25277f8b1b6f43deac8a5ccc5340757d">/openapi/music/basic/playlist/song/list/get/v3</a></td>
</tr>
<tr>
<td>song_fm</td>
<td>相似歌曲</td>
<td><a href="?docId=707058df01fe40288a82ea3581e9e935">/openapi/music/basic/private/fm/roaming/song/list</a></td>
</tr>
<tr>
<td>artist_fm</td>
<td>相似艺人</td>
<td><a href="?docId=0f4b11d5ec5e43379086226154efe4db">/openapi/music/basic/private/fm/roaming/song/list</a></td>
</tr>
<tr>
<td>tag_daily_rec</td>
<td>风格日推</td>
<td><a href="?docId=27083bea44d340c2901662063db34505">/openapi/music/basic/song/daily/style/get</a></td>
</tr>
<tr>
<td>hot_song_board</td>
<td>热歌榜</td>
<td><a href="?docId=25277f8b1b6f43deac8a5ccc5340757d">/openapi/music/basic/playlist/song/list/get/v3</a></td>
</tr>
<tr>
<td>soar_board</td>
<td>飙升榜</td>
<td><a href="?docId=25277f8b1b6f43deac8a5ccc5340757d">/openapi/music/basic/playlist/song/list/get/v3</a></td>
</tr>
<tr>
<td>new_song_board</td>
<td>新歌榜</td>
<td><a href="?docId=25277f8b1b6f43deac8a5ccc5340757d">/openapi/music/basic/playlist/song/list/get/v3</a></td>
</tr>
<tr>
<td>user_like</td>
<td>心动模式</td>
<td><a href="?docId=fba3f9b1fdec4c31aee5d6da383d794c">/openapi/music/basic/song/play/intelligence/get</a></td>
</tr>
<tr>
<td>mood</td>
<td>心情氛围</td>
<td><a href="?docId=25277f8b1b6f43deac8a5ccc5340757d">/openapi/music/basic/playlist/song/list/get/v3</a></td>
</tr>
<tr>
<td>once_hear</td>
<td>曾经爱听</td>
<td><a href="?docId=25277f8b1b6f43deac8a5ccc5340757d">/openapi/music/basic/playlist/song/list/get/v3</a></td>
</tr>
</tbody>
</table>


**extData**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>playlist</td>
<td>String</td>
<td>红心歌单</td>
</tr>
<tr>
<td>songId</td>
<td>String</td>
<td>心动歌曲</td>
</tr>
<tr>
<td>tagId</td>
<td>String</td>
<td>标签id</td>
</tr>
<tr>
<td>categoryId</td>
<td>String</td>
<td>分类id</td>
</tr>
</tbody>
</table>


### type请求示例


每日推荐


```text
{"limit":"30","qualityFlag":"true"}
```


私人漫游


```text
{"limit":"3","type":"mode","code":"DEFAULT","sourceType":"","sourceIds":"[]"}
```


私人雷达、其他雷达


```text
{"playlistId":"xxxx"}
```


相似歌曲


```text
{"limit":"3","type":"mode","code":"SIMILAR","sourceType":"song","sourceIds":"["xxx","xxx","xxx"]"}
```


相似艺人


```text
{"limit":"3","type":"mode","code":"SIMILAR","sourceType":"artist","sourceIds":"["xxx","xxx","xxx"]"}
```


风格日推


```text
{"categoryId":"xxx","tagId":"xxx","songId":"xxx","limit":"xx","qualityFlag":"xxx"}
```


热歌榜、飙升榜、新歌榜


```text
{"playlistId":"xxxx"}
```


心动模式


- 心动模式的前提条件（包含匿名用户）：


1：有红心歌单
2：红心歌单有红心歌曲


```text
{"playlistId":"xxx","songId":"xxx","type":"fromPlayOne"}
```


心情氛围


```text
{"playlistId":"xxxx"}
```


曾经爱听


```text
{"playlistId":"xxxx"}
```


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "title": null,
    "blocks": [
      {
        "title": "每日推荐 | 从「山海入梦来」听起",
        "subTitle": "每日推荐",
        "simplifiedTitle": "符合你口味的新鲜好歌",
        "block": null,
        "imageInfo": {
          "url": "http://p1.music.126.net/J6P3-gaX9dc74tHy7ZmGgg==/109951166292632577.jpg",
          "onImageIconUrl": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/30907224788/a970/3a60/eca4/72cd11360633d346f26b7dc440333f1a.png?imageView=1&type=webp%7CimageView&thumbnail=180y180",
          "onImageText": null
        },
        "resourceId": "073610A123C7741107A025EC36C91317",
        "resourceType": "daily_song_rec",
        "extData": null
      },
      {
        "title": "你的红心歌曲和更多相似推荐",
        "subTitle": "心动模式",
        "simplifiedTitle": "红心歌曲和相似推荐",
        "block": null,
        "imageInfo": {
          "url": "http://p1.music.126.net/FgpAVmwT8GwMSIbWff8dXA==/109951166353341462.jpg",
          "onImageIconUrl": null,
          "onImageText": null
        },
        "resourceId": null,
        "resourceType": "user_like",
        "extData": {
          "playlist": "339F76C34F3A6657778D474B982FB472",
          "songId": "02DFFB0AC2C276F21243E1BF352E6BA1"
        }
      },
      {
        "title": "如果",
        "subTitle": "私人漫游",
        "simplifiedTitle": "多种听歌模式随心播放",
        "block": null,
        "imageInfo": {
          "url": "http://p1.music.126.net/D1af5MguZzSSGqBqdDfV0A==/109951165798772044.jpg",
          "onImageIconUrl": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/30908042328/47e0/ac4b/1a84/f708442d389647aa320608fa60d4eadd.png?imageView=1&type=webp%7CimageView&thumbnail=180y180",
          "onImageText": null
        },
        "resourceId": "4AEBAF0BFE91CC58CB9250758F6ACA14",
        "resourceType": "fm",
        "extData": null
      },
      {
        "title": "今天从《这世界那么多人》听起",
        "subTitle": "私人雷达",
        "simplifiedTitle": "你爱的歌值得反复聆听",
        "block": null,
        "imageInfo": {
          "url": "http://p1.music.126.net/LOTxqRjFm03VJEOHJbUqMw==/109951165944804127.jpg",
          "onImageIconUrl": null,
          "onImageText": null
        },
        "resourceId": "387D2C823B5855A7CDBC9267591A2A81",
        "resourceType": "radar",
        "extData": null
      },
      {
        "title": "出现又离开 (Live)、曾经是情侣 (Live)、男孩 (Live)",
        "subTitle": "相似歌曲",
        "simplifiedTitle": "从你喜欢的歌听起",
        "block": null,
        "imageInfo": {
          "url": "http://p1.music.126.net/mAV2OH6nPJd4XLwn80kwpA==/109951164054054313.jpg",
          "onImageIconUrl": null,
          "onImageText": null
        },
        "resourceId": "[\"B4584FB72DCD09E5B6EDF227CE68F26A\",\"FED107E0100BC9D33031AEC0DE57ED42\",\"278D189F3227303A267CAAF22DD20C5C\"]",
        "resourceType": "song_fm",
        "extData": null
      },
      {
        "title": "宋冬野、赵雷、马頔",
        "subTitle": "相似艺人",
        "simplifiedTitle": "从你喜欢的艺人听起",
        "block": null,
        "imageInfo": {
          "url": "http://p1.music.126.net/E0naLXtRIBuB_f6RvlBscg==/109951162811539164.jpg",
          "onImageIconUrl": null,
          "onImageText": null
        },
        "resourceId": "[\"7A02894166BF22C7BD2AA95AE1ABF6C4\",\"7F85B50A1A2EA33990BC7633FCD32A15\",\"E857DB429ED5D14C5F9E2B1EC4CE2AF2\"]",
        "resourceType": "artist_fm",
        "extData": null
      },
      {
        "title": "蜜湖、一路向北、第一万零一次告白",
        "subTitle": "摇滚日推",
        "simplifiedTitle": "你喜欢的摇滚歌曲",
        "block": null,
        "imageInfo": {
          "url": "http://p1.music.126.net/Tet2yVBY1VlhGif3xEpStQ==/109951164867152185.jpg",
          "onImageIconUrl": null,
          "onImageText": null
        },
        "resourceId": "824010B9756A2CCA9D30B198A64AF9D8",
        "resourceType": "tag_daily_rec",
        "extData": {
          "tagId": 10021,
          "categoryId": 1000
        }
      },
      {
        "title": "独自听歌 | 漫步城市的民谣旋律",
        "subTitle": "独自听歌",
        "simplifiedTitle": "懂你情绪的歌单",
        "block": null,
        "imageInfo": {
          "url": "http://p1.music.126.net/xh8PiWA5HuYazbdqEddKMA==/109951168650981742.jpg",
          "onImageIconUrl": null,
          "onImageText": null
        },
        "resourceId": "32CCBF3A0944A41BEFAB7D82D830EECE",
        "resourceType": "mood",
        "extData": null
      },
      {
        "title": "你曾经听过的好歌",
        "subTitle": "曾经爱听",
        "simplifiedTitle": "你曾经听过的好歌",
        "block": null,
        "imageInfo": {
          "url": "http://p1.music.126.net/A6VByArTeykL0EkmBzGv_A==/109951166183733920.jpg",
          "onImageIconUrl": null,
          "onImageText": null
        },
        "resourceId": "F7F121EC4965B917444F61FDE3EE6C71",
        "resourceType": "once_hear",
        "extData": null
      }
    ]
  }
}
```

## 获取相似歌曲-歌曲列表（日推mix）

- docId：`4f7214fbb2534c69aad759095283d108`
- 来源：https://developer.music.163.com/st/developer/document?docId=4f7214fbb2534c69aad759095283d108

## 获取相似歌曲-歌曲列表（日推mix）


### /openapi/music/basic/private/fm/roaming/song/list


```text
同一个账号当日首次请求，返回的是当前歌曲列表，再次请求会变化
```


### 请求方式：


- POST/GET


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>必填</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>type</td>
<td>String</td>
<td>是</td>
<td>mode</td>
</tr>
<tr>
<td>code</td>
<td>String</td>
<td>是</td>
<td>SIMILAR</td>
</tr>
<tr>
<td>sourceType</td>
<td>String</td>
<td>是</td>
<td>song</td>
</tr>
<tr>
<td>sourceIds</td>
<td>String</td>
<td>是</td>
<td>歌曲id，/openapi/music/basic/recommend/daily/mix返回的song_fm中歌曲id</td>
</tr>
<tr>
<td>limit</td>
<td>int</td>
<td>否</td>
<td>获取推荐歌曲数量，需<10 ，默认3</td>
</tr>
<tr>
<td>unplaySongIds</td>
<td>JSON String</td>
<td>否</td>
<td>推荐但未播放的歌曲列表，例如：["445A8B860CC9CEA34A2A6082AACE1595"]</td>
</tr>
</tbody>
</table>


#### 请求示例：


```text
https://openapi.music.163.com/openapi/music/basic/private/fm/roaming/song/list?appId=a3010200000000000506754c4042abd6&timestamp=1742348856160&bizContent={"code":"SIMILAR","limit":"3","type":"mode","sourceType":"song","sourceIds":"[\"E1A252DE2B79012B8B125D4B7B4B6AD6\",\"5358CC23EE5DDC6DF938BEBF7BA20ECC\",\"916DACF9B3167D94A2085B282B3F989B\"]"}&device={"channel":"nio_VR","deviceId":"54a770494f036b40","deviceType":"andrcar","appVer":"1.0.0","os":"andrcar","osVer":"8.1.0","brand":"nio_VR","model":"Taycan","clientIp":"10.0.0.130"}&accessToken=6c762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&sign=eXRnKAq2ABQ59s9mWf%2BXSJ2yqYiNp5W48ivydrqEybc9de%2F4ydpmZNI9BGv1Peoe03Jmy4rnTL2TXJM63%2B4jus8SwoZPD%2FKyx%2BPl87Ep076yYpLkcInsat676jTzALKUIa6p%2FuZJ1hKc6md70KGef9POZe7wzPOH7Fwm%2FfL8OmfyYymMl7RtsQIbS9qHuYTKyfh3Y8awPmi2MTP8xarWtnqlnScJaWY0g5E5kWrorXkPCSp9Pgt3Fre%2FOnHK4yjjtloSqKnLspJTKv7ZQWwGSVoP251NxgHsZCOHCNkMuN%2B927eoId3BxpLio1d7SurVGphou9wej4KEbhM4pvqmdw%3D%3D
```


### 返回参数说明


歌曲模型可查看：[https://developer.music.163.com/st/developer/document?docId=8e96f389dfc74fcb97af35d1597be77e](https://developer.music.163.com/st/developer/document?docId=8e96f389dfc74fcb97af35d1597be77e)


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "id": "46DDDD932BD184F4463538C76F007679",
      "name": "苦茶子",
      "duration": 170796,
      "albumName": "埋汰",
      "albumId": "D31C8AB0B3BF94BCF8037FF9899A1182",
      "albumArtistId": "232C416E7273A8051F2C0F809A44971B",
      "albumArtistName": "Starling8",
      "artistId": "232C416E7273A8051F2C0F809A44971B",
      "artistName": "Starling8",
      "coverImgUrl": "http://p1.music.126.net/VjXYNoGC3lXajZDs0r35XQ==/109951167852652412.jpg",
      "mvId": null,
      "playUrl": null,
      "br": 0,
      "playFlag": true,
      "downloadFlag": false,
      "payPlayFlag": false,
      "payDownloadFlag": true,
      "vipFlag": false,
      "vipPlayFlag": false,
      "freeTrailFlag": false,
      "songFtFlag": false,
      "freeTrail": null,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "playMaxbr": 0,
      "liked": false,
      "songMaxBr": 999000,
      "userMaxBr": 320000,
      "maxBrLevel": "hires",
      "plLevel": "exhigh",
      "dlLevel": "none",
      "gain": 0,
      "peak": 0,
      "level": null,
      "songSize": 0,
      "songMd5": null,
      "songTag": [
        "嘻哈说唱",
        "流行说唱"
      ],
      "emotionTag": null,
      "artists": [
        {
          "id": "232C416E7273A8051F2C0F809A44971B",
          "name": "Starling8"
        },
        {
          "id": "7A1F6F71CD4951D8ACDDDFDFE2E93087",
          "name": "MoreLearn 27"
        },
        {
          "id": "32B73133C384A38EA1D3BC394AD60C9D",
          "name": "FIVESTAR"
        }
      ],
      "fullArtists": [
        {
          "id": "232C416E7273A8051F2C0F809A44971B",
          "name": "Starling8"
        },
        {
          "id": "7A1F6F71CD4951D8ACDDDFDFE2E93087",
          "name": "MoreLearn 27"
        },
        {
          "id": "32B73133C384A38EA1D3BC394AD60C9D",
          "name": "FIVESTAR"
        }
      ],
      "songFee": 8,
      "alg": "alg-music-rec-songFm-i2i",
      "audioFlag": null,
      "effects": null,
      "privateCloudSong": false,
      "qualities": null,
      "language": null,
      "vocalFlag": null,
      "originCoverType": 1,
      "payed": {
        "payed": 0,
        "vipPackagePayed": 0,
        "singlePayed": 0,
        "albumPayed": 0
      },
      "visible": true
    },
    {
      "id": "A4FCF15F4CD75C010EE406F2A0E8C466",
      "name": "和你",
      "duration": 200708,
      "albumName": "幸福三部曲",
      "albumId": "5F852A004D33B432ACCA0748B4C6276A",
      "albumArtistId": "2065856DFE35DE53A22FF0741B0CA36E",
      "albumArtistName": "余佳运",
      "artistId": "2065856DFE35DE53A22FF0741B0CA36E",
      "artistName": "余佳运",
      "coverImgUrl": "http://p1.music.126.net/O6d7GYY3gp2uy8zehvcOjQ==/17699938184267410.jpg",
      "mvId": null,
      "playUrl": null,
      "br": 0,
      "playFlag": true,
      "downloadFlag": false,
      "payPlayFlag": false,
      "payDownloadFlag": true,
      "vipFlag": false,
      "vipPlayFlag": false,
      "freeTrailFlag": false,
      "songFtFlag": false,
      "freeTrail": null,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "playMaxbr": 0,
      "liked": false,
      "songMaxBr": 999000,
      "userMaxBr": 320000,
      "maxBrLevel": "lossless",
      "plLevel": "exhigh",
      "dlLevel": "none",
      "gain": 0,
      "peak": 0,
      "level": null,
      "songSize": 0,
      "songMd5": null,
      "songTag": [
        "流行",
        "华语流行",
        "节奏布鲁斯",
        "当代R&B"
      ],
      "emotionTag": null,
      "artists": [
        {
          "id": "2065856DFE35DE53A22FF0741B0CA36E",
          "name": "余佳运"
        }
      ],
      "fullArtists": [
        {
          "id": "2065856DFE35DE53A22FF0741B0CA36E",
          "name": "余佳运"
        }
      ],
      "songFee": 8,
      "alg": "alg-music-rec-songFm-promoted_cf",
      "audioFlag": null,
      "effects": null,
      "privateCloudSong": false,
      "qualities": null,
      "language": null,
      "vocalFlag": null,
      "originCoverType": 1,
      "payed": {
        "payed": 0,
        "vipPackagePayed": 0,
        "singlePayed": 0,
        "albumPayed": 0
      },
      "visible": true
    },
    {
      "id": "859260259E2D82E74C4A1916A741D9DA",
      "name": "网恋",
      "duration": 192592,
      "albumName": "网恋",
      "albumId": "B94C8D987D71D97AA59F207D6008BBF9",
      "albumArtistId": "E56673C16CF122A0E36A98F81C936C56",
      "albumArtistName": "Six Teen/果妹",
      "artistId": "E56673C16CF122A0E36A98F81C936C56",
      "artistName": "Six Teen",
      "coverImgUrl": "http://p1.music.126.net/cw5COb-ZESk4VDIVc10Kkw==/109951169694983111.jpg",
      "mvId": null,
      "playUrl": null,
      "br": 0,
      "playFlag": true,
      "downloadFlag": false,
      "payPlayFlag": false,
      "payDownloadFlag": true,
      "vipFlag": false,
      "vipPlayFlag": false,
      "freeTrailFlag": false,
      "songFtFlag": false,
      "freeTrail": null,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "playMaxbr": 0,
      "liked": false,
      "songMaxBr": 999000,
      "userMaxBr": 320000,
      "maxBrLevel": "hires",
      "plLevel": "exhigh",
      "dlLevel": "none",
      "gain": 0,
      "peak": 0,
      "level": null,
      "songSize": 0,
      "songMd5": null,
      "songTag": [
        "流行",
        "嘻哈说唱",
        "流行说唱"
      ],
      "emotionTag": null,
      "artists": [
        {
          "id": "E56673C16CF122A0E36A98F81C936C56",
          "name": "Six Teen"
        },
        {
          "id": "3FF06BF8081D4D29153F4FBB28E4816C",
          "name": "果妹"
        }
      ],
      "fullArtists": [
        {
          "id": "E56673C16CF122A0E36A98F81C936C56",
          "name": "Six Teen"
        },
        {
          "id": "3FF06BF8081D4D29153F4FBB28E4816C",
          "name": "果妹"
        }
      ],
      "songFee": 8,
      "alg": "alg-music-rec-songFm-promoted_cf",
      "audioFlag": null,
      "effects": null,
      "privateCloudSong": false,
      "qualities": null,
      "language": null,
      "vocalFlag": null,
      "originCoverType": 1,
      "payed": {
        "payed": 0,
        "vipPackagePayed": 0,
        "singlePayed": 0,
        "albumPayed": 0
      },
      "visible": true
    }
  ]
}
```

## 获取风格日推-歌曲列表（日推mix）

- docId：`b5419158b92d4310b0d4c02c696d7841`
- 来源：https://developer.music.163.com/st/developer/document?docId=b5419158b92d4310b0d4c02c696d7841

## 获取风格日推-歌曲列表（日推mix）


### /openapi/music/basic/song/daily/style/get


```text
返回的第一首歌是日推mix中的resourceId，每天固定30首
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>categoryId</td>
<td>是</td>
<td>Long</td>
<td>分类id ，/openapi/music/basic/recommend/daily/mix返回的tag_daily_rec中categoryId</td>
</tr>
<tr>
<td>tagId</td>
<td>是</td>
<td>String</td>
<td>标签id /openapi/music/basic/recommend/daily/mix返回的tag_daily_rec中tagId</td>
</tr>
<tr>
<td>songId</td>
<td>是</td>
<td>String</td>
<td>歌曲id，/openapi/music/basic/recommend/daily/mix返回的tag_daily_rec中resourceId</td>
</tr>
<tr>
<td>limit</td>
<td>否</td>
<td>Int</td>
<td>请求的数据量，默认30</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/song/daily/style/get?appId=a301020000000000746f96a196e52e07&bizContent={"categoryId":"1000","tagId":"10005","songId":"3089419F3DB03FB560C55A6751DB4495","qualityFlag":true,"limit":2}&timestamp=1741664535068&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&accessToken=62fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&sign=HCVtQ0U2IKvOuvzbeB%2FkQzQSYWZ2jWiVQ9C%2BY4ggd%2FVfmI9CBu2BsxUlVtGv4GQRveyS34xfwGhhvu0GWr9toVCAS8OTicqIpDBUT8O6fsKbvBUl7RlZEEgITsgVfMhlnFaJPJ%2FFyMuHnkw1zjoaIQS%2F6UohqYleUAiA4NVH3HOCtBuQAp6faX%2Ffb7DTFXXl1tenOcoSGMPnYsuqsNMC4fL9MwXSRjZeYoUnI6b97MmFeUY0xm2RoRJQ%2BhGyLz8GA3LLkijd53%2FFtWMp7e%2F7zeWxZi991f9moQtqGDksi22M9S14%2BArn%2FGoTvtG3M25jc06RUCoFTgUC23wbpHqoqg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>albumName</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>albumId</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>albumArtistId</td>
<td>String</td>
<td>专辑艺人Id</td>
</tr>
<tr>
<td>albumArtistName</td>
<td>String</td>
<td>专辑艺人名</td>
</tr>
<tr>
<td>artistId</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>artistName</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面Url</td>
</tr>
<tr>
<td>mvId</td>
<td>String</td>
<td>mvId</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放url</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载歌曲（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持试听</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>试听起止时间，单位：s</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>songSize</td>
<td>int</td>
<td>歌曲的大小</td>
</tr>
<tr>
<td>songMd5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>fullArtists</td>
<td>List<Artist></td>
<td>完整艺人列表（包含已下线艺人）</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>br</td>
<td>int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效信息（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>language</td>
<td>String</td>
<td>语种</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**FreeTrail**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>start</td>
<td>Int</td>
<td>试听开始时间</td>
</tr>
<tr>
<td>end</td>
<td>Int</td>
<td>试听结束时间</td>
</tr>
</tbody>
</table>


**Qualities**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>dolbyMusic</td>
<td>String</td>
<td>杜比</td>
</tr>
<tr>
<td>skMusic</td>
<td>String</td>
<td>沉浸环绕声</td>
</tr>
<tr>
<td>jyMasterMusic</td>
<td>String</td>
<td>超清母带</td>
</tr>
<tr>
<td>jyEffectMusic</td>
<td>String</td>
<td>高清臻音</td>
</tr>
<tr>
<td>hrMusic</td>
<td>String</td>
<td>hi-res</td>
</tr>
<tr>
<td>sqMusic</td>
<td>String</td>
<td>无损</td>
</tr>
<tr>
<td>hmusic</td>
<td>String</td>
<td>极高</td>
</tr>
<tr>
<td>mmusic</td>
<td>String</td>
<td>较高</td>
</tr>
<tr>
<td>lmusic</td>
<td>String</td>
<td>标准</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**maxBrLevel、plLevel、dlLevel、level**


<table>
<thead>
<tr>
<th>值</th>
<th>音质</th>
<th>比特率</th>
</tr>
</thead>
<tbody>
<tr>
<td>dobly</td>
<td>杜比</td>
<td>无</td>
</tr>
<tr>
<td>hires</td>
<td>hires</td>
<td>1999</td>
</tr>
<tr>
<td>lossless</td>
<td>无损</td>
<td>999</td>
</tr>
<tr>
<td>exhigh</td>
<td>极高</td>
<td>320</td>
</tr>
<tr>
<td>higher</td>
<td>较高</td>
<td>192</td>
</tr>
<tr>
<td>standard</td>
<td>标准</td>
<td>128</td>
</tr>
<tr>
<td>none</td>
<td>不能播放/下载</td>
<td>0</td>
</tr>
</tbody>
</table>


**songFee**


<table>
<thead>
<tr>
<th>值</th>
<th>说明</th>
<th>详细描述</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>免费</td>
<td>免费歌曲</td>
</tr>
<tr>
<td>1</td>
<td>会员</td>
<td>普通用户无法免费收听下载；会员可收听和下载所有音质</td>
</tr>
<tr>
<td>4</td>
<td>数字专辑</td>
<td>所有用户只能在商城购买数字专辑后，才能收听下载</td>
</tr>
<tr>
<td>8</td>
<td>128K</td>
<td>普通用户可免费收听128k音质（大部分歌曲已支持320k），但不能下载；会员可收听和下载所有音质</td>
</tr>
<tr>
<td>16</td>
<td>只能付费下载</td>
<td>普通用户只能付费下载后使用，不提供在线收听；会员只能下载后使用，不能在线收听</td>
</tr>
<tr>
<td>32</td>
<td>只能付费播放</td>
<td>普通用户只能付费后收听，不能下载；会员可以直接收听，但不能下载</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "songListVo": [
      {
        "id": "3089419F3DB03FB560C55A6751DB4495",
        "name": "你是我的眼",
        "duration": 316467,
        "artists": [
          {
            "id": "89AE9BA2CEBB526875819321F03BFE85",
            "name": "萧煌奇"
          }
        ],
        "fullArtists": [
          {
            "id": "89AE9BA2CEBB526875819321F03BFE85",
            "name": "萧煌奇"
          }
        ],
        "album": {
          "id": "96570EF1709879FB87C9C2B2B7A9C6B8",
          "name": "K情歌2"
        },
        "playFlag": true,
        "downloadFlag": true,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": false,
        "liked": false,
        "coverImgUrl": "http://p1.music.126.net/pGjJLj81b0FmUr0v506PNg==/109951165641566083.jpg",
        "vipPlayFlag": false,
        "accompanyFlag": null,
        "songMaxBr": 999000,
        "userMaxBr": 999000,
        "maxBrLevel": "lossless",
        "plLevel": "lossless",
        "dlLevel": "lossless",
        "songTag": null,
        "privateCloudSong": false,
        "freeTrailFlag": false,
        "songFtFlag": false,
        "freeTrialPrivilege": {
          "cannotListenReason": null,
          "resConsumable": false,
          "userConsumable": false
        },
        "songFee": 0,
        "playMaxbr": 999000,
        "qualities": [
          "vividMusic",
          "skMusic",
          "jyMasterMusic",
          "jyEffectMusic",
          "sqMusic",
          "hmusic",
          "mmusic",
          "lmusic"
        ],
        "originCoverType": 0,
        "emotionTag": null,
        "vocalFlag": null,
        "payed": {
          "payed": 0,
          "vipPackagePayed": 0,
          "singlePayed": 0,
          "albumPayed": 0
        },
        "visible": true
      }
    ]
  }
}
```

## 获取相似艺人-歌曲列表（日推mix）

- docId：`183e1200829b46869ef1674881a90d8a`
- 来源：https://developer.music.163.com/st/developer/document?docId=183e1200829b46869ef1674881a90d8a

## 获取相似艺人-歌曲列表（日推mix）


### /openapi/music/basic/private/fm/roaming/song/list


### 请求方式：


- POST/GET


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>必填</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>type</td>
<td>String</td>
<td>是</td>
<td>mode</td>
</tr>
<tr>
<td>code</td>
<td>String</td>
<td>是</td>
<td>SIMILAR</td>
</tr>
<tr>
<td>sourceType</td>
<td>String</td>
<td>是</td>
<td>artist</td>
</tr>
<tr>
<td>sourceIds</td>
<td>String</td>
<td>是</td>
<td>艺人id，/openapi/music/basic/recommend/daily/mix返回的artist_fm中艺人id</td>
</tr>
<tr>
<td>limit</td>
<td>int</td>
<td>否</td>
<td>获取推荐歌曲数量，需<10，默认3</td>
</tr>
</tbody>
</table>


#### 请求示例：


```text
https://openapi.music.163.com/openapi/music/basic/private/fm/roaming/song/list?appId=a3010200000000000506754c4042abd6&timestamp=1742348856160&bizContent={"code":"SIMILAR","limit":"3","type":"mode","sourceType":"artist","sourceIds":"[\"E1A252DE2B79012B8B125D4B7B4B6AD6\",\"5358CC23EE5DDC6DF938BEBF7BA20ECC\",\"916DACF9B3167D94A2085B282B3F989B\"]"}&device={"channel":"nio_VR","deviceId":"54a770494f036b40","deviceType":"andrcar","appVer":"1.0.0","os":"andrcar","osVer":"8.1.0","brand":"nio_VR","model":"Taycan","clientIp":"10.0.0.130"}&accessToken=w62fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&sign=eXRnKAq2ABQ59s9mWf%2BXSJ2yqYiNp5W48ivydrqEybc9de%2F4ydpmZNI9BGv1Peoe03Jmy4rnTL2TXJM63%2B4jus8SwoZPD%2FKyx%2BPl87Ep076yYpLkcInsat676jTzALKUIa6p%2FuZJ1hKc6md70KGef9POZe7wzPOH7Fwm%2FfL8OmfyYymMl7RtsQIbS9qHuYTKyfh3Y8awPmi2MTP8xarWtnqlnScJaWY0g5E5kWrorXkPCSp9Pgt3Fre%2FOnHK4yjjtloSqKnLspJTKv7ZQWwGSVoP251NxgHsZCOHCNkMuN%2B927eoId3BxpLio1d7SurVGphou9wej4KEbhM4pvqmdw%3D%3D
```


### 返回参数说明


歌曲模型可查看：[https://developer.music.163.com/st/developer/document?docId=8e96f389dfc74fcb97af35d1597be77e](https://developer.music.163.com/st/developer/document?docId=8e96f389dfc74fcb97af35d1597be77e)


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "id": "46DDDD932BD184F4463538C76F007679",
      "name": "苦茶子",
      "duration": 170796,
      "albumName": "埋汰",
      "albumId": "D31C8AB0B3BF94BCF8037FF9899A1182",
      "albumArtistId": "232C416E7273A8051F2C0F809A44971B",
      "albumArtistName": "Starling8",
      "artistId": "232C416E7273A8051F2C0F809A44971B",
      "artistName": "Starling8",
      "coverImgUrl": "http://p1.music.126.net/VjXYNoGC3lXajZDs0r35XQ==/109951167852652412.jpg",
      "mvId": null,
      "playUrl": null,
      "br": 0,
      "playFlag": true,
      "downloadFlag": false,
      "payPlayFlag": false,
      "payDownloadFlag": true,
      "vipFlag": false,
      "vipPlayFlag": false,
      "freeTrailFlag": false,
      "songFtFlag": false,
      "freeTrail": null,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "playMaxbr": 0,
      "liked": false,
      "songMaxBr": 999000,
      "userMaxBr": 320000,
      "maxBrLevel": "hires",
      "plLevel": "exhigh",
      "dlLevel": "none",
      "gain": 0,
      "peak": 0,
      "level": null,
      "songSize": 0,
      "songMd5": null,
      "songTag": [
        "嘻哈说唱",
        "流行说唱"
      ],
      "emotionTag": null,
      "artists": [
        {
          "id": "232C416E7273A8051F2C0F809A44971B",
          "name": "Starling8"
        },
        {
          "id": "7A1F6F71CD4951D8ACDDDFDFE2E93087",
          "name": "MoreLearn 27"
        },
        {
          "id": "32B73133C384A38EA1D3BC394AD60C9D",
          "name": "FIVESTAR"
        }
      ],
      "fullArtists": [
        {
          "id": "232C416E7273A8051F2C0F809A44971B",
          "name": "Starling8"
        },
        {
          "id": "7A1F6F71CD4951D8ACDDDFDFE2E93087",
          "name": "MoreLearn 27"
        },
        {
          "id": "32B73133C384A38EA1D3BC394AD60C9D",
          "name": "FIVESTAR"
        }
      ],
      "songFee": 8,
      "alg": "alg-music-rec-songFm-i2i",
      "audioFlag": null,
      "effects": null,
      "privateCloudSong": false,
      "qualities": null,
      "language": null,
      "vocalFlag": null,
      "originCoverType": 1,
      "payed": {
        "payed": 0,
        "vipPackagePayed": 0,
        "singlePayed": 0,
        "albumPayed": 0
      },
      "visible": true
    },
    {
      "id": "A4FCF15F4CD75C010EE406F2A0E8C466",
      "name": "和你",
      "duration": 200708,
      "albumName": "幸福三部曲",
      "albumId": "5F852A004D33B432ACCA0748B4C6276A",
      "albumArtistId": "2065856DFE35DE53A22FF0741B0CA36E",
      "albumArtistName": "余佳运",
      "artistId": "2065856DFE35DE53A22FF0741B0CA36E",
      "artistName": "余佳运",
      "coverImgUrl": "http://p1.music.126.net/O6d7GYY3gp2uy8zehvcOjQ==/17699938184267410.jpg",
      "mvId": null,
      "playUrl": null,
      "br": 0,
      "playFlag": true,
      "downloadFlag": false,
      "payPlayFlag": false,
      "payDownloadFlag": true,
      "vipFlag": false,
      "vipPlayFlag": false,
      "freeTrailFlag": false,
      "songFtFlag": false,
      "freeTrail": null,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "playMaxbr": 0,
      "liked": false,
      "songMaxBr": 999000,
      "userMaxBr": 320000,
      "maxBrLevel": "lossless",
      "plLevel": "exhigh",
      "dlLevel": "none",
      "gain": 0,
      "peak": 0,
      "level": null,
      "songSize": 0,
      "songMd5": null,
      "songTag": [
        "流行",
        "华语流行",
        "节奏布鲁斯",
        "当代R&B"
      ],
      "emotionTag": null,
      "artists": [
        {
          "id": "2065856DFE35DE53A22FF0741B0CA36E",
          "name": "余佳运"
        }
      ],
      "fullArtists": [
        {
          "id": "2065856DFE35DE53A22FF0741B0CA36E",
          "name": "余佳运"
        }
      ],
      "songFee": 8,
      "alg": "alg-music-rec-songFm-promoted_cf",
      "audioFlag": null,
      "effects": null,
      "privateCloudSong": false,
      "qualities": null,
      "language": null,
      "vocalFlag": null,
      "originCoverType": 1,
      "payed": {
        "payed": 0,
        "vipPackagePayed": 0,
        "singlePayed": 0,
        "albumPayed": 0
      },
      "visible": true
    },
    {
      "id": "859260259E2D82E74C4A1916A741D9DA",
      "name": "网恋",
      "duration": 192592,
      "albumName": "网恋",
      "albumId": "B94C8D987D71D97AA59F207D6008BBF9",
      "albumArtistId": "E56673C16CF122A0E36A98F81C936C56",
      "albumArtistName": "Six Teen/果妹",
      "artistId": "E56673C16CF122A0E36A98F81C936C56",
      "artistName": "Six Teen",
      "coverImgUrl": "http://p1.music.126.net/cw5COb-ZESk4VDIVc10Kkw==/109951169694983111.jpg",
      "mvId": null,
      "playUrl": null,
      "br": 0,
      "playFlag": true,
      "downloadFlag": false,
      "payPlayFlag": false,
      "payDownloadFlag": true,
      "vipFlag": false,
      "vipPlayFlag": false,
      "freeTrailFlag": false,
      "songFtFlag": false,
      "freeTrail": null,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "playMaxbr": 0,
      "liked": false,
      "songMaxBr": 999000,
      "userMaxBr": 320000,
      "maxBrLevel": "hires",
      "plLevel": "exhigh",
      "dlLevel": "none",
      "gain": 0,
      "peak": 0,
      "level": null,
      "songSize": 0,
      "songMd5": null,
      "songTag": [
        "流行",
        "嘻哈说唱",
        "流行说唱"
      ],
      "emotionTag": null,
      "artists": [
        {
          "id": "E56673C16CF122A0E36A98F81C936C56",
          "name": "Six Teen"
        },
        {
          "id": "3FF06BF8081D4D29153F4FBB28E4816C",
          "name": "果妹"
        }
      ],
      "fullArtists": [
        {
          "id": "E56673C16CF122A0E36A98F81C936C56",
          "name": "Six Teen"
        },
        {
          "id": "3FF06BF8081D4D29153F4FBB28E4816C",
          "name": "果妹"
        }
      ],
      "songFee": 8,
      "alg": "alg-music-rec-songFm-promoted_cf",
      "audioFlag": null,
      "effects": null,
      "privateCloudSong": false,
      "qualities": null,
      "language": null,
      "vocalFlag": null,
      "originCoverType": 1,
      "payed": {
        "payed": 0,
        "vipPackagePayed": 0,
        "singlePayed": 0,
        "albumPayed": 0
      },
      "visible": true
    }
  ]
}
```

# 私人漫游API

## 获取私人漫游场景模式

- docId：`999a99898fa44785baf4cbda2d8d58af`
- 来源：https://developer.music.163.com/st/developer/document?docId=999a99898fa44785baf4cbda2d8d58af

## 获取私人漫游场景模式


### /openapi/music/basic/private/fm/roaming/category


![图片](https://p5.music.126.net/I0xZPSi0tObixvtbO3VYww==/109951172626812468)


### 请求方式：


- POST/GET


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


无业务参数


#### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/private/fm/roaming/category?appId=a301010000000000aadb4e5a28b45a67&timestamp=1709634902072&bizContent={}&device={"deviceType":"andrwear","os":"otos","appVer":"0.1","channel":"hm","model":"kys","deviceId":"357","brand":"hm","osVer":"8.1.0","clientIp":"127.0.0.1"}&accessToken=v04cd4e794fe66c2f9914c4afcd7aabbf860a930af4f39904t&signType=RSA_SHA256&sign=${sign}
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>categoryList</td>
<td>List<PrivateRoamingCategory></td>
<td>目录列表</td>
</tr>
</tbody>
</table>


**PrivateRoamingCategory**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>type</td>
<td>String</td>
<td>type，接口（/openapi/music/basic/private/fm/roaming/song/list）入参</td>
</tr>
<tr>
<td>detailList</td>
<td>List<PrivateRoamingTypeDetail></td>
<td>可选模块详情</td>
</tr>
</tbody>
</table>


**PrivateRoamingTypeDetail**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>code</td>
<td>String</td>
<td>code，接口（/openapi/music/basic/private/fm/roaming/song/list）入参</td>
</tr>
<tr>
<td>title</td>
<td>String</td>
<td>标题，eg：默认模式</td>
</tr>
<tr>
<td>subTitle</td>
<td>String</td>
<td>副标题/描述，eg：沿着目前喜好继续聆听</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
	"code": 200,
	"subCode": null,
	"message": null,
	"data": {
		"categoryList": [{
			"type": "mode",
			"detailList": [{
				"code": "DEFAULT",
				"title": "默认模式",
				"subTitle": "沿着目前喜好继续聆听",
				"icon": ""
			}, {
				"code": "FAMILIAR",
				"title": "熟悉模式",
				"subTitle": "喜欢过的歌曲与相似推荐",
				"icon": ""
			}, {
				"code": "EXPLORE",
				"title": "探索模式",
				"subTitle": "多元曲风与小众佳作",
				"icon": ""
			}]
		}, {
			"type": "scene",
			"detailList": [{
				"code": "COMMUTE",
				"title": "驾车",
				"subTitle": "",
				"icon": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958770831/4964/154f/6c98/5a005cee4ae7f3c9ec697ab6ae697676.png"
			}, {
				"code": "ELECTRONIC",
				"title": "电音",
				"subTitle": null,
				"icon": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958818749/e5e6/c98d/859c/657ca53588436e2137dae2fbf50f547b.png"
			}, {
				"code": "RAP",
				"title": "说唱",
				"subTitle": null,
				"icon": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958816576/36c7/b2b5/611c/c09ef96ca9d0225b0b44dc1cfd00ff5c.png"
			}, {
				"code": "ROCK",
				"title": "摇滚",
				"subTitle": null,
				"icon": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958814561/4a3d/89f4/713c/3a16845ab19fb7031bd65b12814d1e87.png"
			}, {
				"code": "RELAX",
				"title": "放松",
				"subTitle": "",
				"icon": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958819647/855d/a2fa/5290/8e6c7c4564560b04cc8ba1c83397da07.png"
			}, {
				"code": "HAPPINESS",
				"title": "欢快",
				"subTitle": null,
				"icon": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958818751/7c15/9a5c/a3a1/bf3c3ce2432a7cb3ad10de4246e10984.png"
			}, {
				"code": "RHYTHM_BLUES",
				"title": "R&B",
				"subTitle": null,
				"icon": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958817121/fc9f/5154/3094/e8f07d3e831aa1151745a38c2a9a34d2.png"
			}, {
				"code": "RAINY",
				"title": "下雨天",
				"subTitle": null,
				"icon": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958817122/66a9/67ed/0611/7f9992637164d5d6d605cb5dcb2b51ed.png"
			}, {
				"code": "LATE_NIGHT_EMO",
				"title": "伤感",
				"subTitle": null,
				"icon": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958815739/d6d2/1dd8/a49c/24f0d9465ec1c44e66849f0e4ef1eb50.png"
			}, {
				"code": "LYRICAL",
				"title": "抒情",
				"subTitle": null,
				"icon": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958813762/05fa/85e5/a9ed/6eb64e4474835f79394c251ef52bc2e5.png"
			}, {
				"code": "SLEEP_HELP",
				"title": "助眠",
				"subTitle": "",
				"icon": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958817125/0105/82c5/19f2/f6e2eb0913179912d6f85255442d4212.png"
			}, {
				"code": "CURE",
				"title": "治愈",
				"subTitle": null,
				"icon": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958816575/180a/d22a/400f/257cd11a9f64433e634c527269fef5db.png"
			}, {
				"code": "ROMANTIC",
				"title": "浪漫情歌",
				"subTitle": null,
				"icon": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958814562/2f5d/c5f3/353e/f54b7ee54378b61f4ac258b25e330b29.png"
			}, {
				"code": "K_POP",
				"title": "K-pop",
				"subTitle": null,
				"icon": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958820672/6f35/4433/2a66/18a2e88bf6efc1b6131f2878143844e0.png"
			}, {
				"code": "GAMES",
				"title": "打游戏",
				"subTitle": null,
				"icon": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/61735573339/28ea/babc/5b46/fee2e2435cbc22959c1e354df9fd08ce.png"
			}, {
				"code": "COFFEE_SHOP",
				"title": "咖啡馆",
				"subTitle": null,
				"icon": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/61735624077/0ce4/2d57/22f5/460f78b6de553983d43e5f73f20ace3f.png"
			}, {
				"code": "ORIGINAL_MUSICIAL",
				"title": "宝藏原创",
				"subTitle": null,
				"icon": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958820671/f117/02f0/2b38/955b2b4b972b0f28e10fa0054aa0341e.png"
			}, {
				"code": "INSPIRATIONAL",
				"title": "励志",
				"subTitle": null,
				"icon": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/60958812489/25ed/5fdb/72b7/60c2316cb6c8853399a7dae801f0738d.png"
			}]
		}]
	}
}
```

## 获取私人漫游(不建议使用)

- docId：`bb07d0cea0ab4cc2bda2e26fa0e5337e`
- 来源：https://developer.music.163.com/st/developer/document?docId=bb07d0cea0ab4cc2bda2e26fa0e5337e

## 获取私人漫游(不建议使用)


### /openapi/music/basic/radio/fm/get/v2


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>请求数据量，固定3</td>
</tr>
<tr>
<td>filterSongDurationMinute</td>
<td>否</td>
<td>Long</td>
<td>过滤歌曲的时长（大于等于该时长的歌曲将不会返回）</td>
</tr>
<tr>
<td>scene</td>
<td>否</td>
<td>String</td>
<td>漫游场景，游戏必传，固定值：unisdk</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质</td>
</tr>
</tbody>
</table>


- 算法接口，每次请求都会重推，如果单次拿的过多，会导致推荐结果极大浪费


#### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/radio/fm/get/v2?bizContent%3d%7b%22limit%22%3a%2210%22%2c%22filterSongDurationMinute%22%3a%2210000%22%2c%22withPlayUrl%22%3a%22false%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>albumName</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>albumId</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>albumArtistId</td>
<td>String</td>
<td>专辑艺人Id</td>
</tr>
<tr>
<td>albumArtistName</td>
<td>String</td>
<td>专辑艺人名</td>
</tr>
<tr>
<td>artistId</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>artistName</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面Url</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放url</td>
</tr>
<tr>
<td>br</td>
<td>int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>mvId</td>
<td>String</td>
<td>mvId</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率</td>
</tr>
<tr>
<td>songSize</td>
<td>int</td>
<td>歌曲的大小</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>songMd5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效信息（目前仅杜比才有）</td>
</tr>
<tr>
<td>alg</td>
<td>String</td>
<td>算法推荐使用，播放数据上报接口需透传该字段</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**Qualities**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>dolbyMusic</td>
<td>String</td>
<td>杜比</td>
</tr>
<tr>
<td>skMusic</td>
<td>String</td>
<td>沉浸环绕声</td>
</tr>
<tr>
<td>jyMasterMusic</td>
<td>String</td>
<td>超清母带</td>
</tr>
<tr>
<td>jyEffectMusic</td>
<td>String</td>
<td>高清臻音</td>
</tr>
<tr>
<td>hrMusic</td>
<td>String</td>
<td>hi-res</td>
</tr>
<tr>
<td>sqMusic</td>
<td>String</td>
<td>无损</td>
</tr>
<tr>
<td>hmusic</td>
<td>String</td>
<td>极高</td>
</tr>
<tr>
<td>mmusic</td>
<td>String</td>
<td>较高</td>
</tr>
<tr>
<td>lmusic</td>
<td>String</td>
<td>标准</td>
</tr>
</tbody>
</table>


**songFee**


<table>
<thead>
<tr>
<th>值</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>免费</td>
</tr>
<tr>
<td>1</td>
<td>会员</td>
</tr>
<tr>
<td>4</td>
<td>数字专辑</td>
</tr>
<tr>
<td>8</td>
<td>128K</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "id": "0D04A99BBBA4929E0EF3D9C1CE5B0BED",
      "name": "珊珊",
      "duration": 321149,
      "albumName": "珊珊",
      "albumId": "38DA48597522CD02359E35F8F7C8B8AA",
      "albumArtistId": "9AAB19C22F18BB7C6D4251A9C8C0D8A5",
      "albumArtistName": "贺生辰",
      "artistId": "9AAB19C22F18BB7C6D4251A9C8C0D8A5",
      "artistName": "贺生辰",
      "coverImgUrl": "http://p1.music.126.net/6ORTK8zGtdSjuw3Xnov0qw==/109951164191207506.jpg",
      "mvId": null,
      "playUrl": "http://m8.music.126.net/20240327151224/45849413294355e9ef985d4f51a43e13/ymusic/7bf8/c788/00f2/252ec99643d1eb7d442c6668981cfe25.mp3",
      "br": 320000,
      "playFlag": true,
      "downloadFlag": true,
      "payPlayFlag": false,
      "payDownloadFlag": false,
      "vipFlag": false,
      "vipPlayFlag": false,
      "freeTrailFlag": false,
      "songFtFlag": false,
      "freeTrail": null,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "playMaxbr": 0,
      "liked": false,
      "songMaxBr": 999000,
      "userMaxBr": 999000,
      "maxBrLevel": "lossless",
      "plLevel": "lossless",
      "dlLevel": "lossless",
      "level": "exhigh",
      "songSize": 12848109,
      "songMd5": "252ec99643d1eb7d442c6668981cfe25",
      "songTag": [
        "民谣"
      ],
      "emotionTag": null,
      "artists": [
        {
          "id": "9AAB19C22F18BB7C6D4251A9C8C0D8A5",
          "name": "贺生辰"
        }
      ],
      "songFee": 8,
      "alg": "alg-music-rec_cm_openFM_i2i",
      "audioFlag": null,
      "effects": null,
      "privateCloudSong": false,
      "qualities": [
        "skMusic",
        "jyMasterMusic",
        "jyEffectMusic",
        "sqMusic",
        "hmusic",
        "mmusic",
        "lmusic"
      ],
      "visible": true
    }
  ]
}
```

## 获取私人漫游场景歌曲

- docId：`65df691d1b284d92b29038b34daca95b`
- 来源：https://developer.music.163.com/st/developer/document?docId=65df691d1b284d92b29038b34daca95b

## 获取私人漫游场景歌曲


### /openapi/music/basic/private/fm/roaming/song/list


![图片](https://p5.music.126.net/oXrKZ5PkZoCT-IspWNnR4w==/109951172626834687)


### 请求方式：


- POST/GET


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>必填</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>type</td>
<td>String</td>
<td>是</td>
<td>type，来自/openapi/music/basic/private/fm/roaming/category</td>
</tr>
<tr>
<td>code</td>
<td>String</td>
<td>是</td>
<td>code，来自/openapi/music/basic/private/fm/roaming/category</td>
</tr>
<tr>
<td>limit</td>
<td>int</td>
<td>是</td>
<td>获取推荐歌曲数量，固定每次取3</td>
</tr>
<tr>
<td>withPlayUrl</td>
<td>boolean</td>
<td>否（默认false）</td>
<td>是否一并获取播放链接（可能获取失败）</td>
</tr>
<tr>
<td>unplaySongIds</td>
<td>JSON String</td>
<td>否</td>
<td>推荐但未播放的歌曲列表，例如：["445A8B860CC9CEA34A2A6082AACE1595"]</td>
</tr>
</tbody>
</table>


- unplaySongIds的时机：不分模式和场景，只要是上一次请求未播放的歌曲都可以带回来，目的是为了提升业务效果，不然会浪费资源

- 最好登录使用，匿名用户不保证数据完整性，可能limit=3，但是返回1条

- 最佳实践：


{"limit":"3","type":"mode","code":"DEFAULT"}


#### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/private/fm/roaming/song/list
?appId=a301010000000000aadb4e5a28b45a67&timestamp=1709634902072&bizContent={"type":"mode","code":"DEFAULT"}&device={"deviceType":"andrwear","os":"otos","appVer":"0.1","channel":"hm","model":"kys","deviceId":"357","brand":"hm","osVer":"8.1.0","clientIp":"127.0.0.1"}&accessToken=v04cd4e794fe66c2f9914c4afcd7aabbf860a930af4f39904t&signType=RSA_SHA256&sign=${sign}
```


### 返回参数说明


歌曲模型可查看：[https://developer.music.163.com/st/developer/document?docId=8e96f389dfc74fcb97af35d1597be77e](https://developer.music.163.com/st/developer/document?docId=8e96f389dfc74fcb97af35d1597be77e)


### 返回示例


```text
{
    "code": 200,
    "subCode": null,
    "message": null,
    "data": [
        {
            "id": "445A8B860CC9CEA34A2A6082AACE1595",
            "name": "Miss Americana & The Heartbreak Prince",
            "duration": 234146,
            "albumName": "Lover",
            "albumId": "09EEFD2A454E5B4E0CFD6581731D4E94",
            "albumArtistId": "3B8970FA0CAD8935CFD15CBE0DBC2B89",
            "albumArtistName": "Taylor Swift",
            "artistId": "3B8970FA0CAD8935CFD15CBE0DBC2B89",
            "artistName": "Taylor Swift",
            "coverImgUrl": "http://p1.music.126.net/6CB6Jsmb7k7qiJqfMY5Row==/109951164260234943.jpg",
            "mvId": null,
            "playUrl": null,
            "br": 0,
            "playFlag": true,
            "downloadFlag": true,
            "payPlayFlag": false,
            "payDownloadFlag": false,
            "vipFlag": true,
            "vipPlayFlag": true,
            "freeTrailFlag": true,
            "songFtFlag": false,
            "freeTrail": null,
            "freeTrialPrivilege": {
                "cannotListenReason": null,
                "resConsumable": false,
                "userConsumable": false
            },
            "playMaxbr": 0,
            "liked": false,
            "songMaxBr": 999000,
            "userMaxBr": 999000,
            "maxBrLevel": "dolby",
            "plLevel": "jyeffect",
            "dlLevel": "jyeffect",
            "level": null,
            "songSize": 0,
            "songMd5": null,
            "songTag": [
                "流行",
                "欧美流行"
            ],
            "emotionTag": null,
            "artists": [
                {
                    "id": "3B8970FA0CAD8935CFD15CBE0DBC2B89",
                    "name": "Taylor Swift"
                }
            ],
            "songFee": 1,
            "alg": "alg_fm_red_i2i",
            "audioFlag": 1,
            "effects": null,
            "privateCloudSong": false,
            "visible": true
        },
        {
            "id": "D3DD753EAF48D57D34763F623CD59539",
            "name": "最后一页",
            "duration": 245547,
            "albumName": "恋习",
            "albumId": "53AF5D75E7044C4B311AFE87D0BDF744",
            "albumArtistId": "3C2B7E95A9AA02418D7FF87E5220A11A",
            "albumArtistName": "江语晨",
            "artistId": "3C2B7E95A9AA02418D7FF87E5220A11A",
            "artistName": "江语晨",
            "coverImgUrl": "http://p1.music.126.net/XvVUZQTCxmhjNOcfEnJYew==/109951163610134059.jpg",
            "mvId": null,
            "playUrl": null,
            "br": 0,
            "playFlag": true,
            "downloadFlag": true,
            "payPlayFlag": false,
            "payDownloadFlag": false,
            "vipFlag": true,
            "vipPlayFlag": true,
            "freeTrailFlag": true,
            "songFtFlag": false,
            "freeTrail": null,
            "freeTrialPrivilege": {
                "cannotListenReason": null,
                "resConsumable": false,
                "userConsumable": false
            },
            "playMaxbr": 0,
            "liked": false,
            "songMaxBr": 999000,
            "userMaxBr": 999000,
            "maxBrLevel": "sky",
            "plLevel": "jyeffect",
            "dlLevel": "jyeffect",
            "level": null,
            "songSize": 0,
            "songMd5": null,
            "songTag": [
                "流行",
                "华语流行"
            ],
            "emotionTag": null,
            "artists": [
                {
                    "id": "3C2B7E95A9AA02418D7FF87E5220A11A",
                    "name": "江语晨"
                }
            ],
            "songFee": 1,
            "alg": "alg_fm_red_i2i",
            "audioFlag": null,
            "effects": null,
            "privateCloudSong": false,
            "visible": true
        },
        {
            "id": "EED3E87C1D96F7B4E71712EC077B6481",
            "name": "那些你很冒险的梦",
            "duration": 244470,
            "albumName": "学不会",
            "albumId": "10E63DC900472FD7686AC93537338515",
            "albumArtistId": "4DE05F05457B198B59BDA3F441F2AFBB",
            "albumArtistName": "林俊杰",
            "artistId": "4DE05F05457B198B59BDA3F441F2AFBB",
            "artistName": "林俊杰",
            "coverImgUrl": "http://p1.music.126.net/Z5lg-iA7pGbquJvMoY8tbg==/109951168271379420.jpg",
            "mvId": "27A5310EC643A0C8F1144EF3CC55D03C",
            "playUrl": null,
            "br": 0,
            "playFlag": true,
            "downloadFlag": true,
            "payPlayFlag": false,
            "payDownloadFlag": false,
            "vipFlag": true,
            "vipPlayFlag": true,
            "freeTrailFlag": true,
            "songFtFlag": false,
            "freeTrail": null,
            "freeTrialPrivilege": {
                "cannotListenReason": null,
                "resConsumable": false,
                "userConsumable": false
            },
            "playMaxbr": 0,
            "liked": false,
            "songMaxBr": 999000,
            "userMaxBr": 999000,
            "maxBrLevel": "sky",
            "plLevel": "jyeffect",
            "dlLevel": "jyeffect",
            "level": null,
            "songSize": 0,
            "songMd5": null,
            "songTag": [
                "流行",
                "华语流行"
            ],
            "emotionTag": null,
            "artists": [
                {
                    "id": "4DE05F05457B198B59BDA3F441F2AFBB",
                    "name": "林俊杰"
                }
            ],
            "songFee": 1,
            "alg": "alg_fm_red_i2i",
            "audioFlag": null,
            "effects": null,
            "privateCloudSong": false,
            "visible": true
        }
    ]
}
```


### 备注


公共参数需要传入accessToken


播放数据回传时需要回传alg

# 查询歌单及歌曲API

## 获取歌单详情

- docId：`730b0a8b80e745dea3b9f354eddb467e`
- 来源：https://developer.music.163.com/st/developer/document?docId=730b0a8b80e745dea3b9f354eddb467e

## 获取歌单详情


### /openapi/music/basic/playlist/detail/get/v2


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>playlistId</td>
<td>是</td>
<td>string</td>
<td>歌单Id</td>
</tr>
<tr>
<td>originalCoverFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否使用原始封面（无水印，华语私人雷达第一首歌封面），默认：false</td>
</tr>
<tr>
<td>newCoverFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否获取原始新封面（左下角文字和右上角logo），默认：false</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"playlistId":"A1EECD810B0C28EBD2C04445DD254AEE"}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/detail/get/v2?bizContent%3d%7b%22playlistId%22%3a%225CF4DA1F06D2AB3AC61AB1A665C7D588%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>creatorAvatarUrl</td>
<td>String</td>
<td>创建者头像</td>
</tr>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>String</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>creatorId</td>
<td>String</td>
<td>歌单创建人Id</td>
</tr>
<tr>
<td>createTime</td>
<td>String</td>
<td>创建时间</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>trackCount</td>
<td>int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>specialType</td>
<td>int</td>
<td>歌单类型</td>
</tr>
<tr>
<td>trackUpdateTime</td>
<td>long</td>
<td>最近更新时间</td>
</tr>
</tbody>
</table>


#### 歌单类型


<table>
<thead>
<tr>
<th>specialType</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>普通歌单</td>
</tr>
<tr>
<td>5</td>
<td>红心歌单</td>
</tr>
<tr>
<td>10</td>
<td>置顶歌单</td>
</tr>
<tr>
<td>20</td>
<td>尾部歌单</td>
</tr>
<tr>
<td>100</td>
<td>官方歌单</td>
</tr>
<tr>
<td>200</td>
<td>视频歌单</td>
</tr>
<tr>
<td>300</td>
<td>分享歌单</td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>code</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>请求正常</td>
</tr>
<tr>
<td>404</td>
<td>获取资源不存在</td>
</tr>
<tr>
<td>500</td>
<td>系统错误</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
	"code": 200,
	"subCode": null,
	"message": null,
	"data": {
		"id": "A1EECD810B0C28EBD2C04445DD254AEE",
		"name": "古典宅家指南 | 古典旋律揉碎周末平庸琐事",
		"coverImgUrl": "http://p1.music.126.net/4ehuVFDWzXd_Xa739K9RIQ==/109951168969635024.jpg?imageView=1&thumbnail=800y800&enlarge=1%7CimageView=1&watermark&type=1&image=b2JqL3c1bkRrTUtRd3JMRGpEekNtOE9tLzM2NTkzODYwNTc2LzAyMDYvMjAyNDUxMTE1NTgzMy94MzI1MTcxODA5MjcxMzgwNS5wbmc=&dx=0&dy=0%7Cwatermark&type=1&image=b2JqL3dvbkRsc0tVd3JMQ2xHakNtOEt4LzI3NjEwNDk3MDYyL2VlOTMvOTIxYS82NjE4LzdhMDc5ZDg0NTYyMDAwZmVkZWJmMjVjYjE4NjhkOWEzLnBuZw==&dx=0&dy=0%7CimageView=1",
		"describe": "古典乐如一首安静而又温柔的诗 找到内心的宁静和安慰 与古典乐相伴点亮日常 让音乐成为宅家时最美妙的陪伴",
		"creatorNickName": "云音乐古典星球",
		"creatorAvatarUrl": "http://p1.music.126.net/RQa5zUJdEx46F4HWQ82eXQ==/109951166469319070.jpg",
		"playCount": 67374,
		"subscribedCount": 688,
		"tags": null,
		"createTime": 0,
		"subed": false,
		"trackCount": 54,
		"specialType": 100,
		"category": null,
		"allFreeTrialFlag": false,
		"trackUpdateTime": 1769066893169,
		"creatorId": "72281C26EC3F1B116FB87B1728FA62F5"
	}
}
```


- 隐私歌单


```text
{
  "code": 404,
  "subCode": "",
  "message": "无权访问该资源",
  "data": null
}
```


- 无权限访问(被创作设置隐私)


```text
{
	"code": 404,
	"subCode": "",
	"message": "无权访问该资源",
	"data": null
}
```

## 批量查询歌单详情

- docId：`cc0c3b1000eb4c969b5e5393ea83a9a0`
- 来源：https://developer.music.163.com/st/developer/document?docId=cc0c3b1000eb4c969b5e5393ea83a9a0

## 批量查询歌单详情


### /openapi/music/basic/playlist/detail/list


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>playlistIds</td>
<td>是</td>
<td>List<String></td>
<td>歌曲Id列表，序列化成json String；限制为500个Id及以下</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"playlistIds":["7747FEA04606F9838B75B022F81508BB","87621E9FB0B776C4EF38922B6D8559A7","C6F25F83CEB3993C61A1968CAABB417F"]}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/detail/list?appId=a301020000000000746f96a196e52e07&device=%7B%22deviceType%22%3A%22andrcar%22%2C%22os%22%3A%22andrcar%22%2C%22appVer%22%3A%220.1%22%2C%22channel%22%3A%22didi%22%2C%22model%22%3A%22kys%22%2C%22deviceId%22%3A%22357%22%2C%22brand%22%3A%22didi%22%2C%22osVer%22%3A%228.1.0%22%2C%22clientIp%22%3A%22192.168.0.1%22%7D&accessToken=wb6c762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&timestamp=1702455415674&playlistIds=356AD31B6D8DB20A28885E18032E618B
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>String</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>creatorId</td>
<td>String</td>
<td>歌单创建人Id</td>
</tr>
<tr>
<td>createTime</td>
<td>String</td>
<td>创建时间</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>trackCount</td>
<td>int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>specialType</td>
<td>int</td>
<td>歌单类型</td>
</tr>
</tbody>
</table>


#### 歌单类型


<table>
<thead>
<tr>
<th>specialType</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>普通歌单</td>
</tr>
<tr>
<td>5</td>
<td>红心歌单</td>
</tr>
<tr>
<td>10</td>
<td>置顶歌单</td>
</tr>
<tr>
<td>20</td>
<td>尾部歌单</td>
</tr>
<tr>
<td>100</td>
<td>官方歌单</td>
</tr>
<tr>
<td>200</td>
<td>视频歌单</td>
</tr>
<tr>
<td>300</td>
<td>分享歌单</td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>code</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>请求正常</td>
</tr>
<tr>
<td>404</td>
<td>获取资源不存在</td>
</tr>
<tr>
<td>500</td>
<td>系统错误</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "id": "356AD31B6D8DB20A28885E18032E618B",
      "name": "周海媚参演原声集|一代人心中最美的周芷若",
      "coverImgUrl": "http://p2.music.126.net/WzwcQGO24imYrO1GrkHSbw==/109951169157723223.jpg",
      "describe": "12日晚，周海媚工作室发文透露周海媚因医治无效于12月11日病逝，享年57岁，作为一名优秀的演员，周海媚生前参演过多部的影视作品，代表作有《倚天屠龙记》《射雕英雄传》《武媚娘传奇》《香蜜沉沉烬如霜》等。\n\n一代人心中最美的周芷若，一路走好。",
      "creatorNickName": "Beth丝丝",
      "playCount": 164424,
      "subscribedCount": 810,
      "tags": null,
      "createTime": 0,
      "subed": false,
      "trackCount": 19,
      "specialType": 0,
      "category": null,
      "creatorId": "AB3C06E41A9F570D2F375FC0CB53EFFC"
    }
  ]
}
```

## 获取歌单里的歌曲列表

- docId：`1d0537d7facc4c398834810d2955123c`
- 来源：https://developer.music.163.com/st/developer/document?docId=1d0537d7facc4c398834810d2955123c

## 获取歌单里的歌曲列表


### /openapi/music/basic/playlist/song/list/get/v3


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>playlistId</td>
<td>是</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>获取数据量（最多500条），建议每次取30条</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"playlistId":"A1EECD810B0C28EBD2C04445DD254AEE","limit":"30","offset":"0","qualityFlag":"true"}


- 异步加载播放列表歌曲时，可以limit=500


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/song/list/get/v3?bizContent%3d%7b%22playlistId%22%3a%225CF4DA1F06D2AB3AC61AB1A665C7D588%22%2c%22limit%22%3a%2210%22%2c%22offset%22%3a%220%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>时长</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>album</td>
<td>Album</td>
<td>专辑信息</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持试听</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面url</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>alg</td>
<td>String</td>
<td>算法推荐使用，播放数据上报接口需透传该字段</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>qualities</td>
<td>int</td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**Qualities**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>dolbyMusic</td>
<td>long</td>
<td>杜比</td>
</tr>
<tr>
<td>skMusic</td>
<td>String</td>
<td>沉浸环绕声</td>
</tr>
<tr>
<td>jyMasterMusic</td>
<td>String</td>
<td>超清母带</td>
</tr>
<tr>
<td>jyEffectMusic</td>
<td>String</td>
<td>高清臻音</td>
</tr>
<tr>
<td>hrMusic</td>
<td>String</td>
<td>hi-res</td>
</tr>
<tr>
<td>sqMusic</td>
<td>String</td>
<td>无损</td>
</tr>
<tr>
<td>hmusic</td>
<td>String</td>
<td>极高</td>
</tr>
<tr>
<td>mmusic</td>
<td>String</td>
<td>较高</td>
</tr>
<tr>
<td>lmusic</td>
<td>String</td>
<td>标准</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**Album**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名称</td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>code</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>请求正常</td>
</tr>
<tr>
<td>400</td>
<td>参数错误</td>
</tr>
<tr>
<td>500</td>
<td>系统错误</td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>subcode</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>有返回数据</td>
</tr>
<tr>
<td>10007</td>
<td>资源不存在</td>
</tr>
</tbody>
</table>


### 返回示例


正常情况


```text
{
  "code": 200,
  "subCode": "200",
  "message": null,
  "data": [
    {
      "id": "E0D0F90596B94E7F72DAE19D2D440EC4",
      "name": "紫荆花盛开",
      "duration": 210667,
      "artists": [
        {
          "id": "F303DF5534E993DF55770B50A718BA74",
          "name": "李荣浩"
        },
        {
          "id": "4459C411DED70104B4A690E9606B82F2",
          "name": "梁咏琪"
        }
      ],
      "album": {
        "id": "38CF06364EE9B64D921301F135D8DDEB",
        "name": "紫荆花盛开"
      },
      "playFlag": true,
      "downloadFlag": false,
      "payPlayFlag": false,
      "payDownloadFlag": true,
      "vipFlag": false,
      "liked": false,
      "coverImgUrl": "http://p1.music.126.net/R7yzr15Ftp4Mf59kTvy_uA==/109951167605022957.jpg",
      "vipPlayFlag": false,
      "accompanyFlag": null,
      "songMaxBr": 999000,
      "userMaxBr": 320000,
      "maxBrLevel": "hires",
      "plLevel": "exhigh",
      "dlLevel": "none",
      "songTag": [
        "流行",
        "粤语流行"
      ],
      "alg": null,
      "privateCloudSong": false,
      "freeTrailFlag": false,
      "songFtFlag": false,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false
      },
      "songFee": 8,
      "playMaxbr": 999000,
      "qualities": [
        "skMusic",
        "jyMasterMusic",
        "jyEffectMusic",
        "hrMusic",
        "sqMusic",
        "hmusic",
        "mmusic",
        "lmusic"
      ],
      "visible": true
    }
  ]
}
```


歌单无数据时会提示（包括红心歌单）


- 常出现场景：匿名用户红心歌单为空、某个歌单offset超过总数量

- 被创作者设置隐私（客态无法访问）


```text
{
    "code":200,
    "subCode":"10007",
    "message":"资源不存在",
    "data": null
}
```

# 查询歌曲API

## 获取歌曲音质

- docId：`4e6a21da27a64becb778484ce2068fd0`
- 来源：https://developer.music.163.com/st/developer/document?docId=4e6a21da27a64becb778484ce2068fd0

## 获取歌曲音质


### /openapi/music/basic/song/music/quality/sound/get


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songId</td>
<td>是</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/song/music/quality/sound/get?appId=a301020000000000746f96a196e52e07&device=%7B%22deviceType%22:%22andrcar%22,%22os%22:%22andrcar%22,%22appVer%22:%220.1%22,%22channel%22:%22didi%22,%22model%22:%22kys%22,%22deviceId%22:%22357%22,%22brand%22:%22didi%22,%22osVer%22:%228.1.0%22,%22clientIp%22:%22192.168.0.1%22%7D&bizContent=%7B%22songId%22:%22F888146F7F363DC188014EFE00829A1C%22%7D&accessToken=wb6c762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&timestamp=1689239715482&sign=ISWZssiRlzMgsmtX4y6ekUnKpmAyNsMMneFOAJCjwu41WwRigRbVQA%2BS%2BTgmt2GVICCIK3GboyBpTfh8E1eRShfVPGHPZ6GoSU%2ByjTOjZ69ew9nuFjSnNNYazLHHouvVFyWmNZvQyrN21wFx1zsDBVzP3UWzzqYIYFMxn74edr0RU0XOJCgjUnhGOMmkIP%2B5WraEaOMT9yQ%2Fn2IUOgacaSaaSG9ZLigSmmqvozRiK%2B5HV2iOUGL3%2F%2FS2ZTho%2BS%2Fywf9qbPpB6U8UlpyJHxhD%2FLWpiYRdS9BySYBLLr9%2FjgVcz885qQdK5F1uh1KtRH3YiC4bB43IZ1a7JVUfHKlE6Q%3D%3D&signType=RSA_SHA256
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>vividMusic</td>
<td>String</td>
<td>Audio Vivid</td>
</tr>
<tr>
<td>dolbyMusic</td>
<td>String</td>
<td>杜比全景声</td>
</tr>
<tr>
<td>skMusic</td>
<td>String</td>
<td>沉浸环绕声</td>
</tr>
<tr>
<td>jyMasterMusic</td>
<td>String</td>
<td>超清母带</td>
</tr>
<tr>
<td>jyEffectMusic</td>
<td>String</td>
<td>高清臻音</td>
</tr>
<tr>
<td>hrMusic</td>
<td>String</td>
<td>hi-res</td>
</tr>
<tr>
<td>sqMusic</td>
<td>String</td>
<td>无损</td>
</tr>
<tr>
<td>hmusic</td>
<td>String</td>
<td>极高</td>
</tr>
<tr>
<td>mmusic</td>
<td>String</td>
<td>较高</td>
</tr>
<tr>
<td>lmusic</td>
<td>String</td>
<td>标准</td>
</tr>
</tbody>
</table>


**xxMusic**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>size</td>
<td>Long</td>
<td>歌曲大小</td>
</tr>
<tr>
<td>extension</td>
<td>String</td>
<td>音频格式</td>
</tr>
<tr>
<td>bitrate</td>
<td>Long</td>
<td>比特率</td>
</tr>
<tr>
<td>playTime</td>
<td>Long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>vipTypes</td>
<td>List</td>
<td>需要的会员类型</td>
</tr>
</tbody>
</table>


**vipTypes**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>vip</td>
<td>Long</td>
<td>车端会员（之前的各端会员）</td>
</tr>
<tr>
<td>blackvip</td>
<td>Long</td>
<td>黑胶vip</td>
</tr>
<tr>
<td>svip</td>
<td>Long</td>
<td>黑胶svip</td>
</tr>
</tbody>
</table>


- 表示展示当前音质需要最低会员类型，svip包含blackvip

- 空值表示免费音质


### 返回示例


```text
{
  "code": 200,
  "subCode": "200",
  "message": null,
  "data": {
    "sqMusic": {
      "name": null,
      "id": 103168898,
      "size": 13775163,
      "extension": "flac",
      "sr": 44100,
      "dfsId": 0,
      "bitrate": 676081,
      "playTime": 163000,
      "volumeDelta": 26182,
      "md5": null,
      "dolbyType": null,
      "peak": null,
      "level": null,
      "vipTypes": [
        "vip",
        "blackvip"
      ]
    },
    "hrMusic": null,
    "dolbyMusic": null,
    "jyMasterMusic": {
      "name": null,
      "id": 8007805159,
      "size": 87763222,
      "extension": null,
      "sr": 192000,
      "dfsId": 8007805159,
      "bitrate": 4307397,
      "playTime": 163000,
      "volumeDelta": -1.3156,
      "md5": "01199cdd06f0d421d2cf13e2382a35be",
      "dolbyType": null,
      "peak": 0,
      "level": null,
      "vipTypes": [
        "vip",
        "blackvip",
        "svip"
      ]
    },
    "jyEffectMusic": {
      "name": null,
      "id": 8007805048,
      "size": 52679441,
      "extension": null,
      "sr": 96000,
      "dfsId": 8007805048,
      "bitrate": 2585494,
      "playTime": 163000,
      "volumeDelta": -1.3038,
      "md5": "f4c6c1224c4cb3af5c1fbacfd367cd12",
      "dolbyType": null,
      "peak": 0,
      "level": null,
      "vipTypes": [
        "vip",
        "blackvip"
      ]
    },
    "skMusic": {
      "name": null,
      "id": 8131179579,
      "size": 13702948,
      "extension": null,
      "sr": 44100,
      "dfsId": 8131179579,
      "bitrate": 672537,
      "playTime": 163000,
      "volumeDelta": 1.664,
      "md5": "2e903afee562f3ad4d7c22149293e305",
      "dolbyType": null,
      "peak": 0,
      "level": null,
      "vipTypes": [
        "vip",
        "blackvip",
        "svip"
      ]
    },
    "vividMusic": {
      "name": null,
      "id": 11375576776,
      "size": 16954087,
      "extension": null,
      "sr": 44100,
      "dfsId": 11375576776,
      "bitrate": 832042,
      "playTime": 163005,
      "volumeDelta": 78,
      "md5": "f91f8c9a1310c6f1b8486bc28721ca0e",
      "dolbyType": null,
      "peak": 0,
      "level": null,
      "vipTypes": [
        "svip"
      ]
    },
    "hmusic": {
      "name": null,
      "id": 103168900,
      "size": 6522296,
      "extension": "mp3",
      "sr": 44100,
      "dfsId": 0,
      "bitrate": 320000,
      "playTime": 163000,
      "volumeDelta": 26182,
      "md5": null,
      "dolbyType": null,
      "peak": null,
      "level": null,
      "vipTypes": []
    },
    "mmusic": {
      "name": null,
      "id": 103168901,
      "size": 3913394,
      "extension": "mp3",
      "sr": 44100,
      "dfsId": 0,
      "bitrate": 192000,
      "playTime": 163000,
      "volumeDelta": 28822,
      "md5": null,
      "dolbyType": null,
      "peak": null,
      "level": null,
      "vipTypes": []
    },
    "lmusic": {
      "name": null,
      "id": 103168902,
      "size": 2608944,
      "extension": "mp3",
      "sr": 44100,
      "dfsId": 0,
      "bitrate": 128000,
      "playTime": 163000,
      "volumeDelta": 30613,
      "md5": null,
      "dolbyType": null,
      "peak": null,
      "level": null,
      "vipTypes": []
    }
  }
}
```

## 全曲试听

- docId：`1549413ffa5548b8a646a1eb2ea4da5b`
- 来源：https://developer.music.163.com/st/developer/document?docId=1549413ffa5548b8a646a1eb2ea4da5b

## 全曲试听


### 功能介绍


```text
- 支持全曲试听：可配置歌单、用户人群、场景（日推，私人漫游，场景音乐等）
- 需联系云音乐同事进行配置
- 需要做数据回传，isAudition=2
```


<table>
<thead>
<tr>
<th>配置范围</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>歌单</td>
<td>指定任意歌单，包括排行榜、官方歌单</td>
</tr>
<tr>
<td>接口</td>
<td>指定任意接口进行分发，包括每日推荐、私人漫游、场景音乐</td>
</tr>
<tr>
<td>用户人群</td>
<td>指定任意人群包（必须实名登录），比如所有普通用户，或者指定uid</td>
</tr>
</tbody>
</table>


- 举例：可以指定xx渠道的普通用户免费全曲试听每日推荐中的歌曲


### 业务参数


#### trialScene


<table>
<thead>
<tr>
<th>场景</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>每日推荐</td>
<td>daily_trial</td>
</tr>
<tr>
<td>私人漫游</td>
<td>fm_trial</td>
</tr>
<tr>
<td>红心歌单</td>
<td>star_playlist_trial</td>
</tr>
<tr>
<td>歌单</td>
<td>playlist_trial</td>
</tr>
<tr>
<td>场景音乐</td>
<td>scene_trial</td>
</tr>
</tbody>
</table>


### 请求示例（每日推荐）：


#### 1、每日推荐


- /openapi/music/basic/recommend/songlist/get/v2


```text
入参：{"trialScene":"daily_trial","limit":xx}
返回：playflag=false和freeTrialPrivilege

{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "id": "564F304D934C62693EE7868054460769",
      "name": "如果爱忘了",
      "duration": 194592,
      "artists": [
        {
          "id": "F1FE6AD0CF36CE8DCC769BC17E8CBD46",
          "name": "王贰浪"
        }
      ],
      "album": {
        "id": "E467B08A52B0DE213A555E8351B33CF5",
        "name": "如果爱忘了"
      },
      "playFlag": false,
      "downloadFlag": false,
      "payPlayFlag": true,
      "payDownloadFlag": true,
      "vipFlag": true,
      "liked": false,
      "coverImgUrl": "http://p1.music.126.net/3rxX9wTHUFBBaT6Ud1tv5w==/109951168305751852.jpg",
      "vipPlayFlag": true,
      "accompanyFlag": null,
      "songMaxBr": 999000,
      "userMaxBr": 0,
      "maxBrLevel": "hires",
      "plLevel": "none",
      "dlLevel": "none",
      "songTag": [
        "流行",
        "华语流行"
      ],
      "alg": "openDaily_daily",
      "privateCloudSong": false,
      "freeTrailFlag": true,
      "songFtFlag": false,
      "freeTrialPrivilege": {
        "cannotListenReason": 0,
        "resConsumable": true,
        "userConsumable": true
      },
      "songFee": 1,
      "playMaxbr": 999000,
      "qualities": null,
      "visible": true
    }
  ]
}
```


#### 2、获取歌曲详情


- /openapi/music/basic/song/detail/get/v2


```text
入参：{"trialScene":"daily_trial","withUrl":true,"songId":"xx"}
返回：playflag=false和完整playUrl

{
  "code": 200,
  "subCode": "200",
  "message": null,
  "data": {
    "id": "564F304D934C62693EE7868054460769",
    "name": "如果爱忘了",
    "duration": 194592,
    "albumName": "如果爱忘了",
    "albumId": "E467B08A52B0DE213A555E8351B33CF5",
    "albumArtistId": "F1FE6AD0CF36CE8DCC769BC17E8CBD46",
    "albumArtistName": "王贰浪",
    "artistId": "F1FE6AD0CF36CE8DCC769BC17E8CBD46",
    "artistName": "王贰浪",
    "coverImgUrl": "http://p1.music.126.net/3rxX9wTHUFBBaT6Ud1tv5w==/109951168305751852.jpg",
    "mvId": null,
    "playUrl": "http://iot202.music.126.net/Yml6PWlvdCZjaGFubmVsPXplZWtyX2FwaSZzY2VuZT1hbmRyY2Fy/20240605112814/da58b4837755651bc681a473b1b5902e/jdymusic/obj/wo3DlMOGwrbDjj7DisKw/24828872053/db40/5aea/bcb3/18d30ec05afa35223fc20d9f6c4117f0.mp3",
    "br": 128000,
    "playFlag": false,
    "downloadFlag": false,
    "payPlayFlag": true,
    "payDownloadFlag": true,
    "vipFlag": true,
    "vipPlayFlag": true,
    "freeTrailFlag": true,
    "songFtFlag": false,
    "freeTrail": null,
    "freeTrialPrivilege": {
      "cannotListenReason": 0,
      "resConsumable": true,
      "userConsumable": true
    },
    "playMaxbr": 0,
    "liked": false,
    "songMaxBr": 999000,
    "userMaxBr": 0,
    "maxBrLevel": "hires",
    "plLevel": "none",
    "dlLevel": "none",
    "level": "standard",
    "songSize": 3114285,
    "songMd5": "18d30ec05afa35223fc20d9f6c4117f0",
    "songTag": [
      "流行",
      "华语流行"
    ],
    "emotionTag": null,
    "artists": [
      {
        "id": "F1FE6AD0CF36CE8DCC769BC17E8CBD46",
        "name": "王贰浪"
      }
    ],
    "songFee": 1,
    "alg": null,
    "audioFlag": null,
    "effects": null,
    "privateCloudSong": false,
    "qualities": null,
    "visible": true
  }
}
```


#### 3、获取歌曲播放url


- /openapi/music/basic/song/playurl/get/v2


```text
入参：{"trialScene":"daily_trial","songId":"xxx"}
返回：完整playUrl

{
  "code": 200,
  "subCode": "200",
  "message": null,
  "data": {
    "url": "http://iot202.music.126.net/Yml6PWlvdCZjaGFubmVsPXplZWtyX2FwaSZzY2VuZT1hbmRyY2Fy/20240605141047/096df3f750a6e187693ac89fac423308/jdymusic/obj/wo3DlMOGwrbDjj7DisKw/24828872053/db40/5aea/bcb3/18d30ec05afa35223fc20d9f6c4117f0.mp3",
    "size": 3114285,
    "md5": "18d30ec05afa35223fc20d9f6c4117f0",
    "br": 128000,
    "effects": null,
    "privateCloudSong": false,
    "level": "standard",
    "freeTrail": null,
    "freeTrialPrivilege": {
      "cannotListenReason": 0,
      "resConsumable": true,
      "userConsumable": true
    },
    "duration": 194592,
    "gain": -9.7859,
    "peak": 1
  }
}
```


### 请求示例（某个试听歌单）：


#### 1、查询歌单详情


- /openapi/music/basic/playlist/detail/get/v2


```text
入参：无
返回：allFreeTrialFlag=true，表示当前歌单可全曲试听

{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "id": "FCB7FBF00D01DBB5AEE872AE43CB71F9",
    "name": "热歌榜",
    "coverImgUrl": "http://p2.music.126.net/ZyUjc7K_GDpD8MO1-GQkmA==/109951166952706664.jpg",
    "describe": "云音乐热歌榜：云音乐用户一周内收听所有线上歌曲官方TOP排行榜，每日更新。",
    "creatorNickName": "网易云音乐",
    "playCount": 12117658624,
    "subscribedCount": 12045928,
    "tags": null,
    "createTime": 0,
    "subed": false,
    "trackCount": 200,
    "specialType": 10,
    "category": null,
    "allFreeTrialFlag": true,
    "creatorId": "BFB7C979614F67364AA8C7E38E1AA2B2"
  }
}
```


#### 2、查询歌单下的歌曲


- /openapi/music/basic/playlist/song/list/get/v3


```text
入参：{"trialScene":"playlist_trial","playlistId":"xxx","offset":"x","limit":"xx"}
返回：playflag=false和freeTrialPrivilege

{
  "code": 200,
  "subCode": "200",
  "message": null,
  "data": [
    {
      "id": "F484A7E3B383158E9098A5049E2FD6B2",
      "name": "若月亮没来 (若是月亮还没来)",
      "duration": 173822,
      "artists": [
        {
          "id": "E3819FEDB87F8F5B43755245AC8E978B",
          "name": "王宇宙Leto"
        },
        {
          "id": "A8CF82DA31566AE5C5B4CEB2D0D52604",
          "name": "乔浚丞"
        }
      ],
      "album": {
        "id": "7A3A7A761496E1A9EE30333045CF0D17",
        "name": "若月亮没来（若是月亮还没来）"
      },
      "playFlag": false,
      "downloadFlag": false,
      "payPlayFlag": true,
      "payDownloadFlag": true,
      "vipFlag": true,
      "liked": false,
      "coverImgUrl": "http://p1.music.126.net/Bb50pyrAJzR3ZsjxILnO6A==/109951169278248355.jpg",
      "vipPlayFlag": true,
      "accompanyFlag": null,
      "songMaxBr": 999000,
      "userMaxBr": 0,
      "maxBrLevel": "hires",
      "plLevel": "none",
      "dlLevel": "none",
      "songTag": [
        "流行"
      ],
      "alg": null,
      "privateCloudSong": false,
      "freeTrailFlag": true,
      "songFtFlag": false,
      "freeTrialPrivilege": {
        "cannotListenReason": 0,
        "resConsumable": true,
        "userConsumable": true
      },
      "songFee": 1,
      "playMaxbr": 999000,
      "qualities": null,
      "visible": true
    }
  ]
}
```


#### freeTrialPrivilege


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>cannotListenReason</td>
<td>int</td>
<td>是否支持试听，0：支持，null：不支持</td>
</tr>
<tr>
<td>resConsumable</td>
<td>boolean</td>
<td>该场景是否支持试听</td>
</tr>
<tr>
<td>userConsumable</td>
<td>boolean</td>
<td>该用户是否支持试听</td>
</tr>
</tbody>
</table>


#### 3、获取歌曲播放url


- /openapi/music/basic/song/playurl/get/v2


#### source


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>sourceType</td>
<td>string</td>
<td>资源类型（歌单固定传playlist）</td>
</tr>
<tr>
<td>sourceId</td>
<td>string</td>
<td>资源ID（对应上游的playlistid）</td>
</tr>
</tbody>
</table>


```text
入参：{"trialScene":"playlist_trial","sourceId":"xxx","sourceType":"playlist","withUrl":true,"songId":"xxx"}
返回：完整playUrl

{
  "code": 200,
  "subCode": "200",
  "message": null,
  "data": {
    "url": "http://iot202.music.126.net/Yml6PWlvdCZjaGFubmVsPXplZWtyX2FwaSZzY2VuZT1hbmRyY2Fy/20240605141047/096df3f750a6e187693ac89fac423308/jdymusic/obj/wo3DlMOGwrbDjj7DisKw/24828872053/db40/5aea/bcb3/18d30ec05afa35223fc20d9f6c4117f0.mp3",
    "size": 3114285,
    "md5": "18d30ec05afa35223fc20d9f6c4117f0",
    "br": 128000,
    "effects": null,
    "privateCloudSong": false,
    "level": "standard",
    "freeTrail": null,
    "freeTrialPrivilege": {
      "cannotListenReason": 0,
      "resConsumable": true,
      "userConsumable": true
    },
    "duration": 194592,
    "gain": -9.7859,
    "peak": 1
  }
}
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>albumName</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>albumId</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>albumArtistId</td>
<td>String</td>
<td>专辑艺人Id</td>
</tr>
<tr>
<td>albumArtistName</td>
<td>String</td>
<td>专辑艺人名</td>
</tr>
<tr>
<td>artistId</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>artistName</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面Url</td>
</tr>
<tr>
<td>mvId</td>
<td>String</td>
<td>mvId</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放url</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载歌曲（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持试听</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>试听起止时间，单位：s</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>songSize</td>
<td>int</td>
<td>歌曲的大小</td>
</tr>
<tr>
<td>songMd5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>freeTrialPrivilege</td>
<td>List<String></td>
<td>是否支持全曲试听</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>br</td>
<td>int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效信息（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>

## 批量获取歌曲信息

- docId：`b8bdaa8e40b946ecbc1d08978f3f12b0`
- 来源：https://developer.music.163.com/st/developer/document?docId=b8bdaa8e40b946ecbc1d08978f3f12b0

## 批量获取歌曲信息


### /openapi/music/basic/song/list/get/v2


```text
该接口拿不到播放地址，需要单独查
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songIdList</td>
<td>是</td>
<td>List<String></td>
<td>歌曲Id列表，序列化成json String；限制为500个Id及以下</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质</td>
</tr>
</tbody>
</table>


- 长度限制8k，如果songIDList过大，需要把参数放到body中

- 最佳实践：


{"qualityFlag":true,"songIdList":["5679C07696AEB144AB24D66DAC4D2988","7B3CB3A0BEEE8DDA8082FCAEF6371AE9"]}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/song/list/get/v2?bizContent%3d%7b%22songIdList%22%3a%5b%225CF4DA1F06D2AB3AC61AB1A665C7D588%22%5d%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>时长</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面url</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>album</td>
<td>Album</td>
<td>专辑信息</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持试听</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**Album**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名称</td>
</tr>
</tbody>
</table>


**maxBrLevel、plLevel、dlLevel**


<table>
<thead>
<tr>
<th>值</th>
<th>音质</th>
<th>比特率</th>
</tr>
</thead>
<tbody>
<tr>
<td>dobly</td>
<td>杜比</td>
<td>无</td>
</tr>
<tr>
<td>hires</td>
<td>hires</td>
<td>1999</td>
</tr>
<tr>
<td>lossless</td>
<td>无损</td>
<td>999</td>
</tr>
<tr>
<td>exhigh</td>
<td>极高</td>
<td>320</td>
</tr>
<tr>
<td>higher</td>
<td>较高</td>
<td>192</td>
</tr>
<tr>
<td>standard</td>
<td>标准</td>
<td>128</td>
</tr>
<tr>
<td>none</td>
<td>不能播放/下载</td>
<td>0</td>
</tr>
</tbody>
</table>


**songFee**


<table>
<thead>
<tr>
<th>值</th>
<th>说明</th>
<th>详细描述</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>免费</td>
<td>免费歌曲</td>
</tr>
<tr>
<td>1</td>
<td>会员</td>
<td>普通用户无法免费收听下载；会员可收听和下载所有音质</td>
</tr>
<tr>
<td>4</td>
<td>数字专辑</td>
<td>所有用户只能在商城购买数字专辑后，才能收听下载</td>
</tr>
<tr>
<td>8</td>
<td>128K</td>
<td>普通用户可免费收听128k音质，但不能下载；会员可收听和下载所有音质</td>
</tr>
<tr>
<td>16</td>
<td>只能付费下载</td>
<td>普通用户只能付费下载后使用，不提供在线收听；会员只能下载后使用，不能在线收听</td>
</tr>
<tr>
<td>32</td>
<td>只能付费播放</td>
<td>普通用户只能付费后收听，不能下载；会员可以直接收听，但不能下载</td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>code</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>请求正常</td>
</tr>
<tr>
<td>400</td>
<td>参数错误</td>
</tr>
<tr>
<td>500</td>
<td>系统错误</td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>subcode</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>有返回数据</td>
</tr>
<tr>
<td>10007</td>
<td>资源不存在</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": "200",
  "message": null,
  "data": [
    {
      "id": "0ACE1D9BB5D16A2249ECD8DF64F0D267",
      "name": "愿与愁",
      "duration": 231586,
      "artists": [
        {
          "id": "63A823195B2CE23512D08E44099319C0",
          "name": "林俊杰"
        }
      ],
      "album": {
        "id": "E4D881F6FB40C6F8B9E154B6B61A7A6D",
        "name": "愿与愁"
      },
      "playFlag": false,
      "downloadFlag": false,
      "payPlayFlag": true,
      "payDownloadFlag": true,
      "vipFlag": true,
      "liked": false,
      "coverImgUrl": "http://p1.music.126.net/vtnI8JpimWnZSzkXdmIB3w==/109951168558210782.jpg",
      "vipPlayFlag": true,
      "accompanyFlag": null,
      "songMaxBr": 999000,
      "userMaxBr": 0,
      "maxBrLevel": "hires",
      "plLevel": "none",
      "dlLevel": "none",
      "songTag": [
        "流行",
        "华语流行"
      ],
      "privateCloudSong": false,
      "freeTrailFlag": true,
      "songFtFlag": false,
      "freeTrialPrivilege": {
        "cannotListenReason": 1,
        "resConsumable": false,
        "userConsumable": false
      },
      "songFee": 1,
      "playMaxbr": 999000,
      "qualities": [
        "vividMusic",
        "skMusic",
        "jyEffectMusic",
        "hrMusic",
        "sqMusic",
        "hmusic",
        "mmusic",
        "lmusic"
      ],
      "emotionTag": null,
      "visible": true
    }
  ]
}
```

## 获取歌词

- docId：`803202bd65bc469587d05b507dcd31e7`
- 来源：https://developer.music.163.com/st/developer/document?docId=803202bd65bc469587d05b507dcd31e7

## 获取歌词


### /openapi/music/basic/song/lyric/get/v2


```text
逐行歌词
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songId</td>
<td>是</td>
<td>string</td>
<td>歌曲Id</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/song/lyric/get/v2?bizContent=%7B%22songId%22:%2271E84B3A233C496234D80EE53C48B8E3%22%7D&timestamp=1708587652333&accessToken=wb6c7661e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&sign=KpgegDb6EsjS4Z8qUDIPuxZhgeXuibVkXezHRfgvOa9oRbc%2BrcsjZDAXzvk2PUZUij%2BFS0he4Qcm3ZAu1OImIS7ZVo57BJQeia06VERt8xpyrC3j%2FR64aKGBflg%2FYe9UStu6MGyuRxkaTXZeeXF9JMofvrkVz0k11Q2T8LqV08%2F%2BPds6a8pXQHQLe32aFkxfLh8yGuIFMVDxKPXNoZCRq3It6C5dL8G4yJKiXaPfcdOMZ748gK3lorCSyUjDiFOqRDwZbSqyYBBBa%2B%2BdGBiNV4aIH7lAzjE2%2Fpv4JXogXiYPesP5JM4Ep6QIWmBnjLHWTi6EhrMkI1OwV3S02LfEHQ%3D%3D&appId=a301020000000000746f96a196e52e07&device=%7B%22deviceType%22:%22openapi%22,%22os%22:%22openapi%22,%22appVer%22:%220.1%22,%22channel%22:%22iotapitest%22,%22model%22:%22kys%22,%22deviceId%22:%22357%22,%22brand%22:%22iotapitest%22,%22osVer%22:%228.1.0%22,%22clientIp%22:%22192.168.0.1%22%7D&signType=RSA_SHA256
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songId</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>lyric</td>
<td>String</td>
<td>原版歌词内容（逐行歌词）</td>
</tr>
<tr>
<td>noLyric</td>
<td>Boolean</td>
<td>歌曲是否本身无歌词，true无歌词（纯音乐）、false有歌词</td>
</tr>
<tr>
<td>transLyric</td>
<td>String</td>
<td>翻译歌词</td>
</tr>
<tr>
<td>txtLyric</td>
<td>String</td>
<td>非滚动歌词</td>
</tr>
</tbody>
</table>


### 返回示例


#### 中文歌曲

`{
    "code": 200,
    "subCode": null,
    "message": null,
    "data": {
        "id": 0,
        "lyric": "[by:立酱]\n[00:02.00]编曲：郑楠\n\n[00:13.10]华：怎么了 怎么了\n[00:17.25]一份爱失去了光泽\n[00:20.38]面对面 背对背\n[00:23.60]反复挣扎怎么都痛\n[00:27.01]以为爱坚固像石头\n[00:30.32]谁知一秒钟就碎落\n[00:33.69]难道心痛都要不断打磨\n[00:38.14]纬：抱紧你的我比国王富有\n[00:46.43]曾多么快乐\n[00:50.48]华：失去你的我比乞丐落魄\n[00:59.64]痛多么深刻\n[01:05.98]噢 喔 噢 喔\n[01:11.13]噢 喔 噢 喔\n[01:16.16]纬：谁哭着谁笑着\n[01:22.05]一人分饰两个角色\n[01:25.30]越执迷越折磨\n[01:28.60]回忆还在煽风点火\n[01:32.10]明知往前就会坠落\n[01:35.17]抱着遗憾重返寂寞\n[01:38.43]爱到最后究竟还剩什么\n[01:43.88]纬：抱紧你的我比国王富有\n[01:51.66]曾多么快乐\n[01:56.41]华：失去你的我比乞丐落魄\n[02:04.43]痛多么深刻\n[02:12.30]杨：当一切 结束了 安静了 过去了\n[02:17.77]华：为什么 还拥有 一万个 舍不得\n[02:24.34]合：喔 喔\n[02:37.07]谁又能感受\n[02:42.73]回忆里的我比国王富有\n[02:50.04]奢侈的快乐\n[02:55.76]失去你以后比乞丐落魄\n[03:06.05]心痛如刀割\n[03:13.23]怀念那时你安静陪着我\n[03:17.48]噢 噢\n[03:19.77]柔软时光里最美的挥霍\n[03:25.87]喔 喔\n[03:29.54]爱有多快乐\n[03:33.89]痛有多深刻\n[03:40.51]痛有多深刻\n[03:43.20]\n[03:43.30]制作人：郑楠\n[03:43.40]制作助理：王子\n[03:43.50]配唱制作人：翁乙仁\n[03:43.60]录音：刘灵\n[03:43.70]吉他：牛子健\n[03:43.80]鼓：贝贝\n[03:43.90]贝斯：韩阳\n[03:43.92]和声编写 / 和声：余昭源\n[03:43.94]混音：Craig Burbidge\n[03:43.96]弦乐：国际首席爱乐乐团\n[03:43.97]弦乐编写：郑楠\n[03:43.98]录音棚：Big J Studio & TweakToneLabs\n[03:44.40]词OP：上海天娱传媒有限公司\n[03:45.70]曲OP：上海天娱传媒有限公司",
        "noLyric": false,
        "transLyric": null,
        "txtLyric": "怎么了 怎么了\n一份爱失去了光泽\n面对面 背对背\n反复挣扎怎么都痛\n以为爱坚固像石头\n谁知一秒钟就碎落\n难道心痛都要不断打磨\n抱紧你的我比国王富有\n曾多么快乐\n失去你的我比乞丐落魄\n痛多么深刻\n噢 喔 噢 喔\n噢 喔 噢 喔\n谁哭着谁笑着\n一人分饰两个角色\n越执迷越折磨\n回忆还在煽风点火\n明知往前就会坠落\n抱着遗憾重返寂寞\n爱到最后究竟还剩什么\n抱紧你的我比国王富有\n曾多么快乐\n失去你的我比乞丐落魄\n痛多么深刻\n当一切 结束了 安静了 过去了\n为什么 还拥有 一万个 舍不得\n喔 喔\n谁又能感受\n回忆里的我比国王富有\n奢侈的快乐\n失去你以后比乞丐落魄\n心痛如刀割\n怀念那时你安静陪着我\n噢 噢\n柔软时光里最美的挥霍\n喔 喔\n爱有多快乐\n痛有多深刻\n痛有多深刻"
    }
}
`

#### 英文歌曲带翻译

`{
    "code": 200,
    "subCode": null,
    "message": null,
    "data": {
        "id": 0,
        "songId": "71E84B3A233C496234D80EE53C48B8E3",
        "lyric": "[00:00.000] 作词 : Taylor Swift\n[00:01.000] 作曲 : Taylor Swift\n[00:15.840]We were both young when I first saw you\n[00:19.680]I close my eyes and the flashback starts\n[00:23.140]I'm standing there\n[00:26.440]On a balcony in summer air\n[00:31.940]See the lights see the party the ball gowns\n[00:36.030]see you make your way through the crowd\n[00:39.290]And say hello\n[00:42.600]Little did I know\n[00:47.860]That you were Romeo you were throwing pebbles\n[00:51.610]And my daddy said stay away from Juliet\n[00:55.410]And I was crying on the staircase\n[00:58.200]Begging you please don't go\n[01:02.710]And I said\n[01:04.220]Romeo take me somewhere we can be alone\n[01:08.350]I'll be waiting all there's left to do is run\n[01:12.260]You'll be the prince and I'll be the princess\n[01:16.320]It's a love story\n[01:18.350]Baby just say yes\n[01:24.340]So I sneak out to the garden to see you\n[01:28.350]We keep quiet cause we're dead if they knew\n[01:31.610]So close your eyes\n[01:34.900]Escape this town for a little while\n[01:38.390]Oh oh\n[01:40.550]Cause you were Romeo I was  a scarlet letter\n[01:44.000]And my daddy said stay away from Juliet\n[01:47.820]But you were everything to me\n[01:50.090]I was begging you please don't go\n[01:55.130]And I said\n[01:56.720]Romeo take me somewhere we can be alone\n[02:00.720]I'll be waiting all there's left to do is run\n[02:04.750]You'll be the prince and I'll be the princess\n[02:08.720]It's a love story\n[02:10.810]Baby just say yes\n[02:12.770]Romeo save me\n[02:14.590]They’re trying to tell me how to feel\n[02:17.070]This love is difficult but it's real\n[02:20.890]Don't be afraid we'll make it out of this mess\n[02:24.880]It's a love story\n[02:26.890]Baby just say yes\n[02:31.890]Oh oh\n[02:44.080]I got tired of waiting\n[02:48.000]Wondering if you were ever coming around\n[02:51.910]My faith in you was fading\n[02:56.770]When I met you on the outskirts of town\n[02:59.980]And I said\n[03:01.160]Romeo save me\n[03:03.260]I've been feeling so alone\n[03:05.240]I keep waiting for you but you never come\n[03:09.070]Is this in my head\n[03:10.850]I don't know what to think\n[03:12.810]He knelt to the ground and pulled out a ring\n[03:16.600]And said\n[03:17.300]Marry me Juliet you'll never have to be alone\n[03:21.360]I love you and that's all I really know\n[03:25.440]I talked to your dad\n[03:26.940]Go pick out a white dress\n[03:29.440]It's a love story\n[03:31.410]Baby just say yes\n[03:36.700]Oh oh oh\n[03:40.440]Oh oh oh oh\n[03:45.390]'Cause we were both young when I first saw you\n",
        "noLyric": false,
        "transLyric": "[00:15.840]第一次见到你的时候我们都还很年轻\n[00:19.680]我闭上眼睛 我们的故事在我脑海里一幕幕回放\n[00:23.140]我站在那里\n[00:26.440]炎炎夏日的阳台上\n[00:31.940]看着这些灯光，派对和舞会礼服\n[00:36.030]我看见你穿过拥挤的人群\n[00:39.290]向我打招呼\n[00:42.600]我却一无所知\n[00:47.860]你就是罗密欧，你扔石子（敲打窗户来找我）\n[00:51.610]我爸爸说：“离朱丽叶远点”\n[00:55.410]我在楼梯上不停地哭泣\n[00:58.200]心中乞求你不要离开\n[01:02.710]我说\n[01:04.220]罗密欧，带我去一个我们能单独相处的地方吧\n[01:08.350]我等待着这一天，只有逃离才能让我们摆脱束缚\n[01:12.260]你会成为王子，而我也将会是公主\n[01:16.320]这是一个爱情故事\n[01:18.350]亲爱的，你只需答应我\n[01:24.340]于是，我偷偷地到花园去见你\n[01:28.350]我们保持低调因为如果被他们知道的话我们就死定了\n[01:31.610]所以请闭上你的眼睛\n[01:34.900]逃避尘世 即使如此短暂的一刻\n[01:38.390]oh oh\n[01:40.550]因为你是罗密欧，世俗不允许我们相恋\n[01:44.000]我爸爸说：“离朱丽叶远点”\n[01:47.820]但是你就是我的一切\n[01:50.090]心中乞求你不要离开\n[01:55.130]然后我说\n[01:56.720]罗密欧，带着我去一个只有我们两个人的地方吧\n[02:00.720]我等待着这一天，只有逃离才能让我们摆脱束缚\n[02:04.750]你会成为我的王子，而我也将会是你的公主\n[02:08.720]这是一个爱情故事\n[02:10.810]亲爱的，你只需答应我\n[02:12.770]罗密欧，拯救我\n[02:14.590]他们总在试图左右我的思想\n[02:17.070]这种的爱是困难的，但它是真实的\n[02:20.890]别害怕，我们终究会冲破困境\n[02:24.880]这就是我们的爱情\n[02:26.890]亲爱的，你只需答应我\n[02:31.890]Oh oh\n[02:44.080]我厌倦了等待\n[02:48.000]怀疑你是否会如期出现在我的面前\n[02:51.910]曾经坚定的信念开始动摇\n[02:56.770]当我在城郊与你相会\n[02:59.980]我说\n[03:01.160]罗密欧，救救我\n[03:03.260]孤独的感觉一直缠绕着我\n[03:05.240]我一直在等你，而你却沓然无踪\n[03:09.070]我的脑海里\n[03:10.850]一片空白\n[03:12.810]他跪在地上，并掏出一枚钻戒\n[03:16.600]对我说\n[03:17.300]嫁给我吧 朱丽叶，我不会再让你感到孤单\n[03:21.360]我知道我一直深爱着你\n[03:25.440]我和你的爸爸谈话了\n[03:26.940]快去挑选一件洁白的婚纱\n[03:29.440]这是一个爱情故事\n[03:31.410]宝贝，你只需答应我\n[03:36.700]Oh oh oh\n[03:40.440]Oh oh oh oh\n[03:45.390]因为当我第一次见到你的时候我们都还很年轻",
        "txtLyric": "We  were  both  young  when  I  first  saw  you\nI  closed  my  eyes  and  the  flashback  starts\nI'm  standing  there\nOn  a  balcony  in  summer  air\nSee  the  lights  see  the  party  the  ball  gowns\nI  see  you  make  your  way  through  the  crowd\nAnd  say  hello\nLittle  did  I  know\nThat  you  were  Romeo  you  were  throwing  pebbles\nAnd  my  daddy  said  stay  away  from  Juliet\nAnd  I  was  crying  on  the  staircase\nBegging  you  please  don't  go\nAnd  I  said\nRomeo  take  me  somewhere  we  can  be  alone\nI'll  be  waiting  all  there's  left  to  do  is  run\nYou'll  be  the  prince  and  I'll  be  the  princess\nIt's  a  love  story\nBaby  just  say  yes\nSo  I  sneak  out  to  the  garden  to  see  you\nWe  keep  quiet  cause  we're  dead  if  they  knew\nSo  close  your  eyes\nEscape  this  town  for  a  little  while\nOh  oh\nCause  you  were  Romeo  I  was  the  scarlet  letter\nAnd  my  daddy  said  stay  away  from  Juliet\nBut  you  were  my  everything  to  me\nI  was  begging  you  please  don't  go\nAnd  I  said\nRomeo  take  me  somewhere  we  can  be  alone\nI'll  be  waiting  all  there's  left  to  do  is  run\nYou'll  be  the  prince  and  I'll  be  the  princess\nIt's  a  love  story\nBaby  just  say  yes\nRomeo  save  me\nThey  try  to  tell  me  how  I  feel\nThis  love  is  difficult  but  it's  real\nDon't  be  afraid  we'll  make  it  out  of  this  mess\nIt's  a  love  story\nBaby  just  say  yes\nOh  oh\nI  got  tired  of  waiting\nWondering  if  you  were  ever  coming  around\nMy  faith  in  you  is  fading\nWhen  I  met  you  on  the  outskirts  of  town\nAnd  I  said\nRomeo  save  me\nI've  been  feeling  so  alone\nI  keep  waiting  for  you  but  you  never  come\nIs  this  in  my  head\nI  don't  know  what  to  think\nHe  knelt  to  the  ground  and  pulled  out  a  ring\nAnd  said\nMarry  me  Juliet  you'll  never  have  to  be  alone\nI  love  you  and  that's  all  I  really  know\nI  talked  to  your  dad\nGo  pick  out  a  white  dress\nIt's  a  love  story\nBaby  just  say  yes\nOh  oh  oh\nOh  oh  oh  oh\n'Cause  we  were  both  young  when  I  first  saw  you\n"
    }
}
`

#### 纯音乐

`{
    "code": 200,
    "subCode": null,
    "message": null,
    "data": {
        "id": 0,
        "songId": "EB9F22F8692D615C3E4DEF9AC6543E0F",
        "lyric": "",
        "noLyric": true,
        "transLyric": null,
        "txtLyric": "",
        "romalrc": null
    }
}
`

## 全曲试听改版

- docId：`2863fdc2ce2047c2bfcee49f1b6c65e6`
- 来源：https://developer.music.163.com/st/developer/document?docId=2863fdc2ce2047c2bfcee49f1b6c65e6

### 历史接入


会员可针对channel和uid配置加白名单，也可全量


```text
全曲试听播放逻辑
    playflag = false 不可播放
    visible = true 有版权
    resConsumable=true
    userConsumable= true
```


### 新流程：


开放平台针对appid管控playflag的值


```text
playflag试听情况下，支持默认设置为true，试听歌曲默认可播，
        也可保留历史判断逻辑 playflag=false,结合 resConsumable和userConsumable
试听标签的判断可以通过判断：
resConsumable=true
userConsumable= true
```


#### 1：查询接口：场景值入参保持不变或者不传


#### 2：歌曲信息接口返回新增字段：


```text
接入方透传即可：
openApiTraceInfo
{
    "trialMode":"hdshjashjasjhdczxbjczb"
}
```


#### 3：已下发透传字段接口：


<table>
<thead>
<tr>
<th>接口名</th>
<th>接口</th>
</tr>
</thead>
<tbody>
<tr>
<td>获取歌曲详情</td>
<td>/openapi/music/basic/song/detail/get/v2</td>
</tr>
<tr>
<td>获取歌曲播放url</td>
<td>/openapi/music/basic/song/playurl/get/v2</td>
</tr>
<tr>
<td>批量获取歌曲播放url，不对入参做过滤且无播放链接时直接返回null</td>
<td>/openapi/music/basic/batch/song/playurl/get</td>
</tr>
<tr>
<td>批量获取歌曲信息列表</td>
<td>/openapi/music/basic/song/list/get/v2</td>
</tr>
</tbody>
</table>


#### 4：数据回传


需要在回传接口新增字段trialMode，透传歌曲信息中拿到的值


<table>
<thead>
<tr>
<th>接口名</th>
<th>接口</th>
</tr>
</thead>
<tbody>
<tr>
<td>第三方播放数据回传的埋点</td>
<td>/openapi/music/basic/play/data/record</td>
</tr>
<tr>
<td>批量回传用户播放数据</td>
<td>/openapi/music/basic/batch/play/data/record</td>
</tr>
</tbody>
</table>

## 获取歌曲音质（新版）

- docId：`548179f7ecbc417d8acd35d604aea3c9`
- 来源：https://developer.music.163.com/st/developer/document?docId=548179f7ecbc417d8acd35d604aea3c9

## 获取歌曲音质（新版）


### /openapi/music/basic/song/music/quality/sound/sp/get


```text
sdk：com.netease.cloudmusic.iotsdk.repository.music.song.SongDataSource#getSongQualitiesSp
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songId</td>
<td>是</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/song/music/quality/sound/sp/get?appId=a301020000000000746f96a196e52e07&device=%7B%22deviceType%22:%22andrcar%22,%22os%22:%22andrcar%22,%22appVer%22:%220.1%22,%22channel%22:%22didi%22,%22model%22:%22kys%22,%22deviceId%22:%22357%22,%22brand%22:%22didi%22,%22osVer%22:%228.1.0%22,%22clientIp%22:%22192.168.0.1%22%7D&bizContent=%7B%22songId%22:%22F888146F7F363DC188014EFE00829A1C%22%7D&accessToken=wb6c762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&timestamp=1689239715482&sign=ISWZssiRlzMgsmtX4y6ekUnKpmAyNsMMneFOAJCjwu41WwRigRbVQA%2BS%2BTgmt2GVICCIK3GboyBpTfh8E1eRShfVPGHPZ6GoSU%2ByjTOjZ69ew9nuFjSnNNYazLHHouvVFyWmNZvQyrN21wFx1zsDBVzP3UWzzqYIYFMxn74edr0RU0XOJCgjUnhGOMmkIP%2B5WraEaOMT9yQ%2Fn2IUOgacaSaaSG9ZLigSmmqvozRiK%2B5HV2iOUGL3%2F%2FS2ZTho%2BS%2Fywf9qbPpB6U8UlpyJHxhD%2FLWpiYRdS9BySYBLLr9%2FjgVcz885qQdK5F1uh1KtRH3YiC4bB43IZ1a7JVUfHKlE6Q%3D%3D&signType=RSA_SHA256
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>vividMusic</td>
<td>MusicQualityDataVO</td>
<td>Audio Vivid</td>
</tr>
<tr>
<td>dolbyMusic</td>
<td>MusicQualityDataVO</td>
<td>杜比全景声</td>
</tr>
<tr>
<td>skMusic</td>
<td>MusicQualityDataVO</td>
<td>沉浸环绕声</td>
</tr>
<tr>
<td>jyMasterMusic</td>
<td>MusicQualityDataVO</td>
<td>超清母带</td>
</tr>
<tr>
<td>jyEffectMusic</td>
<td>MusicQualityDataVO</td>
<td>高清臻音</td>
</tr>
<tr>
<td>hrMusic</td>
<td>MusicQualityDataVO</td>
<td>hi-res</td>
</tr>
<tr>
<td>sqMusic</td>
<td>MusicQualityDataVO</td>
<td>无损</td>
</tr>
<tr>
<td>hmusic</td>
<td>MusicQualityDataVO</td>
<td>极高</td>
</tr>
<tr>
<td>mmusic</td>
<td>MusicQualityDataVO</td>
<td>较高</td>
</tr>
<tr>
<td>lmusic</td>
<td>MusicQualityDataVO</td>
<td>标准</td>
</tr>
</tbody>
</table>


**MusicQualityDataVO**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>size</td>
<td>Long</td>
<td>歌曲大小</td>
</tr>
<tr>
<td>extension</td>
<td>String</td>
<td>音频格式</td>
</tr>
<tr>
<td>bitrate</td>
<td>Long</td>
<td>比特率</td>
</tr>
<tr>
<td>playTime</td>
<td>Long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>md5</td>
<td>String</td>
<td>文件md5</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>音质</td>
</tr>
<tr>
<td>iconList</td>
<td>List<QualityIconDetailVO></td>
<td>音质图标列表</td>
</tr>
<tr>
<td>sqPrivilege</td>
<td>SongQualitySpVO</td>
<td>音质权限信息</td>
</tr>
</tbody>
</table>


**QualityIconDetailVO**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>iconUrl</td>
<td>String</td>
<td>icon地址</td>
</tr>
<tr>
<td>iconType</td>
<td>String</td>
<td>icon类型</td>
</tr>
<tr>
<td>iconType</td>
<td>Integer</td>
<td>宽</td>
</tr>
<tr>
<td>height</td>
<td>Integer</td>
<td>高</td>
</tr>
</tbody>
</table>


**SongQualitySpVO**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>该音质用户是否可播</td>
</tr>
<tr>
<td>canPlayVips</td>
<td>List<String></td>
<td>可播放的会员身份，该字段主要用于展示icon，客户端可挑选当前端支持的会员身份展示icon</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "sqMusic": null,
    "hrMusic": null,
    "dolbyMusic": null,
    "jyMasterMusic": null,
    "jyEffectMusic": null,
    "skMusic": {
      "name": null,
      "id": 15824096662,
      "size": 19525203,
      "extension": null,
      "sr": 44100,
      "dfsId": 15824096662,
      "bitrate": 894660,
      "playTime": 174564,
      "volumeDelta": -4.2958,
      "md5": "d1af251104d1093753661fa4f413437d",
      "dolbyType": null,
      "peak": 0,
      "level": "sky",
      "iconUrl": null,
      "iconList": [
        {
          "iconUrl": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/56404800457/3434/9865/3069/2483bd6d66b7103a88d7efccb79a853e.png",
          "iconType": "VIP",
          "width": 120,
          "height": 48
        }
      ],
      "sqPrivilege": {
        "playFlag": false,
        "canPlayVips": [
          "svip"
        ]
      }
    },
    "vividMusic": {
      "name": null,
      "id": 15814912159,
      "size": 18156761,
      "extension": null,
      "sr": 44100,
      "dfsId": 15814912159,
      "bitrate": 832042,
      "playTime": 174568,
      "volumeDelta": 78,
      "md5": "fb67f6b9903c70d6c4dbf11b36205866",
      "dolbyType": null,
      "peak": 0,
      "level": null,
      "iconUrl": null,
      "iconList": [
        {
          "iconUrl": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/56404800457/3434/9865/3069/2483bd6d66b7103a88d7efccb79a853e.png",
          "iconType": "VIP",
          "width": 120,
          "height": 48
        }
      ],
      "sqPrivilege": {
        "playFlag": false,
        "canPlayVips": [
          "svip"
        ]
      }
    },
    "mmusic": {
      "name": null,
      "id": 15785519883,
      "size": 4191129,
      "extension": "mp3",
      "sr": 44100,
      "dfsId": 0,
      "bitrate": 192000,
      "playTime": 174602,
      "volumeDelta": -22509,
      "md5": null,
      "dolbyType": null,
      "peak": null,
      "level": null,
      "iconUrl": null,
      "iconList": [
        {
          "iconUrl": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/56404786678/3313/558f/f677/ca1818751116de79caf41398e4f22b54.png",
          "iconType": "VIP",
          "width": 108,
          "height": 48
        }
      ],
      "sqPrivilege": {
        "playFlag": true,
        "canPlayVips": [
          "svip",
          "blackvip",
          "singvip",
          "novip"
        ]
      }
    },
    "lmusic": {
      "name": null,
      "id": 15785519889,
      "size": 2794101,
      "extension": "mp3",
      "sr": 44100,
      "dfsId": 0,
      "bitrate": 128000,
      "playTime": 174602,
      "volumeDelta": -20829,
      "md5": null,
      "dolbyType": null,
      "peak": null,
      "level": null,
      "iconUrl": null,
      "iconList": null,
      "sqPrivilege": {
        "playFlag": true,
        "canPlayVips": [
          "svip",
          "blackvip",
          "singvip",
          "novip"
        ]
      }
    },
    "hmusic": {
      "name": null,
      "id": 15785519890,
      "size": 6985187,
      "extension": "mp3",
      "sr": 44100,
      "dfsId": 0,
      "bitrate": 320000,
      "playTime": 174602,
      "volumeDelta": -25082,
      "md5": null,
      "dolbyType": null,
      "peak": null,
      "level": null,
      "iconUrl": null,
      "iconList": [
        {
          "iconUrl": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/56404786678/3313/558f/f677/ca1818751116de79caf41398e4f22b54.png",
          "iconType": "VIP",
          "width": 108,
          "height": 48
        }
      ],
      "sqPrivilege": {
        "playFlag": true,
        "canPlayVips": [
          "svip",
          "blackvip",
          "singvip",
          "novip"
        ]
      }
    }
  }
}
```

## 获取逐字歌词

- docId：`ac69c8c9c1b04a7f8704d6ccb78580dc`
- 来源：https://developer.music.163.com/st/developer/document?docId=ac69c8c9c1b04a7f8704d6ccb78580dc

## 获取逐字歌词


### /openapi/music/basic/song/lyric/word/by/word/get


```text
并非所有歌曲都有逐字歌词(大约头部几百万歌曲有)，逐字词库会逐渐丰富
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songId</td>
<td>是</td>
<td>String</td>
<td>歌曲id</td>
</tr>
</tbody>
</table>


#### 请求示例：


```text
https://openapi.music.163.com/openapi/music/basic/song/lyric/word/by/word/get?appId=a301020000000000746f96a196e52e07&signType=RSA_SHA256&timestamp=1666766431080&device={"deviceType":"andrcar","os":"andrcar","appVer":"0.1","channel":"didi","model":"kys","deviceId":"357","brand":"didi","osVer":"8.1.0","clientIp":"192.168.0.1"}&accessToken=vbff1ca77af7a69ff8496abbe9df6ee071412ef527510080cl&sign=OL7nt%2FfVJaoMjllfPAe2Ts775Pod3MlEPPSyqM7I0OiKkT4l4dk1a7ILhLCYhsSV4Ks3%2FcByBH7grjScOtduc%2BfY6x2f3P3gt0uUKBNx8kpfTTZl91KkDbhmBLmoD3EIuaLE0QYSKhaCcSwZulh4ORNC6owfEZt3HwFciO1ZlvM9otkKqu5Ey5h%2FrtlM4%2FISUt6hRqumR82vFEZstoufFpwkeh8Jt8W6ehY8SH1xFW0FyRCeH8Qkbi5NQ6b8QdNsnJt%2Bu437CPO3R9qMG4JFYWmvUXBoQDkm9opubRiq0fw2YMnJGFwNas1qWhDL483Qh1bCWxkz%2BGlgkWOchlGKcQ%3D%3D&bizContent={"songId":"72B7093E512B0BE8B5C40CFC05E958C1"}
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>lyrics</td>
<td>List<WordByWordLyricVO></td>
<td>逐字歌词</td>
</tr>
<tr>
<td>ytlrcs</td>
<td>String</td>
<td>翻译歌词lrc格式，时间轴对齐yrc</td>
</tr>
<tr>
<td>lrc</td>
<td>String</td>
<td>逐行歌词</td>
</tr>
<tr>
<td>tlyric</td>
<td>String</td>
<td>逐行翻译歌词</td>
</tr>
</tbody>
</table>


**WordByWordLyricVO**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>start</td>
<td>Long</td>
<td>逐行开始时间，单位：ms</td>
</tr>
<tr>
<td>duration</td>
<td>Long</td>
<td>持续时间，单位：ms</td>
</tr>
<tr>
<td>words</td>
<td>List<YrcWordVO>></td>
<td>歌词信息</td>
</tr>
</tbody>
</table>


**YrcWordVO**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>suspend</td>
<td>Long</td>
<td>逐字开始时间，单位：ms</td>
</tr>
<tr>
<td>duration</td>
<td>Long</td>
<td>持续时间，单位：ms</td>
</tr>
<tr>
<td>words</td>
<td>String</td>
<td>歌词</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "lyrics": [
      {
        "start": 0,
        "duration": 1000,
        "words": [
          {
            "suspend": 0,
            "duration": 1000,
            "words": " 作词 : L. Danielsson/Lazonate Franklin/Lady Gaga/Rodney Jerkins/Beyoncé Knowles"
          }
        ]
      },
      {
        "start": 1000,
        "duration": 1000,
        "words": [
          {
            "suspend": 1000,
            "duration": 1000,
            "words": " 作曲 : L. Danielsson/Lazonate Franklin/Lady Gaga/Rodney Jerkins/Beyoncé Knowles"
          }
        ]
      }
    ],
    "ytlrcs": "[00:07.880]嗨,宝贝,你打的电话我听不到。\n[00:11.930]你知道的,我在酒吧里收不到信号\n[00:15.920]什么?你说什么\n[00:17.450]哦,信号断断续续的，\n[00:19.700]抱歉,我听不清楚你在说什么.我有点儿忙\n[00:23.480]有点忙  有点忙\n[00:27.530]抱歉,我听不清楚你在说什么.我有点儿忙\n[00:31.520]等一下,他们现在正在放我最喜欢的歌\n[00:35.360]我手里拿着饮料所以就不能给你发信息了\n[00:39.350]你也知道我是自由身了\n[00:41.270]所以你做什么事都该和我商量一下\n[00:43.190]那么现在就停止给我打电话吧\n[00:45.260]因为我在忙\n[00:47.330]别再打来 别再打来了\n[00:49.460]我什么也不要想\n[00:51.620]只要全身心的投入到舞池里\n[00:55.130]别再打来 别再打来了\n[00:57.320]我什么也不要想\n[00:59.630]只要全身心的投入到舞池里\n[01:03.170]呃呃呃呃呃呃呃呃呃...\n[01:05.810]停止给我打电话\n[01:07.610]呃呃呃呃呃呃呃呃呃...\n[01:10.220]我很忙\n[01:11.090]呃呃呃呃呃呃呃呃呃...\n[01:13.610]停止给我打电话\n[01:15.200]呃呃呃呃呃呃呃呃呃...\n[01:18.560]你随时都可以打来,只是不会有人在家\n[01:20.630]我不会接你电话\n[01:22.850]我正在酒吧和那个家伙一起喝着香槟\n[01:24.590]我不会接你电话\n[01:26.720]你随时都可以打来,只是不会有人在家\n[01:28.520]我也不会接电话\n[01:30.710]我正在酒吧和那个家伙一起喝着香槟\n[01:32.450]你也不会得到我的号码\n[01:34.370]宝贝,用这种方法轰炸我的手机\n[01:36.350]不会使我离开你的脚步放慢\n[01:38.540]迅速的穿上外衣,等女友们跟上我的节奏\n[01:42.380]我本应该把电话放在家的\n[01:44.210]而现在它简直像灾难一样\n[01:46.430]不停地响就像有自动拨打它 抱歉,这让我无法接听\n[01:50.330]并不是我不喜欢你,只是我正在参加派对\n[01:53.990]我对我电话响个不停已经感到厌烦了\n[01:57.920]有的时候我甚至感觉自己就像站在中央车站一样\n[02:02.120]今晚我一个电话也不会接,因为我要热舞\n[02:06.020]因为我要跳舞\n[02:08.030]因为我要跳舞\n[02:09.380]今晚一个电话我也不会接,因为我要跳舞\n[02:13.850]别再打 别再打了\n[02:16.010]我什么也不想说\n[02:18.440]只要全身心的投入到舞池里\n[02:21.710]别再打 别再打了\n[02:23.870]我什么也不想说\n[02:26.210]只要全身心的投入到舞池里\n[02:29.570]别再打 别再打了\n[02:31.760]我什么也不想说\n[02:34.040]只要全身心的投入到舞池里\n[02:37.430]别再打 别再打了\n[02:39.590]我什么也不想说\n[02:41.810]只要全身心的投入到舞池里\n[02:45.470]呃呃呃呃呃呃呃呃呃...\n[02:48.020]停止给我打电话\n[02:49.640]呃呃呃呃呃呃呃呃呃...\n[02:52.490]我很忙\n[02:53.660]呃呃呃呃呃呃呃呃呃...\n[02:55.940]停止给我打电话\n[02:57.590]呃呃呃呃呃呃呃呃呃...\n[03:01.010]你随时都可以打来,只是不会有人在家\n[03:03.020]你也不会得到我的号码\n[03:04.940]我正在酒吧和那个家伙一起喝着香槟\n[03:06.860]你也不会得到我的号码\n[03:09.050]你随时都可以打来,只是不会有人在家\n[03:10.790]你也不会得到我的号码\n[03:12.740]我正在酒吧和那个家伙一起喝着香槟\n[03:14.750]你也不会得到我的号码\n[03:17.600]我的电话! 我-我-我的电话!\n[03:20.570]我正在酒吧和那个家伙一起喝着香槟 你不会得到我的号码\n[03:22.640]你也不会得到我的号码\n[03:25.400]我的电话! 我-我-我的电话!\n[03:28.490]我正在酒吧和那个家伙一起喝着香槟 你不会得到我的号码\n[03:30.500]你也不会得到我的号码\n[03:32.810]抱歉,你拨打的号码\n[03:34.820]不在服务\n[03:36.830]请检查号码重新尝试呼叫",
    "lrc": "[00:00.000] 作词 : L. Danielsson/Lazonate Franklin/Lady Gaga/Rodney Jerkins/Beyoncé Knowles\n[00:01.000] 作曲 : L. Danielsson/Lazonate Franklin/Lady Gaga/Rodney Jerkins/Beyoncé Knowles\n[00:07.299]Hello, hello, baby; You called, I can't hear a thing.\n[00:11.020]I have got no service in the club, you see, see…\n[00:15.039]Wha-Wha-What did you say?\n[00:16.610]Oh, you're breaking up on me…\n[00:18.830]Sorry, I cannot hear you, I'm kinda busy.\n[00:22.720]K-kinda busy K-kinda busy\n[00:26.690]Sorry, I cannot hear you, I'm kinda busy.\n[00:30.610]Just a second, it's my favorite song they're gonna play\n[00:34.710]And I cannot text you with a drink in my hand, eh…\n[00:38.510]You shoulda made some plans with me,\n[00:40.520]you knew that I was free.\n[00:42.270]And now you won't stop calling me;\n[00:44.900]I'm kinda busy.\n[00:45.850]\n[00:46.770]Stop callin', stop callin',\n[00:48.500]I don't wanna think anymore!\n[00:51.010]I left my head and my heart on the dance floor.\n[00:54.340]Stop callin', stop callin',\n[00:56.270]I don't wanna talk anymore!\n[00:58.620]I left my head and my heart on the dance floor.\n[01:02.310]Eh, eh, eh, eh, eh, eh, eh, eh, eh…\n[01:05.340]Stop telephonin' me!\n[01:06.600]Eh, eh, eh, eh, eh, eh, eh, eh, eh…\n[01:08.889]I'm busy!\n[01:10.330]Eh, eh, eh, eh, eh, eh, eh, eh, eh…\n[01:13.300]Stop telephonin' me!\n[01:14.700]Eh, eh, eh, eh, eh, eh, eh, eh, eh…\n[01:17.340]\n[01:18.050]Can call all you want, but there's no one home,\n[01:19.770]and you're not gonna reach my telephone!\n[01:21.889]Out in the club, and I'm sippin' that bub,\n[01:23.740]and you're not gonna reach my telephone!\n[01:25.800]Call when you want, but there's no one home,\n[01:27.610]and you're not gonna reach my telephone!\n[01:29.790]Out in the club, and I'm sippin' that bub,\n[01:31.550]and you're not gonna reach my telephone!\n[01:32.990]\n[01:33.760]Boy, the way you blowin' up my phone\n[01:35.530]won't make me leave no faster.\n[01:37.720]Put my coat on faster, leave my girls no faster.\n[01:41.560]I shoulda left my phone at home,\n[01:43.530]'cause this is a disaster!\n[01:45.570]Callin' like a collector -sorry, I cannot answer!\n[01:49.609]Not that I don't like you, I'm just at a party.\n[01:53.340]And I am sick and tired of my phone r-ringing.\n[01:57.100]Sometimes I feel like I live in Grand Central Station.\n[02:00.970]Tonight I'm not takin' no calls, 'cause I'll be dancin'.\n[02:05.600]'Cause I'll be dancin'\n[02:07.100]'Cause I'll be dancin'\n[02:08.930]Tonight I'm not takin' no calls, 'cause I'll be dancin'!\n[02:12.070]\n[02:13.400]Stop callin', stop callin',\n[02:15.019]I don't wanna think anymore!\n[02:17.270]I left my head and my heart on the dance floor.\n[02:20.759]Stop callin', stop callin',\n[02:22.810]I don't wanna talk anymore!\n[02:25.500]I left my head and my heart on the dance floor.\n[02:28.859]Stop callin', stop callin',\n[02:30.720]I don't wanna think anymore!\n[02:33.040]I left my head and my heart on the dance floor.\n[02:36.549]Stop callin', stop callin',\n[02:38.530]I don't wanna talk anymore!\n[02:41.000]I left my head and my heart on the dance floor.\n[02:44.630]Eh, eh, eh, eh, eh, eh, eh, eh, eh…\n[02:47.270]Stop telephonin' me!\n[02:48.609]Eh, eh, eh, eh, eh, eh, eh, eh, eh…\n[02:51.239]I'm busy!\n[02:52.729]Eh, eh, eh, eh, eh, eh, eh, eh, eh…\n[02:55.359]Stop telephonin' me!\n[02:57.000]Eh, eh, eh, eh, eh, eh, eh, eh, eh…\n[02:58.829]\n[03:00.299]Can call all you want, but there's no one home,\n[03:02.060]you're not gonna reach my telephone!\n[03:04.299]'Cause I'm out in the club, and I'm sippin' that bub,\n[03:06.000]and you're not gonna reach my telephone!\n[03:08.100]Call when you want, but there's no one home,\n[03:10.009]and you're not gonna reach my telephone!\n[03:12.030]'Cause I'm out in the club, and I'm sippin' that bub,\n[03:13.889]and you're not gonna reach my telephone!\n[03:15.600]\n[03:16.810]My telephone! M-m-my telephone!\n[03:19.940]'Cause I'm out in the club, and I'm sippin' that bub,\n[03:21.790]and you're not gonna reach my telephone!\n[03:23.979]My telephone! M-m-my telephone!\n[03:27.829]'Cause I'm out in the club, and I'm sippin' that bub,\n[03:29.650]and you're not gonna reach my telephone!\n[03:31.239]\n[03:32.290]We're sorry…the number you have reached\n[03:34.250]is not in service at this time.\n[03:35.949]Please check the number, or try your call again\n[03:38.199]\n[03:39.199]\n",
    "tlyric": "[by:_WHITE_]\n[00:07.299]嗨,宝贝,你打的电话我听不到。\n[00:11.020]你知道的,我在酒吧里收不到信号\n[00:15.039]什么?你说什么\n[00:16.610]哦,信号断断续续的，\n[00:18.830]抱歉,我听不清楚你在说什么.我有点儿忙\n[00:22.720]有点忙  有点忙\n[00:26.690]抱歉,我听不清楚你在说什么.我有点儿忙\n[00:30.610]等一下,他们现在正在放我最喜欢的歌\n[00:34.710]我手里拿着饮料所以就不能给你发信息了\n[00:38.510]你也知道我是自由身了\n[00:40.520]所以你做什么事都该和我商量一下\n[00:42.270]那么现在就停止给我打电话吧\n[00:44.900]因为我在忙\n[00:46.770]别再打来 别再打来了\n[00:48.500]我什么也不要想\n[00:51.010]只要全身心的投入到舞池里\n[00:54.340]别再打来 别再打来了\n[00:56.270]我什么也不要想\n[00:58.620]只要全身心的投入到舞池里\n[01:02.310]呃呃呃呃呃呃呃呃呃...\n[01:05.340]停止给我打电话\n[01:06.600]呃呃呃呃呃呃呃呃呃...\n[01:08.889]我很忙\n[01:10.330]呃呃呃呃呃呃呃呃呃...\n[01:13.300]停止给我打电话\n[01:14.700]呃呃呃呃呃呃呃呃呃...\n[01:18.050]你随时都可以打来,只是不会有人在家\n[01:19.770]我不会接你电话\n[01:21.889]我正在酒吧和那个家伙一起喝着香槟\n[01:23.740]我也不会接电话\n[01:25.800]你随时都可以打来,只是不会有人在家\n[01:27.610]你也不会得到我的号码\n[01:29.790]我正在酒吧和那个家伙一起喝着香槟\n[01:31.550]你不会得到我的号码\n[01:33.760]宝贝,用这种方法轰炸我的手机\n[01:35.530]不会使我离开你的脚步放慢\n[01:37.720]迅速的穿上外衣,等女友们跟上我的节奏\n[01:41.560]我本应该把电话放在家的\n[01:43.530]而现在它简直像灾难一样\n[01:45.570]不停地响就像有自动拨打它 抱歉,这让我无法接听\n[01:49.609]并不是我不喜欢你,只是我正在参加派对\n[01:53.340]我对我电话响个不停已经感到厌烦了\n[01:57.100]有的时候我甚至感觉自己就像站在中央车站一样\n[02:00.970]今晚我一个电话也不会接,因为我要热舞\n[02:05.600]因为我要跳舞\n[02:07.100]因为我要跳舞\n[02:08.930]今晚一个电话我也不会接,因为我要跳舞\n[02:13.400]别再打 别再打了\n[02:15.019]我什么也不想说\n[02:17.270]只要全身心的投入到舞池里\n[02:20.759]别再打 别再打了\n[02:22.810]我什么也不想说\n[02:25.500]只要全身心的投入到舞池里\n[02:28.859]别再打 别再打了\n[02:30.720]我什么也不想说\n[02:33.040]只要全身心的投入到舞池里\n[02:36.549]别再打 别再打了\n[02:38.530]我什么也不想说\n[02:41.000]只要全身心的投入到舞池里\n[02:44.630]呃呃呃呃呃呃呃呃呃...\n[02:47.270]停止给我打电话\n[02:48.609]呃呃呃呃呃呃呃呃呃...\n[02:51.239]我很忙\n[02:52.729]呃呃呃呃呃呃呃呃呃...\n[02:55.359]停止给我打电话\n[02:57.000]呃呃呃呃呃呃呃呃呃...\n[03:00.299]你随时都可以打来,只是不会有人在家\n[03:02.060]你也不会得到我的号码\n[03:04.299]我正在酒吧和那个家伙一起喝着香槟\n[03:06.000]你也不会得到我的号码\n[03:08.100]你随时都可以打来,只是不会有人在家\n[03:10.009]你也不会得到我的号码\n[03:12.030]我正在酒吧和那个家伙一起喝着香槟 你不会得到我的号码\n[03:13.889]你也不会得到我的号码\n[03:16.810]我的电话! 我-我-我的电话!\n[03:19.940]我正在酒吧和那个家伙一起喝着香槟 你不会得到我的号码\n[03:21.790]你也不会得到我的号码\n[03:23.979]我的电话!我-我-我的电话!\n[03:27.829]我正在酒吧和那个家伙一起喝着香槟 你不会得到我的号码\n[03:29.650]你也不会得到我的号码\n[03:32.290]抱歉,你拨打的号码\n[03:34.250]不在服务\n[03:35.949]请检查号码重新尝试呼叫\n"
  }
}
```


无逐字歌词


```text
{
"code": 200,
"subCode": null,
"message": null,
"data": null
}
```

## 获取歌曲详情

- docId：`2f583c5e2d764bbabaa221865f62dbc4`
- 来源：https://developer.music.163.com/st/developer/document?docId=2f583c5e2d764bbabaa221865f62dbc4

## 获取歌曲详情


### /openapi/music/basic/song/detail/get/v2


```text
1、该接口可以拿到播放地址
2、默认最高到hires，如果需要高品质有两种开启方式：
第一种是针对appid全量开始高品质，之后下发的level、maxlevel都是变成jymaster（超清母带），check是否会有影响
第二种是通过extFlags={"hqScene":"normal"}来决定本次请求下发高品质，由接入方决定
vivid需要单独配置
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songId</td>
<td>是</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
<tr>
<td>withUrl</td>
<td>是</td>
<td>Boolean</td>
<td>是否需要播放url</td>
</tr>
<tr>
<td>bitrate</td>
<td>否</td>
<td>Int</td>
<td>播放ur的l码率：128（标准）、320（极高）、999（无损）、1999（Hi-Res）。默认获取用户可收听的最大码率（目前默认值最大无损）</td>
</tr>
<tr>
<td>effects</td>
<td>否</td>
<td>String</td>
<td>支持杜比的音效：eac3（车载用这个）、ac4</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质</td>
</tr>
<tr>
<td>level</td>
<td>否</td>
<td>String</td>
<td>高品质(都需要配置)：vivid（臻音全景声，该音质需要单独配置）、sky（沉浸环绕声）、jymaster（超清母带）、jyeffect（高清臻音），拿不到会自动降级</td>
</tr>
<tr>
<td>immerseType</td>
<td>否</td>
<td>String</td>
<td>sky必传，支持的沉浸声环绕声类型：c51（c51类型）、ste（环绕立体声类型）、aac（aac类型）</td>
</tr>
<tr>
<td>languageFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否返回语种，默认false</td>
</tr>
<tr>
<td>extFlags</td>
<td>否</td>
<td>String</td>
<td>是否获取高品质音源，固定值：{"hqScene":"normal"}；是否获取副歌起止点固定值：{"chorusFlag":true}</td>
</tr>
</tbody>
</table>


- 可以联系云音乐同事全量开通高品质服务，或者自行根据extFlags决定高品质下发

- 原则：音效>音质

- 优先级：杜比全景声>沉浸环绕声>超清母带>高清臻音>hires>无损>极高>标准


```text
传了effects，以effects为主
如果歌曲没有杜比，先看level，再看bitrate，这俩都有枚举值，只有在枚举值对的情况下拿不到指定音质才会自动降级

level枚举值：vivid、dolby、sky、jymaster、jyeffect、hires、lossless、exhigh、standard
bitrate枚举值：128、320、999、1999
```


### 示例


请求标准音质：


{"songId":"xxx","withUrl":"true","bitrate":128}


{"songId":"xxx","withUrl":"true","level":"standard"}


请求极高音质：


{"songId":"xxx","withUrl":"true","bitrate":320}


{"songId":"xxx","withUrl":"true","level":"exhigh"}


请求无损音质：


{"songId":"xxx","withUrl":"true","bitrate":999}


{"songId":"xxx","withUrl":"true","level":"lossless"}


请求hires音质：


{"songId":"xxx","withUrl":"true","bitrate":1999}


{"songId":"xxx","withUrl":"true","level":"hires"}


请求高清臻音音质：


{"songId":"xxx","withUrl":"true","level":"jyeffect"}


请求超清母带音质：


{"songId":"xxx","withUrl":"true","level":"jymaster"}


请求沉浸环绕声：


{"songId":"xxx","withUrl":"true","level":"sky","immerseType":"c51"}
{"songId":"xxx","withUrl":"true","level":"sky","immerseType":"ste"}
{"songId":"xxx","withUrl":"true","level":"sky","immerseType":"aac"}


请求臻音全景声（vivid）：


{"songId":"xxx","withUrl":"true","level":"vivid"}


请求杜比全景声：


{"songId":"xxx","withUrl":"true","effects":"eac3"}


需要副歌点位：


{"songId":"xxx","withUrl":"true","bitrate":999,"extFlags":"{\"chorusFlag\":true}"}


可以自控高品质(仅当前请求生效)：


{"songId":"xxx","withUrl":"true","level":"jyeffect","extFlags":"{\"hqScene":\"normal\"}"}


沉浸环绕声：


```text
一首歌会同时有5.1声道flac、5.1声道aac、和2声道flac，客户端会根据不同的场景和策略去选择用哪个
c51：5.1声道flac
ste：2声道flac
aac：5.1声道aac，m4a格式
==》先用c51，播不了或者觉得文件太大用aac，还是不兼容用ste（低配版沉浸声）
```


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/song/detail/get/v2?bizContent%3d%7b%22artistsId%22%3a%225CF4DA1F06D2AB3AC61AB1A665C7D588%22%2c%22withUrl%22%3a%22false%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>albumName</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>albumId</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>albumArtistId</td>
<td>String</td>
<td>专辑艺人Id</td>
</tr>
<tr>
<td>albumArtistName</td>
<td>String</td>
<td>专辑艺人名</td>
</tr>
<tr>
<td>artistId</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>artistName</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面Url</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放url</td>
</tr>
<tr>
<td>playUrlExpireTime</td>
<td>String</td>
<td>播放url到期时间</td>
</tr>
<tr>
<td>br</td>
<td>int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载歌曲（true，false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>是否vip歌曲</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持片段试听</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>片段试听起止时间，单位：s</td>
</tr>
<tr>
<td>freeTrialPrivilege</td>
<td>FreeTrialPrivilegeVO</td>
<td>全曲试听</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>gain</td>
<td>Float</td>
<td>音频增益</td>
</tr>
<tr>
<td>peak</td>
<td>Float</td>
<td>音频peak</td>
</tr>
<tr>
<td>type</td>
<td>String</td>
<td>文件类型</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>songSize</td>
<td>long</td>
<td>歌曲的大小</td>
</tr>
<tr>
<td>songMd5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>artists</td>
<td>List<SongArtistVo></td>
<td>艺人集合</td>
</tr>
<tr>
<td>fullArtists</td>
<td>List<SongArtistVo></td>
<td>艺人Id</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效信息（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>歌曲音质列表</td>
</tr>
<tr>
<td>vocalFlag</td>
<td>Boolean</td>
<td>是否有干声  false:没有  true 有</td>
</tr>
<tr>
<td>originCoverType</td>
<td>Integer</td>
<td>原唱标签，1:原唱</td>
</tr>
<tr>
<td>payed</td>
<td>SongPrivilegePayedVO</td>
<td>付费信息</td>
</tr>
<tr>
<td>openApiTraceInfo</td>
<td>String</td>
<td>歌曲链路id</td>
</tr>
<tr>
<td>chorusMeta</td>
<td>ChorusMetaVO</td>
<td>副歌信息</td>
</tr>
<tr>
<td>dirty</td>
<td>String</td>
<td>脏标</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**ChorusMetaVO**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>startTime</td>
<td>Long</td>
<td>副歌开始时间，单位：毫秒</td>
</tr>
<tr>
<td>endTime</td>
<td>Long</td>
<td>副歌结束时间，单位：毫秒</td>
</tr>
</tbody>
</table>


**FreeTrail**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>start</td>
<td>Int</td>
<td>试听开始时间</td>
</tr>
<tr>
<td>end</td>
<td>Int</td>
<td>试听结束时间</td>
</tr>
</tbody>
</table>


**FreeTrialPrivilegeVO**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>cannotListenReason</td>
<td>Integer</td>
<td>不可试听原因</td>
</tr>
<tr>
<td>resConsumable</td>
<td>Boolean</td>
<td>资源维度是否支持全曲试听，全曲试听标记大于0为支持</td>
</tr>
<tr>
<td>userConsumable</td>
<td>Boolean</td>
<td>用户维度是否支持全曲试听</td>
</tr>
</tbody>
</table>


**SongArtistVo**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>艺人封面</td>
</tr>
</tbody>
</table>


**maxBrLevel、plLevel、dlLevel、level**


<table>
<thead>
<tr>
<th>值</th>
<th>音质</th>
<th>比特率</th>
</tr>
</thead>
<tbody>
<tr>
<td>vivid</td>
<td>Audio Vivid</td>
<td>无</td>
</tr>
<tr>
<td>dolby</td>
<td>杜比</td>
<td>无</td>
</tr>
<tr>
<td>sky</td>
<td>沉浸环绕声</td>
<td>无</td>
</tr>
<tr>
<td>jymaster</td>
<td>超清母带</td>
<td>待定</td>
</tr>
<tr>
<td>jyeffect</td>
<td>高清臻音</td>
<td>无</td>
</tr>
<tr>
<td>hires</td>
<td>hires</td>
<td>1999</td>
</tr>
<tr>
<td>lossless</td>
<td>无损</td>
<td>999</td>
</tr>
<tr>
<td>exhigh</td>
<td>极高</td>
<td>320</td>
</tr>
<tr>
<td>standard</td>
<td>标准</td>
<td>128</td>
</tr>
<tr>
<td>none</td>
<td>不能播放/下载</td>
<td>0</td>
</tr>
</tbody>
</table>


**songFee**


- 仅关心前4个类型就行


<table>
<thead>
<tr>
<th>值</th>
<th>说明</th>
<th>详细描述</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>免费</td>
<td>免费歌曲</td>
</tr>
<tr>
<td>1</td>
<td>会员</td>
<td>普通用户无法免费收听下载；会员可收听和下载所有音质</td>
</tr>
<tr>
<td>4</td>
<td>数字专辑</td>
<td>所有用户只能在商城购买数字专辑后，才能收听下载</td>
</tr>
<tr>
<td>8</td>
<td>128K</td>
<td>普通用户可免费收听128k音质，但不能下载；会员可收听和下载所有音质</td>
</tr>
<tr>
<td>16</td>
<td>只能付费下载 （已下线）</td>
<td>普通用户只能付费下载后使用，不提供在线收听；会员只能下载后使用，不能在线收听</td>
</tr>
<tr>
<td>32</td>
<td>只能付费播放  （已下线）</td>
<td>普通用户只能付费后收听，不能下载；会员可以直接收听，但不能下载</td>
</tr>
</tbody>
</table>


**SongPrivilegePayedVO**


<table>
<thead>
<tr>
<th>值</th>
<th>类型</th>
<th>详细描述</th>
</tr>
</thead>
<tbody>
<tr>
<td>singlePayed</td>
<td>int</td>
<td>单曲是否付费，默认值0</td>
</tr>
<tr>
<td>albumPayed</td>
<td>int</td>
<td>专辑是否付费，默认值0</td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>subcode</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>有返回数据</td>
</tr>
<tr>
<td>10007</td>
<td>资源不存在</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": "200",
  "message": null,
  "data": {
    "id": "8D7266CE4D59752A18A54A50FBDBE92E",
    "name": "浆果",
    "duration": 267999,
    "albumName": "浆果",
    "albumId": "ADB6FAFC1ECE990E2715900060684390",
    "albumArtistId": "21947BB699F66F7D9E5275AAD91CF551",
    "albumArtistName": "TINY7",
    "artistId": "21947BB699F66F7D9E5275AAD91CF551",
    "artistName": "TINY7",
    "coverImgUrl": "http://p1.music.126.net/BQAY8w9XzOj_j1wZgIsczQ==/109951168247366566.jpg",
    "mvId": "1799F488DF130322BCE566AF636A6FE3",
    "playUrl": "http://m703.music.126.net/20260422151423/a116c7f792a158a0798583284a16424b/jd-musicrep-privatecloud-audio-public/obj/woHCgMKXw6XCmDjDj8Oj/29253378462/b0a5/d1a0/177c/67a4b6448419020f555defc4f7e88880.flac?vuutv=bOV/gSI85CQsbyxGVgrS9d9reIn6NL/3VGg8IIGKX/NjzkHP1ZFVnWo69qbpg1YmauZbxCuCB1WGAYhUbJbJLLDIMB8OgOe0dKlDzY0XaFM=&cdntag=Y2hhbm5lbD1fYm13Jm1hcms9b3NfYW5kcmNhcixxdWFsaXR5X2xvc3NsZXNz",
    "playUrlExpireTime": 1776842063288,
    "br": 718613,
    "playFlag": true,
    "downloadFlag": true,
    "payPlayFlag": false,
    "payDownloadFlag": false,
    "vipFlag": false,
    "vipPlayFlag": false,
    "freeTrailFlag": false,
    "songFtFlag": false,
    "freeTrail": null,
    "freeTrialPrivilege": {
      "cannotListenReason": null,
      "resConsumable": false,
      "userConsumable": false,
      "listenType": null,
      "freeLimitTagType": null
    },
    "playMaxbr": 0,
    "liked": false,
    "songMaxBr": 999000,
    "userMaxBr": 718000,
    "maxBrLevel": "lossless",
    "plLevel": "lossless",
    "dlLevel": "lossless",
    "gain": -8.1577,
    "peak": 0,
    "type": "FLAC",
    "level": "lossless",
    "songSize": 24073544,
    "songMd5": "67a4b6448419020f555defc4f7e88880",
    "songTag": [
      "流行",
      "R&B",
      "当代R&B"
    ],
    "emotionTag": null,
    "artists": [
      {
        "id": "21947BB699F66F7D9E5275AAD91CF551",
        "name": "TINY7",
        "coverImgUrl": null
      }
    ],
    "fullArtists": [
      {
        "id": "21947BB699F66F7D9E5275AAD91CF551",
        "name": "TINY7",
        "coverImgUrl": null
      }
    ],
    "songFee": 8,
    "audioFlag": null,
    "effects": null,
    "privateCloudSong": true,
    "qualities": [
      "vividMusic",
      "skMusic",
      "jyMasterMusic",
      "jyEffectMusic",
      "sqMusic",
      "hmusic",
      "mmusic",
      "lmusic"
    ],
    "language": null,
    "vocalFlag": null,
    "originCoverType": 1,
    "payed": {
      "payed": 1,
      "vipPackagePayed": 1,
      "singlePayed": 0,
      "albumPayed": 0
    },
    "openApiTraceInfo": null,
    "chorusMeta": {
      "startTime": 68281,
      "endTime": 102847
    },
    "dirty": false,
    "visible": true
  }
}
```


```text
{
  "code":200,
  "subCode":"10007",
  "message":"资源不存在",
  "data": null
}
```


### FAQ


1、如何判断歌曲是否已购买


```text
singlePayed == 1 || albumPayed == 1
```


2、如何获取已下线艺人名称


```text
取fullArtists，无id，有名称，说明艺人已下线，只展示名称
已下线艺人、专辑：最稳的是判断id和name同时存在即正常，否则都可以提示未知歌手/专辑
```

# 获取播放地址API

## 获取歌曲播放url

- docId：`3d2c9f695ff24f4ea37611614b7f7856`
- 来源：https://developer.music.163.com/st/developer/document?docId=3d2c9f695ff24f4ea37611614b7f7856

## 获取歌曲播放url


### /openapi/music/basic/song/playurl/get/v2


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?category=api&type=common&docId=iotCommonParam)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songId</td>
<td>是</td>
<td>string</td>
<td>歌曲Id</td>
</tr>
<tr>
<td>bitrate</td>
<td>否</td>
<td>Int</td>
<td>比特率：128（标准）、192（较高）、320（极高）、999（无损）、1999（Hi-Res）。默认320，若不能返回指定比特率则会返回较低的一个</td>
</tr>
<tr>
<td>effects</td>
<td>否</td>
<td>string</td>
<td>支持杜比的音效：eac3、ac4</td>
</tr>
<tr>
<td>level</td>
<td>否</td>
<td>String</td>
<td>高品质：vivid（臻音全景声，该音质需要单独配置）、sky（沉浸环绕声）、jymaster（超清母带）、jyeffect（高清臻音），拿不到会自动降级</td>
</tr>
<tr>
<td>immerseType</td>
<td>否</td>
<td>String</td>
<td>支持的沉浸声环绕声类型：c51（c51类型）、ste（环绕立体声类型）、aac（aac类型）</td>
</tr>
</tbody>
</table>


- 无损以上需要联系云音乐同事开通高品质服务

- 原则：音效>音质

- 优先级：杜比全景声>沉浸环绕声>超清母带>高清臻音>hires>无损>极高>标准


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/song/playurl/get/v2?bizContent=%7B%22songId%22:%22ABA2B0253CBC88DD6532D398F35890B4%22,%22bitrate%22:192%7D&appId=a301010000000000aadb4e5a28b45a67&signType=RSA_SHA256&accessToken=9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd&appSecret=de6882f913d59560c9f37345f4cb0053&device=%7B%22deviceType%22:%22andrwear%22,%22os%22:%22otos%22,%22appVer%22:%220.1%22,%22channel%22:%22hm%22,%22model%22:%22kys%22,%22deviceId%22:%22357%22,%22brand%22:%22hm%22,%22osVer%22:%228.1.0%22%7D&timestamp=1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>url</td>
<td>String</td>
<td>歌曲播放url</td>
</tr>
<tr>
<td>size</td>
<td>Int</td>
<td>歌曲大小</td>
</tr>
<tr>
<td>md5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>br</td>
<td>Int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>试听起止时间，单位：s</td>
</tr>
</tbody>
</table>


- 说明：如果音频时长小于25分钟，播放地址有效期为25分钟；如果音频时长大于25分钟，播放地址有效期为音频时长；

- 车载、电视、手表、音箱已经是1天


**subcode**


<table>
<thead>
<tr>
<th>subcode</th>
<th>提示语</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>有返回播放url数据</td>
<td>正常获取</td>
</tr>
<tr>
<td>10002</td>
<td>获取版权错误，请稍后重试</td>
<td>服务异常</td>
</tr>
<tr>
<td>10003</td>
<td>因合作方要求，请前往手机端收听</td>
<td>当前端无版权</td>
</tr>
<tr>
<td>10004</td>
<td>该歌曲为付费歌曲，请前往手机端购买后收听</td>
<td>需要vip或者单独购买</td>
</tr>
<tr>
<td>10005</td>
<td>未知错误，请稍后重试</td>
<td>未知错误</td>
</tr>
</tbody>
</table>


**FreeTrail**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>start</td>
<td>Int</td>
<td>试听开始时间</td>
</tr>
<tr>
<td>end</td>
<td>Int</td>
<td>试听结束时间</td>
</tr>
</tbody>
</table>


### 返回示例


获取播放地址成功


```text
{
  "code": 200,
  "subCode": "200",
  "message": null,
  "data": {
    "url": "http://m802.music.126.net/20230601192036/4c212981d175c84afdd9c065bec3a226/jd-musicrep-ts/ebd7/04e4/31f0/20cfa4d0d7a0687914ca23d2e61fc159.mp3",
    "size": 1202721,
    "md5": "20cfa4d0d7a0687914ca23d2e61fc159",
    "br": 320012,
    "effects": null,
    "privateCloudSong": false,
    "level": "exhigh",
    "freeTrail": {
      "start": 0,
      "end": 30
    }
  }
}
```


获取播放地址失败


```text
{
    "code": 200,
    "subCode": "10003",
    "message": "因合作方要求，请前往手机端收听",
    "data": {
        "url": null,
        "size": 0,
        "md5": null,
        "br": 0
    }
}
```

## 批量获取歌曲播放url

- docId：`70ada04216d64b0d88e80740dee23a77`
- 来源：https://developer.music.163.com/st/developer/document?docId=70ada04216d64b0d88e80740dee23a77

## 批量获取歌曲播放url


### /openapi/music/basic/batch/song/playurl/get


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?category=api&type=common&docId=iotCommonParam)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songIds</td>
<td>是</td>
<td>List<String></td>
<td>歌曲Id列表,序列化成json String；限制为500个Id及以下</td>
</tr>
<tr>
<td>bitrate</td>
<td>否</td>
<td>Int</td>
<td>比特率：128（标准）、320（极高）、999（无损）、1999（Hi-Res）。默认320，若不能返回指定比特率则会返回较低的一个</td>
</tr>
<tr>
<td>effects</td>
<td>否</td>
<td>string</td>
<td>支持杜比的音效：eac3、ac4</td>
</tr>
</tbody>
</table>


- 长度限制8k，如果songIds太长，需要把参数放到body中

- 最佳实践：


{"bitrate":128,"effects":"eac3","songIds":["E6767DDA85289AA4118775DE0D6BCC32","CB328A27F2D13A4ED57B41534F70330E"]}


### 请求示例：


```text
https://openapi.music.163.com/openapi/music/basic/batch/song/playurl/get?appId=a301020000000000746f96a196e52e07&signType=RSA_SHA256&timestamp=1672815200645&device={"deviceType":"andrcar","os":"andrcar","appVer":"0.1","channel":"didi","model":"kys","deviceId":"357","brand":"didi","osVer":"8.1.0","clientIp":"192.168.0.1"}&bizContent={"songIds":["841E0DEE626146AD07BFF264FAC00C54","03DD6A098D75ADE676488EA2EB8679E7","E3CB8332A5F1281E1D989578666CA69C"],"bitrate":1999}&accessToken=sb68a98eaf073267ef0b854130beaf9aaf221ea794715d2a1a&sign=J78k17USszDAPbf54xzm%2B81tc%2F3rKNuGjvl%2BzIQE48%2FEwVQPG9pRHa8muObIuU8Olq9W8lohVLYBclIgvPrt%2FWx%2FyvKDWZ2Z9fzpjB%2FVRr0TNzf2AiEUOmn7ulA3N4KOOhxlMnSPc2g0jPLUFa2Yem3RcNz74YCcv0AAYweSpKsrnxyiE5zXWVOTF%2FhrCancHdWCoLG1Sbye5KTNvzyckLXhVmEycXRlwIseykEVMe6s24GXT02zIQWucuUnKCk5OHXJatysu2EwxbCGX%2FH63EayNv72XbwkD0q63%2FiXuBMm3eks5tkhmzucbBFbIUIrrSRjK52wuTZHpVY6im16wg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>url</td>
<td>String</td>
<td>歌曲播放url</td>
</tr>
<tr>
<td>size</td>
<td>Int</td>
<td>歌曲大小</td>
</tr>
<tr>
<td>md5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>br</td>
<td>Int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>试听起止时间，单位：s</td>
</tr>
</tbody>
</table>


**level**


<table>
<thead>
<tr>
<th>值</th>
<th>音质</th>
<th>比特率</th>
</tr>
</thead>
<tbody>
<tr>
<td>vivid</td>
<td>Audio Vivid</td>
<td>无</td>
</tr>
<tr>
<td>dobly</td>
<td>杜比</td>
<td>无</td>
</tr>
<tr>
<td>sky</td>
<td>沉浸环绕声</td>
<td>无</td>
</tr>
<tr>
<td>jymaster</td>
<td>超清母带</td>
<td>待定</td>
</tr>
<tr>
<td>jyeffect</td>
<td>高清臻音</td>
<td>无</td>
</tr>
<tr>
<td>hires</td>
<td>hires</td>
<td>1999</td>
</tr>
<tr>
<td>lossless</td>
<td>无损</td>
<td>999</td>
</tr>
<tr>
<td>exhigh</td>
<td>极高</td>
<td>320</td>
</tr>
<tr>
<td>standard</td>
<td>标准</td>
<td>128</td>
</tr>
<tr>
<td>none</td>
<td>不能播放/下载</td>
<td>0</td>
</tr>
</tbody>
</table>


**FreeTrail**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>start</td>
<td>Int</td>
<td>试听开始时间</td>
</tr>
<tr>
<td>end</td>
<td>Int</td>
<td>试听结束时间</td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>code</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>请求正常</td>
</tr>
</tbody>
</table>


<table>
<thead>
<tr>
<th>subcode</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>200</td>
<td>有返回播放url数据</td>
</tr>
<tr>
<td>10002</td>
<td>获取版权错误，请稍后重试</td>
</tr>
<tr>
<td>10003</td>
<td>因合作方要求，请前往手机端收听</td>
</tr>
<tr>
<td>10004</td>
<td>该歌曲为付费歌曲，请前往手机端购买后收听</td>
</tr>
<tr>
<td>10005</td>
<td>未知错误，请稍后重试</td>
</tr>
</tbody>
</table>


### 返回示例


获取播放地址成功


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "id": "E6767DDA85289AA4118775DE0D6BCC32",
      "url": "http://iot202.music.126.net/Yml6PWlvdCZjaGFubmVsPWx4X2dsYXNzZXMmbWFyaz1vc19oYXJkd2FyZSxxdWFsaXR5X3N0YW5kYXJkJnNjZW5lPWhhcmR3YXJl/20251226112834/f46e6df3abd0bf7bf3172557325960f1/jdymusic/obj/wo3DlMOGwrbDjj7DisKw/35850741888/c6d4/6170/1e6d/4c6d22ce1b33b6962fe206b5ce70f853.mp3?cdntag=Yml6PWlvdCZjaGFubmVsPWx4X2dsYXNzZXMmbWFyaz1vc19oYXJkd2FyZSxxdWFsaXR5X3N0YW5kYXJkJnNjZW5lPWhhcmR3YXJl",
      "playUrlExpireTime": 1766634514316,
      "size": 4374189,
      "md5": "4c6d22ce1b33b6962fe206b5ce70f853",
      "br": 128000,
      "effects": null,
      "privateCloudSong": false,
      "level": "standard",
      "freeTrail": null,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false,
        "listenType": null,
        "freeLimitTagType": null
      },
      "duration": 273318,
      "gain": -7.2215,
      "peak": 1,
      "type": "mp3"
    },
    {
      "id": "065C086B43254186B8AE3D11AE063290",
      "url": "http://iot202.music.126.net/Yml6PWlvdCZjaGFubmVsPWx4X2dsYXNzZXMmbWFyaz1vc19oYXJkd2FyZSxxdWFsaXR5X3N0YW5kYXJkJnNjZW5lPWhhcmR3YXJl/20251226112834/a474f98c4d650d8324e8ce724cf7fd0d/jdymusic/obj/wo3DlMOGwrbDjj7DisKw/36308452630/d42b/313e/b821/27c01cfdf3c5b54f79027c2e37ba2bea.mp3?cdntag=Yml6PWlvdCZjaGFubmVsPWx4X2dsYXNzZXMmbWFyaz1vc19oYXJkd2FyZSxxdWFsaXR5X3N0YW5kYXJkJnNjZW5lPWhhcmR3YXJl",
      "playUrlExpireTime": 1766634514316,
      "size": 3826221,
      "md5": "27c01cfdf3c5b54f79027c2e37ba2bea",
      "br": 128002,
      "effects": null,
      "privateCloudSong": false,
      "level": "standard",
      "freeTrail": null,
      "freeTrialPrivilege": {
        "cannotListenReason": null,
        "resConsumable": false,
        "userConsumable": false,
        "listenType": null,
        "freeLimitTagType": null
      },
      "duration": 239112,
      "gain": 4.7785,
      "peak": 0.2467,
      "type": "mp3"
    }
  ]
}
```


获取播放地址失败


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "id": "841E0DEE626146AD07BFF264FAC00C54",
      "url": "http://m701.music.126.net/20230223173942/a7cfb3b0e7660fdb100f3cc79a91cc6b/jdymusic/obj/w5zDlMODwrDDiGjCn8Ky/1548310106/4588/c55f/e4b9/12c092b26f62e1700d62601c6c281737.mp3",
      "size": 2510933,
      "md5": "12c092b26f62e1700d62601c6c281737",
      "br": 320000,
      "effects": null
    },
    {
      "id": "03DD6A098D75ADE676488EA2EB8679E7",
      "url": null,
      "size": 0,
      "md5": null,
      "br": 0,
      "effects": null
    },
    {
      "id": "E3CB8332A5F1281E1D989578666CA69C",
      "url": "http://m801.music.126.net/20230223173942/9d4dcb806fd70bc14c710eb077e68919/jdymusic/obj/wo3DlMOGwrbDjj7DisKw/8613533029/9f32/da33/dcd1/56a402e2db18b15244225404868f1a69.mp3",
      "size": 4210564,
      "md5": "56a402e2db18b15244225404868f1a69",
      "br": 128001,
      "effects": null
    }
  ]
}
```


- 说明：如果音频时长小于25分钟，播放地址有效期为25分钟；如果音频时长大于25分钟，播放地址有效期为音频时长；

## 获取歌曲无法播放toast文案

- docId：`7261533300a645ea99aaf0f860f19dd5`
- 来源：https://developer.music.163.com/st/developer/document?docId=7261533300a645ea99aaf0f860f19dd5

## 获取歌曲无法播放toast文案


### /openapi/music/basic/song/text/play/get/v2


```text
获取的是歌曲的无法播放的兜底提示文案，尽量不用
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?category=api&type=common&docId=iotCommonParam)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songId</td>
<td>是</td>
<td>String</td>
<td>歌曲id</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/song/text/play/get/v2?bizContent%3d%7b%22songId%22%3a%225CF4DA1F06D2AB3AC61AB1A665C7D588%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>message</td>
<td>String</td>
<td>歌曲无法获取toast文案</td>
</tr>
</tbody>
</table>


### 提示文案枚举


<table>
<thead>
<tr>
<th>文案</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>因合作方要求，暂不支持收听，请前往手机端</td>
<td>当前端上无版权</td>
</tr>
<tr>
<td>VIP歌曲，请开通会员；数字专辑，请前往手机端购买</td>
<td>数字专辑</td>
</tr>
<tr>
<td>VIP歌曲，请开通会员；数字专辑，请前往手机端购买</td>
<td>vip歌曲</td>
</tr>
<tr>
<td>因合作方要求，暂不支持收听，请前往手机端</td>
<td>无版权</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": [
    {
      "message": "因合作方要求，暂不支持收听，请前往手机端。"
    }
  ]
}
```

# 文字搜索API

## 获取热搜榜

- docId：`ece9c6aa05544190ad840b2acc2e438e`
- 来源：https://developer.music.163.com/st/developer/document?docId=ece9c6aa05544190ad840b2acc2e438e

## 获取热搜榜


### /openapi/music/basic/search/charts/list/get


![图片](https://p5.music.126.net/Hiw2EzerSBYqibBoMO5XOg==/109951172626902854?imageView&thumbnail=600x600)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>chartCode</td>
<td>否</td>
<td>String</td>
<td>榜单code</td>
</tr>
<tr>
<td>limit</td>
<td>否</td>
<td>Int</td>
<td>获取数据量（最多20条）</td>
</tr>
</tbody>
</table>


- 热搜榜：HOT_SEARCH_SONG#@#

- 最佳实践：


{"limit":"20","chartId":"HOT_SEARCH_SONG#@#"}


### 请求示例：


```text
http://openapi.music.163.com//openapi/music/basic/search/charts/list/get?appId=a301020000000000746f96a196e52e07&timestamp=1749720134811&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&accessToken=2fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&sign=HCVtQ0U2IKvOuvzbeB%2FkQzQSYWZ2jWiVQ9C%2BY4ggd%2FVfmI9CBu2BsxUlVtGv4GQRveyS34xfwGhhvu0GWr9toVCAS8OTicqIpDBUT8O6fsKbvBUl7RlZEEgITsgVfMhlnFaJPJ%2FFyMuHnkw1zjoaIQS%2F6UohqYleUAiA4NVH3HOCtBuQAp6faX%2Ffb7DTFXXl1tenOcoSGMPnYsuqsNMC4fL9MwXSRjZeYoUnI6b97MmFeUY0xm2RoRJQ%2BhGyLz8GA3LLkijd53%2FFtWMp7e%2F7zeWxZi991f9moQtqGDksi22M9S14%2BArn%2FGoTvtG3M25jc06RUCoFTgUC23wbpHqoqg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>iconType</td>
<td>int</td>
<td>icon类型</td>
</tr>
<tr>
<td>rank</td>
<td>int</td>
<td>排行</td>
</tr>
<tr>
<td>searchWord</td>
<td>String</td>
<td>搜索词</td>
</tr>
</tbody>
</table>


### iconType


<table>
<thead>
<tr>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>不显示</td>
</tr>
<tr>
<td>1</td>
<td>热</td>
</tr>
<tr>
<td>2</td>
<td>新</td>
</tr>
<tr>
<td>3</td>
<td>荐</td>
</tr>
<tr>
<td>4</td>
<td>爆</td>
</tr>
<tr>
<td>5</td>
<td>升</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
	"code": 200,
	"subCode": null,
	"message": null,
	"data": {
		"items": [{
			"iconType": "4",
			"rank": 1,
			"searchWord": "一半一半"
		}, {
			"iconType": "0",
			"rank": 2,
			"searchWord": "精卫"
		}, {
			"iconType": "5",
			"rank": 3,
			"searchWord": "我是真的爱上你"
		}, {
			"iconType": "2",
			"rank": 4,
			"searchWord": "泡沫"
		}, {
			"iconType": "5",
			"rank": 5,
			"searchWord": "同手同脚"
		}, {
			"iconType": "5",
			"rank": 6,
			"searchWord": "别怕变老"
		}, {
			"iconType": "0",
			"rank": 7,
			"searchWord": "林俊杰"
		}, {
			"iconType": "0",
			"rank": 8,
			"searchWord": "咏春"
		}, {
			"iconType": "0",
			"rank": 9,
			"searchWord": "失眠"
		}, {
			"iconType": "0",
			"rank": 10,
			"searchWord": "海屿你"
		}, {
			"iconType": "0",
			"rank": 11,
			"searchWord": "如果呢"
		}, {
			"iconType": "0",
			"rank": 12,
			"searchWord": "雨过后的风景"
		}, {
			"iconType": "0",
			"rank": 13,
			"searchWord": "Top Barry"
		}, {
			"iconType": "0",
			"rank": 14,
			"searchWord": "Marry"
		}, {
			"iconType": "0",
			"rank": 15,
			"searchWord": "汪苏泷"
		}, {
			"iconType": "0",
			"rank": 16,
			"searchWord": "离开我的依赖"
		}, {
			"iconType": "0",
			"rank": 17,
			"searchWord": "汤令山"
		}, {
			"iconType": "5",
			"rank": 18,
			"searchWord": "zoo"
		}, {
			"iconType": "0",
			"rank": 19,
			"searchWord": "如果我们不曾相遇"
		}, {
			"iconType": "0",
			"rank": 20,
			"searchWord": "大花轿"
		}]
	}
}
```

## 获取搜索热词

- docId：`11dc8523a53a4e288d8bb056d224878d`
- 来源：https://developer.music.163.com/st/developer/document?docId=11dc8523a53a4e288d8bb056d224878d

## 获取搜索热词


### /openapi/music/basic/search/hot/keyword/get/v2


- 获取到搜索热词


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>获取数据量</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"limit":10}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/search/hot/keyword/get/v2?bizContent%3d%7b%22limit%22%3a%2210%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


Records参数（列表）


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>keyword</td>
<td>String</td>
<td>热词</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
    "code":200,
    "subCode":null,
    "message":null,
    "data":[
        {
            "keyword":"Taylor Swift"
        },
        {
            "keyword":"往下跳"
        },
        {
            "keyword":"天外来物"
        },
        {
            "keyword":"Troye Sivan"
        },
        {
            "keyword":"亚运会歌征集"
        }
    ]
}
```

## 获取搜索提示词

- docId：`45c71d401d6c4eb5bd17d1775f1b8b5e`
- 来源：https://developer.music.163.com/st/developer/document?docId=45c71d401d6c4eb5bd17d1775f1b8b5e

## 获取搜索提示词


### /openapi/music/basic/search/suggest/keyword/get/v2


![图片](https://p5.music.126.net/vgOdCQZPLUOUDEF__miKsg==/109951172627011826?imageView&thumbnail=500x500)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>keyword</td>
<td>是</td>
<td>String</td>
<td>搜索词</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"keyword":"邓"}


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>suggests</td>
<td>List<SuggestKeyword></td>
<td>提示词列表</td>
</tr>
<tr>
<td>recs</td>
<td>List<SuggestKeyword></td>
<td>推荐词列表</td>
</tr>
</tbody>
</table>


#### SuggestKeyword


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>keyword</td>
<td>String</td>
<td>提示词</td>
</tr>
<tr>
<td>highLightInfo</td>
<td>String</td>
<td>高亮信息</td>
</tr>
<tr>
<td>iconUrl</td>
<td>String</td>
<td>提示词前 icon 图片地址</td>
</tr>
<tr>
<td>tagUrl</td>
<td>String</td>
<td>提示词后标签图片地址</td>
</tr>
<tr>
<td>resourceType</td>
<td>String</td>
<td>提示词对应资源类型</td>
</tr>
<tr>
<td>resourceId</td>
<td>String</td>
<td>提示词对应资源 id</td>
</tr>
<tr>
<td>resourceName</td>
<td>String</td>
<td>提示词对应实际资源名称</td>
</tr>
<tr>
<td>showText</td>
<td>String</td>
<td>提示词对应资源展示名称</td>
</tr>
</tbody>
</table>


### 返回结果示例


```text
{
	"code": 200,
	"subCode": null,
	"message": null,
	"data": {
		"suggests": [{
			"keyword": "邓紫棋",
			"highLightInfo": "[{\"text\":\"邓\",\"highLighted\":true},{\"text\":\"紫棋\",\"highLighted\":false}]",
			"iconUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/7828754088/4046/f1c9/6aac/071dbacd4428d7caf41db5d3f824dd93.png",
			"tagUrl": null,
			"resourceType": null,
			"resourceId": "",
			"resourceName": null,
			"showText": null,
			"alg": "alg_suggest_phone_Artist;UserAction;Consume;Album;Song___{}"
		}, {
			"keyword": "邓典 伤心剖半",
			"highLightInfo": "[{\"text\":\"邓\",\"highLighted\":true},{\"text\":\"典 伤心剖半\",\"highLighted\":false}]",
			"iconUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/7828754088/4046/f1c9/6aac/071dbacd4428d7caf41db5d3f824dd93.png",
			"tagUrl": null,
			"resourceType": null,
			"resourceId": "",
			"resourceName": null,
			"showText": null,
			"alg": "alg_suggest_phone_UserAction;ArtistAlias+Song;Artist+Song__Heard_{}"
		}, {
			"keyword": "邓紫棋 唯一",
			"highLightInfo": "[{\"text\":\"邓\",\"highLighted\":true},{\"text\":\"紫棋 唯一\",\"highLighted\":false}]",
			"iconUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/7828754088/4046/f1c9/6aac/071dbacd4428d7caf41db5d3f824dd93.png",
			"tagUrl": null,
			"resourceType": null,
			"resourceId": "",
			"resourceName": null,
			"showText": null,
			"alg": "alg_suggest_phone_UserAction;ArtistAlias+Song;Consume;Artist+Song__Like_{}"
		}, {
			"keyword": "邓丽君",
			"highLightInfo": "[{\"text\":\"邓\",\"highLighted\":true},{\"text\":\"丽君\",\"highLighted\":false}]",
			"iconUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/7828754088/4046/f1c9/6aac/071dbacd4428d7caf41db5d3f824dd93.png",
			"tagUrl": null,
			"resourceType": null,
			"resourceId": "",
			"resourceName": null,
			"showText": null,
			"alg": "alg_suggest_phone_Artist;Consume;Album;Song___{}"
		}, {
			"keyword": "邓诗颖 唯一",
			"highLightInfo": "[{\"text\":\"邓\",\"highLighted\":true},{\"text\":\"诗颖 唯一\",\"highLighted\":false}]",
			"iconUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/7828754088/4046/f1c9/6aac/071dbacd4428d7caf41db5d3f824dd93.png",
			"tagUrl": null,
			"resourceType": null,
			"resourceId": "",
			"resourceName": null,
			"showText": null,
			"alg": "alg_suggest_phone_UserAction;ArtistAlias+Song___{}"
		}, {
			"keyword": "邓佳鑫",
			"highLightInfo": "[{\"text\":\"邓\",\"highLighted\":true},{\"text\":\"佳鑫\",\"highLighted\":false}]",
			"iconUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/7828754088/4046/f1c9/6aac/071dbacd4428d7caf41db5d3f824dd93.png",
			"tagUrl": null,
			"resourceType": null,
			"resourceId": "",
			"resourceName": null,
			"showText": null,
			"alg": "alg_suggest_phone_Artist;Consume;Album___{}"
		}, {
			"keyword": "邓福如",
			"highLightInfo": "[{\"text\":\"邓\",\"highLighted\":true},{\"text\":\"福如\",\"highLighted\":false}]",
			"iconUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/7828754088/4046/f1c9/6aac/071dbacd4428d7caf41db5d3f824dd93.png",
			"tagUrl": null,
			"resourceType": null,
			"resourceId": "",
			"resourceName": null,
			"showText": null,
			"alg": "alg_suggest_phone_Consume___{}"
		}, {
			"keyword": "邓典果DDG",
			"highLightInfo": "[{\"text\":\"邓\",\"highLighted\":true},{\"text\":\"典果DDG\",\"highLighted\":false}]",
			"iconUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/7828754088/4046/f1c9/6aac/071dbacd4428d7caf41db5d3f824dd93.png",
			"tagUrl": null,
			"resourceType": null,
			"resourceId": "",
			"resourceName": null,
			"showText": null,
			"alg": "alg_suggest_phone_Artist;Consume;Album___{}"
		}, {
			"keyword": "邓紫棋 多远都要在一起",
			"highLightInfo": "[{\"text\":\"邓\",\"highLighted\":true},{\"text\":\"紫棋 多远都要在一起\",\"highLighted\":false}]",
			"iconUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/7828754088/4046/f1c9/6aac/071dbacd4428d7caf41db5d3f824dd93.png",
			"tagUrl": null,
			"resourceType": null,
			"resourceId": "",
			"resourceName": null,
			"showText": null,
			"alg": "alg_suggest_phone_UserAction;ArtistAlias+Song;Consume___{}"
		}, {
			"keyword": "邓丽君 我只在乎你",
			"highLightInfo": "[{\"text\":\"邓\",\"highLighted\":true},{\"text\":\"丽君 我只在乎你\",\"highLighted\":false}]",
			"iconUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/7828754088/4046/f1c9/6aac/071dbacd4428d7caf41db5d3f824dd93.png",
			"tagUrl": null,
			"resourceType": null,
			"resourceId": "",
			"resourceName": null,
			"showText": null,
			"alg": "alg_suggest_phone_UserAction;Consume;Artist+Song___{}"
		}],
		"recs": []
	}
}
```

## 根据关键字综合搜索

- docId：`ffd83c003331452d9d0bdb45e8ab1261`
- 来源：https://developer.music.163.com/st/developer/document?docId=ffd83c003331452d9d0bdb45e8ab1261

## 根据关键字综合搜索


### /openapi/music/basic/complex/search


```text
根据关键字返回歌单、歌曲、专辑、艺人、播客等综合结果
```


![图片](https://p5.music.126.net/jDXY4D5HAdiVIFS4-C_tsw==/109951172626963872)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>keyword</td>
<td>是</td>
<td>String</td>
<td>搜索关键字</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质</td>
</tr>
<tr>
<td>identityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否组装艺人身份标签，默认false</td>
</tr>
<tr>
<td>subCountFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否组装粉丝数，默认false</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"keyword":"精卫","identityFlag":"true","subCountFlag":"true"}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/complex/search?bizContent%3d%7b%22keyword%22%3a%22123%22%2c%22limit%22%3a%2210%22%2c%22offset%22%3a%220%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明：


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>bestMatchResources</td>
<td>List<MixResourceVO></td>
<td>最佳匹配资源</td>
</tr>
<tr>
<td>bestMatchResourceTypes</td>
<td>List<String></td>
<td>最佳匹配资源类型</td>
</tr>
<tr>
<td>songs</td>
<td>List<SongListVo></td>
<td>歌曲列表</td>
</tr>
<tr>
<td>artists</td>
<td>List<ArtistVo></td>
<td>艺人列表</td>
</tr>
<tr>
<td>albums</td>
<td>List<AlbumDetailVo></td>
<td>专辑列表</td>
</tr>
<tr>
<td>playlists</td>
<td>List<PlaylistVo></td>
<td>歌单列表</td>
</tr>
<tr>
<td>voicelist</td>
<td>List<PodcastDetailDTO></td>
<td>播单列表</td>
</tr>
</tbody>
</table>


#### MixResourceVO


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>resourceType</td>
<td>String</td>
<td>资源类型</td>
</tr>
<tr>
<td>resource</td>
<td>object</td>
<td>资源详情</td>
</tr>
</tbody>
</table>


#### bestMatchResourceTypes


<table>
<thead>
<tr>
<th>枚举值</th>
<th>资源类型</th>
</tr>
</thead>
<tbody>
<tr>
<td>bestmatch</td>
<td>最佳匹配</td>
</tr>
<tr>
<td>song</td>
<td>歌曲</td>
</tr>
<tr>
<td>playlist</td>
<td>歌单</td>
</tr>
<tr>
<td>voicelist</td>
<td>播单</td>
</tr>
<tr>
<td>album</td>
<td>专辑</td>
</tr>
<tr>
<td>artist</td>
<td>艺人</td>
</tr>
</tbody>
</table>


#### song


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>时长</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>fullArtists</td>
<td>List<Artist></td>
<td>全部艺人列表（包含已下线）</td>
</tr>
<tr>
<td>album</td>
<td>Album</td>
<td>专辑信息</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌曲封面url</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>alg</td>
<td>String</td>
<td>算法推荐使用，播放数据上报接口需透传该字段</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>originCoverType</td>
<td>Int</td>
<td>原唱字段</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**playlist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>creatorAvatarUrl</td>
<td>String</td>
<td>创建者头像</td>
</tr>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>String</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>creatorId</td>
<td>String</td>
<td>歌单创建人Id</td>
</tr>
<tr>
<td>createTime</td>
<td>String</td>
<td>创建时间</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>trackCount</td>
<td>int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>specialType</td>
<td>int</td>
<td>歌单类型</td>
</tr>
<tr>
<td>trackUpdateTime</td>
<td>long</td>
<td>最近更新时间</td>
</tr>
</tbody>
</table>


**voicelist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>long</td>
<td>播单id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>播单名称</td>
</tr>
<tr>
<td>picUrl</td>
<td>String</td>
<td>播单封面url</td>
</tr>
<tr>
<td>playCount</td>
<td>long</td>
<td>播放次数</td>
</tr>
<tr>
<td>programCount</td>
<td>long</td>
<td>节目数</td>
</tr>
<tr>
<td>createTime</td>
<td>long</td>
<td>创建时间（时间戳）</td>
</tr>
<tr>
<td>desc</td>
<td>String</td>
<td>播单简介</td>
</tr>
<tr>
<td>category</td>
<td>String</td>
<td>一级分类</td>
</tr>
<tr>
<td>secondCategory</td>
<td>String</td>
<td>二级分类</td>
</tr>
<tr>
<td>djName</td>
<td>String</td>
<td>创建者</td>
</tr>
<tr>
<td>subscribe</td>
<td>Boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>djName</td>
<td>String</td>
<td>创建者</td>
</tr>
<tr>
<td>fees</td>
<td>List<FeeVO></td>
<td>播单的付费信息，单个播客支持多种付费形式，按照优先级返回</td>
</tr>
<tr>
<td>feeActivity</td>
<td>PodcastFeeActivityVO</td>
<td>付费营销等活动信息</td>
</tr>
<tr>
<td>finishStatus</td>
<td>Integer</td>
<td>完结状态。1：完结；0：连载中。（null代表不存在完结信息）</td>
</tr>
</tbody>
</table>


**Album**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>language</td>
<td>String</td>
<td>专辑语种</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面</td>
</tr>
<tr>
<td>company</td>
<td>String</td>
<td>发行公司</td>
</tr>
<tr>
<td>genre</td>
<td>String</td>
<td>风格流派</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>歌手信息</td>
</tr>
<tr>
<td>transName</td>
<td>String</td>
<td>中文翻译名</td>
</tr>
<tr>
<td>aliaName</td>
<td>String</td>
<td>别名</td>
</tr>
<tr>
<td>briefDesc</td>
<td>String</td>
<td>简要描述</td>
</tr>
<tr>
<td>description</td>
<td>String</td>
<td>详细描述</td>
</tr>
<tr>
<td>publishTime</td>
<td>String</td>
<td>发行时间</td>
</tr>
<tr>
<td>subed</td>
<td>Boolean</td>
<td>是否收藏</td>
</tr>
</tbody>
</table>


**artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
<tr>
<td>transName</td>
<td>String</td>
<td>别名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面</td>
</tr>
<tr>
<td>type</td>
<td>int</td>
<td>艺人类型（3:乐队组合, 1:男歌手, 2:女歌手）</td>
</tr>
<tr>
<td>authMusicianV</td>
<td>Boolean</td>
<td>大V认证</td>
</tr>
<tr>
<td>identity</td>
<td>List<IdentityVO></td>
<td>身份</td>
</tr>
<tr>
<td>roles</td>
<td>List<ExpertIdentityTypeVO></td>
<td>艺人角色信息</td>
</tr>
<tr>
<td>subCount</td>
<td>Long</td>
<td>粉丝数</td>
</tr>
<tr>
<td>briefDesc</td>
<td>String</td>
<td>简要描述</td>
</tr>
<tr>
<td>nationality</td>
<td>String</td>
<td>国家/地区</td>
</tr>
<tr>
<td>musicSize</td>
<td>Int</td>
<td>歌曲数量</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "bestMatchResources": [
      {
        "resourceType": "artist",
        "resource": {
          "id": "4E7401216287BEDF0015EFADB9FF4326",
          "name": "30年前，50年后",
          "transName": null,
          "coverImgUrl": "http://p1.music.126.net/ZUG0iTXPEIXFEYg5LgSxSQ==/109951164537785144.jpg",
          "type": 1,
          "authMusicianV": false,
          "identity": [
            {
              "userType": 4,
              "showName": "网易音乐人"
            },
            {
              "userType": 400,
              "showName": "主播"
            }
          ],
          "roles": null,
          "subCount": 515724,
          "briefDesc": "",
          "nationality": null,
          "musicSize": 66
        }
      },
      {
        "resourceType": "playlist",
        "resource": {
          "id": "59219B4450A8DFB51C7A398D382EAE86",
          "name": "全网超好听热播歌曲300首",
          "coverImgUrl": "http://p1.music.126.net/pC9rszwdC_GtRMeyfv6mAg==/109951171972088936.jpg",
          "describe": "持续更新",
          "creatorNickName": "微雨染尘埃",
          "creatorAvatarUrl": "http://p1.music.126.net/lQX3VabzxU9k57MncIJ6ZA==/109951167531472662.jpg",
          "playCount": 16766606,
          "subscribedCount": 97898,
          "tags": [
            "流行",
            "华语",
            "网络歌曲"
          ],
          "createTime": 1753928055606,
          "subed": false,
          "trackCount": 259,
          "specialType": 0,
          "category": null,
          "allFreeTrialFlag": false,
          "trackUpdateTime": 1769006571836,
          "extMap": {}
        }
      }
    ],
    "bestMatchResourceTypes": [
      "bestmatch",
      "song",
      "playlist",
      "voicelist",
      "album",
      "artist"
    ],
    "songs": [
      {
        "id": "FE637A9417274F4B188AE5D6C9CD4C0F",
        "name": "精卫（万物终归向海）",
        "duration": 140156,
        "artists": [
          {
            "id": "468F1F9A6585F17C11469971D3847927",
            "name": "银翼杀手",
            "coverImgUrl": null
          }
        ],
        "fullArtists": [
          {
            "id": "468F1F9A6585F17C11469971D3847927",
            "name": "银翼杀手",
            "coverImgUrl": null
          }
        ],
        "album": {
          "id": "5B192F29F61101FAD6A7CB0BED563AE7",
          "name": "精卫（万物终归向海）"
        },
        "playFlag": true,
        "downloadFlag": true,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": false,
        "liked": false,
        "coverImgUrl": "http://p1.music.126.net/_9gR27shb_fjyC0NSRxN8g==/109951172492382435.jpg",
        "vipPlayFlag": false,
        "accompanyFlag": null,
        "songMaxBr": 999000,
        "userMaxBr": 999000,
        "maxBrLevel": "vivid",
        "plLevel": "jyeffect",
        "dlLevel": "jyeffect",
        "songTag": null,
        "privateCloudSong": false,
        "freeTrailFlag": false,
        "songFtFlag": false,
        "freeTrialPrivilege": {
          "cannotListenReason": null,
          "resConsumable": false,
          "userConsumable": false,
          "listenType": null,
          "freeLimitTagType": null
        },
        "songFee": 8,
        "playMaxbr": 999000,
        "qualities": null,
        "originCoverType": 2,
        "emotionTag": null,
        "vocalFlag": null,
        "payed": {
          "payed": 1,
          "vipPackagePayed": 1,
          "singlePayed": 0,
          "albumPayed": 0
        },
        "openApiTraceInfo": {
          "trialMode": "DADEA01489D3014467E95DD3C154674E"
        },
        "dirty": false,
        "visible": true
      }
    ],
    "artists": [
      {
        "id": "4E7401216287BEDF0015EFADB9FF4326",
        "name": "30年前，50年后",
        "transName": null,
        "coverImgUrl": "http://p1.music.126.net/ZUG0iTXPEIXFEYg5LgSxSQ==/109951164537785144.jpg",
        "type": 1,
        "authMusicianV": false,
        "identity": [
          {
            "userType": 4,
            "showName": "网易音乐人"
          }
    ],
    "albums": [
      {
        "id": "B50D3F7D6344C4D2F082E8ABDB734790",
        "name": "精卫（戏腔）",
        "language": "国语,纯音乐",
        "coverImgUrl": "http://p1.music.126.net/DRAwf2g65M3a-0xLKQw9jw==/109951168527005053.jpg",
        "company": "",
        "transName": null,
        "aliaName": "",
        "genre": null,
        "artists": [
          {
            "id": "4C4381FE1697D38A7022B5F04D952951",
            "name": "一颗狼星"
          }
        ],
        "briefDesc": "",
        "description": "",
        "publishTime": 1680796800000,
        "subed": null,
        "extMap": {}
      }
    ],
    "playlists": [
      {
        "id": "59219B4450A8DFB51C7A398D382EAE86",
        "name": "全网超好听热播歌曲300首",
        "coverImgUrl": "http://p1.music.126.net/pC9rszwdC_GtRMeyfv6mAg==/109951171972088936.jpg",
        "describe": "持续更新",
        "creatorNickName": "微雨染尘埃",
        "creatorAvatarUrl": "http://p1.music.126.net/lQX3VabzxU9k57MncIJ6ZA==/109951167531472662.jpg",
        "playCount": 16766606,
        "subscribedCount": 97898,
        "tags": [
          "流行",
          "华语",
          "网络歌曲"
        ],
        "createTime": 1753928055606,
        "subed": false,
        "trackCount": 259,
        "specialType": 0,
        "category": null,
        "allFreeTrialFlag": false,
        "trackUpdateTime": 1769006571836,
        "extMap": {}
      }
    ],
    "voicelist": [
      {
        "id": 1224561574,
        "name": "精卫DJ抖音戏腔版",
        "picUrl": "http://p1.music.126.net/4GkcAZlYu29MozHgDplTgw==/109951171203360884.jpg",
        "picId": 109951171203360880,
        "playCount": 366494,
        "programCount": 1,
        "createTime": 1748783522822,
        "lastProgramCreateTime": 1748783855103,
        "lastProgramName": null,
        "desc": "精卫DJ抖音戏腔版￼",
        "categoryId": 10002,
        "category": "电音",
        "secondCategoryId": 450057,
        "secondCategory": "DJ舞曲",
        "icon": null,
        "djName": "圣曹凯",
        "userInfoVO": [
          {
            "nickname": "圣曹凯",
            "avatarUrl": "http://p1.music.126.net/SkcDcyMF2EhCbqpL6LnVMg==/109951170034221575.jpg",
            "userId": 1754823115
          }
        ],
        "subscribe": false,
        "subCnt": 1144,
        "fees": [],
        "finishStatus": null,
        "lastVoiceVO": null,
        "alg": null,
        "tag": null,
        "rcmdText": null,
        "platformValue": null
      }
    ]
  }
}
```

## 根据关键字搜索歌曲

- docId：`b175e0d52550427cbb7cd4735a9de765`
- 来源：https://developer.music.163.com/st/developer/document?docId=b175e0d52550427cbb7cd4735a9de765

## 根据关键字搜索歌曲


### /openapi/music/basic/search/song/get/v3


- 老接口：/openapi/music/basic/search/song/get/v2


```text
根据关键字搜索出匹配度最高的歌曲
```


![图片](https://p5.music.126.net/Xbt-HrK9eJv_c1cXkNX1wA==/109951172627039185?imageView&thumbnail=600x600)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>keyword</td>
<td>是</td>
<td>String</td>
<td>搜索关键字</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>获取数据量</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"keyword":"邓紫棋","limit":"30","offset":"0","qualityFlag":"true"}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/search/song/get/v2?bizContent%3d%7b%22keyword%22%3a%22123%22%2c%22limit%22%3a%2210%22%2c%22offset%22%3a%220%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明：


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>时长</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>fullArtists</td>
<td>List<Artist></td>
<td>全部艺人列表（包含已下线）</td>
</tr>
<tr>
<td>album</td>
<td>Album</td>
<td>专辑信息</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌曲封面url</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>alg</td>
<td>String</td>
<td>算法推荐使用，播放数据上报接口需透传该字段</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>originCoverType</td>
<td>Int</td>
<td>原唱字段</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**originCoverType**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>Int</td>
<td>状态未知</td>
</tr>
<tr>
<td>1</td>
<td>Int</td>
<td>原唱</td>
</tr>
<tr>
<td>2</td>
<td>Int</td>
<td>翻唱</td>
</tr>
</tbody>
</table>


**Qualities**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>dolbyMusic</td>
<td>String</td>
<td>杜比</td>
</tr>
<tr>
<td>skMusic</td>
<td>String</td>
<td>沉浸环绕声</td>
</tr>
<tr>
<td>jyMasterMusic</td>
<td>String</td>
<td>超清母带</td>
</tr>
<tr>
<td>jyEffectMusic</td>
<td>String</td>
<td>高清臻音</td>
</tr>
<tr>
<td>hrMusic</td>
<td>String</td>
<td>hi-res</td>
</tr>
<tr>
<td>sqMusic</td>
<td>String</td>
<td>无损</td>
</tr>
<tr>
<td>hmusic</td>
<td>String</td>
<td>极高</td>
</tr>
<tr>
<td>mmusic</td>
<td>String</td>
<td>较高</td>
</tr>
<tr>
<td>lmusic</td>
<td>String</td>
<td>标准</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**Album**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "recordCount": 7,
    "records": [
      {
        "id": "1CE4E2A5D6869390649E6FF192436A5F",
        "name": "陈酒新茶令",
        "duration": 243487,
        "artists": [],
        "fullArtists": [
          {
            "id": null,
            "name": "Assen捷&东篱"
          }
        ],
        "album": {
          "id": "0E5E42FD4DD36BC27098853AE9BBF2CE",
          "name": "原创作品集"
        },
        "playFlag": true,
        "downloadFlag": true,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": false,
        "liked": false,
        "coverImgUrl": "http://p1.music.126.net/gxRi6adE6uBlcJ3WD-ppbQ==/18005602416583124.jpg",
        "vipPlayFlag": false,
        "accompanyFlag": null,
        "songMaxBr": 320000,
        "userMaxBr": 320000,
        "maxBrLevel": "exhigh",
        "plLevel": "exhigh",
        "dlLevel": "exhigh",
        "songTag": null,
        "alg": "alg_search_basic_00000193be1784010dd90aaaa55c24dc",
        "privateCloudSong": false,
        "freeTrailFlag": false,
        "songFtFlag": false,
        "freeTrialPrivilege": {
          "cannotListenReason": null,
          "resConsumable": false,
          "userConsumable": false
        },
        "songFee": 0,
        "playMaxbr": 320000,
        "qualities": null,
        "originCoverType": 1,
        "emotionTag": null,
        "vocalFlag": false,
        "visible": true
      }
    ]
  }
}
```

## 根据关键字搜索歌单

- docId：`7aae16d1be194e628666dd4ced17f283`
- 来源：https://developer.music.163.com/st/developer/document?docId=7aae16d1be194e628666dd4ced17f283

## 根据关键字搜索歌单


### /openapi/music/basic/search/playlist/get/v2


- 根据歌单名称搜索到匹配度从高到低的歌单
![图片](https://p5.music.126.net/qEsd4q_Mla5cTjho0if-yA==/109951172627049669?imageView&thumbnail=600x600)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>keyword</td>
<td>是</td>
<td>String</td>
<td>搜索关键字</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>获取数据量</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"keyword":"邓紫棋","limit":"30","offset":"0","qualityFlag":"true"}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/search/playlist/get/v2?bizContent%3d%7b%22keyword%22%3a%22123%22%2c%22limit%22%3a%2210%22%2c%22offset%22%3a%220%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>recordCount</td>
<td>Int</td>
<td>歌单数量</td>
</tr>
<tr>
<td>records</td>
<td>List<record></td>
<td>歌单列表</td>
</tr>
</tbody>
</table>


#### record


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>creatorAvatarUrl</td>
<td>String</td>
<td>创建者头像</td>
</tr>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>String</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>creatorId</td>
<td>String</td>
<td>歌单创建人Id</td>
</tr>
<tr>
<td>createTime</td>
<td>String</td>
<td>创建时间</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>trackCount</td>
<td>int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>specialType</td>
<td>int</td>
<td>歌单类型</td>
</tr>
<tr>
<td>trackUpdateTime</td>
<td>long</td>
<td>最近更新时间</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "recordCount": 395,
    "records": [
      {
        "id": "9010F8895D32BAFC2C2F21FE6AFD4207",
        "name": "邓紫棋热门单曲",
        "coverImgUrl": "http://p1.music.126.net/fkqFqMaEt0CzxYS-0NpCog==/18587244069235039.jpg",
        "describe": null,
        "creatorNickName": "Master-辰曜",
        "creatorAvatarUrl": "http://p1.music.126.net/Yaj02ehGq7ZKreCAA_dXCQ==/109951163601764095.jpg",
        "playCount": 8888961,
        "subscribedCount": 85248,
        "tags": [
          "华语",
          "90后",
          "00后"
        ],
        "createTime": 1540640797463,
        "subed": false,
        "trackCount": 49,
        "specialType": 0,
        "category": null,
        "allFreeTrialFlag": false,
        "trackUpdateTime": 1762413990155,
        "alg": "alg_search_rec_playlist_tab_hotartist_null_{\"hit\":\"Name\",\"id\":\"邓紫棋\",\"type\":\"hotartist\"}",
        "extMap": {}
      }
    ]
  }
}
```

## 根据关键字搜索专辑

- docId：`ca7eda92ab634c0fbc1436c99fdaad5d`
- 来源：https://developer.music.163.com/st/developer/document?docId=ca7eda92ab634c0fbc1436c99fdaad5d

## 根据关键字搜索专辑


### /openapi/music/basic/search/album/get/v2


```text
根据关键字搜索到指定的专辑
```


![图片](https://p5.music.126.net/n4tH0kZ4jKkcN475U3al3A==/109951172627083100?imageView&thumbnail=600x600)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>keyword</td>
<td>是</td>
<td>String</td>
<td>搜索关键字</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>获取数据量(最多300，建议100以内)</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"keyword":"邓紫棋","limit":"30","offset":"0"}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/search/album/get/v2?bizContent%3d%7b%22keyword%22%3a%22123%22%2c%22limit%22%3a%2210%22%2c%22offset%22%3a%220%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>language</td>
<td>String</td>
<td>专辑语种</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面</td>
</tr>
<tr>
<td>company</td>
<td>String</td>
<td>发行公司</td>
</tr>
<tr>
<td>genre</td>
<td>String</td>
<td>风格流派</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>歌手信息</td>
</tr>
<tr>
<td>transName</td>
<td>String</td>
<td>中文翻译名</td>
</tr>
<tr>
<td>aliaName</td>
<td>String</td>
<td>别名</td>
</tr>
<tr>
<td>briefDesc</td>
<td>String</td>
<td>简要描述</td>
</tr>
<tr>
<td>description</td>
<td>String</td>
<td>详细描述</td>
</tr>
<tr>
<td>publishTime</td>
<td>String</td>
<td>发行时间</td>
</tr>
<tr>
<td>subed</td>
<td>Boolean</td>
<td>是否收藏</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "recordCount": 185,
    "records": [
      {
        "id": "3A05935FCBF34815FD603990677E09EF",
        "name": "启示录",
        "language": "国语,英语",
        "coverImgUrl": "http://p1.music.126.net/5WBF8uSFXhLVjvMOCeqflQ==/109951167859171747.jpg",
        "company": "G Nation Limited",
        "transName": null,
        "aliaName": "",
        "genre": null,
        "artists": [
          {
            "id": "1EA9121051EA46A7C46A841192243ADB",
            "name": "G.E.M.邓紫棋"
          }
        ],
        "briefDesc": "",
        "description": "",
        "publishTime": 1663862400000,
        "subed": null,
        "alg": "alg_album_hotartist",
        "extMap": {}
      }
    ]
  }
}
```

## 根据关键字搜索歌手

- docId：`a1c2bcb0e9b44c09a45b614c3d4f1784`
- 来源：https://developer.music.163.com/st/developer/document?docId=a1c2bcb0e9b44c09a45b614c3d4f1784

## 根据关键字搜索歌手


### /openapi/music/basic/search/artists/get/v2


```text
根据艺人名称搜索到艺人信息
```


![图片](https://p5.music.126.net/h8u2UgwBJWurssMCsqNaWw==/109951172627055491?imageView&thumbnail=600x600)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>keyword</td>
<td>是</td>
<td>String</td>
<td>搜索关键字</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>获取数据量</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
<tr>
<td>identityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否组装艺人身份标签，默认false</td>
</tr>
<tr>
<td>subCountFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否组装粉丝数，默认false</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"keyword":"邓紫棋","limit":"30","offset":"0","identityFlag":"true","subCountFlag":"true"}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/search/artists/get/v2?bizContent%3d%7b%22keyword%22%3a%22123%22%2c%22limit%22%3a%2210%22%2c%22offset%22%3a%220%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
<tr>
<td>transName</td>
<td>String</td>
<td>别名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面</td>
</tr>
<tr>
<td>type</td>
<td>int</td>
<td>艺人类型（3:乐队组合, 1:男歌手, 2:女歌手）</td>
</tr>
<tr>
<td>authMusicianV</td>
<td>Boolean</td>
<td>大V认证</td>
</tr>
<tr>
<td>identity</td>
<td>List<IdentityVO></td>
<td>身份</td>
</tr>
<tr>
<td>roles</td>
<td>List<ExpertIdentityTypeVO></td>
<td>艺人角色信息</td>
</tr>
<tr>
<td>subCount</td>
<td>Long</td>
<td>粉丝数</td>
</tr>
<tr>
<td>briefDesc</td>
<td>String</td>
<td>简要描述</td>
</tr>
<tr>
<td>nationality</td>
<td>String</td>
<td>国家/地区</td>
</tr>
<tr>
<td>musicSize</td>
<td>Int</td>
<td>歌曲数量</td>
</tr>
</tbody>
</table>


### IdentityVO


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>userType</td>
<td>Int</td>
<td>身份type</td>
</tr>
<tr>
<td>showName</td>
<td>String</td>
<td>身份名</td>
</tr>
</tbody>
</table>


### ExpertIdentityTypeVO


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>roleId</td>
<td>Long</td>
<td>身份id</td>
</tr>
<tr>
<td>roleName</td>
<td>String</td>
<td>身份名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "recordCount": 37,
    "records": [
      {
        "id": "1EA9121051EA46A7C46A841192243ADB",
        "name": "G.E.M.邓紫棋",
        "transName": null,
        "coverImgUrl": "http://p1.music.126.net/fq1O8ZRT5_FHzg_uLEtUQA==/109951167773880633.jpg",
        "type": 2,
        "authMusicianV": true,
        "identity": [
          {
            "userType": 2,
            "showName": "歌手"
          }
        ],
        "roles": null,
        "subCount": 13703110,
        "briefDesc": "",
        "nationality": null,
        "alg": "alg_search_precision_artist_tab_basic",
        "musicSize": 419
      }
    ]
  }
}
```

## 根据标签搜索歌单

- docId：`60d52ebe087b45218dedca1afdcaf49c`
- 来源：https://developer.music.163.com/st/developer/document?docId=60d52ebe087b45218dedca1afdcaf49c

## 根据标签搜索歌单


### /openapi/music/basic/search/playlist/bytag/get/v2


- 使用指定的标签，按热度搜索歌单


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>tag</td>
<td>是</td>
<td>String</td>
<td>标签</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>一页数据量（最多500条），别拿太多</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"tag":"欧美","limit":10,"offset":0}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/search/playlist/bytag/get/v2?bizContent%3d%7b%22limit%22%3a%2210%22%2c%22tag%22%3a%22%e5%8d%8e%e8%af%ad%22%2c%22offset%22%3a%220%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 标签枚举


-

“华语歌曲”可以检索到数据是因为索引里标签字段保存了形如“华语；网络歌曲”字段，分词模糊匹配后可以命中


-

但“欧美歌曲”没有命中存在类似标签的歌单


["华语","欧美","日语","韩语","粤语","小语种","清晨","夜晚","学习","工作","午休","下午茶","地铁","驾车","运动","旅行","散步","校园","酒吧","流行","摇滚","民谣","电子","说唱","轻音乐","爵士","乡村","R&B/Soul","古典","民族","英伦","金属","朋克","蓝调","怀旧","清新","浪漫","性感","伤感","治愈","放松","孤独","感动","兴奋","快乐","安静","思念","影视原声","游戏","70后","80后","90后","网络歌曲","KTV","经典","翻唱","吉他","钢琴","器乐","儿童","榜单","雷鬼","世界音乐","拉丁","另类/独立","ACG","New Age","古风","Bossa Nova","00后","后摇","舞曲","音乐剧","综艺"]


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>creatorAvatarUrl</td>
<td>String</td>
<td>创建者头像</td>
</tr>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>String</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>creatorId</td>
<td>String</td>
<td>歌单创建人Id</td>
</tr>
<tr>
<td>createTime</td>
<td>String</td>
<td>创建时间</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>trackCount</td>
<td>int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>specialType</td>
<td>int</td>
<td>歌单类型</td>
</tr>
<tr>
<td>trackUpdateTime</td>
<td>long</td>
<td>最近更新时间</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "recordCount": 20000,
    "records": [
      {
        "id": "D80BF6C1F285AA8032717A4BCF710A1E",
        "name": "老友记全插曲",
        "coverImgUrl": "http://p1.music.126.net/-LhjpdtfMvmHOVFTNNqWww==/7909886650385890.jpg",
        "describe": "从第一季到第十季···按照顺序排的插曲···并不是所有所有的插曲都在里面···把一些印象深刻的··即使是背景音乐但是很好听的歌都收进来了···也算是完成了我一直以来的一个心愿~~~",
        "creatorNickName": "寿司是只咩咩咩喵喵喵",
        "creatorAvatarUrl": "http://p1.music.126.net/gRtJhMSp6-JxiTT_dWMmQA==/2543170397520454.jpg",
        "playCount": 1072890,
        "subscribedCount": 26918,
        "tags": [
          "欧美"
        ],
        "createTime": 1422632084602,
        "subed": false,
        "trackCount": 87,
        "specialType": 0,
        "category": null,
        "allFreeTrialFlag": false,
        "trackUpdateTime": 1767206757149,
        "extMap": {}
      },
      {
        "id": "6154841E588429F3A77D309E112FCD82",
        "name": "TOP",
        "coverImgUrl": "http://p1.music.126.net/G7SOuV7MhAyyx85bDvkWdQ==/109951170600813137.jpg",
        "describe": "感受音乐带来的快感",
        "creatorNickName": "Yu77iovo",
        "creatorAvatarUrl": "http://p1.music.126.net/9BdMlIQq7Z1ztZ0z8glpMQ==/109951170585689328.jpg",
        "playCount": 1008763,
        "subscribedCount": 6723,
        "tags": [
          "欧美"
        ],
        "createTime": 1495886625066,
        "subed": false,
        "trackCount": 60,
        "specialType": 0,
        "category": null,
        "allFreeTrialFlag": false,
        "trackUpdateTime": 1767627610591,
        "extMap": {}
      }
    ]
  }
}
```

## 根据艺人关键字搜索歌曲（不建议使用）

- docId：`4eabf69b081548499d0d3e57f255bcf4`
- 来源：https://developer.music.163.com/st/developer/document?docId=4eabf69b081548499d0d3e57f255bcf4

## 根据艺人关键字搜索歌曲（不建议使用）


### /openapi/music/basic/search/song/byartist/get/v2


- 根据艺人名称获取到相关歌曲


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>keyword</td>
<td>是</td>
<td>String</td>
<td>搜索关键字</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>获取数据量</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/search/song/byartist/get/v2?bizContent%3d%7b%22keyword%22%3a%22123%22%2c%22limit%22%3a%2210%22%2c%22offset%22%3a%220%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


- Records参数（列表）


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>时长</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>album</td>
<td>Album</td>
<td>专辑信息</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否下载歌曲（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面url</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>alg</td>
<td>String</td>
<td>算法推荐使用，播放数据上报接口需透传该字段</td>
</tr>
<tr>
<td>originCoverType</td>
<td>Int</td>
<td>原唱字段</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**originCoverType**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>Int</td>
<td>状态未知</td>
</tr>
<tr>
<td>1</td>
<td>Int</td>
<td>原唱</td>
</tr>
<tr>
<td>2</td>
<td>Int</td>
<td>翻唱</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**Album**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "recordCount": 300,
    "records": [
      {
        "id": "741D90C1A38DBE2A36EF71216BEEB798",
        "name": "平行宇宙",
        "duration": 209060,
        "artists": [
          {
            "id": "65F5EEC6A8C61C029EEBA1E9FD1FE988",
            "name": "许嵩"
          }
        ],
        "album": {
          "id": "52661C1EF8DE1C5BF9F827DB0FE87C3A",
          "name": "青年晚报"
        },
        "playFlag": false,
        "downloadFlag": false,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": false,
        "liked": false,
        "coverImgUrl": "http://p1.music.126.net/Wcs2dbukFx3TUWkRuxVCpw==/3431575794705764.jpg",
        "vipPlayFlag": false,
        "songMaxBr": 999000,
        "userMaxBr": 0,
        "maxBrLevel": "lossless",
        "plLevel": "none",
        "dlLevel": "none",
        "songTag": null,
        "alg": null,
        "visible": false
      },
      {
        "id": "E5DBD4E1E2533BD537F70CF59E9744D8",
        "name": "素颜",
        "duration": 238733,
        "artists": [
          {
            "id": "65F5EEC6A8C61C029EEBA1E9FD1FE988",
            "name": "许嵩"
          },
          {
            "id": "11982CD9210B05DC94D5758DE3BBF33D",
            "name": "何曼婷"
          }
        ],
        "album": {
          "id": "EFE374B9B18E9B84E8D325C10945727D",
          "name": "素颜"
        },
        "playFlag": false,
        "downloadFlag": false,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": false,
        "liked": false,
        "coverImgUrl": "http://p1.music.126.net/LMyITvYRS7NsgA9lYUKpqg==/109951164179134667.jpg",
        "vipPlayFlag": false,
        "songMaxBr": 999000,
        "userMaxBr": 0,
        "maxBrLevel": "lossless",
        "plLevel": "none",
        "dlLevel": "none",
        "songTag": null,
        "alg": null,
        "visible": false
      }
    ]
  }
}
```

## 根据艺人名、歌曲名搜索歌曲信息（不建议使用）

- docId：`4a4a9ef7d6ce4c39ad2685b321cc7d22`
- 来源：https://developer.music.163.com/st/developer/document?docId=4a4a9ef7d6ce4c39ad2685b321cc7d22

## 根据艺人名、歌曲名搜索歌曲信息（不建议使用）


### /openapi/music/basic/search/song/by/artist/song/get/v2


- 根据根据艺人名、歌曲名搜索匹配度从高到低的歌曲列表


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songName</td>
<td>是</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>artistName</td>
<td>是</td>
<td>String</td>
<td>艺人名称</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>int</td>
<td>一页数据量（最多500条）</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>int</td>
<td>偏移量</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/search/song/by/artist/song/get/v2?bizContent%3d%7b%22songName%22%3a%22123%22%2c%22artistName%22%3a%22123%22%2c%22limit%22%3a%2210%22%2c%22offset%22%3a%220%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


- Records参数（列表）


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>时长</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>album</td>
<td>Album</td>
<td>专辑信息</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面url</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>alg</td>
<td>String</td>
<td>算法推荐使用，播放数据上报接口需透传该字段</td>
</tr>
<tr>
<td>originCoverType</td>
<td>Int</td>
<td>原唱字段</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**originCoverType**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>Int</td>
<td>状态未知</td>
</tr>
<tr>
<td>1</td>
<td>Int</td>
<td>原唱</td>
</tr>
<tr>
<td>2</td>
<td>Int</td>
<td>翻唱</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**Album**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "recordCount": 58,
    "records": [
      {
        "id": "82C0AD6E15038A519B10B1E5F049DC8E",
        "name": "七里香",
        "duration": 288166,
        "artists": [
          {
            "id": "63B9F9BC1C38DB9A6AAFEA0FE25AA8F2",
            "name": "Cannie"
          }
        ],
        "album": {
          "id": "087A5B3FB60ED121B6EBE68FAA01F32C",
          "name": "七里香"
        },
        "playFlag": true,
        "downloadFlag": true,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": false,
        "liked": false,
        "coverImgUrl": "http://p1.music.126.net/7xp8BgSvadeUbd2iVs7XEA==/109951168240417761.jpg",
        "vipPlayFlag": false,
        "songMaxBr": 999000,
        "userMaxBr": 999000,
        "maxBrLevel": "lossless",
        "plLevel": "lossless",
        "dlLevel": "lossless",
        "songTag": null,
        "alg": null,
        "visible": true
      },
      {
        "id": "E6A2D00BD4BB2A944A60A14C9FDB0F6E",
        "name": "屋顶",
        "duration": 319039,
        "artists": [
          {
            "id": "E165472149C92422BA11428F4A5F4855",
            "name": "温岚"
          },
          {
            "id": "AF2EDDDC07C42640CFD1D7C776CEE256",
            "name": "周杰伦"
          }
        ],
        "album": {
          "id": "4D9E783C360A78C5B1C3A52FC4A205AC",
          "name": "有点野"
        },
        "playFlag": true,
        "downloadFlag": true,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": false,
        "liked": false,
        "coverImgUrl": "http://p1.music.126.net/vu3Cdo_dPq8HKOPI6_YXfA==/74766790689775.jpg",
        "vipPlayFlag": false,
        "songMaxBr": 999000,
        "userMaxBr": 999000,
        "maxBrLevel": "lossless",
        "plLevel": "lossless",
        "dlLevel": "lossless",
        "songTag": null,
        "alg": null,
        "visible": true
      }
    ]
  }
}
```

## 根据艺人、专辑关键字搜索专辑列表(不建议使用)

- docId：`44a151d8c432445984d8dbaf06467f7c`
- 来源：https://developer.music.163.com/st/developer/document?docId=44a151d8c432445984d8dbaf06467f7c

## 根据艺人、专辑关键字搜索专辑列表(不建议使用)


### /openapi/music/basic/search/song/by/album/artist/get/v2


- 结合艺人名称、专辑名称搜索匹配度从高到低的专辑信息


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>albumName</td>
<td>是</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>artistName</td>
<td>是</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>获取数据量（不要超过300，建议100以内）</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/search/song/by/album/artist/get/v2?bizContent%3d%7b%22albumName%22%3a%2210%22%2c%22artistName%22%3a%22%e5%8d%8e%e8%af%ad%22%2c%22offset%22%3a%220%22%2c%22limit%22%3a%2210%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>language</td>
<td>String</td>
<td>专辑语种</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面</td>
</tr>
<tr>
<td>genre</td>
<td>String</td>
<td>风格流派</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>歌手信息</td>
</tr>
<tr>
<td>company</td>
<td>String</td>
<td>发行公司</td>
</tr>
<tr>
<td>transName</td>
<td>String</td>
<td>中文翻译名</td>
</tr>
<tr>
<td>aliaName</td>
<td>String</td>
<td>别名</td>
</tr>
<tr>
<td>briefDesc</td>
<td>String</td>
<td>简要描述</td>
</tr>
<tr>
<td>description</td>
<td>String</td>
<td>详细描述</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
    "code":200,
    "subCode":null,
    "message":null,
    "data":{
        "recordCount":97,
        "records":[
            {
                "id":"EC0A96AA28741DDF8CBE517CDD978263",
                "name":"平凡的一天",
                "language":"国语,纯音乐",
                "coverImgUrl":"http://p4.music.126.net/vmCcDvD1H04e9gm97xsCqg==/109951163350929740.jpg",
                "company":"哇唧唧哇×智慧大狗",
                "transName":null,
                "aliaName":null,
                "genre":null,
                "artists":[
                    {
                        "id":"C7BAD226165098602FEF6904CFC25C03",
                        "name":"毛不易"
                    }
                ],
                "briefDesc":"",
                "description":""
            }

        ]
    }
}
```

# 获取播放记录API

## 获取最近播放歌单列表

- docId：`e185b8877e144eba82d8eefd7a7f1081`
- 来源：https://developer.music.163.com/st/developer/document?docId=e185b8877e144eba82d8eefd7a7f1081

## 获取最近播放歌单列表


### /openapi/music/basic/playlist/play/record/list


```text
网易云端->iot设备端：实时同步，秒级传输
iot设备端->网易云端：需要在回传接口新增sourceId和sourceType
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>limit</td>
<td>否</td>
<td>Int</td>
<td>查询条数，默认100条</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/play/record/list?appId=a30102000000000037b6f93f337049b7&timestamp=1768460893755&accessToken=j0091f9a3c1d03e63efaf523f7d676066e9e1b15498adef3en&device={"channel":"byd","deviceId":"bnVsbAkwMjowMDowMDowMDowMDowMAk5MDQ1NzRkODZlMTIzMDc1CW51bGw=","deviceType":"andrcar","appVer":"6.2.10","os":"andrcar","osVer":"16","brand":"vivo","model":"V2408A","clientIp":"42.186.87.42"}&bizContent={"limit":2}&sign=B2aJgMMIryGwwa3MBLedMVC5L%2FK%2FEsQTXKYH%2Foy5ThDklIY%2BG6wB6QNArC8GaxLgt89GdSoQvioFA%2B%2FHz8RyCsw2U4YEf7b4TfoWYFqYBWgBu0zyerD6onDoJsGdVik32Bu2WJ%2BAmuQsDf0Y6WsxK4AjarhNZj%2FIHzKf1LeHUmVT6kH78kBa4wOZkbieoNKUB60DoQ6Hdb6kgeg4iYlk9oUElZiDkXeHH48p35Zu8sfyVAZttoN2oNGMzow3DvNpukQMgI6lWnKS6P52FiS%2B7aFk%2FHMTs7iWkDIin126ATCR9Xsaytoq9vVpX3GzrGfVUhy8KsSMh%2Bkc%2BvjRXCTPKg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>records</td>
<td>List<record></td>
<td>歌单列表</td>
</tr>
<tr>
<td>playTime</td>
<td>String</td>
<td>最近一次播放时间</td>
</tr>
</tbody>
</table>


#### record


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>creatorAvatarUrl</td>
<td>String</td>
<td>创建者头像</td>
</tr>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>String</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>createTime</td>
<td>String</td>
<td>创建时间</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>trackCount</td>
<td>int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>specialType</td>
<td>int</td>
<td>歌单类型</td>
</tr>
<tr>
<td>trackUpdateTime</td>
<td>long</td>
<td>最近更新时间</td>
</tr>
<tr>
<td>extMap</td>
<td>extMapVo</td>
<td>补充信息</td>
</tr>
</tbody>
</table>


#### extMapVo


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>os</td>
<td>String</td>
<td>来源</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "records": [
      {
        "record": {
          "id": "AFB489A5567C64EDBAD710CDEE81D9AD",
          "name": "诠释摇滚 | 放肆宣泄这该死的青春",
          "coverImgUrl": "http://p1.music.126.net/cDFHdwGdG63dv_Ieo1EPvw==/109951168125275547.jpg",
          "describe": "让我喜欢摇滚乐的，就是存在着另一种生活的可能性。\n\n而这种可能性，不是父母教给你的，老师教给你的，而是你独立去得出来的。这种生活的经验是你自己独立得到的，而不是别人教给你的。\n\n你通过思考来总结出自己的生活经验，我觉得这是摇滚乐当年最刺激我的地方！\n\n不定期更新！",
          "creatorNickName": "Bruce梁博",
          "creatorAvatarUrl": "http://p1.music.126.net/VtsWEYOjufrw_H-S4LjDSw==/109951170916931237.jpg",
          "playCount": 724851,
          "subscribedCount": 2615,
          "tags": [
            "华语",
            "摇滚",
            "兴奋"
          ],
          "createTime": 1669273264328,
          "subed": false,
          "trackCount": 103,
          "specialType": 0,
          "category": null,
          "allFreeTrialFlag": false,
          "trackUpdateTime": 0,
          "extMap": {
            "os": "iphone"
          }
        },
        "playTime": 1769044863600
      }
    ]
  }
}
```

## 获取最近播放专辑列表

- docId：`d90400e28fab4fbb834959650ec8d93d`
- 来源：https://developer.music.163.com/st/developer/document?docId=d90400e28fab4fbb834959650ec8d93d

## 获取最近播放专辑列表


### /openapi/music/basic/album/play/record/list


```text
网易云端->iot设备端：实时同步，秒级传输
iot设备端->网易云端，需要在回传接口新增sourceId和sourceType
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>limit</td>
<td>否</td>
<td>Int</td>
<td>查询条数，默认100条</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/album/play/record/list?appId=a30102000000000037b6f93f337049b7&timestamp=1768460893755&accessToken=j0091f9a3c1d03e63efaf523f7d676066e9e1b15498adef3en&device={"channel":"byd","deviceId":"bnVsbAkwMjowMDowMDowMDowMDowMAk5MDQ1NzRkODZlMTIzMDc1CW51bGw=","deviceType":"andrcar","appVer":"6.2.10","os":"andrcar","osVer":"16","brand":"vivo","model":"V2408A","clientIp":"42.186.87.42"}&bizContent={"limit":2}&sign=B2aJgMMIryGwwa3MBLedMVC5L%2FK%2FEsQTXKYH%2Foy5ThDklIY%2BG6wB6QNArC8GaxLgt89GdSoQvioFA%2B%2FHz8RyCsw2U4YEf7b4TfoWYFqYBWgBu0zyerD6onDoJsGdVik32Bu2WJ%2BAmuQsDf0Y6WsxK4AjarhNZj%2FIHzKf1LeHUmVT6kH78kBa4wOZkbieoNKUB60DoQ6Hdb6kgeg4iYlk9oUElZiDkXeHH48p35Zu8sfyVAZttoN2oNGMzow3DvNpukQMgI6lWnKS6P52FiS%2B7aFk%2FHMTs7iWkDIin126ATCR9Xsaytoq9vVpX3GzrGfVUhy8KsSMh%2Bkc%2BvjRXCTPKg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>records</td>
<td>List<record></td>
<td>歌单列表</td>
</tr>
<tr>
<td>playTime</td>
<td>String</td>
<td>最近一次播放时间</td>
</tr>
</tbody>
</table>


#### record


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>language</td>
<td>String</td>
<td>专辑语种</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面</td>
</tr>
<tr>
<td>company</td>
<td>String</td>
<td>发行公司</td>
</tr>
<tr>
<td>transName</td>
<td>String</td>
<td>中文翻译名</td>
</tr>
<tr>
<td>aliaName</td>
<td>String</td>
<td>别名</td>
</tr>
<tr>
<td>genre</td>
<td>String</td>
<td>风格流派</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>歌手信息</td>
</tr>
<tr>
<td>briefDesc</td>
<td>String</td>
<td>简要描述</td>
</tr>
<tr>
<td>description</td>
<td>String</td>
<td>详细描述</td>
</tr>
<tr>
<td>publishTime</td>
<td>String</td>
<td>发行时间</td>
</tr>
<tr>
<td>subed</td>
<td>Boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>extMap</td>
<td>extMapVo</td>
<td>补充信息</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


#### extMapVo


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>os</td>
<td>String</td>
<td>来源</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "records": [
      {
        "record": {
          "id": "146B759E1C52CE33D046E547E4E8E5CA",
          "name": "半点心（DJ热搜版）",
          "language": "粤语",
          "coverImgUrl": "http://p1.music.126.net/B6ojEAfHTF5WZLdhwe8DtQ==/109951167421718464.jpg",
          "company": null,
          "transName": null,
          "aliaName": null,
          "genre": null,
          "artists": [
            {
              "id": "BE71CE265EE5BAD5588BF15F80E5D7C8",
              "name": "Kings"
            }
          ],
          "briefDesc": "",
          "description": "",
          "publishTime": 1652279713951,
          "subed": null,
          "extMap": {
            "os": "andrcar"
          }
        },
        "playTime": 1769072238392
      }
    ]
  }
}
```

## 获取听歌排行数据

- docId：`bc35878b52134cfbb6739fcff7de5f9e`
- 来源：https://developer.music.163.com/st/developer/document?docId=bc35878b52134cfbb6739fcff7de5f9e

## 获取听歌排行数据


### /openapi/music/basic/query/song/record/get


```text
- 需申请接口组：云音乐歌曲能力
- 获取用户最近听歌排行（同步移动端的）
```


![图片](https://p5.music.126.net/embGW7EbHPwGk3oR9mmJkg==/109951172346324484)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>type</td>
<td>是</td>
<td>Int</td>
<td>0:查总排行，1:查周排行</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>获取的数据量</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com//openapi/music/basic/query/song/record/get?appId=a30102000000000002a56300f02d3889&signType=RSA_SHA256&timestamp=1764143877429&bizContent=%7B%22type%22%3A%220%22%2C%22limit%22%3A%22100%22%2C%22offset%22%3A%220%22%2C%22qualityFlag%22%3A%22true%22%7D&device=%7B%22channel%22%3A%22netease%22%2C%22deviceId%22%3A%22bnVsbAkwMjowMDowMDowMDowMDowMAk1ZDFhZDExNGNhMjA1YmI1CW51bGw%3D%22%2C%22deviceType%22%3A%22andrcar%22%2C%22appVer%22%3A%226.1.10%22%2C%22os%22%3A%22andrcar%22%2C%22osVer%22%3A%2210%22%2C%22brand%22%3A%22HONOR%22%2C%22model%22%3A%22LRA-AL00%22%2C%22clientIp%22%3A%22115.236.119.141%22%7D&accessToken=d92f641f89c5b4c46adf54f1af65ac6595ae8019f73eddd18k&sign=V6XF9sABWRhylCm3WBC8%2B2aT7xulG2%2B3U0hhJ4A2cqq4l68Iegr5CTlTbw7iwGivD7CBc5Se4y7S%0AtfTa7%2BBp%2BzaqSfzePbFkjhLQ3yBBqR%2BSNIWRhiJoqLeBnpEVoOzJwzTafNfZI6Bzd149OVEnfO0J%0Ay%2BCj2wNY2EDYT5vHRVeLUfTgk9hiwllvl6ci9Iig2ovnCyW8obx1J%2FiZds7Mrz490hB%2FRInKaVig%0AVm4TFIsiTdjZYziA1esnppQBMpLPTTwWVie2A5ZsbXWsiwge47nttOc5W3D2100%2FbR87uBYCCud1%0AEANw%2BfUnrfSC5p%2BjdkUZcAMIX%2BnO3rMa6xX8YA%3D%3D%0A
```


### 返回参数说明


**PlaySongRecordListVo**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放次数</td>
</tr>
<tr>
<td>score</td>
<td>String</td>
<td>分数</td>
</tr>
<tr>
<td>song</td>
<td>songVo</td>
<td>歌曲</td>
</tr>
</tbody>
</table>


### songVo


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>albumName</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>albumId</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>albumArtistId</td>
<td>String</td>
<td>专辑艺人Id</td>
</tr>
<tr>
<td>albumArtistName</td>
<td>String</td>
<td>专辑艺人名</td>
</tr>
<tr>
<td>artistId</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>artistName</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面Url</td>
</tr>
<tr>
<td>mvId</td>
<td>String</td>
<td>mvId</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放url</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载歌曲（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>vip标识，需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放（不要用）</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持试听</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>试听起止时间，单位：s</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>gain</td>
<td>Float</td>
<td>音频增益</td>
</tr>
<tr>
<td>peak</td>
<td>Float</td>
<td>音频peak</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>songSize</td>
<td>int</td>
<td>歌曲的大小</td>
</tr>
<tr>
<td>songMd5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>fullArtists</td>
<td>List<Artist></td>
<td>完整艺人列表（包含已下线艺人）</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>originCoverType</td>
<td>Int</td>
<td>原唱字段</td>
</tr>
<tr>
<td>br</td>
<td>int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效信息（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>language</td>
<td>String</td>
<td>语种</td>
</tr>
<tr>
<td>payed</td>
<td>List<SongPrivilegePayedVO></td>
<td>付费信息</td>
</tr>
<tr>
<td>chorusMeta</td>
<td>List<ChorusMetaVO></td>
<td>副歌信息</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


- 展示艺人的时候，取fullArtists，无id，有名称，说明艺人已下线，只展示名称

- 已购：singlePayed == 1 || albumPayed == 1，表示买过单曲或者买过专辑


### 返回示例


```text
{
	"code": 200,
	"subCode": null,
	"message": null,
	"data": [{
		"playCount": 7,
		"score": 100,
		"song": {
			"id": "5A8F36EC99EC2A354CE098F62B7991D7",
			"name": "今晚不想睡",
			"duration": 177368,
			"artists": [{
				"id": "EE1838948C35679773217929E28F7862",
				"name": "王赫野",
				"coverImgUrl": "http://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/5639395138885805.jpg"
			}, {
				"id": "1540F19A595DC7FE829E8160728B7EC4",
				"name": "拜德盖Viigho",
				"coverImgUrl": "http://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/5639395138885805.jpg"
			}],
			"fullArtists": [{
				"id": "EE1838948C35679773217929E28F7862",
				"name": "王赫野",
				"coverImgUrl": "http://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/5639395138885805.jpg"
			}, {
				"id": "1540F19A595DC7FE829E8160728B7EC4",
				"name": "拜德盖Viigho",
				"coverImgUrl": "http://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/5639395138885805.jpg"
			}],
			"album": {
				"id": "451C436DB9CA0D87F2B1B8F4AB08A687",
				"name": "今晚不想睡"
			},
			"playFlag": true,
			"downloadFlag": true,
			"payPlayFlag": false,
			"payDownloadFlag": false,
			"vipFlag": true,
			"liked": true,
			"coverImgUrl": "http://p1.music.126.net/ONzjgo8y_6yV9ApiQQKkGg==/109951168991498598.jpg",
			"vipPlayFlag": true,
			"accompanyFlag": null,
			"songMaxBr": 999000,
			"userMaxBr": 999000,
			"maxBrLevel": "vivid",
			"plLevel": "jyeffect",
			"dlLevel": "jyeffect",
			"songTag": ["流行"],
			"privateCloudSong": false,
			"freeTrailFlag": true,
			"songFtFlag": false,
			"freeTrialPrivilege": {
				"cannotListenReason": null,
				"resConsumable": false,
				"userConsumable": false,
				"listenType": null,
				"freeLimitTagType": null
			},
			"songFee": 1,
			"playMaxbr": 999000,
			"qualities": ["vividMusic", "skMusic", "jyMasterMusic", "jyEffectMusic", "sqMusic", "hmusic", "mmusic", "lmusic"],
			"emotionTag": null,
			"vocalFlag": null,
			"payed": {
				"payed": 1,
				"vipPackagePayed": 1,
				"singlePayed": 0,
				"albumPayed": 0
			},
			"visible": true
		}
	}]
}
```

## 获取近期内容推荐

- docId：`e878b43948834b47b93b0025cf947fce`
- 来源：https://developer.music.163.com/st/developer/document?docId=e878b43948834b47b93b0025cf947fce

## 获取近期内容推荐


### /openapi/music/basic/mix/recent/get


```text
- 需申请接口组：云音乐歌曲能力
- 音乐增加近期模块，根据消费行为综合推荐最近播放、创建歌单、收藏歌单、听歌排行等
- 同步的是移动端的数据
```


![图片](https://p5.music.126.net/Jn-WxwHGXxDOf51jl2AKQA==/109951172346279824?imageView&thumbnail=600x600)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>limit</td>
<td>否</td>
<td>Int</td>
<td>获取数量，默认10</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/mix/recent/get?appId=a30102000000000002a56300f02d3889&signType=RSA_SHA256&timestamp=1764141626910&bizContent=%7B%22limit%22%3A%2230%22%7D&device=%7B%22channel%22%3A%22netease%22%2C%22deviceId%22%3A%22bnVsbAkwMjowMDowMDowMDowMDowMAk1ZDFhZDExNGNhMjA1YmI1CW51bGw%3D%22%2C%22deviceType%22%3A%22andrcar%22%2C%22appVer%22%3A%226.1.10%22%2C%22os%22%3A%22andrcar%22%2C%22osVer%22%3A%2210%22%2C%22brand%22%3A%22HONOR%22%2C%22model%22%3A%22LRA-AL00%22%2C%22clientIp%22%3A%22115.236.119.141%22%7D&accessToken=d92f641f89c5b4c46adf54f1af65ac6595ae8019f73eddd18k&sign=pVc2%2FUCWmH0%2B%2FFJ1y1C4bTQG5Vrelb107gDuzQj%2Bmhvvu5tiN8ES9S7k1kYOriRc4YoL%2FopGNKDk%0AWIDAjVxYcq0Z6xp0pn3rPSiI3%2BkX8%2BjHcmfh6Te8CJf3DOEhVdHs4eou1mw2F%2FpHEk2rbsyK2dYl%0AgENbeo0gpNnUzj8nVe2lm%2FZCMvo87VVbOLYd2eOx1d8VaeyFnea%2BBKGe7Z69UQvbsAoI39Yfgfo3%0AqYz%2BCO1Ldzp5A6xUgIjx0ImxbaxLUhUeZ%2FkONnNX0z0lCe4yS%2FcZH2%2Fsw1HHIIXp%2BE0dFWxHSFYC%0AY7Qb1%2FbYNidl6llJ7tLQ%2FodGbyNS%2Bzqk3UZ12A%3D%3D%0A
```


### 返回参数说明


#### resourceType


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>playlist</td>
<td>String</td>
<td>歌单</td>
</tr>
<tr>
<td>album</td>
<td>String</td>
<td>专辑</td>
</tr>
<tr>
<td>songRank</td>
<td>String</td>
<td>听歌排行</td>
</tr>
</tbody>
</table>


#### PLAYLIST


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>String</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>creatorId</td>
<td>String</td>
<td>歌单创建人Id</td>
</tr>
<tr>
<td>createTime</td>
<td>String</td>
<td>创建时间</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>trackCount</td>
<td>int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>specialType</td>
<td>int</td>
<td>歌单类型</td>
</tr>
</tbody>
</table>


#### album


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>language</td>
<td>String</td>
<td>专辑语种</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面</td>
</tr>
<tr>
<td>company</td>
<td>String</td>
<td>发行公司</td>
</tr>
<tr>
<td>genre</td>
<td>String</td>
<td>风格流派</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>歌手信息</td>
</tr>
<tr>
<td>transName</td>
<td>String</td>
<td>中文翻译名</td>
</tr>
<tr>
<td>aliaName</td>
<td>String</td>
<td>别名</td>
</tr>
<tr>
<td>briefDesc</td>
<td>String</td>
<td>简要描述</td>
</tr>
<tr>
<td>description</td>
<td>String</td>
<td>详细描述</td>
</tr>
<tr>
<td>publishTime</td>
<td>String</td>
<td>发行时间</td>
</tr>
<tr>
<td>subed</td>
<td>Boolean</td>
<td>是否收藏</td>
</tr>
</tbody>
</table>


#### songRank


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>name</td>
<td>String</td>
<td>名称</td>
</tr>
<tr>
<td>playCount</td>
<td>String</td>
<td>播放数量</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "recentMix": [
      {
        "resourceType": "playlist",
        "resource": {
          "id": "2CA5F14BCD7B5B70A7CE5EE3FAABDF87",
          "name": "我喜欢的音乐",
          "coverImgUrl": "http://p2.music.126.net/WLZueNhsrAfQgJqbP3ckTg==/109951170063416721.jpg",
          "describe": null,
          "creatorNickName": "热心市民_Potter",
          "creatorAvatarUrl": "http://p1.music.126.net/hbauXe5LeuC5Ylwl5SZTSA==/109951165791651162.jpg",
          "playCount": 9532,
          "subscribedCount": 1,
          "tags": null,
          "createTime": 0,
          "subed": false,
          "trackCount": 1372,
          "specialType": 5,
          "category": null,
          "allFreeTrialFlag": false,
          "trackUpdateTime": 1764139040239,
          "creatorId": "ED048AA6F4BA798A2874090498E38416"
        }
      },
      {
        "resourceType": "album",
        "resource": {
          "id": "4DBB256F061E5582C73C2781665A8CE6",
          "name": "没有信号 LIVE",
          "language": "华语",
          "coverImgUrl": "http://p1.music.126.net/WaYdTFYtkItYfa3TIvU8hQ==/109951170175383241.jpg",
          "company": "华宇世博",
          "transName": null,
          "aliaName": "",
          "genre": "民谣",
          "artists": [
            {
              "id": "DD42F5662EA59CC575A2EC8085BC7AAD",
              "name": "赵雷"
            }
          ],
          "briefDesc": "",
          "description": "",
          "publishTime": 1732204800000,
          "subed": null
        }
      },
      {
        "resourceType": "songRank",
        "resource": {
          "name": "听歌排行",
          "playCount": 16504,
          "coverImgUrl": "https://p5.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/55696036171/affd/5dfe/d5c1/a0d87a7a6d5990fdc0d90200428726b3.png"
        }
      }
    ]
  }
}
```

## 获取最近播放歌曲列表

- docId：`1811d8f3db124c65a66edddcef7e70fc`
- 来源：https://developer.music.163.com/st/developer/document?docId=1811d8f3db124c65a66edddcef7e70fc

## 获取最近播放歌曲列表


### /openapi/music/basic/song/play/record/list


```text
网易云端->iot设备端：实时同步，秒级传输
iot设备端->网易云端：需要做播放数据回传

注意：
1、appver不能超过15个字符，不然会被丢弃，数据无法同步
2、应用需要做数据审核流程，控制台点
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>limit</td>
<td>否</td>
<td>Int</td>
<td>查询条数，默认300条</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质</td>
</tr>
</tbody>
</table>


- 最佳实践：


{"limit":100,"qualityFlag":"true"}


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/song/play/record/list?bizContent={"limit":1,"qualityFlag":true}&appId=a301020000000000746f96a196e52e07&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&timestamp=1715911462117&accessToken=wb6c76d61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&sign=B2aJgMMIryGwwa3MBLedMVC5L%2FK%2FEsQTXKYH%2Foy5ThDklIY%2BG6wB6QNArC8GaxLgt89GdSoQvioFA%2B%2FHz8RyCsw2U4YEf7b4TfoWYFqYBWgBu0zyerD6onDoJsGdVik32Bu2WJ%2BAmuQsDf0Y6WsxK4AjarhNZj%2FIHzKf1LeHUmVT6kH78kBa4wOZkbieoNKUB60DoQ6Hdb6kgeg4iYlk9oUElZiDkXeHH48p35Zu8sfyVAZttoN2oNGMzow3DvNpukQMgI6lWnKS6P52FiS%2B7aFk%2FHMTs7iWkDIin126ATCR9Xsaytoq9vVpX3GzrGfVUhy8KsSMh%2Bkc%2BvjRXCTPKg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>albumName</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>albumId</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>albumArtistId</td>
<td>String</td>
<td>专辑艺人Id</td>
</tr>
<tr>
<td>albumArtistName</td>
<td>String</td>
<td>专辑艺人名</td>
</tr>
<tr>
<td>artistId</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>artistName</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面Url</td>
</tr>
<tr>
<td>mvId</td>
<td>String</td>
<td>mvId</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放url</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载歌曲（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持试听</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>试听起止时间，单位：s</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>songSize</td>
<td>int</td>
<td>歌曲的大小</td>
</tr>
<tr>
<td>songMd5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>br</td>
<td>int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效信息（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "songListVo": [
      {
        "id": "437E5DDF01F9A5DA3A9FDB34360A2092",
        "name": "둘이서",
        "duration": 184000,
        "artists": [
          {
            "id": "70699A59DE46BBCAB3679E955E3CF342",
            "name": "蔡妍"
          }
        ],
        "album": {
          "id": "202E6AAED5370ACC4938B4EFCC9DC872",
          "name": "Virginalness Bloom"
        },
        "playFlag": true,
        "downloadFlag": true,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": false,
        "liked": false,
        "coverImgUrl": "http://p1.music.126.net/liTBhUeQhxZi5t05Ypu1xQ==/109951168907850232.jpg",
        "vipPlayFlag": false,
        "accompanyFlag": null,
        "songMaxBr": 320000,
        "userMaxBr": 320000,
        "maxBrLevel": "exhigh",
        "plLevel": "exhigh",
        "dlLevel": "exhigh",
        "songTag": [
          "流行",
          "电子",
          "电子舞曲",
          "韩国流行"
        ],
        "alg": null,
        "privateCloudSong": false,
        "freeTrailFlag": false,
        "songFtFlag": false,
        "freeTrialPrivilege": {
          "cannotListenReason": null,
          "resConsumable": false,
          "userConsumable": false
        },
        "songFee": 8,
        "playMaxbr": 320000,
        "qualities": [
          "hmusic",
          "mmusic",
          "lmusic"
        ],
        "visible": true
      }
    ]
  }
}
```


## FAQ


1、limit=300或者不传走默认值，问啥返回歌曲数量不足300？


```text
有歌曲下架等原因导致被过滤掉，算是接口特性，不影响使用
```

# 用户资产API

## 获取用户已购歌曲

- docId：`393b4acad0f0443094e42b27340a71ad`
- 来源：https://developer.music.163.com/st/developer/document?docId=393b4acad0f0443094e42b27340a71ad

## 获取用户已购歌曲


### /openapi/music/basic/song/paid/get


### 请求方式：


- POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


[SDK公共参数](?docId=eb75c66cac074beda81216669a4192c9)


[WEB公共参数](?docId=72801c136f144658995fe1ab756a183e)


[移动端公共参数](?docId=98b78be8870c4bfe85aec7791c167f0a)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>offset</td>
<td>否</td>
<td>Int</td>
<td>偏移量，默认0</td>
</tr>
<tr>
<td>limit</td>
<td>否</td>
<td>Int</td>
<td>数据量，默认10</td>
</tr>
<tr>
<td>qualityFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否下发音质，默认false</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://music.163.com//openapi/music/basic/song/paid/get?appId=a301020000000000746f96a196e52e07&bizContent={"qualityFlag":true}&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&timestamp=1735614377863&accessToken=wb6c762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&sign=qsxMi3oHPf4Fe7qxc4YADvjZOpfixhB5ufpEPxardsS8qsxXvs%2F3GZdVbIOWctw4cIcZT4%2BhIURMNDsfmkAmoNqLhXT5Z5SY1t0JZzwB5aWc%2FcT4hPcGESjc5OuRh%2F%2Fqr06dNHcsW31iQTm7ZiwA4%2FnBR1OK%2FDBur2Ko41gR8tl6RtFXPJJ8Tt2W%2B15Z8Dfrn7yWj%2FVqACXY5ua7760jXn%2Fdm3HHj7zgqGbpCwIKP5SmdA5KqM0%2Bc128nLWrTYDcImkKbQchPex98yt2Vx4um6RPAzaevIkFFl2xBc9gP1Lv5%2F6LVwnBYEKyJPMaOwKJamRLv2uMgsqydpGW736uTg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>歌曲时长</td>
</tr>
<tr>
<td>albumName</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>albumId</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>albumArtistId</td>
<td>String</td>
<td>专辑艺人Id</td>
</tr>
<tr>
<td>albumArtistName</td>
<td>String</td>
<td>专辑艺人名</td>
</tr>
<tr>
<td>artistId</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>artistName</td>
<td>String</td>
<td>艺人名</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面Url</td>
</tr>
<tr>
<td>mvId</td>
<td>String</td>
<td>mvId</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放url</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载歌曲（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持试听</td>
</tr>
<tr>
<td>freeTrail</td>
<td>FreeTrail</td>
<td>试听起止时间，单位：s</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>level</td>
<td>String</td>
<td>当前返回的歌曲码率对应的level</td>
</tr>
<tr>
<td>songSize</td>
<td>int</td>
<td>歌曲的大小</td>
</tr>
<tr>
<td>songMd5</td>
<td>String</td>
<td>歌曲的MD5</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>fullArtists</td>
<td>List<Artist></td>
<td>完整艺人列表（包含已下线艺人）</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>br</td>
<td>int</td>
<td>返回的歌曲码率</td>
</tr>
<tr>
<td>audioFlag</td>
<td>int</td>
<td>是否有杜比：1</td>
</tr>
<tr>
<td>effects</td>
<td>String</td>
<td>音效信息（目前仅杜比才有）</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>qualities</td>
<td>List<String></td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>language</td>
<td>String</td>
<td>语种</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**FreeTrail**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>start</td>
<td>Int</td>
<td>试听开始时间</td>
</tr>
<tr>
<td>end</td>
<td>Int</td>
<td>试听结束时间</td>
</tr>
</tbody>
</table>


**Qualities**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>dolbyMusic</td>
<td>String</td>
<td>杜比</td>
</tr>
<tr>
<td>skMusic</td>
<td>String</td>
<td>沉浸环绕声</td>
</tr>
<tr>
<td>jyMasterMusic</td>
<td>String</td>
<td>超清母带</td>
</tr>
<tr>
<td>jyEffectMusic</td>
<td>String</td>
<td>高清臻音</td>
</tr>
<tr>
<td>hrMusic</td>
<td>String</td>
<td>hi-res</td>
</tr>
<tr>
<td>sqMusic</td>
<td>String</td>
<td>无损</td>
</tr>
<tr>
<td>hmusic</td>
<td>String</td>
<td>极高</td>
</tr>
<tr>
<td>mmusic</td>
<td>String</td>
<td>较高</td>
</tr>
<tr>
<td>lmusic</td>
<td>String</td>
<td>标准</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**maxBrLevel、plLevel、dlLevel、level**


<table>
<thead>
<tr>
<th>值</th>
<th>音质</th>
<th>比特率</th>
</tr>
</thead>
<tbody>
<tr>
<td>dobly</td>
<td>杜比</td>
<td>无</td>
</tr>
<tr>
<td>hires</td>
<td>hires</td>
<td>1999</td>
</tr>
<tr>
<td>lossless</td>
<td>无损</td>
<td>999</td>
</tr>
<tr>
<td>exhigh</td>
<td>极高</td>
<td>320</td>
</tr>
<tr>
<td>higher</td>
<td>较高</td>
<td>192</td>
</tr>
<tr>
<td>standard</td>
<td>标准</td>
<td>128</td>
</tr>
<tr>
<td>none</td>
<td>不能播放/下载</td>
<td>0</td>
</tr>
</tbody>
</table>


**songFee**


<table>
<thead>
<tr>
<th>值</th>
<th>说明</th>
<th>详细描述</th>
</tr>
</thead>
<tbody>
<tr>
<td>0</td>
<td>免费</td>
<td>免费歌曲</td>
</tr>
<tr>
<td>1</td>
<td>会员</td>
<td>普通用户无法免费收听下载；会员可收听和下载所有音质</td>
</tr>
<tr>
<td>4</td>
<td>数字专辑</td>
<td>所有用户只能在商城购买数字专辑后，才能收听下载</td>
</tr>
<tr>
<td>8</td>
<td>128K</td>
<td>普通用户可免费收听128k音质（大部分歌曲已支持320k），但不能下载；会员可收听和下载所有音质</td>
</tr>
<tr>
<td>16</td>
<td>只能付费下载</td>
<td>普通用户只能付费下载后使用，不提供在线收听；会员只能下载后使用，不能在线收听</td>
</tr>
<tr>
<td>32</td>
<td>只能付费播放</td>
<td>普通用户只能付费后收听，不能下载；会员可以直接收听，但不能下载</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "recordCount": 2,
    "records": [
      {
        "id": "01AF719CAD443AA5944BFE83F8F3569A",
        "name": "理想",
        "duration": 313906,
        "artists": [
          {
            "id": "C3B22614339CD2FDA7E108B65E460AA9",
            "name": "赵雷"
          }
        ],
        "fullArtists": [
          {
            "id": "C3B22614339CD2FDA7E108B65E460AA9",
            "name": "赵雷"
          }
        ],
        "album": {
          "id": "7329D1F4FFB19EB4A74FC9C93FA1E64F",
          "name": "吉姆餐厅"
        },
        "playFlag": true,
        "downloadFlag": true,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": true,
        "liked": true,
        "coverImgUrl": "http://p1.music.126.net/pwcUlwh9MFZ_V3hGBOPaCQ==/109951169213425474.jpg",
        "vipPlayFlag": true,
        "accompanyFlag": null,
        "songMaxBr": 999000,
        "userMaxBr": 999000,
        "maxBrLevel": "lossless",
        "plLevel": "lossless",
        "dlLevel": "lossless",
        "songTag": [
          "民谣",
          "流行民谣"
        ],
        "privateCloudSong": false,
        "freeTrailFlag": true,
        "songFtFlag": false,
        "freeTrialPrivilege": {
          "cannotListenReason": null,
          "resConsumable": false,
          "userConsumable": false
        },
        "songFee": 1,
        "playMaxbr": 999000,
        "qualities": [
          "vividMusic",
          "skMusic",
          "jyMasterMusic",
          "jyEffectMusic",
          "sqMusic",
          "hmusic",
          "mmusic",
          "lmusic"
        ],
        "emotionTag": null,
        "vocalFlag": null,
        "visible": true
      },
      {
        "id": "5DA44AA31BC0EFECEF00E51277E36966",
        "name": "美丽世界的孤儿",
        "duration": 338546,
        "artists": [
          {
            "id": "B07A0DE4F0B7DE615886F30CC02DBD2B",
            "name": "汪峰"
          }
        ],
        "fullArtists": [
          {
            "id": "B07A0DE4F0B7DE615886F30CC02DBD2B",
            "name": "汪峰"
          }
        ],
        "album": {
          "id": "C84A5AEDFB04C0D44E1FC18211166158",
          "name": "花火"
        },
        "playFlag": true,
        "downloadFlag": true,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": true,
        "liked": true,
        "coverImgUrl": "http://p1.music.126.net/U7o_YfdjdD8KoFOgEo2k-A==/109951166562840538.jpg",
        "vipPlayFlag": true,
        "accompanyFlag": null,
        "songMaxBr": 999000,
        "userMaxBr": 999000,
        "maxBrLevel": "lossless",
        "plLevel": "lossless",
        "dlLevel": "lossless",
        "songTag": [
          "摇滚",
          "摇滚乐"
        ],
        "privateCloudSong": false,
        "freeTrailFlag": true,
        "songFtFlag": false,
        "freeTrialPrivilege": {
          "cannotListenReason": null,
          "resConsumable": false,
          "userConsumable": false
        },
        "songFee": 1,
        "playMaxbr": 999000,
        "qualities": [
          "vividMusic",
          "skMusic",
          "jyMasterMusic",
          "jyEffectMusic",
          "sqMusic",
          "hmusic",
          "mmusic",
          "lmusic"
        ],
        "emotionTag": null,
        "vocalFlag": null,
        "visible": true
      }
    ]
  }
}
```

## 获取用户已购专辑

- docId：`99900726c96d4c0c8b3724d939b7e0f3`
- 来源：https://developer.music.163.com/st/developer/document?docId=99900726c96d4c0c8b3724d939b7e0f3

## 获取用户已购专辑


### /openapi/music/basic/album/paid/get/v2


### 请求方式：


- POST


### 公共参数：


[IOT公共参数](?category=api&type=common&docId=iotCommonParam)


[SDK公共参数](?category=api&type=common&docId=sdkCommonParam)


[WEB公共参数](?category=api&type=common&docId=webCommonParam)


[移动端公共参数](?category=api&type=common&docId=mobileCommonParam)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>offset</td>
<td>是</td>
<td>int</td>
<td>偏移量</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>int</td>
<td>数据量</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
https://openapi.music.163.com/openapi/music/basic/album/paid/get/v2?appId=a301020000000000746f96a196e52e07&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&timestamp=1735553606847&signType=RSA_SHA256&accessToken=wfd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&bizContent={"limit":10,"offset":0}&sign=qsxMi3oHPf4Fe7qxc4YADvjZOpfixhB5ufpEPxardsS8qsxXvs%2F3GZdVbIOWctw4cIcZT4%2BhIURMNDsfmkAmoNqLhXT5Z5SY1t0JZzwB5aWc%2FcT4hPcGESjc5OuRh%2F%2Fqr06dNHcsW31iQTm7ZiwA4%2FnBR1OK%2FDBur2Ko41gR8tl6RtFXPJJ8Tt2W%2B15Z8Dfrn7yWj%2FVqACXY5ua7760jXn%2Fdm3HHj7zgqGbpCwIKP5SmdA5KqM0%2Bc128nLWrTYDcImkKbQchPex98yt2Vx4um6RPAzaevIkFFl2xBc9gP1Lv5%2F6LVwnBYEKyJPMaOwKJamRLv2uMgsqydpGW736uTg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名</td>
</tr>
<tr>
<td>language</td>
<td>String</td>
<td>专辑语种</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>封面</td>
</tr>
<tr>
<td>company</td>
<td>String</td>
<td>发行公司</td>
</tr>
<tr>
<td>transName</td>
<td>String</td>
<td>中文翻译名</td>
</tr>
<tr>
<td>aliaName</td>
<td>String</td>
<td>别名</td>
</tr>
<tr>
<td>genre</td>
<td>String</td>
<td>风格流派</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>歌手信息</td>
</tr>
<tr>
<td>briefDesc</td>
<td>String</td>
<td>简要描述</td>
</tr>
<tr>
<td>description</td>
<td>String</td>
<td>详细描述</td>
</tr>
<tr>
<td>publishTime</td>
<td>String</td>
<td>发行时间</td>
</tr>
<tr>
<td>subed</td>
<td>Boolean</td>
<td>是否收藏</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "recordCount": 2,
    "records": [
      {
        "id": "BCCE9999BA99AA23D919F960565C2346",
        "name": "署前街少年",
        "language": "华语",
        "coverImgUrl": "http://p1.music.126.net/9bVOooAY6U6EJLzpv1Fikw==/109951169682871673.jpg",
        "company": "北京音之邦文化科技有限公司",
        "transName": null,
        "aliaName": "",
        "genre": "华语音乐",
        "artists": [
          {
            "id": "C3B22614339CD2FDA7E108B65E460AA9",
            "name": "赵雷"
          }
        ],
        "briefDesc": "",
        "description": "",
        "publishTime": 1661702400000,
        "subed": null
      },
      {
        "id": "6E456E9FDB0A34E8778F8B53DAAD6B08",
        "name": "黑夜问白天",
        "language": "华语",
        "coverImgUrl": "http://p1.music.126.net/KuwDoBa5kE_TEDt5l1EnuA==/109951169697339183.jpg",
        "company": "华纳音乐",
        "transName": null,
        "aliaName": "",
        "genre": null,
        "artists": [
          {
            "id": "DADE61AB7C43451EBB3B5061D4DBE6E9",
            "name": "林俊杰"
          }
        ],
        "briefDesc": "",
        "description": "",
        "publishTime": 1514217600000,
        "subed": null
      }
    ]
  }
}
```

## 获取用户网盘歌曲

- docId：`4a3a24a059894e2bbded639b891d44a1`
- 来源：https://developer.music.163.com/st/developer/document?docId=4a3a24a059894e2bbded639b891d44a1

## 获取用户网盘歌曲


### /openapi/music/basic/private/cloud/song/list/get


```text
- 必须要登录，匿名用户无网盘歌曲
- 歌单、艺人、最近播放等有网盘歌曲出现的列表，要展示网盘标志
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?category=api&type=common&docId=iotCommonParam)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>一页数据量（最多500条）</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://music.163.com//openapi/music/basic/private/cloud/song/list/get?appId=a301020000000000746f96a196e52e07&bizContent={"limit":30,"offset":0}&timestamp=1728453166557&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&accessToken=6c762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&sign=qsxMi3oHPf4Fe7qxc4YADvjZOpfixhB5ufpEPxardsS8qsxXvs%2F3GZdVbIOWctw4cIcZT4%2BhIURMNDsfmkAmoNqLhXT5Z5SY1t0JZzwB5aWc%2FcT4hPcGESjc5OuRh%2F%2Fqr06dNHcsW31iQTm7ZiwA4%2FnBR1OK%2FDBur2Ko41gR8tl6RtFXPJJ8Tt2W%2B15Z8Dfrn7yWj%2FVqACXY5ua7760jXn%2Fdm3HHj7zgqGbpCwIKP5SmdA5KqM0%2Bc128nLWrTYDcImkKbQchPex98yt2Vx4um6RPAzaevIkFFl2xBc9gP1Lv5%2F6LVwnBYEKyJPMaOwKJamRLv2uMgsqydpGW736uTg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌曲Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌曲名称</td>
</tr>
<tr>
<td>duration</td>
<td>long</td>
<td>时长</td>
</tr>
<tr>
<td>artists</td>
<td>List<Artist></td>
<td>艺人列表</td>
</tr>
<tr>
<td>album</td>
<td>Album</td>
<td>专辑信息</td>
</tr>
<tr>
<td>playFlag</td>
<td>Boolean</td>
<td>是否可以播放（true，false）</td>
</tr>
<tr>
<td>downloadFlag</td>
<td>Boolean</td>
<td>是否可以下载（true，false）</td>
</tr>
<tr>
<td>payPlayFlag</td>
<td>Boolean</td>
<td>是否需要付费才能播放（true、false）</td>
</tr>
<tr>
<td>payDownloadFlag</td>
<td>Boolean</td>
<td>是否需要付费才能下载（true、false）</td>
</tr>
<tr>
<td>vipFlag</td>
<td>boolean</td>
<td>需要VIP才能播放和下载</td>
</tr>
<tr>
<td>vipPlayFlag</td>
<td>boolean</td>
<td>需要VIP才能播放</td>
</tr>
<tr>
<td>freeTrailFlag</td>
<td>boolean</td>
<td>是否支持试听</td>
</tr>
<tr>
<td>liked</td>
<td>boolean</td>
<td>是否喜欢</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌曲封面url</td>
</tr>
<tr>
<td>songMaxBr</td>
<td>int</td>
<td>歌曲原本的最大码率（已失效）</td>
</tr>
<tr>
<td>userMaxBr</td>
<td>int</td>
<td>用户能播放的最大码率（已失效）</td>
</tr>
<tr>
<td>maxBrLevel</td>
<td>String</td>
<td>歌曲拥有最大码率对应的level</td>
</tr>
<tr>
<td>plLevel</td>
<td>String</td>
<td>用户可播放歌曲最大码率对应的level</td>
</tr>
<tr>
<td>dlLevel</td>
<td>String</td>
<td>用户可下载歌曲最大码率对应的level</td>
</tr>
<tr>
<td>privateCloudSong</td>
<td>Boolean</td>
<td>是否云盘歌曲</td>
</tr>
<tr>
<td>songTag</td>
<td>List<String></td>
<td>歌曲的曲风标签</td>
</tr>
<tr>
<td>alg</td>
<td>String</td>
<td>算法推荐使用，播放数据上报接口需透传该字段</td>
</tr>
<tr>
<td>songFee</td>
<td>int</td>
<td>歌曲付费类型</td>
</tr>
<tr>
<td>qualities</td>
<td>int</td>
<td>支持的音质列表</td>
</tr>
<tr>
<td>visible</td>
<td>Boolean</td>
<td>是否有版权（true，false）</td>
</tr>
</tbody>
</table>


**Artist**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>艺人Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>艺人名称</td>
</tr>
</tbody>
</table>


**Album**


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>专辑Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>专辑名称</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": "200",
  "message": null,
  "data": {
    "recordCount": 455,
    "records": [
      {
        "id": "236BB8F163634173B76CA7A3BDE16A2A",
        "name": "小小",
        "duration": 264601,
        "artists": [
          {
            "id": "9DC78D8C719C13A5A3470ED1937EC28C",
            "name": "容祖儿"
          }
        ],
        "album": {
          "id": "38EA7E7D4B1374D9FA30E432D499CF69",
          "name": "小小"
        },
        "playFlag": true,
        "downloadFlag": true,
        "payPlayFlag": false,
        "payDownloadFlag": false,
        "vipFlag": true,
        "liked": true,
        "coverImgUrl": "http://p1.music.126.net/WDcYhuw0EejVMVCxgFl0Bg==/120946279068536.jpg",
        "vipPlayFlag": true,
        "accompanyFlag": null,
        "songMaxBr": 999000,
        "userMaxBr": 816000,
        "maxBrLevel": "lossless",
        "plLevel": "lossless",
        "dlLevel": "lossless",
        "songTag": [
          "流行",
          "华语流行",
          "国风",
          "国风流行"
        ],
        "privateCloudSong": true,
        "freeTrailFlag": true,
        "songFtFlag": false,
        "freeTrialPrivilege": {
          "cannotListenReason": null,
          "resConsumable": false,
          "userConsumable": false
        },
        "songFee": 1,
        "playMaxbr": 999000,
        "qualities": null,
        "emotionTag": null,
        "visible": true
      }
    ]
  }
}
```


### 备注


- playFlag为false则需要调用提示文案统一接口`/openapi/music/basic/song/text/play/get/v2`

- downloadFlag为false，需要调用提示文案统一接口`/openapi/music/basic/song/text/download/get/v2`

# 播放数据回传API

## 音乐/长音频播放数据回传

- docId：`eb0ddaf2efc649e99dffe0677472466a`
- 来源：https://developer.music.163.com/st/developer/document?docId=eb0ddaf2efc649e99dffe0677472466a

## 播放数据回传


### /openapi/music/basic/play/data/record


```text
要求所有接入方必做，指当用户产生播放行为时，合作方调用回传接口将用户的播放数据回传给云音乐。接入方必须按照文档要求将数据回传给云音乐，回传数据不涉及用户隐私。
  1）数据分析，了解各端场景用户收听喜好，给用户推荐更精准内容
  2）数据融合，同接入方进行数据融合，场景化推送，千人千面内容推送
  3）听歌时长统计，影响用户听歌报告
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


**注意1: 公共参数中的accessToken需保证每台设备或每个用户唯一。如匿名登录时，每台设备需生成唯一的匿名accessToken。**


- 一旦有实名登录，就需要切实名token进行回传；实名用户登录状态变更时（用户主动退出、token过期、修改密码等），切换匿名token进行回传


**注意2：请确保设备id可信，设备id在单设备上稳定（单设备重启、升级等情况下不变）且唯一（设备间不重复）**


**注意3：回传后，最近播放-歌曲、声音可直接同步网易云端，歌单、专辑、播单、有声书需传sourceId、sourceType和categoryId**


**注意4：最近播放同步云音乐服务端触发点：startplay**


**注意5：公共参数中的clientIp非常重要，请确保其为客户端出口ip（用户终端ip），而非服务端中转ip**


**注意6：公共参数中的osVer、appVer重要，请确保其可信（随着应用、系统升级，osVer、appVer均需升级）**


### 业务参数（bizContent）：


**开始播放的数据回传**


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>是</td>
<td>Sting</td>
<td>当前资源id, 例如：歌曲的id，声音的id或者encVoiceId</td>
</tr>
<tr>
<td>action</td>
<td>是</td>
<td>String</td>
<td>行为，startplay:开始播放</td>
</tr>
<tr>
<td>bitrate</td>
<td>是</td>
<td>Int</td>
<td>码率，单位/kbps。song传实际播放码率，128：标准，320：极高，999：无损，1999：hires，高清臻音：3999，超清母带：4999，沉浸环绕声：4099，杜比全景声：2999，臻音全景声（vivid）：5999，播客固定传128</td>
</tr>
<tr>
<td>file</td>
<td>是</td>
<td>Int</td>
<td>文件类型回传枚举值：0：下载文件， 1：本地文件， 2：缓存文件， 3：云盘文件， 4：线上文件。不清楚填4</td>
</tr>
<tr>
<td>type</td>
<td>是</td>
<td>Sting</td>
<td>类型，song：歌曲, dj：播客</td>
</tr>
<tr>
<td>startLogTime</td>
<td>是</td>
<td>Long</td>
<td>开始播放时的时间戳，单位：毫秒</td>
</tr>
<tr>
<td>alg</td>
<td>是</td>
<td>Sting</td>
<td>算法使用，私人漫游、每日推荐和场景音乐已返回该字段，产生播放时需透传alg（其余场景可参考下方，也可不传）</td>
</tr>
<tr>
<td>isAudition</td>
<td>否</td>
<td>Int</td>
<td>试听类型，1：片段试听（固定传1），2：全曲试听</td>
</tr>
<tr>
<td>auditionStart</td>
<td>否</td>
<td>Int</td>
<td>试听片段开始时间点（从上游接口取，不同用户不一样），单位/s</td>
</tr>
<tr>
<td>auditionEnd</td>
<td>否</td>
<td>Int</td>
<td>试听片段结束时间点（从上游接口取，不同用户不一样），单位/s</td>
</tr>
<tr>
<td>sourceId</td>
<td>是</td>
<td>Sting</td>
<td>播放来源资源ID（最近常听必传）</td>
</tr>
<tr>
<td>sourceType</td>
<td>是</td>
<td>Sting</td>
<td>播放来源资源类型（最近常听必传）</td>
</tr>
<tr>
<td>categoryId</td>
<td>否</td>
<td>Long</td>
<td>播客categoryId</td>
</tr>
<tr>
<td>openApiTraceInfo</td>
<td>否</td>
<td>String</td>
<td>全曲试听播放时需透传该字段（播放地址相关接口会下发）</td>
</tr>
<tr>
<td>ext</td>
<td>否</td>
<td>String</td>
<td>设备唯一识别码，游戏必传，ios传idfa，android传oaid，eg：{"idfa":"abc"}或{"oaid":"def"}</td>
</tr>
</tbody>
</table>


**结束播放的数据回传**


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>是</td>
<td>Sting</td>
<td>当前资源id, 例如：歌曲的id，声音的id或者encVoiceId</td>
</tr>
<tr>
<td>action</td>
<td>是</td>
<td>String</td>
<td>行为，play：结束播放</td>
</tr>
<tr>
<td>bitrate</td>
<td>是</td>
<td>Int</td>
<td>码率，单位/kbps。song传实际播放码率，128：标准，320：极高，999：无损，1999：hires，高清臻音：3999，超清母带：4999，沉浸环绕声：4099，杜比全景声：2999，臻音全景声（vivid）：5999，播客固定传128</td>
</tr>
<tr>
<td>file</td>
<td>是</td>
<td>Int</td>
<td>文件类型回传枚举值：0：下载文件， 1：本地文件， 2：缓存文件， 3：云盘文件， 4：线上文件。不清楚填4</td>
</tr>
<tr>
<td>type</td>
<td>是</td>
<td>Sting</td>
<td>类型，song：歌曲, dj：播客</td>
</tr>
<tr>
<td>startLogTime</td>
<td>是</td>
<td>long</td>
<td>开始播放时的时间戳，单位：毫秒</td>
</tr>
<tr>
<td>time</td>
<td>是</td>
<td>double</td>
<td>播放时长，单位：秒， 播放完成或者中止播放时的时长，按照实际播放时长统计，不包含暂停，不能超过歌曲总时长</td>
</tr>
<tr>
<td>end</td>
<td>是</td>
<td>Sting</td>
<td>结束方式回传枚举值：playend：正常结束（歌曲播放到结尾自然结束；系统自动触发上报）；interrupt：第三方APP打断（第三方应用抢占音频焦点；系统通知或电话等打断播放）； exception：错误（网络错误导致播放失败；歌曲文件损坏；其他技术异常）； ui: 用户切歌（用户主动切换到下一首/上一首；用户切换播放列表；用户点击指定歌曲播放；用户暂停播放）。不清楚填playend</td>
</tr>
<tr>
<td>alg</td>
<td>是</td>
<td>Sting</td>
<td>算法使用，私人漫游、每日推荐和场景音乐已返回该字段，产生播放时需透传alg（其余场景可参考下方，也可不传）</td>
</tr>
<tr>
<td>isAudition</td>
<td>否</td>
<td>Int</td>
<td>试听类型，1：片段试听（固定传1），2：全曲试听</td>
</tr>
<tr>
<td>auditionStart</td>
<td>否</td>
<td>Int</td>
<td>试听片段开始时间偏移（从上游接口取，不同用户不一样），单位/s</td>
</tr>
<tr>
<td>auditionEnd</td>
<td>否</td>
<td>Int</td>
<td>试听片段时间偏移（从上游接口取，不同用户不一样），单位/s</td>
</tr>
<tr>
<td>sourceId</td>
<td>是</td>
<td>Sting</td>
<td>播放来源资源ID（最近常听必传）</td>
</tr>
<tr>
<td>sourceType</td>
<td>是</td>
<td>Sting</td>
<td>播放来源资源类型（最近常听必传）</td>
</tr>
<tr>
<td>categoryId</td>
<td>否</td>
<td>Long</td>
<td>播客categoryId</td>
</tr>
<tr>
<td>openApiTraceInfo</td>
<td>否</td>
<td>String</td>
<td>全曲试听播放时需透传该字段（播放地址相关接口会下发）</td>
</tr>
<tr>
<td>ext</td>
<td>否</td>
<td>String</td>
<td>设备唯一识别码，游戏必传，ios传idfa，android传oaid，eg：{"idfa":"abc"}或{"oaid":"def"}</td>
</tr>
</tbody>
</table>


- auditionStart、auditionEnd就是试听起止时间，用作版权结算，不是用户真实播放时长

- alg字段除了每日推荐、私人漫游、场景电台等场景分发外，，也可以增加上游数据来源（目前不强制要求），回传歌单id、艺人id、专辑id等

- 注意，播放时长等于0（time=0）的数据无需回传


<table>
<thead>
<tr>
<th>序号</th>
<th>场景</th>
<th>alg</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>每日推荐</td>
<td>接口分发（必传）</td>
</tr>
<tr>
<td>2</td>
<td>私人漫游</td>
<td>接口分发 （必传）</td>
</tr>
<tr>
<td>3</td>
<td>场景电台</td>
<td>接口分发 （必传）</td>
</tr>
<tr>
<td>4</td>
<td>搜索</td>
<td>search（不要求）</td>
</tr>
<tr>
<td>5</td>
<td>杜比专区</td>
<td>dobly_上游资源id（不要求）</td>
</tr>
<tr>
<td>6</td>
<td>hires专区</td>
<td>hires_上游资源id（不要求）</td>
</tr>
</tbody>
</table>


**action字段详解**


<table>
<thead>
<tr>
<th>action 名字</th>
<th>含义</th>
<th>回传时机</th>
</tr>
</thead>
<tbody>
<tr>
<td>startplay</td>
<td>播放开始</td>
<td>播放开始打点，不包含暂停-->开始 ，播放状态变更: 当歌曲从准备状态切换到正在播放状态时自动触发（播放器状态切成play）；发生场景: 用户点击播放、自动播放下一首、恢复播放等</td>
</tr>
<tr>
<td>play</td>
<td>播放结束</td>
<td>播放结束打点，不包含暂停。触发时机：请参考end的四种状态（playend/ui/exception/interrupt）</td>
</tr>
</tbody>
</table>


- 综上，一首歌的回传日志有且仅有两条，startplay和play


**time字段详解**


<table>
<thead>
<tr>
<th>序号</th>
<th>场景</th>
<th>time</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>用户正常听歌10s</td>
<td>10</td>
</tr>
<tr>
<td>2</td>
<td>⽤户正常听歌10S，2倍速听歌10S</td>
<td>10+2*10 = 30</td>
</tr>
<tr>
<td>3</td>
<td>⽤户正常听歌10S，2倍速听歌10S，0.5倍速听10S</td>
<td>10+2* 10+0.5* 10= 35</td>
</tr>
<tr>
<td>4</td>
<td>⽤户正常听歌10S后滑动到歌曲的第20S继续听10S 到歌曲的第30S</td>
<td>10+10=20</td>
</tr>
<tr>
<td>5</td>
<td>⽤户正常听歌30S后滑动到歌曲的第10S继续听20S 到歌曲的第30S</td>
<td>30+20=50</td>
</tr>
<tr>
<td>6</td>
<td>其他滑动和倍速交叉场景⼀致</td>
<td></td>
</tr>
</tbody>
</table>


- 倍速场景下的歌曲播放时⻓ ：time=（time1 * speed1+time2 * speed2···）,无倍速时和time一致


**sourceType**


当前sourceType支持如下五种枚举类型，按规定传参可使得播放回传数据进入首页-最近常听模块及我的-最近播放tab中（歌单、播客、有声书、声音等）


<table>
<thead>
<tr>
<th>type</th>
<th>资源</th>
</tr>
</thead>
<tbody>
<tr>
<td>list</td>
<td>歌单</td>
</tr>
<tr>
<td>album</td>
<td>专辑</td>
</tr>
<tr>
<td>dailySongRecommend</td>
<td>每日推荐</td>
</tr>
<tr>
<td>userfm</td>
<td>私人漫游</td>
</tr>
<tr>
<td>djradio</td>
<td>播单（包含有声书等所有分类）</td>
</tr>
</tbody>
</table>


- 别的场景不用传，null就行，比如：场景电台


**sourceId**


sourceId不同资源传不同的值，具体规则如下


<table>
<thead>
<tr>
<th>条件</th>
<th>值</th>
</tr>
</thead>
<tbody>
<tr>
<td>播放来源为歌单，sourceType=list时</td>
<td>sourceId=来源歌单ID</td>
</tr>
<tr>
<td>播放来源为专辑，sourceType=album时</td>
<td>sourceId=来源专辑ID</td>
</tr>
<tr>
<td>播放来源为每日推荐，sourceType=dailySongRecommend时</td>
<td>sourceId=dailySongRecommend</td>
</tr>
<tr>
<td>播放来源为私人漫游，sourceType=userfm时</td>
<td>sourceId=userfm</td>
</tr>
<tr>
<td>播放来源为播单，sourceType=djradio时</td>
<td>sourceId=来源播单ID（包含有声书等所有分类）</td>
</tr>
</tbody>
</table>


### 最佳实践：


- 歌曲


开始播放


```text
{"id":"01AF719CAD443AA5944BFE83F8F3569A","action":"startplay","bitrate":128,"file":4,"type":"song","startLogTime":"1653373289000","alg":"xxx","sourceId":"xxx","sourceType":"xxx","netStatus":"5g"}
```


结束播放


```text
{"id":"01AF719CAD443AA5944BFE83F8F3569A","action":"play","bitrate":128,"file":4,"type":"song","startLogTime":"1653373289000","time":100,"end":"playend","alg":"xxx","sourceId":"xxx","sourceType":"xxx","netStatus":"5g"}
```


- 播客：


开始播放


```text
{"id":"2495287087","action":"startplay","bitrate":128,"file":4,"type":"dj","startLogTime":1724073040000,,"sourceId":"xxx","sourceType":"xxx","categoryId":"xxx","netStatus":"5g"}
```


结束播放


```text
{"id":"2495287087","action":"play","bitrate":128,"file":4,"type":"dj","startLogTime":1724073040000,"time":100,"end":"xxx","sourceId":"xxx","sourceType":"xxx","categoryId":"xxx","netStatus":"5g"}
```


### 示例：


```text
https://openapi.music.163.com/openapi/music/basic/play/data/record?appId=a301020000000000746f96a196e52e07&signType=RSA_SHA256&timestamp=1660881438305&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&bizContent={"action":"startplay","bitrate":128,"file":4,"type":"song","startLogTime":"1653373289000","id":"01AF719CAD443AA5944BFE83F8F3569A"}&sign=hoxD0q9CyLZj+Z2yYLjCVs1sVInjphTFecgzWc6Y3zIOL1GTidmwXxc7Yv6HNOsf+9rKUT3mEi+kDhj22yqrBrnDEVMjySSAM21OSzESHL0RdtS2aLaTG7kmJmK4VX0S6UliNE57gOLJSWxICv00eT+nbss8gGUREvkgo867+1qczMhqa5HN0v6HNJbaa5NSUmJX9lUBRBIlwpa9qIVLnYtbG7oWS0TbWbku/LluQDzBxyuBhv0BXZKCjCVZ9D3xL8Tegldxq+/MftaudJjD0eA8nR9d+zHEVvmrTZE7LXSeHrT0iJcz6goz+SHPjFtY0HChPaGV/OYrAnSF6r2h0Q==&accessToken=sbc3d8e0323707d8fe8858f3c1561734547ad71544abbef80c
```


### 返回示例


```text
{
    "code":200,
    "subCode":null,
    "message":null,
    "data":true / false
}
```


### 常见错误案例


1、time字段单位错误


- https://music.163.com/#/song?id=28838040

- 歌曲总时长只有211s，但是time传了211123

- 正确做法：time=211


```text
{"action":"play","time":"211123","end":"playend","bitrate":"128","file":"4","type":"song","startLogTime":"1757998450716","id":"6E2ADF1F9B91B4EAD6507EFB24BC0317","alg":"","sourceId":"825236C11E263B45E67E3B4FE73348C3","sourceType":"list"}
```


2、单曲循环时，time字段累加


- https://music.163.com/#/song?id=28838040

- 歌曲总时长只有211s，但是time传了970

- 正确做法：time=211，多次播放，多次回传，不能超过歌曲总时长


```text
{"action":"play","time":"970","end":"ui","bitrate":"128","file":"4","type":"song","startLogTime":"1757998450716","id":"6E2ADF1F9B91B4EAD6507EFB24BC0317","alg":"","sourceId":"825236C11E263B45E67E3B4FE73348C3","sourceType":"list"}
```

# 收藏&创建API

## 用户取消收藏歌单

- docId：`5f2aa23db2aa411b8ccec5fa40ad501a`
- 来源：https://developer.music.163.com/st/developer/document?docId=5f2aa23db2aa411b8ccec5fa40ad501a

## 用户取消收藏歌单


### /openapi/music/basic/playlist/unsub/v2


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?category=api&type=common&docId=iotCommonParam)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>是</td>
<td>string</td>
<td>歌单Id</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/unsub/v2?bizContent%3d%7b%22grantCode%22%3a%22123%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回示例


正常情况


```text
{
    "code":200,
    "subCode":null,
    "message":null,
    "data":true
}
```


不能收藏/取消收藏自己创建的歌单


```text
{
  "code": 400,
  "message": "取消收藏歌单失败",
  "debugInfo": null,
  "data": null,
  "failData": null
}
```


### 备注


- 需要传入accessToken

## 添加或删除红心歌曲

- docId：`f9a2353b14de42cd925c61de66095e0e`
- 来源：https://developer.music.163.com/st/developer/document?docId=f9a2353b14de42cd925c61de66095e0e

## 添加或删除红心歌曲


### /openapi/music/basic/playlist/song/like/v2


- 匿名用户暂不支持添加付费歌曲


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songId</td>
<td>是</td>
<td>String</td>
<td>歌曲id</td>
</tr>
<tr>
<td>isLike</td>
<td>是</td>
<td>Boolean</td>
<td>添加/删除</td>
</tr>
</tbody>
</table>


- plagflag=false&songfee=4，就提示需要在手机端完成购买


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/song/like/v2?bizContent%3d%7b%22songId%22%3a%225CF4DA1F06D2AB3AC61AB1A665C7D588%22%2c%22isLike%22%3a%22false%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回示例


```text
{
    "code":200,
    "subCode":null,
    "message":null,
    "data":null
}
```


### 备注


- 公共参数需要传入accessToken

## 获取用户收藏的歌单列表

- docId：`1b3d86a47f2e45c7bd631bcd26052382`
- 来源：https://developer.music.163.com/st/developer/document?docId=1b3d86a47f2e45c7bd631bcd26052382

## 获取用户收藏的歌单列表


### /openapi/music/basic/playlist/subed/get/v2


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](https://developer.music.163.com/st/developer/document?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>一页数据量（最多500条）</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
<tr>
<td>originalCoverFlag</td>
<td>否</td>
<td>Boolean</td>
<td>是否使用原始封面（无水印），默认：false</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/subed/get/v2?bizContent%3d%7b%22limit%22%3a%22123%22%2c%22offset%22%3a%22123%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


- Records参数（列表）


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>playCount</td>
<td>Int</td>
<td>播放量</td>
</tr>
<tr>
<td>trackCount</td>
<td>Int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>Int</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>createTime</td>
<td>long</td>
<td>创建时间（时间戳）</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
    "code":200,
    "subCode":null,
    "message":null,
    "data":{
        "recordCount":1301,
        "records":[
            {
                "id":"EC1C091CD575E0143D1A12672904BEB2",
                "name":"[欧美私人订制] 最懂你的欧美推荐 每日更新35首",
                "coverImgUrl":"http://p3.music.126.net/ov41Jb2wGPGo8XJsMPiabg==/109951164273699524.jpg",
                "describe":"收藏专属于你的欧美日推每天和喜欢的欧美音乐不期而遇",
                "creatorNickName":"网易云音乐",
                "playCount":210376736,
                "subscribedCount":2679925,
                "tags":[
                    "欧美"
                ],
                "createTime": 0,
                "trackCount": 357,
                "subed": false
            }
        ]
    }
}
```


### 备注


- 需要传入accessToken

## 批量删除歌单内歌曲

- docId：`19b352625a9843f9b86521f49b856542`
- 来源：https://developer.music.163.com/st/developer/document?docId=19b352625a9843f9b86521f49b856542

## 批量删除歌单内歌曲


### /openapi/music/basic/playlist/song/batch/delete


```text
批量删除指定歌单内的歌曲，需是自己的歌单
```


### 请求方式：


- GETPOST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>playlistId</td>
<td>是</td>
<td>string</td>
<td>歌单Id</td>
</tr>
<tr>
<td>songIdList</td>
<td>是</td>
<td>List<String></td>
<td>待删除歌曲Id列表，上限500</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
https://openapi.music.163.com/openapi/music/basic/playlist/song/batch/delete?appId=a301020000000000746f96a196e52e07&signType=RSA_SHA256&timestamp=1663575750656&device={"deviceType":"andrcar","os":"andrcar","appVer":"0.1","channel":"didi","model":"kys","deviceId":"357","brand":"didi","osVer":"8.1.0","clientIp":"192.168.0.1"}&bizContent={"playlistId":"0DE9CA8A4D475A1332E2F82339EFB684","songIdList":["F1DEC869860BB146A68E0399E36E4F9E"]}&sign=XPPwGKzAkD57MkrzvFH6aWUfADEMDTwbxet4WZSzY%2BZOobP518qKTE65blo9rIrzDi%2BWGURPnjm8YGOby60TbhEHb%2FvVQZAOTRZ%2BgNrY9vszhy3WhYwq9xkVc9Pl9%2FkK7AaSKGlhjL0Fji9P2B9PhB2bxI%2FdW%2FZt6dpnUeO%2FaBl0nt4gB0AmUQQQ7tJvedZASQrpyqO6pXKFRN%2F%2B9ZL%2Fl9ztSqHfiaegh3d5BkFAxnHF6GmqbjZuRP8vA0XwMPpw7GnnF7QQV2XHDxZ4pxPOxgkx%2FnvaNbrP6%2Bz66Elm7CIAeNnPZGgEG6c8YgqqMScaG7cb8ah9ZKbUEiQr2ZN2Sg%3D%3D&accessToken=sd38dcbfbb03ef35ecab644020ca0ac453d59c7a0fa2f35h
```


### **返回示例**


`{
    "code":200,
    "subCode":null,
    "message":null,
    "data":true
}
`
异常情况


```text
{
  "code": 400,
  "message": "部分歌曲不存在于歌单，请检查",
  "debugInfo": null,
  "data": null,
  "failData": null
}
```

## 获取用户红心歌单

- docId：`f0b639bf1494424188a8360d4a22fdd4`
- 来源：https://developer.music.163.com/st/developer/document?docId=f0b639bf1494424188a8360d4a22fdd4

## 获取用户红心歌单


### /openapi/music/basic/playlist/star/get/v2


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?category=api&type=common&docId=iotCommonParam)


### 业务参数（bizContent）：


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/star/get/v2?appId=a301010000000000aadb4e5a28b45a67&bizContent=%7B%22limit%22%3A+10%2C%22offset%22%3A+1%7D&appSecret=de6882f913d59560c9f37345f4cb0053&accessToken=hdceca4830112b07cac4a5578d43a4f11ebd2a29052d1fa36b&device=%7B%22deviceType%22%3A%22andrwear%22%2C%22os%22%3A%22otos%22%2C%22appVer%22%3A%220.1%22%2C%22channel%22%3A%22hm%22%2C%22model%22%3A%22kys%22%2C%22deviceId%22%3A%22357%22%2C%22brand%22%3A%22hm%22%2C%22osVer%22%3A%228.1.0%22%7D&timestamp=1614021030065&signType=RSA_SHA256
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>playCount</td>
<td>Int</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>Int</td>
<td>收藏量</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>createTime</td>
<td>long</td>
<td>创建时间（时间戳）</td>
</tr>
<tr>
<td>trackCount</td>
<td>Int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
<tr>
<td>specialType</td>
<td>Int</td>
<td>歌单类型</td>
</tr>
</tbody>
</table>


### **返回示例**


`{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "id": "2B82A68567F93A51BF029294C872DD00",
    "name": "我喜欢的音乐",
    "coverImgUrl": "http://p1.music.126.net/9-rm4PUkKuL-lD1Rgg6SDw==/109951165434984508.jpg",
    "describe": null,
    "creatorNickName": null,
    "playCount": 0,
    "subscribedCount": 0,
    "tags": null,
    "createTime": 0,
    "subed": false,
    "trackCount": 0,
    "specialType": 5,
    "category": null
  }
}
`
**备注**


- 需要传入accessToken

## 获取用户创建的歌单列表

- docId：`e4fef4e5cc564fc1adbcfcf02140f0d5`
- 来源：https://developer.music.163.com/st/developer/document?docId=e4fef4e5cc564fc1adbcfcf02140f0d5

## 获取用户创建的歌单列表


### /openapi/music/basic/playlist/created/get/v2


```text
历史原因，该接口最后一个歌单是红心歌单（不要可自行删除）
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?category=api&type=common&docId=iotCommonParam)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>limit</td>
<td>是</td>
<td>Int</td>
<td>一页数据量（最多500条）</td>
</tr>
<tr>
<td>offset</td>
<td>是</td>
<td>Int</td>
<td>偏移量</td>
</tr>
</tbody>
</table>


- 会默认增加一个红心歌单在末尾，不需要可以自行处理下


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/created/get/v2?bizContent%3d%7b%22limit%22%3a%22123%22%2c%22offset%22%3a%22123%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### 返回参数说明


- Records参数（列表）


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>String</td>
<td>歌单Id</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>歌单名称</td>
</tr>
<tr>
<td>describe</td>
<td>String</td>
<td>歌单描述</td>
</tr>
<tr>
<td>coverImgUrl</td>
<td>String</td>
<td>歌单封面url</td>
</tr>
<tr>
<td>creatorNickName</td>
<td>String</td>
<td>创建者昵称</td>
</tr>
<tr>
<td>playCount</td>
<td>Int</td>
<td>播放量</td>
</tr>
<tr>
<td>subscribedCount</td>
<td>Int</td>
<td>收藏量</td>
</tr>
<tr>
<td>trackCount</td>
<td>Int</td>
<td>歌单下歌曲总数</td>
</tr>
<tr>
<td>tags</td>
<td>List<String></td>
<td>标签</td>
</tr>
<tr>
<td>createTime</td>
<td>long</td>
<td>创建时间（时间戳）</td>
</tr>
<tr>
<td>subed</td>
<td>boolean</td>
<td>是否收藏</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
    "code": 200,
    "subCode": null,
    "message": null,
    "data": {
        "recordCount": 2,
        "records": [
            {
                "id": "1A9910C070E44B82B24CE147AED8DFB8",
                "name": "老歌",
                "coverImgUrl": "http://p1.music.126.net/jWE3OEZUlwdz0ARvyQ9wWw==/109951165474121408.jpg",
                "describe": null,
                "creatorNickName": "热心市民_Potter",
                "playCount": 0,
                "subscribedCount": 0,
                "tags": [],
                "createTime": 1666065565122,
                "subed": false,
                "trackCount": 0,
                "specialType": 0,
                "category": null
            },
             {
                "id": "3C80FFB1BB4D095FE15D8934D04B9CEB",
                "name": "热心市民_Potter喜欢的音乐",
                "coverImgUrl": "http://p1.music.126.net/uXyY5ZUGuLXuqL-4Y83aIA==/109951166583522458.jpg",
                "describe": null,
                "creatorNickName": null,
                "playCount": 0,
                "subscribedCount": 0,
                "tags": null,
                "createTime": 0,
                "subed": false,
                "trackCount": 214,
                "specialType": 5,
                "category": null
            }]
           }
          }
```


### 备注


- 需要传入accessToken

## 批量添加歌曲到歌单

- docId：`81deeef0f74147dba249531b5e08042d`
- 来源：https://developer.music.163.com/st/developer/document?docId=81deeef0f74147dba249531b5e08042d

## 批量添加歌曲到歌单


### /openapi/music/basic/playlist/song/batch/like


```text
批量添加歌曲到指定歌单，需是自己的
```


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>playlistId</td>
<td>是</td>
<td>string</td>
<td>歌单Id</td>
</tr>
<tr>
<td>songIdList</td>
<td>是</td>
<td>List<String></td>
<td>待收藏歌曲Id列表</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/song/batch/like?appId=a301020000000000746f96a196e52e07&device=%7B%22deviceType%22:%22andrcar%22,%22os%22:%22andrcar%22,%22appVer%22:%220.1%22,%22channel%22:%22didi%22,%22model%22:%22kys%22,%22deviceId%22:%22357%22,%22brand%22:%22didi%22,%22osVer%22:%228.1.0%22,%22clientIp%22:%22192.168.0.1%22%7D&accessToken=wb6c762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&timestamp=1684220608784&bizContent=%7B%22playlistId%22:%223C80FFB1BB4D095FE15D8934D04B9CEB%22,%22songIdList%22:[%22BE4A4F7ABE9D1D871984046327D72BA4%22]%7D&signType=RSA_SHA256&sign=Q9YV2KLn%2FaUg7VIn%2B7S4aeR7dxAkEZw7U5FWknefV6Jd9niCcz9MfrFMkWgHH5MVfmnw%2FPTpBt6uAunwcQisLf5XpkdAqqqT4%2BBfM9hpJVQhZ4EgbtYa24E0TlhC4MbRfmChFSemhpQ0CUsdpj616Lw1nQa9JvuC%2BBWCmmSTFaghLAKUSy5XEPv0FYU90mFbdaRneMPBp1YeM07NmTpNhju%2FBgyNyeOrYWX76d22YVXmw7gKL93fnIwk4FxDXWZPaq3glL%2BCAg30SJ%2BCTJV8A4U3U1ujVbeJudDVdPbczbe0L8M9cedLmhpqfk27iP9dUQjS6d4SW2wzEmJYUDWL3g%3D%3D
```


### **返回示例**


```text
{
    "code":200,
    "subCode":null,
    "message":null,
    "data":true
}
```


重复添加


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": []
}
```

## 用户收藏歌单

- docId：`eb8bef1f8603489f8c31b4b9720eda24`
- 来源：https://developer.music.163.com/st/developer/document?docId=eb8bef1f8603489f8c31b4b9720eda24

## 用户收藏歌单


### /openapi/music/basic/playlist/sub/v2


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?category=api&type=common&docId=iotCommonParam)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>id</td>
<td>是</td>
<td>string</td>
<td>歌单Id</td>
</tr>
</tbody>
</table>


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/playlist/sub/v2?bizContent%3d%7b%22id%22%3a%225CF4DA1F06D2AB3AC61AB1A665C7D588%22%7d%26appId%3da301010000000000aadb4e5a28b45a67%26signType%3dRSA_SHA256%26accessToken%3d9ffc6030fb9b8d186a33d45d32779638907ef86e8d889918bd%26appSecret%3dde6882f913d59560c9f37345f4cb0053%26device%3d%7b%22deviceType%22%3a%22andrwear%22%2c%22os%22%3a%22otos%22%2c%22appVer%22%3a%220.1%22%2c%22channel%22%3a%22hm%22%2c%22model%22%3a%22kys%22%2c%22deviceId%22%3a%22357%22%2c%22brand%22%3a%22hm%22%2c%22osVer%22%3a%228.1.0%22%7d%26timestamp%3d1609751129255
```


### **返回示例**


`{
    "code":200,
    "subCode":null,
    "message":null,
    "data":true
}
`
异常：


不可收藏自己创建的歌单、收藏数量达到上限


```text
{
  "code": 400,
  "message": "收藏歌单失败",
  "debugInfo": null,
  "data": null,
  "failData": null
}
```


已经收藏


```text
{
  "code": 400,
  "message": "已经订阅收藏",
  "debugInfo": null,
  "data": null,
  "failData": null
}
```


**备注**


- 需要传入accessToken

# AIDJ

## 获取行为口播信息（暂不支持）

- docId：`23515286a8b14ddaa2438eed712f4128`
- 来源：https://developer.music.163.com/st/developer/document?docId=23515286a8b14ddaa2438eed712f4128

## 获取行为口播信息（暂不支持）


### /openapi/music/basic/action/aidj/audio/get


### 请求方式：


- POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>actionKeys</td>
<td>是</td>
<td>String</td>
<td>场景</td>
</tr>
<tr>
<td>timbreKey</td>
<td>是</td>
<td>String</td>
<td>音色</td>
</tr>
</tbody>
</table>


- 两个入参有枚举列表，都需要提前和云音乐同事约定好


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/action/aidj/audio/get?appId=a30103000000000077da3efa051c57f0&bizContent={"actionKeys":"night","timbreKey":"DAN-ZAI"}&device={"channel":"AITO","deviceId":"c9ad4747-f407-4d03-b9b2-433628d26ad5","deviceType":"andrcar","appVer":"4.4.0","os":"andrcar","osVer":"12","brand":"AITO","model":"hwkit","clientIp":"192.168.65.4"}&timestamp=1724742300880&signType=RSA_SHA256&accessToken=04cd4e794fe66c2f9914c4afcd7aabbf860a930af4f39904t&sign=oS9OLbpHakH2PDh5LLASeTatUeMZTuBRTxs%2Fq1hxWj4dSq8Nv18jFvvmnBCvNGkFB1XaVxwc%2F1hJ14HNyY9CrMgy9BktH%2BTXVju6%2FPFq7XuWb%2BNxL3sCy5Ids5%2BQPUbOnrEqQJ9eJc0QBuQ2fx4rpycHikG0R%2Fw0k2R1%2BsAIGr6aw05BnsH2d2QFYjqr6HUAicKP%2FCNINgI0Oy0BhHm26c9G27imtuyPScWkura%2BbsGrUSpgEx7%2FB%2BHAUBvpJ8lDfpi5Ov6cTZs18Y%2FF6cMT%2F6NrbSTf5vYHWNtBWe6kSOV4aXixPpFN7qPF%2F1gJNcBBQzrTN1%2Bp5BrxNaJIXx016Q%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>audioUrl</td>
<td>String</td>
<td>音频地址</td>
</tr>
<tr>
<td>audioId</td>
<td>String</td>
<td>音频id</td>
</tr>
<tr>
<td>conversation</td>
<td>String</td>
<td>口播文案</td>
</tr>
<tr>
<td>duration</td>
<td>Float</td>
<td>音频时长 单位秒</td>
</tr>
<tr>
<td>size</td>
<td>Long</td>
<td>语音文件大小，单位字节</td>
</tr>
<tr>
<td>gain</td>
<td>Float</td>
<td>语音文件 gain 值</td>
</tr>
<tr>
<td>peak</td>
<td>Float</td>
<td>语音文件 peak 值</td>
</tr>
<tr>
<td>poolCode</td>
<td>String</td>
<td>不同类型的音频对应不同的code</td>
</tr>
<tr>
<td>validTime</td>
<td>Long</td>
<td>有效时间 单位秒 即多久之后过期</td>
</tr>
<tr>
<td>fadeInOut</td>
<td>Boolean</td>
<td>是否支持淡入淡出(指和歌曲资源的重叠播放)</td>
</tr>
<tr>
<td>timbreKey</td>
<td>String</td>
<td>音色key</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "audioInfoMap": {
      "night": [
        {
          "audioUrl": "http://d1.music.126.net/dmusic/0af3/62cd/8d8a/44aae2552fefefd283470ab059494f0b.mp3",
          "audioId": "prompt_greeting_509951163325515276_1722503777377_2",
          "conversation": "闭上眼睛，我给你唱摇篮曲",
          "duration": 3.22,
          "size": 19881,
          "gain": 1.7909851,
          "peak": 0,
          "poolCode": "action_greeting",
          "validTime": 86399,
          "fadeInOut": true,
          "timbreKey": "DAN-ZAI"
        }
      ]
    }
  }
}
```

## 获取音色列表

- docId：`4db4e338fe524c6b91017996b5ed9197`
- 来源：https://developer.music.163.com/st/developer/document?docId=4db4e338fe524c6b91017996b5ed9197

## 获取音色列表


### /openapi/music/basic/aidj/audio/timbre/get


```text
- 需申请接口组：AIDJ能力
```


![图片](https://p5.music.126.net/H7YUzswUkT-QkzU1XElZVQ==/109951173074924406)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


无


### 请求示例：


```text
https://openapi.music.163.com//api/openapi/score/queryMonthReporPic?appId=a301020000000000746f96a196e52e07&signType=RSA_SHA256&accessToken=1e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&timestamp=1750155479270&sign=HCVtQ0U2IKvOuvzbeB%2FkQzQSYWZ2jWiVQ9C%2BY4ggd%2FVfmI9CBu2BsxUlVtGv4GQRveyS34xfwGhhvu0GWr9toVCAS8OTicqIpDBUT8O6fsKbvBUl7RlZEEgITsgVfMhlnFaJPJ%2FFyMuHnkw1zjoaIQS%2F6UohqYleUAiA4NVH3HOCtBuQAp6faX%2Ffb7DTFXXl1tenOcoSGMPnYsuqsNMC4fL9MwXSRjZeYoUnI6b97MmFeUY0xm2RoRJQ%2BhGyLz8GA3LLkijd53%2FFtWMp7e%2F7zeWxZi991f9moQtqGDksi22M9S14%2BArn%2FGoTvtG3M25jc06RUCoFTgUC23wbpHqoqg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>avatar</td>
<td>String</td>
<td>头像</td>
</tr>
<tr>
<td>userDetailUrl</td>
<td>String</td>
<td>用户详情地址</td>
</tr>
<tr>
<td>name</td>
<td>String</td>
<td>用户名称</td>
</tr>
<tr>
<td>timbreKey</td>
<td>String</td>
<td>音色key</td>
</tr>
<tr>
<td>timbreDesc</td>
<td>String</td>
<td>音色描述</td>
</tr>
<tr>
<td>playUrl</td>
<td>String</td>
<td>播放地址</td>
</tr>
<tr>
<td>defaultAudio</td>
<td>String</td>
<td>是否为默认音色</td>
</tr>
<tr>
<td>gain</td>
<td>String</td>
<td>语音文件 gain 值</td>
</tr>
<tr>
<td>peak</td>
<td>String</td>
<td>语音文件 peak 值</td>
</tr>
<tr>
<td>bindingMode</td>
<td>String</td>
<td>绑定的漫游模式</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
    "code": 200,
    "subCode": null,
    "message": null,
    "data": {
        "timbreOptionsInfos": [
            {
                "avatar": "https://p6.music.126.net/obj/wonDlsKUwrLClGjCm8Kx/31101979053/fa45/cbb8/cccc/57beff6099d21d8ebdeee997c380f6e5.jpg",
                "userDetailUrl": "https://y.music.163.com/m/at/654220afc945f547a09b797a",
                "name": "黄俊",
                "desc": "高级内容总监、云上工作室负责人",
                "timbreKey": "M791-C2",
                "timbreDesc": null,
                "playUrl": "https://m8.music.126.net/20920106132414/763ffd037f935628c19f0ffba3c1b8f4/ymusic/obj/w5zDlMODwrDDiGjCn8Ky/32230193436/d0dd/0400/1124/2755dde1c3428ae67df6225b63fa62ab.mp3?infoId=1396354",
                "defaultAudio": false,
                "duration": 0,
                "size": 0,
                "gain": 0,
                "peak": 0,
                "bindingMode": null
            }
        ]
    }
}
```

## 获取歌曲口播信息

- docId：`5bfd65db8f1d4290908269884c7a81a4`
- 来源：https://developer.music.163.com/st/developer/document?docId=5bfd65db8f1d4290908269884c7a81a4

## 获取歌曲口播信息


### /openapi/music/basic/song/aidj/audio/get


![图片](https://p5.music.126.net/j15F8f9fB5EvHcObmV-wAA==/109951173074940530)


### 请求方式：


- GET/POST


### 公共参数：


[IOT公共参数](?docId=0f7801d7d6d24180b8fc9058d1ffe593)


### 业务参数（bizContent）：


<table>
<thead>
<tr>
<th>参数名</th>
<th>必选</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>songIds</td>
<td>是</td>
<td>String</td>
<td>歌曲列表JSON字符串，eg: "["4FF2AEFFA12B91F8B36FC7A7A191946F"]"</td>
</tr>
<tr>
<td>timbreKey</td>
<td>是</td>
<td>String</td>
<td>音色，测试可以传F793-C2</td>
</tr>
<tr>
<td>lastReqTimestamp</td>
<td>否</td>
<td>Long</td>
<td>上一次请求口播的时间戳（ms），默认为0，0认为是第一次请求,用于判断是否为首次请求，出首次请求欢迎语</td>
</tr>
</tbody>
</table>


- timbreKey入参有枚举列表，需要提前和云音乐同事约定好

- 使用预请求，有数据就有口播，反之，播这首的时候请求下一首的口播，歌曲播放结束播放口播


### 请求示例：


```text
http://openapi.music.163.com/openapi/music/basic/song/aidj/audio/get?appId=a301020000000000746f96a196e52e07&signType=RSA_SHA256&timestamp=1724915490172&bizContent={"songIds":["64C296B78BD5D0892E3035CC1F015DB4"],"timbreKey":"DAN-ZAI","lastReqTimestamp":1720890549000}&device={"deviceType":"openapi","os":"openapi","appVer":"0.1","channel":"iotapitest","model":"kys","deviceId":"357","brand":"iotapitest","osVer":"8.1.0","clientIp":"192.168.0.1"}&accessToken=b6c762fd61e274ea64cba6d4b03f13d67fc8c6a7a5a03023s&sign=UfDTgG%2BvRd9PxA0AV7O6PvOTHQglO9KohFz1cK%2BGkvlW73wNFkktp0SOsrnS1V1d%2BYL5TWb%2FNnSQK5hEYdNCcmf2uDpCMIkYgQkRCJGz5Qv1ijRxOmM5gKbXCYaFtWqJ7KoCMkNGJRq%2BHE60EWrYVkeHgevaoG73jiY3CmuIOGaixkOJXzakswyPT6mDADqWYvLwcbbKAKWST4tG1X0OGIDb%2BMMVembtCZWTSTAR0d1h0CgATOBz6wPbCJGVHTU6g8Kk%2FtZJpqC%2BBOgy7tbTB14WyUwjs4ftsYTmpmiXN3jsXUJ4nPyRNr8JSs5ArG42oE3q3WEUN%2FGvRnneOo%2B1Jg%3D%3D
```


### 返回参数说明


<table>
<thead>
<tr>
<th>参数名</th>
<th>类型</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td>audioUrl</td>
<td>String</td>
<td>音频地址</td>
</tr>
<tr>
<td>audioId</td>
<td>String</td>
<td>音频id</td>
</tr>
<tr>
<td>conversation</td>
<td>String</td>
<td>口播文案</td>
</tr>
<tr>
<td>duration</td>
<td>Float</td>
<td>音频时长 单位秒</td>
</tr>
<tr>
<td>size</td>
<td>Long</td>
<td>语音文件大小，单位字节</td>
</tr>
<tr>
<td>gain</td>
<td>Float</td>
<td>语音文件 gain 值</td>
</tr>
<tr>
<td>peak</td>
<td>Float</td>
<td>语音文件 peak 值</td>
</tr>
<tr>
<td>poolCode</td>
<td>String</td>
<td>不同类型的音频对应不同的code</td>
</tr>
<tr>
<td>validTime</td>
<td>Long</td>
<td>有效时间 单位秒 即多久之后过期</td>
</tr>
<tr>
<td>fadeInOut</td>
<td>Boolean</td>
<td>是否支持淡入淡出(指和歌曲资源的重叠播放)</td>
</tr>
<tr>
<td>timbreKey</td>
<td>String</td>
<td>音色key</td>
</tr>
</tbody>
</table>


### 返回示例


```text
{
  "code": 200,
  "subCode": null,
  "message": null,
  "data": {
    "audioInfoMap": {
      "A3F95C30A41BD0FB4970392D39310A1E": [
        {
          "audioUrl": "http://aidj.music.126.net/20240830161556/fd870defcdb2ad23375f3b5f72eb39f0/155d/06e5/706b/347cca0035f06ad0b5d4bc81aa04b18a.mp3",
          "audioId": "prompt_song_509951163311477415_1703148880955_26619",
          "conversation": "<speak>柔柔的新灵魂乐，<w role=\"x:person\">方大同</w>用他的声音绘出春日的暖意，像是轻轻踩在棉花上的感觉。这首<w role=\"x:song\">春风吹</w>带着淡淡绿意，让人回味无穷。</speak>",
          "duration": 14.184,
          "size": 454656,
          "gain": -2.2329617,
          "peak": 0,
          "poolCode": "prompt_song",
          "validTime": 86399,
          "fadeInOut": true,
          "timbreKey": "F793-C2"
        }
      ],
      "9EE2E4702F565ED038370AEF14B0AD65": [
        {
          "audioUrl": "http://aidj.music.126.net/20240830161556/91b7111869ac1cd8dc6d2191b57153ac/3f49/6d53/67bf/93611eb5b29d55c3090a13904ebd28e1.mp3",
          "audioId": "prompt_song_509951163301444413_1687939996841_72963",
          "conversation": "<speak>下面播放的是荣获<w role=\"x:award\">第15届华语音乐传媒大奖年度国语歌曲(提名)</w>的<w role=\"x:song\">平凡之路</w>，由<w role=\"x:person\">朴树</w>演唱。让我们一起聆听吧！</speak>",
          "duration": 11.664,
          "size": 374016,
          "gain": -1.3811703,
          "peak": 0,
          "poolCode": "prompt_song",
          "validTime": 86399,
          "fadeInOut": true,
          "timbreKey": "F793-C2"
        }
      ]
    }
  }
}
```

