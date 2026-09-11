#!/usr/bin/env bash
# start.sh — JobFlow one-click launcher for macOS / Linux
# Usage: ./start.sh  (or double-click in a terminal-aware file manager)

set -e

# Move to script directory so relative paths always work
cd "$(dirname "$0")"

# ── Colour helpers ──────────────────────────────────────────────────────────
BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "  ${BOLD}=====================================  ${NC}"
echo -e "  ${CYAN}  JobFlow - Job Application Suite    ${NC}"
echo -e "  ${BOLD}=====================================  ${NC}"
echo ""

# ── Dependency check ────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "  ${RED}[ERROR]${NC} Node.js not found. Install it from https://nodejs.org"
  exit 1
fi

# ── 1. Harvest sessions from browser profile ───────────────────────────────
echo -e "  ${GREEN}[1/4]${NC} Harvesting sessions from Brave profile…"
if pgrep -x "brave" >/dev/null 2>&1 || pgrep -x "Brave Browser" >/dev/null 2>&1; then
  echo -e "  ${CYAN}[!]${NC} Note: Make sure Brave is closed for profile extraction."
fi
node bot/harvestSessions.js || true

# ── 2. Start API server in background ──────────────────────────────────────
echo -e "  ${GREEN}[2/4]${NC} Starting API server (port 3001)…"
node bot/server.js &
SERVER_PID=$!

# Trap CTRL-C / exit to also kill the background server
cleanup() {
  echo ""
  echo -e "  Shutting down API server (PID $SERVER_PID)…"
  kill "$SERVER_PID" 2>/dev/null || true
  echo -e "  ${GREEN}All stopped. Goodbye!${NC}"
}
trap cleanup EXIT INT TERM

# ── 3. Wait then open browser ───────────────────────────────────────────────
echo -e "  ${GREEN}[3/4]${NC} Waiting for server to start…"
sleep 3

echo -e "  ${GREEN}[4/4]${NC} Opening dashboard in default browser…"
URL="http://localhost:5173/run"

# Cross-platform browser open
if command -v xdg-open &>/dev/null; then
  xdg-open "$URL" &        # Linux
elif command -v open &>/dev/null; then
  open "$URL"              # macOS
elif command -v wslview &>/dev/null; then
  wslview "$URL"           # WSL
fi

# ── 4. Run Vite in foreground ───────────────────────────────────────────────
echo ""
echo -e "  Dashboard : ${CYAN}http://localhost:5173/run${NC}"
echo -e "  API       : ${CYAN}http://localhost:3001${NC}"
echo -e "  Press ${BOLD}Ctrl+C${NC} to stop everything."
echo ""

cd dashboard
npx vite --port 5173
