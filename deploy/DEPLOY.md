# Deploying yumi to a home server (Ubuntu) + Tailscale

Single-user, no auth. Reachable **only** from your own devices over Tailscale —
the public internet never sees it. An Ubuntu box (22.04/24.04) runs the app;
your phone reaches it over the tailnet as an installable, full-screen PWA. Any
nginx/Cloudflare setup already on the box for other sites is left untouched —
yumi binds localhost and is exposed only through `tailscale serve`.

> The examples assume user `sadirano` with the app at `~/projects/yumi`. If
> your username or paths differ, adjust the commands **and** the `User=` /
> path lines in the `deploy/*.service` units before installing them.
> Steps marked **(sudo)** need root.

---

## 1. Clone + build (no sudo)

```bash
cd ~/projects
git clone https://github.com/sadirano/yumi.git
cd yumi

# Frontend (needs Node 18+) -> builds into backend/app/static, which is git-ignored.
# No Node on the server? Build on another machine and copy backend/app/static over.
cd frontend && npm install && npm run build && cd ..

# Python venv + deps:
python3 -m venv ~/projects/yumi/.venv
~/projects/yumi/.venv/bin/python -m pip install --upgrade pip
~/projects/yumi/.venv/bin/python -m pip install -e backend

# Smoke test (Ctrl-C after "Application startup complete"):
~/projects/yumi/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8765
# elsewhere: curl -s http://127.0.0.1:8765/api/health
```

Migrating an existing library? Stop yumi on the old machine first, then copy
`favorites.sqlite` and `uploads/` into `~/.local/share/sadirano-data/yumi/`
(see the data-directory table in the README). Migrations self-apply on boot.

## 2. (sudo) systemd: run the app + daily backup

```bash
sudo cp ~/projects/yumi/deploy/yumi.service        /etc/systemd/system/
sudo cp ~/projects/yumi/deploy/yumi-backup.service /etc/systemd/system/
sudo cp ~/projects/yumi/deploy/yumi-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yumi.service
sudo systemctl enable --now yumi-backup.timer

systemctl status yumi.service --no-pager
curl -s http://127.0.0.1:8765/api/health
```

## 3. (sudo) Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                 # open the printed URL once to authenticate
sudo tailscale serve --bg 8765    # HTTPS, real cert, tailnet-only
sudo tailscale serve status       # prints https://<host>.<tailnet>.ts.net
```

> **Use `serve`, never `funnel`.** `serve` is tailnet-only — correct for a
> no-auth app. `funnel` publishes to the public internet and would expose the
> unauthenticated app to the world. Do not use `funnel` to "fix" connectivity.
> If you *want* yumi on the public internet, put a real auth gate in front —
> see [DEPLOY-ORACLE.md](DEPLOY-ORACLE.md) for a Cloudflare Access setup.

On the **phone**: install the Tailscale app, sign in (same account), toggle on,
open `https://<host>.<tailnet>.ts.net`, then **Add to Home Screen / Install**
for the full-screen PWA. (The HTTPS from `serve` is what makes install work.)

## 4. (sudo) Offsite backup to Google Drive (rclone)

If the server has no browser, authorize on a desktop and paste the token:

```bash
sudo apt-get install -y rclone
rclone config                     # n) new remote -> name: gdrive, type: drive
# When asked to auto-open a browser, answer No, then on a desktop run:
#   rclone authorize "drive"
# and paste the token back into the server's prompt.
rclone mkdir gdrive:yumi-backups
rclone copy ~/.local/share/sadirano-data/yumi/backups gdrive:yumi-backups   # smoke test
```

The daily timer (step 2) already runs this copy after each snapshot.

## 5. (sudo, optional) Laptop as server: keep serving with the lid closed

```bash
sudo sed -i 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo sed -i 's/^#\?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind
```

---

## Updating after code changes

```bash
cd ~/projects/yumi && git pull
cd frontend && npm run build && cd ..        # refresh UI
~/projects/yumi/.venv/bin/python -m pip install -e backend -q
sudo systemctl restart yumi
```

## Notes / footguns

- **One source of truth.** Once the server is live, edit only there. A desktop
  copy and the server use *separate* SQLite files and will silently diverge if
  both are used.
- **systemd uses `WorkingDirectory=backend`** so `app.main:app` resolves; the
  manual smoke-test command uses `--app-dir backend` for the same reason.
