# myMusic

myMusic is a local-first AI music radio. It reads your NetEase Cloud Music library, builds a personal music profile, and runs a browser PWA that can recommend and play music with AI DJ narration.

## Run

1. Copy `.env.example` to `.env.local`.
2. Install dependencies:

```powershell
npm install
```

3. Fill in NetEase OpenAPI, LLM, and TTS settings. Weather defaults to Open-Meteo for Shanghai and does not require an API key.
4. Start the app:

```powershell
npm run dev
```

Open `http://127.0.0.1:3000`.

For personal local debugging, keep `LOCAL_DEV_UNLOCK_DEMO=true` in `.env.local`. This keeps account switching, library sync, local playback fallback, and account-scoped long-term memory enabled even if a demo config was copied over from the Tencent Cloud deployment.

The app uses Node built-ins for the custom server and SQLite, plus `NeteaseCloudMusicApi` for NetEase cookie login and playback URL helpers.

## Deploy

For the Tencent Cloud shared-account demo deployment, see:

```txt
docs/deploy-tencent-cloud.md
```

The cloud demo can run with one dedicated NetEase demo account while giving each visitor an isolated temporary sandbox:

```dotenv
DEMO_GUEST_MODE=true
DEMO_GUEST_TTL_HOURS=24
```

When enabled, each browser tab session sends `X-Demo-Visitor-Id`; visitor chat, memories, feedback, preferences, plays, and diaries do not affect other visitors or the shared demo account.

## TTS and Weather

Real host narration uses Volcengine/Doubao TTS when these values are set:

```dotenv
TTS_PROVIDER=volcengine
VOLCENGINE_TTS_APP_ID=
VOLCENGINE_TTS_ACCESS_KEY=
VOLCENGINE_TTS_AUTH_TYPE=api-key
VOLCENGINE_TTS_VERSION=v3
VOLCENGINE_TTS_RESOURCE_ID=seed-tts-2.0
VOLCENGINE_TTS_APP_KEY=aGjiRDfUWi
VOLCENGINE_TTS_VOICE_TYPE=zh_female_vv_uranus_bigtts
VOLCENGINE_TTS_ENDPOINT=https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse
```

The server caches generated MP3 files under `cache/tts` and exposes them through `/api/tts/:id.mp3`. If TTS is not configured or the provider request fails, the browser speech-synthesis fallback is used.

Weather uses Open-Meteo by default:

```dotenv
WEATHER_PROVIDER=openmeteo
WEATHER_CITY=上海
WEATHER_COUNTRY_CODE=CN
```

On the cloud demo, the server can derive each visitor's city, time zone, and weather from the request IP via `IP_GEO_PROVIDER=ip-api`, then query Open-Meteo by latitude/longitude. If IP lookup or weather lookup fails, it falls back to `WEATHER_CITY` and `APP_TIME_ZONE`.

The radio prompt receives the current hour, live weather summary, user chat message, music profile, and selected track.

## Notes

- Keep real keys in `.env.local`.
- Do not put private keys, access tokens, or API keys in frontend code.
- The server falls back to local demo music when NetEase credentials are not configured, so the UI and AI radio flow can be tested before credentials are added.

## Schedule-Aware Radio

The optional schedule integration is disabled by default and is intended for private local deployments. It starts the official Feishu MCP server over `stdio`, lists its tools, and only calls the configured read-only calendar tools.

Set these server-side environment variables:

```dotenv
SCHEDULE_MCP_ENABLED=true
FEISHU_APP_ID=cli_your_app_id
FEISHU_APP_SECRET=your_app_secret
```

The default command is equivalent to:

```powershell
npx -y @larksuiteoapi/lark-mcp mcp -a $env:FEISHU_APP_ID -s $env:FEISHU_APP_SECRET --token-mode auto
```

Open **Settings > 日程感知电台** to enable the feature and test a manual refresh. The app stores only an expiring summary containing the free-window length, local event category, location type, day load, transition type, and a fingerprint. Event titles are discarded after local classification; descriptions, attendees, and attachments are not persisted or returned by the API.

## AI DJ Avatar

The main player artwork area is now the AI DJ host avatar. The source image lives at:

```txt
public/avatar/source/cancan-first-frame.png
```

The frontend first tries to play a matching WebM motion clip from `public/avatar/webm`. If the clip does not exist yet, it falls back to the PNG and uses CSS motion so the host still feels alive without any external API calls.

Supported frontend states:

```txt
idle
listening
talking
searching
reading
happy
```

These map to WebM files:

```txt
public/avatar/webm/idle.webm
public/avatar/webm/listening.webm
public/avatar/webm/talking.webm
public/avatar/webm/searching_music.webm
public/avatar/webm/reading_book.webm
public/avatar/webm/happy.webm
```

The radio UI switches avatar state automatically: searching while recommendations are loading, talking while the AI host speaks, listening while music plays, idle while paused or stopped, and happy after liking a song.

The legacy `on_air` frames, sprite, prompt, and processing support are retained as reserved assets, but the frontend does not currently select or display that state.

### Generate Avatar Videos

Avatar motion is generated through the Jimeng website, so no video API key is required. Run the environment check first:

```powershell
npm run avatar:doctor
```

Print the prompt for the motion being generated:

```powershell
npm run avatar:prompt -- --motion idle
```

In Jimeng, use image-to-video with `public/avatar/source/cancan-first-frame.png`, a 1:1 ratio, five-second duration, and no generated audio. Generate `idle` first, then `talking` and `listening` after the character identity is accepted.

After downloading the MP4, import it with a stable motion name:

```powershell
npm run avatar:import -- --motion idle --input "C:\Downloads\jimeng-video.mp4"
```

Use `--force` only when intentionally replacing an existing motion.

### Convert and Validate

The project includes Windows-compatible FFmpeg and FFprobe binaries. Convert all available MP4 files:

```powershell
npm run avatar:convert
npm run avatar:validate
```

To process one motion:

```powershell
npm run avatar:convert -- --motion idle
npm run avatar:validate -- --motion idle
```

If a generated clip moves too quickly, slow it during conversion:

```powershell
npm run avatar:convert -- --motion idle --speed 0.5
```

Add `--interpolate` only when the half-speed output looks choppy. Interpolation can soften pixel edges, so keep the non-interpolated output if it looks cleaner.

The converter crops to a square, outputs 720x720 VP9 WebM without audio, and applies a short loop transition. Files are written to:

```txt
public/avatar/generated/<motion>.mp4
public/avatar/webm/<motion>.webm
```

The frontend loads WebM first and falls back to the existing PNG frame animation if the video is absent or cannot play.

### Unify Avatar Backgrounds

The generated clips can be composited onto one shared cyber radio studio background. The original MP4 files remain unchanged.

Set up the isolated Python environment and download the Apache-2.0 anime segmentation model:

```powershell
npm run avatar:unify:setup
```

Unify one motion or every available motion:

```powershell
npm run avatar:unify -- --motion idle
npm run avatar:unify -- --motion all
```

The shared background lives at:

```txt
public/avatar/background/cyber-radio-master.png
public/avatar/background/cyber-radio-loop.mp4
```

Composited MP4 files and metadata are written without replacing the generated sources:

```txt
public/avatar/processed/<motion>.mp4
public/avatar/processed/<motion>.json
```

The command then replaces the matching frontend WebM with the unified version. Run the automated metadata, watermark-corner, and contact-sheet audit with:

```powershell
npm run avatar:audit
```

Audit images are generated under `public/avatar/audit` and are ignored by Git.
