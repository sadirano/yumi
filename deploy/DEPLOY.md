# Deploying yumi to viper (Ubuntu) + Tailscale

Single-user, no auth. Reachable **only** from your own devices over Tailscale —
the public internet never sees it. viper (Ubuntu 24.04) runs the app; your phone
reaches it over the tailnet as an installable, full-screen PWA. nginx/Cloudflare
on viper are for your *other* public sites and are left untouched.

Host: `sadirano@192.168.0.100` (`viper`), app at `~/projects/yumi`.

> **The built frontend (`backend/app/static/`) is git-ignored and viper has no
> Node.** So a plain `git clone` has no UI. Two ways to get the static:
> **(A)** use the prebuilt copy already staged on viper at `~/yumi-transfer/static/`
> (done for you — no Node), or **(B)** install Node and `npm run build`.
> Steps below use (A).

> **Steps needing `sudo`** require your password and are NOT run for you. Run
> them yourself. The data transfer (library DB + prebuilt static) is already done.

---

## Already done for you

- Library DB copied to `~/.local/share/sadirano-data/yumi/favorites.sqlite`
  (consistent snapshot of the Windows library; migrations self-apply on boot).
- Prebuilt frontend staged at `~/yumi-transfer/static/` (Node-free path).

## 1. Clone + assemble (no sudo)

```bash
cd ~/projects
git clone https://github.com/sadirano/yumi.git
cd yumi

# Drop in the prebuilt UI (git-ignored, so not in the clone):
mkdir -p backend/app/static
cp -r ~/yumi-transfer/static/. backend/app/static/

# Python venv + deps:
python3 -m venv ~/projects/yumi/.venv
~/projects/yumi/.venv/bin/python -m pip install --upgrade pip
~/projects/yumi/.venv/bin/python -m pip install -e backend

# Smoke test (Ctrl-C after you see "Application startup complete"):
~/projects/yumi/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8765
# in another shell: curl -s http://127.0.0.1:8765/api/health
```

> **(Alternative B — build with Node instead of step's `cp`)**
> `sudo apt-get install -y nodejs npm && cd frontend && npm install && npm run build && cd ..`

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
sudo tailscale serve status       # prints https://viper.<tailnet>.ts.net
```

> **Use `serve`, never `funnel`.** `serve` is tailnet-only — correct for a
> no-auth app. `funnel` publishes to the public internet and would expose the
> unauthenticated app to the world. Do not use `funnel` to "fix" connectivity.

On the **phone**: install the Tailscale app, sign in (same account), toggle on,
open `https://viper.<tailnet>.ts.net`, then **Add to Home Screen / Install** for
the full-screen PWA. (The HTTPS from `serve` is what makes install work.)

## 4. (sudo) Offsite backup to Google Drive (rclone)

viper has no browser, so authorize on a desktop and paste the token:

```bash
sudo apt-get install -y rclone
rclone config                     # n) new remote -> name: gdrive, type: drive
# When asked to auto-open a browser, answer No, then on a desktop run:
#   rclone authorize "drive"
# and paste the token back into viper's prompt.
rclone mkdir gdrive:yumi-backups
rclone copy ~/.local/share/sadirano-data/yumi/backups gdrive:yumi-backups   # smoke test
```

The daily timer (step 2) already runs this copy after each snapshot.

## 5. (sudo, optional) Keep serving with the lid closed

Not needed since the lid is never closed, but harmless insurance:

```bash
sudo sed -i 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo sed -i 's/^#\?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind
```

---

## Updating viper after code changes

```bash
cd ~/projects/yumi && git pull
# refresh UI: either re-copy a freshly-built static, or (if Node installed) rebuild:
#   cd frontend && npm run build && cd ..
~/projects/yumi/.venv/bin/python -m pip install -e backend -q
sudo systemctl restart yumi
```

## Notes / footguns

- **One source of truth.** Once viper is live, edit only there. The Windows app
  and viper use *separate* SQLite files and will silently diverge if both are used.
- **systemd uses `WorkingDirectory=backend`** so `app.main:app` resolves; the
  manual smoke-test command uses `--app-dir backend` for the same reason.
