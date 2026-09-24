#!/bin/zsh
set -u

cd -- "$(dirname -- "$0")" || exit 1

site_url="http://127.0.0.1:8000/"

if curl -fsS "$site_url" | grep -q "FPL Sidekick"; then
  open "$site_url"
  exit 0
fi

echo "Starting FPL Sidekick at $site_url"
python3 -m http.server 8000 --bind 127.0.0.1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM

for attempt in {1..30}; do
  if curl -fsS "$site_url" | grep -q "FPL Sidekick"; then
    echo "FPL Sidekick is ready. Keep this Terminal window open while you use it."
    open "$site_url"
    wait "$server_pid"
    exit $?
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Could not start on port 8000. Another app may already be using that port."
    exit 1
  fi
  sleep 0.25
done

echo "The local site did not respond at $site_url."
exit 1
