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
