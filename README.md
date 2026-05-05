# myMusic

myMusic is a local-first AI music radio. It reads your NetEase Cloud Music library, builds a personal music profile, and runs a browser PWA that can recommend and play music with AI DJ narration.

## Run

1. Copy `.env.example` to `.env.local`.
2. Fill in NetEase OpenAPI, LLM, and TTS settings. Weather defaults to Open-Meteo for Shanghai and does not require an API key.
3. Start the app:

```powershell
npm run dev
```

Open `http://127.0.0.1:3000`.

The current implementation intentionally uses only Node built-ins, so no `npm install` is required for the first local version.

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

The radio prompt receives the current hour, live weather summary, user chat message, music profile, and selected track.

## Notes

- Keep real keys in `.env.local`.
- Do not put private keys, access tokens, or API keys in frontend code.
- The server falls back to local demo music when NetEase credentials are not configured, so the UI and AI radio flow can be tested before credentials are added.

## AI DJ Avatar

The main player artwork area is now the AI DJ host avatar. The source image lives at:

```txt
public/avatar/source/cancan.png
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
on_air
```

These map to WebM files:

```txt
public/avatar/webm/idle.webm
public/avatar/webm/listening.webm
public/avatar/webm/talking.webm
public/avatar/webm/searching_music.webm
public/avatar/webm/reading_book.webm
public/avatar/webm/happy.webm
public/avatar/webm/on_air.webm
```

The radio UI switches avatar state automatically: searching while recommendations are loading, talking while the AI host speaks, listening while music plays, idle while paused or stopped, and happy after liking a song.

### Generate Avatar Videos

The repository keeps generation optional so the local app stays zero-build and zero-React.

Install only the provider client you need:

```powershell
npm install @fal-ai/client
# or
npm install @runwayml/sdk
```

Set provider keys in your shell or `.env.local`; never put them in frontend code:

```dotenv
FAL_KEY=your_fal_key
RUNWAY_API_KEY=your_runway_key
RUNWAYML_API_SECRET=your_runway_key
```

Most image-to-video providers need a public image URL or a provider-supported data URL for `public/avatar/source/cancan.png`.

fal.ai Pika example:

```powershell
node scripts/generate-avatar-motion.mjs --provider fal --motion all --image-url "https://example.com/cancan.png" --duration 5 --resolution 720p
```

Runway example:

```powershell
node scripts/generate-avatar-motion.mjs --provider runway --motion talking --image-url "https://example.com/cancan.png" --duration 5 --model gen4_turbo
```

The script downloads MP4 files into:

```txt
public/avatar/generated/<motion>.mp4
```

References:

- [fal.ai Pika image-to-video API](https://fal.ai/models/fal-ai/pika/v2.2/image-to-video/api)
- [Runway API reference](https://docs.dev.runwayml.com/api/)

### Convert MP4 to WebM

Install `ffmpeg`, then run:

```powershell
bash scripts/convert-avatar-videos.sh
```

The converter writes WebM clips to:

```txt
public/avatar/webm/<motion>.webm
```

It uses nearest-neighbor scaling to preserve pixel-art edges.
