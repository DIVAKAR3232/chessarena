# Hosting ChessArena on the internet

ChessArena is deployed as **one Render web service** (website + API + live games on a single
HTTPS URL) plus a **managed Render PostgreSQL database**. Everything is described in
[`render.yaml`](../render.yaml), so Render creates both with one click.

Why one service: the login cookies stay first-party and live games (WebSockets) need no
cross-domain setup. This avoids the third-party-cookie problems of splitting the site across
two domains.

---

## What you need

- A free **GitHub** account: https://github.com/signup
- A free **Render** account (sign up with GitHub): https://dashboard.render.com/register
- Git installed (already on this PC)

---

## Step 1: Put the code on GitHub

1. On GitHub, click **New repository**, name it `chessarena`, choose **Private**, and do **not**
   add a README or .gitignore. Click **Create repository**.
2. In a terminal in the project folder, run (replace `YOUR-NAME`):

```bash
git init
git add .
git commit -m "ChessArena"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/chessarena.git
git push -u origin main
```

Secrets are **not** uploaded: `.gitignore` excludes `server/.env`, `.dev-admin.txt`, the local
database (`.pgdata`) and build output.

## Step 2: Create the services on Render

1. Open https://dashboard.render.com → **New** → **Blueprint**.
2. Connect your GitHub account if asked, and select the `chessarena` repository.
3. Render reads `render.yaml` and shows **chessarena** (web service) and **chessarena-db**
   (PostgreSQL). It asks for two values:
   - `ADMIN_USERNAME`: the admin login you want, e.g. `admin`
   - `ADMIN_PASSWORD`: at least 8 characters with a letter and a number
4. Click **Apply**. The first build takes about 5 minutes.

Render generates the login-token secrets automatically, and it connects the database
automatically.

## Step 3: Open your site

When the deploy shows **Live**, your address is at the top of the service page, e.g.
`https://chessarena-xxxx.onrender.com`.

- Players: open the address and **Create account**.
- Admin: open `https://chessarena-xxxx.onrender.com/admin/login` with the username/password from
  Step 2.
- Check health: `https://chessarena-xxxx.onrender.com/ready` should show `"database":"ok"`.

After signing in once, the admin can change the password under **Account → Change password**.
For security, you can then delete `ADMIN_PASSWORD` from the service's **Environment** tab. It is
only used on the very first start, and an existing admin is never overwritten.

---

## Updating the site

Push changes to GitHub; Render rebuilds and redeploys automatically:

```bash
git add .
git commit -m "Describe the change"
git push
```

On every start the service runs `prisma migrate deploy`, which applies new database migrations
and **never deletes data**.

## Custom domain (optional)

Render service → **Settings → Custom Domains** → add e.g. `chess.example.com` and create the DNS
record Render shows. HTTPS is issued automatically. Then add these in **Environment**:

```
CLIENT_ORIGIN=https://chess.example.com
APP_URL=https://chess.example.com
```

## Email for password resets (optional)

Without email settings, password-reset emails are not sent, and an admin cannot email a reset
link. To enable them, add your provider's SMTP values in **Environment**: `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM`. Once email is configured, new players
must also verify their address.

---

## Free plan limits (read before going live)

| Limit | Effect | Fix |
|---|---|---|
| Free web service sleeps after 15 min idle | First visit after a pause takes ~1 minute to wake | Upgrade the web service to **Starter** |
| Free PostgreSQL expires after 30 days | Data is deleted unless upgraded | Upgrade the database to a paid plan before 30 days |
| Free database has no backups | No point-in-time restore | Paid plans include daily backups |

For real events, use at least **Starter** for the web service and **Basic** for the database.
Running one instance is intended. Live games are coordinated in that instance; do not raise the
instance count above 1 without adding a Redis Socket.IO adapter.

## Backups (manual)

From any PC with PostgreSQL tools, use the **External Database URL** from the database page:

```bash
pg_dump "EXTERNAL_DATABASE_URL" --format=custom --file=chessarena-backup.dump
```

Restore into an empty database:

```bash
pg_restore --no-owner --dbname "EXTERNAL_DATABASE_URL" chessarena-backup.dump
```

## Troubleshooting

- **Build failed**: Render service → **Logs**. Make sure the latest code is pushed.
- **Site shows 502 / not ready**: wait for the free instance to wake (about 1 minute), then check
  `/ready`.
- **Cannot sign in as admin**: confirm `ADMIN_USERNAME` / `ADMIN_PASSWORD` were set *before* the
  first successful start. To add an admin later: Render service → **Shell** →
  `cd server && ADMIN_USERNAME=newadmin ADMIN_PASSWORD='YourPass123' node dist/scripts/create-admin.js`
  (Shell requires a paid instance).
- **Live games do not connect**: if you use a custom domain, `CLIENT_ORIGIN` must exactly match the
  address in the browser bar (with `https://`, no trailing slash).
