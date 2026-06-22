# Tencent Cloud Lightweight Server Demo Deploy

This guide deploys myMusic as a shared NetEase demo account with isolated visitor sandboxes on a Tencent Cloud Lightweight Application Server.

## 1. Cloud Console Setup

Use the Guangzhou trial server for the first demo.

1. Reinstall the instance as `Ubuntu Server 22.04 LTS`.
2. Set a strong SSH password or SSH key. Do not share it in chat or commit it.
3. Open these firewall ports in the Tencent Cloud console:
   - `22` for SSH
   - `3000` for the first direct demo URL
   - `80` and `443` for the optional Caddy reverse proxy
4. Copy the public IPv4 address from the instance detail page.

Guangzhou is a mainland China region. Use the public IP during the demo. Binding a domain for public website access usually requires ICP filing.

## 2. Install Docker On Ubuntu

SSH into the server:

```bash
ssh ubuntu@YOUR_SERVER_IP
```

Install Docker and the Compose plugin:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and SSH back in so the Docker group takes effect.

## 3. Put The App On The Server

Clone the repository or upload this project directory. Example with Git:

```bash
git clone YOUR_REPOSITORY_URL myMusic2
cd myMusic2
```

Create the production environment file:

```bash
cp .env.production.example .env.production
nano .env.production
```

Fill only server-side keys in `.env.production`. Never put API keys in `public/` files.

For the judging demo, keep the dedicated NetEase demo account logged in and enable visitor sandboxes:

```dotenv
DEMO_GUEST_MODE=true
DEMO_GUEST_TTL_HOURS=720
REQUIRE_BROWSER_PLAY_URL=true
IP_GEO_PROVIDER=ip-api
WEATHER_PROVIDER=openmeteo
WEATHER_CITY=Shanghai
WEATHER_COUNTRY_CODE=CN
```

In guest mode, visitors share the demo account's NetEase cookie, library, and initial music profile, but their chat, feedback, preferences, memories, radio sessions, plays, portraits, and diaries are written into separate `demo:guest:*` scopes. The web UI stores a persistent anonymous id per browser profile and sends it as `X-Demo-Visitor-Id`; tabs in the same browser share one sandbox. Stale visitor data is cleaned after 30 inactive days by default.

`TTS_PROVIDER` can stay empty so browsers use speech synthesis fallback, or you can configure Volcengine TTS for the same voice as local. You can also leave NetEase OpenAPI values empty and scan the NetEase cookie login QR code once from the web UI before turning on guest mode.

## 4. Start The Demo

Build and run:

```bash
docker compose up -d --build
```

Check health:

```bash
docker compose ps
curl http://127.0.0.1:3000/api/health
```

Open:

```txt
http://YOUR_SERVER_IP:3000
```

Then scan the NetEase QR code with the dedicated demo account and sync the library before enabling guest mode. After guest mode is enabled, login/logout and library sync endpoints are locked so visitors cannot replace the shared account.

## 5. Optional Port 80 Reverse Proxy

After `http://YOUR_SERVER_IP:3000` works, start Caddy:

```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

Open:

```txt
http://YOUR_SERVER_IP
```

The included Caddyfile is HTTP-only for IP access. When a domain is available and ICP filing is handled, update `deploy/Caddyfile` from `:80` to the domain name and restart Compose.

## 6. Operations

View logs:

```bash
docker compose logs -f mymusic
```

Restart:

```bash
docker compose restart mymusic
```

Update app code:

```bash
git pull
docker compose up -d --build
```

Back up demo data:

```bash
tar -czf mymusic-backup-$(date +%Y%m%d-%H%M%S).tgz data cache
```

Clean visitor sandboxes if needed without deleting the shared demo account, library, cookie, or provider keys:

```bash
sqlite3 data/mymusic.sqlite "DELETE FROM account_settings WHERE account_id LIKE 'demo:guest:%'; DELETE FROM account_music_profiles WHERE account_id LIKE 'demo:guest:%'; DELETE FROM messages WHERE account_id LIKE 'demo:guest:%'; DELETE FROM radio_sessions WHERE account_id LIKE 'demo:guest:%'; DELETE FROM plays WHERE account_id LIKE 'demo:guest:%'; DELETE FROM track_feedback_events WHERE account_id LIKE 'demo:guest:%'; DELETE FROM track_feedback_summary WHERE account_id LIKE 'demo:guest:%'; DELETE FROM user_memories WHERE account_id LIKE 'demo:guest:%'; DELETE FROM diary_entries WHERE account_id LIKE 'demo:guest:%';"
```

For a full reset, back up `data/` first, then remove only after confirming you are comfortable re-scanning the demo NetEase account and re-syncing the library.
