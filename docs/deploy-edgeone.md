# EdgeOne Makers Deployment

This branch migrates CanCan Radio toward a pure EdgeOne Makers / Pages target. It keeps `main` and the Render deployment as the fallback production path while the EdgeOne implementation is completed.

## Current Scope

The first EdgeOne batch provides:

- `edgeone.json` with Node.js `22.11.0`, Cloud Functions `maxDuration` 120 seconds, and China mainland region `ap-guangzhou`.
- `cloud-functions/api/[[default]].js` as the catch-all API entry.
- Same-origin `/api/...` routes for health, public config, library, radio start/next/chat, comments, preferences, memories, diary, TTS blob reads, and locked NetEase login endpoints.
- KV/Blob-style storage abstraction for shared library snapshots, per-device state, quotas, and TTS audio.
- Anonymous device isolation via `X-Demo-Visitor-Id`.
- Daily public quotas for LLM, TTS, and AI music generation.

Still intentionally limited in this batch:

- AI original music generation returns `503` after quota validation until the Blob write/read lifecycle is fully migrated.
- The EdgeOne library starts from a demo snapshot unless you import or sync a NetEase Cookie library through the admin API.
- Render and the existing SQLite server remain the stable fallback until EdgeOne is verified online.

## Local Commands

```bash
npm ci
npm run edgeone:dev
```

The regular local app still uses:

```bash
npm run dev
```

Do not make `dev` call `edgeone makers dev`; EdgeOne CLI uses the project command during startup and can recurse.

## Required EdgeOne Environment Variables

Set these in the EdgeOne Makers project settings, not in frontend code.

```text
NETEASE_COOKIE=...
LLM_BASE_URL=...
LLM_API_KEY=...
LLM_MODEL=...
EDGEONE_ADMIN_TOKEN=...
```

`NETEASE_COOKIE` should be a single-line cookie string, for example:

```text
MUSIC_U=...; __remember_me=true
```

Optional TTS variables:

```text
TTS_PROVIDER=volcengine
VOLCENGINE_TTS_API_KEY=...
VOLCENGINE_TTS_VOICE_TYPE=...
VOLCENGINE_TTS_RESOURCE_ID=seed-tts-2.0
```

Optional OpenAI-compatible TTS variables:

```text
TTS_PROVIDER=openai
TTS_BASE_URL=https://api.openai.com
TTS_API_KEY=...
TTS_MODEL=tts-1
TTS_VOICE=alloy
```

Optional quota overrides:

```text
EDGEONE_DAILY_LLM_LIMIT=80
EDGEONE_DAILY_TTS_LIMIT=100
EDGEONE_DAILY_AI_MUSIC_LIMIT=3
```

Optional library sync controls:

```text
EDGEONE_SYNC_PLAYLIST_LIMIT=8
EDGEONE_SYNC_TRACK_LIMIT_PER_PLAYLIST=200
EDGEONE_BLOB_STORE=cancan-radio
```

## Library Initialization

After deployment, initialize the shared library with one of these admin-only calls.

Import a prepared snapshot:

```bash
curl -X POST "https://<edgeone-domain>/api/admin/library/import" \
  -H "content-type: application/json" \
  -H "x-admin-token: $EDGEONE_ADMIN_TOKEN" \
  --data-binary @library-snapshot.json
```

Sync from the server-side NetEase Cookie:

```bash
curl -X POST "https://<edgeone-domain>/api/admin/library/sync-cookie" \
  -H "x-admin-token: $EDGEONE_ADMIN_TOKEN"
```

Public visitors cannot scan login, logout, or modify the shared NetEase account from the website. They only receive isolated device data under their anonymous browser device ID.

## Verification Checklist

- `https://<edgeone-domain>/api/health` returns `runtime: "edgeone"`.
- `/api/config/status` shows LLM/TTS configured without exposing keys or base URLs.
- The homepage displays before API data finishes loading.
- Two browsers have different preferences, chat history, diary, feedback, and memories.
- `/api/track-comments?songId=<netease-id>` returns comments when the NetEase Cookie is valid.
- Quota exhaustion returns `429 quota_exceeded` and the page remains usable.
- Render remains available until the EdgeOne domain is stable in mainland China.
