#!/bin/sh
set -eu

action=${1:-status}
port=${2:-3001}
root=$(git rev-parse --show-toplevel)
label="local.opensight.frontend-$port"
plist="$HOME/Library/LaunchAgents/$label.plist"
vite="$root/node_modules/vite/bin/vite.js"

case "$port" in
  *[!0-9]*|'') echo "invalid port: $port" >&2; exit 2 ;;
esac

install_service() {
  test -f "$vite" || {
    echo "missing Vite: $vite" >&2
    exit 1
  }
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v node)</string>
    <string>$vite</string>
    <string>--host</string>
    <string>--port</string>
    <string>$port</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$root</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/opensight-frontend-$port.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/opensight-frontend-$port.err</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  attempts=0
  until launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null; do
    attempts=$((attempts + 1))
    test "$attempts" -lt 20 || {
      echo "could not install $label" >&2
      return 1
    }
    sleep 0.25
  done
}

show_status() {
  attempts=0
  until curl --fail --silent "http://localhost:$port/__opensight_dev.json"; do
    attempts=$((attempts + 1))
    test "$attempts" -lt 20 || {
      echo "frontend $port did not become ready" >&2
      return 1
    }
    sleep 0.25
  done
  printf '\n'
}

case "$action" in
  install) install_service; show_status ;;
  restart) launchctl kickstart -k "gui/$(id -u)/$label"; sleep 1; show_status ;;
  status) show_status ;;
  *)
    echo "usage: $0 [install|restart|status] [port]" >&2
    exit 2
    ;;
esac
