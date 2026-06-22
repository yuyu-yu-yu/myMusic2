# Render Free Demo Deploy

This guide publishes CanCan Radio as a Docker web service at:

```txt
https://cancan-radio.onrender.com
```

## Create The Service

1. Push `main` to GitHub with the root `render.yaml` file.
2. In Render, choose **New > Blueprint** and connect `yuyu-yu-yu/myMusic2`.
3. Select the `main` branch and keep the default Blueprint path, `render.yaml`.
4. Confirm the service name is exactly `cancan-radio`. Stop if Render reports that the name is unavailable.
5. Enter the secret environment variables and deploy the Blueprint.

Render builds the existing `Dockerfile`, checks `/api/health`, and deploys every new commit on `main`.

## Required Secrets

Configure these only in the Render dashboard. Never commit their values:

```dotenv
NETEASE_COOKIE=
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
```

Use a dedicated NetEase demo account, not a personal primary account. `NETEASE_COOKIE` takes precedence over `NETEASE_COOKIE_FILE`. The server logs only the credential source and never the cookie value.

MiniMax music generation and Volcengine TTS are optional. Add their secret variables in the Render dashboard after the first deployment only when those features are needed. Browser speech synthesis remains available when server TTS is not configured.

## Cold Start Behavior

Every instance starts with the built-in Demo library, so the page and basic radio flow remain available without provider credentials. When demo guest mode is enabled and `NETEASE_COOKIE` exists, the server starts a background library sync. Invalid credentials or a failed sync do not fail the health check or remove the Demo fallback.

Each browser profile receives a persistent anonymous device id. Visitors share the demo account's NetEase library and initial music portrait, while chat, playback history, preferences, feedback, memories, diaries, schedules, and later portrait changes stay inside that device sandbox. Set `DEMO_GUEST_TTL_HOURS=720` to clean up devices after 30 inactive days.

Render Free web services sleep after 15 minutes without inbound traffic. A later request can take about one minute to wake the service. The local SQLite database, generated audio, login cache, visitor chat, preferences, memories, and diaries can be lost whenever the instance sleeps, restarts, or redeploys.

## Verification

After deployment:

1. Open `https://cancan-radio.onrender.com/api/health` and confirm `ok` is `true`.
2. Open the home page and verify the avatar, chat, recommendation, next-track, and browser playback flows.
3. Confirm login and library-sync controls are locked for visitors.
4. Check Render logs for `demo library ready` and either `shared sync scheduled` or `shared sync not scheduled`.
5. Trigger one manual redeploy and verify the Demo fallback is restored after the new instance starts.

Free-tier behavior and limits are documented at <https://render.com/docs/free>.
