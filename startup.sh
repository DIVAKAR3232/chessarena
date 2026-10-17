#!/usr/bin/env bash
# ChessArena — one-command local startup.
#
#   ./startup.sh            set up everything that is missing, then run the app
#   ./startup.sh --reset-db wipe the local database first (asks for confirmation)
#   ./startup.sh --admin    set (or change) the administrator username and password
#
# What it does (each step is skipped when already done):
#   1. checks Node.js, npm and PostgreSQL binaries
#   2. installs npm dependencies
#   3. creates server/.env with freshly generated secrets
#   4. creates and starts a private PostgreSQL cluster in ./.pgdata (port 5433)
#   5. creates the databases and applies migrations (non-destructive)
#   6. creates the first admin account (password saved to .dev-admin.txt)
#   7. starts the API (http://localhost:4000) and website (http://localhost:5173)
# Press Ctrl+C to stop the app and the database.

set -euo pipefail
export PRISMA_HIDE_UPDATE_MESSAGE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PGPORT=5433
PGUSER=chessarena
PGDATA_DIR="$ROOT/.pgdata"
PGLOG="$ROOT/pgdata.log"
ENV_FILE="$ROOT/server/.env"
ADMIN_FILE="$ROOT/.dev-admin.txt"
API_PORT=4000
WEB_PORT=5173

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;32m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------------------------------
step "1/7  Checking prerequisites"
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install Node.js 20.19 or newer from https://nodejs.org"
command -v npm  >/dev/null 2>&1 || die "npm is not installed (it ships with Node.js)."
NODE_OK=$(node -e "const [a,b]=process.versions.node.split('.').map(Number);console.log(a>20||(a===20&&b>=19)?'yes':'no')")
[ "$NODE_OK" = "yes" ] || die "Node.js $(node -v) is too old; 20.19 or newer is required."
info "Node.js $(node -v), npm $(npm -v)"

# Locate PostgreSQL binaries (PATH first, then the standard Windows install folders).
if ! command -v pg_ctl >/dev/null 2>&1; then
  for dir in "/c/Program Files/PostgreSQL"/*/bin /usr/lib/postgresql/*/bin /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$dir/pg_ctl" ] || [ -x "$dir/pg_ctl.exe" ]; then PATH="$dir:$PATH"; fi
  done
fi
command -v pg_ctl >/dev/null 2>&1 || die "PostgreSQL was not found. Install PostgreSQL 14+ (https://www.postgresql.org/download/) and re-run."
info "PostgreSQL $(pg_ctl --version | awk '{print $NF}')"

# A port is "in use" if anything accepts a connection on it via IPv4 or IPv6. (Test-binding is
# unreliable on Windows, where 127.0.0.1 can be bound even while 0.0.0.0 or ::1 is taken.)
port_in_use() {
  node -e "
    const net = require('net');
    const probe = (host) => new Promise((res) => {
      const s = net.connect({ port: $1, host });
      s.setTimeout(800);
      s.once('connect', () => { s.destroy(); res(true); });
      s.once('timeout', () => { s.destroy(); res(false); });
      s.once('error', () => res(false));
    });
    Promise.all([probe('127.0.0.1'), probe('::1')]).then((r) => process.exit(r.some(Boolean) ? 0 : 1));
  "
}
for p in $API_PORT $WEB_PORT; do
  if port_in_use "$p"; then die "Port $p is already in use. Stop whatever is using it (maybe ChessArena is already running) and try again."; fi
done

# ------------------------------------------------------------------------------------------
step "2/7  Installing dependencies"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm install --no-audit --no-fund
else
  info "Dependencies are up to date."
fi

# ------------------------------------------------------------------------------------------
step "3/7  Configuring environment"
if [ ! -f "$ENV_FILE" ]; then
  node -e "
    const fs = require('fs'), c = require('crypto');
    let s = fs.readFileSync('server/.env.example', 'utf8');
    s = s.replace(/^JWT_ACCESS_SECRET=.*$/m, 'JWT_ACCESS_SECRET=' + c.randomBytes(48).toString('base64url'));
    s = s.replace(/^JWT_SOCKET_SECRET=.*$/m, 'JWT_SOCKET_SECRET=' + c.randomBytes(48).toString('base64url'));
    fs.writeFileSync('server/.env', s);
  "
  info "Created server/.env with new random secrets."
else
  info "Using existing server/.env"
fi

# ------------------------------------------------------------------------------------------
step "4/7  Starting PostgreSQL (port $PGPORT)"
PG_STARTED_BY_US=0

if [ "${1:-}" = "--reset-db" ] && [ -d "$PGDATA_DIR" ]; then
  read -r -p "    This permanently deletes all local ChessArena data. Type 'reset' to continue: " answer
  [ "$answer" = "reset" ] || die "Aborted."
  pg_ctl -D "$PGDATA_DIR" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" "$ADMIN_FILE"
  info "Local database removed."
fi

if [ ! -f "$PGDATA_DIR/PG_VERSION" ]; then
  info "Creating a new database cluster in .pgdata ..."
  initdb -D "$PGDATA_DIR" -U "$PGUSER" --auth=trust -E UTF8 --locale=C >/dev/null
fi

if pg_ctl -D "$PGDATA_DIR" status >/dev/null 2>&1; then
  info "PostgreSQL is already running."
else
  # Full redirection so the server does not hold this terminal's output open.
  pg_ctl -D "$PGDATA_DIR" -o "-p $PGPORT -c listen_addresses=localhost" -l "$PGLOG" -w -t 60 start >/dev/null 2>&1 </dev/null \
    || die "PostgreSQL failed to start. See $PGLOG"
  PG_STARTED_BY_US=1
  info "PostgreSQL started."
fi

kill_tree() {
  local pid="$1"
  if [ -r "/proc/$pid/winpid" ]; then
    # Windows (Git Bash): native child processes are not signalled by bash; kill the whole tree.
    taskkill //F //T //PID "$(cat "/proc/$pid/winpid")" >/dev/null 2>&1 || true
  else
    local child
    for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
    kill "$pid" >/dev/null 2>&1 || true
  fi
}

# The ports were verified free at startup, so any listener on them now was started by us
# (catches processes that detach from their parent, e.g. the `tsx watch` worker).
free_port() {
  local port="$1" pids
  if command -v netstat >/dev/null 2>&1 && [ -n "${WINDIR:-}" ]; then
    pids=$(netstat -ano | awk -v p=":$port" '$2 ~ p"$" && $4 == "LISTENING" {print $5}' | sort -u)
    for p in $pids; do taskkill //F //T //PID "$p" >/dev/null 2>&1 || true; done
  elif command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && kill $pids >/dev/null 2>&1 || true
  fi
}

cleanup() {
  trap - INT TERM EXIT
  echo
  if [ -n "${APP_PID:-}" ]; then
    bold "Stopping the app ..."
    kill_tree "$APP_PID"
    wait "$APP_PID" 2>/dev/null || true
    sleep 1
    free_port "$API_PORT"
    free_port "$WEB_PORT"
  fi
  if [ "$PG_STARTED_BY_US" = "1" ]; then
    bold "Stopping PostgreSQL ..."
    pg_ctl -D "$PGDATA_DIR" stop -m fast >/dev/null 2>&1 || true
  fi
  bold "ChessArena stopped."
}
trap cleanup INT TERM EXIT

for i in $(seq 1 30); do
  pg_isready -h localhost -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1 && break
  sleep 1
  [ "$i" = 30 ] && die "PostgreSQL did not become ready. See $PGLOG"
done

# ------------------------------------------------------------------------------------------
step "5/7  Preparing databases"
for db in chessarena chessarena_test; do
  if ! psql -h localhost -p "$PGPORT" -U "$PGUSER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    createdb -h localhost -p "$PGPORT" -U "$PGUSER" "$db"
    info "Created database $db"
  fi
done
(cd server && npx prisma generate >/dev/null 2>&1 && npx prisma migrate deploy 2>&1) | grep -E "migrations? (found|applied)|No pending|Error" | sed "s/^/    /" || true

# ------------------------------------------------------------------------------------------
step "6/7  Checking admin account"
# Asks for an admin username + password and saves them (create or update). Password is hidden.
prompt_admin_credentials() {
  local user pw pw2
  bold "    Set the administrator login (used at http://localhost:$WEB_PORT/admin/login)"
  read -r -p "    Admin username [admin]: " user
  user="${user:-admin}"
  while true; do
    read -r -s -p "    Admin password (8+ chars, a letter and a number): " pw; echo
    read -r -s -p "    Repeat password: " pw2; echo
    [ "$pw" = "$pw2" ] || { warn "Passwords do not match, try again."; continue; }
    local out
    out=$(cd server && ADMIN_USERNAME="$user" ADMIN_PASSWORD="$pw" npx tsx src/scripts/set-admin.ts 2>&1 | grep -E "Created admin|Password updated|Invalid|is a |already used|Failed" || true)
    printf '    %s\n' "$out"
    if printf '%s' "$out" | grep -qE "Created admin|Password updated"; then
      rm -f "$ADMIN_FILE"
      info "Admin login saved (username: $(printf '%s' "$user" | tr '[:upper:]' '[:lower:]'))."
      break
    fi
    warn "Could not save that login; please try again."
  done
  unset pw pw2
}

ADMINS=$(psql -h localhost -p "$PGPORT" -U "$PGUSER" -d chessarena -tAc "SELECT count(*) FROM \"User\" WHERE role='ADMIN'")
if [ "${1:-}" = "--admin" ]; then
  [ -t 0 ] || die "--admin needs an interactive terminal."
  prompt_admin_credentials
elif [ "${ADMINS// /}" = "0" ]; then
  if [ -t 0 ]; then
    prompt_admin_credentials
  else
    # Non-interactive first run: generate a password and store it in a git-ignored file.
    ADMIN_PW="Adm1n$(node -e "console.log(require('crypto').randomBytes(9).toString('base64url'))")"
    (cd server && ADMIN_USERNAME="admin" ADMIN_PASSWORD="$ADMIN_PW" npx tsx src/scripts/set-admin.ts) >/dev/null
    printf 'Local development admin (created by startup.sh)\nusername: admin\npassword: %s\n' "$ADMIN_PW" > "$ADMIN_FILE"
    unset ADMIN_PW
    info "Admin created. Credentials saved to .dev-admin.txt (git-ignored)."
  fi
else
  info "Admin account exists. To change the admin login run: ./startup.sh --admin"
fi

# ------------------------------------------------------------------------------------------
step "7/7  Starting ChessArena"
echo
bold "    Website:  http://localhost:$WEB_PORT"
bold "    API:      http://localhost:$API_PORT/health"
info "Admin portal:  http://localhost:$WEB_PORT/admin/login   (change login: ./startup.sh --admin)"
info "Press Ctrl+C to stop everything."
echo

# Open the browser once the site answers (best effort, non-blocking).
(
  for _ in $(seq 1 60); do
    if node -e "fetch('http://localhost:$WEB_PORT').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*) cmd //c start "" "http://localhost:$WEB_PORT" >/dev/null 2>&1 ;;
        Darwin) open "http://localhost:$WEB_PORT" ;;
        *) command -v xdg-open >/dev/null && xdg-open "http://localhost:$WEB_PORT" >/dev/null 2>&1 ;;
      esac
      exit 0
    fi
    sleep 1
  done
) &

npm run dev &
APP_PID=$!
wait "$APP_PID"
