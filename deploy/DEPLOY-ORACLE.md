# Deploying yumi to Oracle Cloud (Always Free) + Cloudflare Access

Public-internet deployment on a $0/month Oracle ARM VM, protected by a Google
login. yumi itself stays single-user and auth-free: it binds `127.0.0.1` only,
`cloudflared` dials **out** to Cloudflare (the VM has no open web ports), and
Cloudflare Access rejects every Google account except yours before a request
ever reaches the VM.

```
phone/desktop ──HTTPS──▶ Cloudflare edge ──[Access: Google login, your email only]
                                │
                        tunnel (outbound from VM)
                                │
                        cloudflared on VM ──▶ 127.0.0.1:8765 (yumi)
```

Prerequisites: a domain already on Cloudflare (free plan is fine), a Google
account, a credit card for Oracle signup (identity check — Always Free is not
charged).

> Same convention as [DEPLOY.md](DEPLOY.md): steps marked **(sudo)** need root.
> The systemd units in this folder are reused as-is — the VM gets a `sadirano`
> user so the hardcoded paths match.

---

## 1. Oracle account + ARM instance

1. Sign up at <https://www.oracle.com/cloud/free/>. **Pick your home region
   carefully — it cannot be changed later.** Choose the one closest to you
   *that has A1 (Ampere ARM) capacity*; smaller regions run dry. São Paulo /
   Vinhedo work for Brazil.
2. Console → Compute → Instances → **Create instance**:
   - **Image:** Ubuntu 24.04 (aarch64).
   - **Shape:** `VM.Standard.A1.Flex`. The free allowance is 4 OCPU + 24 GB
     total; **2 OCPU / 12 GB** is already overkill for yumi. Boot volume:
     default ~47 GB is fine (free allowance: 200 GB total).
   - **SSH key:** paste your public key (`type $env:USERPROFILE\.ssh\id_ed25519.pub`).
   - **Networking:** accept the default VCN/public subnet with a public IPv4.
3. **"Out of capacity" error?** This is the famous A1 lottery. Retry at odd
   hours, try another availability domain, or temporarily drop to 1 OCPU/6 GB.
   It usually lands within a few days of retries.
4. **Avoiding idle reclamation.** Oracle may reclaim Always Free instances
   that look idle for 7 days (CPU/network/memory all under ~20%). Two options:
   - **Upgrade the account to Pay As You Go** (Billing → Upgrade). Always Free
     resources stay free, reclamation no longer applies, and nothing is billed
     unless you provision beyond the free limits. Recommended.
   - Or stay on the free tier and rely on the daily backup (§5) to make a
     reclaim a 10-minute redeploy instead of a disaster.

**Firewall reality check** — two layers, both default-closed except SSH:

- The VCN **security list** allows inbound 22 only. Leave it: cloudflared is
  outbound-only, so no web ports are ever opened.
- Oracle's Ubuntu image ships **iptables rules** (`/etc/iptables/rules.v4`)
  that also allow only 22. Leave them too, and **don't enable ufw** — it
  fights the preinstalled rules and you don't need it.

Optional SSH hardening: Console → the instance's security list → edit the
port-22 rule's source CIDR to your home IP (`<your-ip>/32`). Key-only auth is
already the image default.

## 2. (sudo) Base setup

SSH in as the image's default user, then create the app user (matches the
`sadirano` paths baked into the systemd units):

```bash
ssh ubuntu@<public-ip>

sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y git python3-venv python3-pip unattended-upgrades rclone
sudo dpkg-reconfigure -plow unattended-upgrades   # enable automatic security patches

# App user, reachable with the same SSH key:
sudo adduser --disabled-password --gecos "" sadirano
sudo mkdir -p /home/sadirano/.ssh
sudo cp ~/.ssh/authorized_keys /home/sadirano/.ssh/
sudo chown -R sadirano:sadirano /home/sadirano/.ssh
sudo chmod 700 /home/sadirano/.ssh && sudo chmod 600 /home/sadirano/.ssh/authorized_keys
sudo usermod -aG sudo sadirano          # optional: lets you sudo from sadirano

# Node 22 LTS (Vite 6 needs >=18; Ubuntu's apt node is too old):
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Reconnect as the app user: `ssh sadirano@<public-ip>`.

## 3. Clone + build (no sudo)

Identical to the home-server deploy (see DEPLOY.md §1):

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/sadirano/yumi.git
cd yumi

cd frontend && npm install && npm run build && cd ..
# Fallback if the ARM build misbehaves: build on Windows (cd frontend; npm run build)
# and copy the result:  scp -r backend/app/static sadirano@<ip>:~/projects/yumi/backend/app/

python3 -m venv ~/projects/yumi/.venv
~/projects/yumi/.venv/bin/python -m pip install --upgrade pip
~/projects/yumi/.venv/bin/python -m pip install -e backend

# Smoke test (Ctrl-C after "Application startup complete"):
~/projects/yumi/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8765
# elsewhere: curl -s http://127.0.0.1:8765/api/health
```

### Migrate the library

**Stop yumi on the current source-of-truth machine first** (a live SQLite file
copied mid-write can be inconsistent), then copy the DB and uploads:

```powershell
# From Windows (source of truth on Windows):
scp $env:LOCALAPPDATA\sadirano-data\yumi\favorites.sqlite sadirano@<ip>:.local/share/sadirano-data/yumi/
scp -r $env:LOCALAPPDATA\sadirano-data\yumi\uploads sadirano@<ip>:.local/share/sadirano-data/yumi/
```

```bash
# Or from a Linux home server (source of truth there):
ssh <home-server> "sudo systemctl stop yumi"
scp <home-server>:.local/share/sadirano-data/yumi/favorites.sqlite  sadirano@<ip>:.local/share/sadirano-data/yumi/
scp -r <home-server>:.local/share/sadirano-data/yumi/uploads        sadirano@<ip>:.local/share/sadirano-data/yumi/
```

(Create the target dir first: `mkdir -p ~/.local/share/sadirano-data/yumi`.)
Migrations self-apply on first boot; a pre-migration snapshot is taken
automatically.

> **If yumi already ran on the target machine**, stop it and delete *all three*
> DB files — `favorites.sqlite`, `favorites.sqlite-wal`, `favorites.sqlite-shm`
> — before copying the new one in. A stale `-wal` sidecar next to a swapped-in
> DB gets "recovered" over it on the next start, silently resetting the library
> to the old (empty) state.

Don't forget `backend/.env` (AI provider keys, `YUMI_*` overrides): it is
gitignored, so it travels with neither the clone nor the DB. Copy it from the
old machine into `~/projects/yumi/backend/.env`, `chmod 600` it, and restart
yumi. Skipping this only disables the AI features — everything else works.

## 4. (sudo) systemd: run the app + daily backup

Same units as the home-server deploy — the paths match because the user is
`sadirano`:

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

## 5. Offsite backup to Google Drive (rclone)

**Not optional here.** On a free-tier VM that Oracle can reclaim, the daily
Drive copy *is* the durability story. Same headless flow as DEPLOY.md §4:

```bash
rclone config                     # n) new remote -> name: gdrive, type: drive
# Answer No to auto-open browser; on a desktop run:  rclone authorize "drive"
# and paste the token back.
rclone mkdir gdrive:yumi-backups
rclone copy ~/.local/share/sadirano-data/yumi/backups gdrive:yumi-backups   # smoke test
```

The timer from §4 runs snapshot + copy daily at 03:30.

## 6. (sudo) Cloudflare Tunnel

In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a
tunnel** → Cloudflared → name it `yumi`. The dashboard shows a copy-paste
install block for Debian/arm64 — it adds the `pkg.cloudflare.com` apt repo,
installs `cloudflared`, and registers it as a systemd service bound to your
tunnel token. Run it on the VM.

Then, still in the tunnel wizard, add a **Public hostname**:

- Subdomain/domain: `yumi.<your-domain>`
- Service: `HTTP` → `localhost:8765`

Verify: the tunnel shows **HEALTHY**, and `https://yumi.<your-domain>` loads
the app (no login yet — that's next, don't stop here).

## 7. Cloudflare Access: Google login, your account only

### 7a. Google OAuth client (for the Cloudflare login page)

In <https://console.cloud.google.com>: create a project (`yumi-access`), then

1. **APIs & Services → OAuth consent screen:** External; app name `yumi`;
   your email for the contact fields. Leave **Publishing status = Testing**
   and add your own Gmail as the only **test user** — Google itself will then
   refuse every other account, a second gate in front of the Access policy.
2. **Credentials → Create credentials → OAuth client ID:** type *Web
   application*. Authorized redirect URI:
   `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/callback`
   (find `<your-team>` under Zero Trust → Settings → Custom Pages, or pick one
   on first Zero Trust setup). Note the **client ID** and **client secret**.

### 7b. Wire it into Zero Trust

1. **Zero Trust → Settings → Authentication → Login methods → Add new →
   Google** — paste client ID + secret, Save, then **Test**.
2. **Access → Applications → Add an application → Self-hosted:**
   - Application domain: `yumi.<your-domain>`
   - Identity providers: untick "Accept all", select **Google** only, and
     enable **Instant Auth** (skips the provider-picker page).
   - Session duration: **1 month** (see PWA note below).
3. **Policy:** name `owner-only`, action **Allow**, include →
   **Emails** → your Gmail address. No other rules.

Verify from a private/incognito window: `https://yumi.<your-domain>` must
bounce to a Google login; your account gets in; any other account is rejected.
Also confirm the API is covered: `curl -s https://yumi.<your-domain>/api/health`
must return a Cloudflare Access redirect/denial, **not** `{"ok":true,...}`.

### On the phone

Open `https://yumi.<your-domain>`, sign in with Google, then **Add to Home
Screen / Install**. Cloudflare's edge cert provides the HTTPS that makes the
PWA install work — no Tailscale needed on this deployment.

---

## Updating after code changes

```bash
ssh sadirano@<ip>
cd ~/projects/yumi && git pull
cd frontend && npm run build && cd ..
~/projects/yumi/.venv/bin/python -m pip install -e backend -q
sudo systemctl restart yumi
```

## Notes / footguns

- **One source of truth.** Once this VM is live, retire any home-server or
  desktop copies (or treat them as read-only). Separate SQLite files silently
  diverge.
- **yumi must stay on `127.0.0.1`.** The whole security model assumes nothing
  but cloudflared can reach port 8765. Never bind `0.0.0.0` "to debug" — and
  never open 80/443/8765 in the Oracle security list.
- **Expired session looks like a broken app.** When the Access session lapses,
  API `fetch()` calls get an auth redirect the PWA can't follow — the UI just
  stops loading data. Fix: pull-to-refresh / reload the page and log in again.
  The 1-month session duration makes this rare.
- **Google "Testing" mode is a feature.** Don't publish the OAuth consent
  screen to production; testing mode + one test user means even a
  misconfigured Access policy still can't let strangers log in with Google.
- **Reclaim insurance.** If Oracle reclaims the instance (free tier only, see
  §1.4): re-run §1–§4 and §6, then restore the newest snapshot from
  `gdrive:yumi-backups` to `~/.local/share/sadirano-data/yumi/favorites.sqlite`.
  Total loss window: ≤24 h (the timer's cadence).
- **Tunnel token = full access to the hostname.** Treat the cloudflared
  install command/token like a password; regenerate it from the dashboard if
  it ever leaks.
