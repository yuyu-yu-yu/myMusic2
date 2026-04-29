# myMusic

myMusic is a local-first AI music radio. It reads your NetEase Cloud Music library, builds a personal music profile, and runs a browser PWA that can recommend and play music with AI DJ narration.

## Run

1. Copy `.env.example` to `.env.local`.
2. Fill in NetEase OpenAPI, LLM, TTS, and optional weather settings.
3. Start the app:

```powershell
npm run dev
```

Open `http://127.0.0.1:3000`.

The current implementation intentionally uses only Node built-ins, so no `npm install` is required for the first local version.

## Notes

- Keep real keys in `.env.local`.
- Do not put private keys, access tokens, or API keys in frontend code.
- The server falls back to local demo music when NetEase credentials are not configured, so the UI and AI radio flow can be tested before credentials are added.
