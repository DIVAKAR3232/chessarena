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

## Password-reset emails

Emails are sent from **rangasamymeena945@gmail.com** (`MAIL_FROM` in `render.yaml`). The server
also needs one sending provider. Without one, "Forgot password" shows its usual message but no
email is sent.

> **Render free plan blocks SMTP**, which is how Gmail sends mail, so on the free plan use
> **Option B (Brevo)**. Option A (Gmail SMTP) works on your own PC and on paid Render instances.

### Option A: Gmail App Password (your PC, or a paid Render instance)

1. Sign in to Google as **rangasamymeena945@gmail.com**.
2. Turn on **2-Step Verification**: https://myaccount.google.com/signinoptions/two-step-verification
3. Create an **App password**: https://myaccount.google.com/apppasswords. Name it `ChessArena` and
   copy the 16-character password. This is *not* your normal Gmail password, and you can revoke
   it anytime.
4. **On your PC:** open `server/.env` and paste it after `SMTP_PASS=` (no spaces), then restart
   the app. `SMTP_HOST`, `SMTP_PORT` and `SMTP_USER` are already filled in.
5. **On a paid Render instance:** service → **Environment** → add `SMTP_HOST=smtp.gmail.com`,
   `SMTP_PORT=587`, `SMTP_USER=rangasamymeena945@gmail.com` and `SMTP_PASS=<the app password>` →
   **Save changes**.

### Option B: Brevo (works on Render's free plan)

1. Create a free account at https://www.brevo.com (300 emails/day free).
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender:** enter
   `rangasamymeena945@gmail.com` and confirm the verification email Brevo sends to that inbox.
3. **SMTP & API → API Keys → Generate a new API key**, then copy it.
4. Render service → **Environment** → add `BREVO_API_KEY=<the key>` → **Save changes**. Render
   restarts the service.

When `BREVO_API_KEY` is set it is used instead of SMTP.

### Check that it works

1. Sign in at `/admin/login` → **Settings**. The **Email** card shows the active provider.
2. Enter your own address under **Send a test email** and click **Send test**. The card shows
   exactly why a send failed (wrong app password, unverified Brevo sender, and so on).
3. Try the real flow: `/login` → **Forgot password?** → enter a player's email → open the email →
   **Choose a new password**.

Notes:

- Reset links are single-use and expire after 30 minutes. Using one signs the player out
  everywhere.
- Mail sent "from" a Gmail address through Brevo may land in **Spam** at first. Ask players to
  check there and mark it "Not spam".
- Admins can also send a reset link from **Users → (user) → Send password reset**. It reports
  whether the email went out.
- To make new players confirm their email before they can sign in, set
  `REQUIRE_EMAIL_VERIFICATION=true` (only once email delivery works).

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
