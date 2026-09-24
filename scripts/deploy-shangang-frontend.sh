#!/usr/bin/env bash
set -euo pipefail

branch="${DEPLOY_BRANCH:-main}"
host="${DEPLOY_HOST:-Baosight-AIPAC01@10.168.10.6}"
url="${DEPLOY_URL:-http://10.168.10.6:3001}"
repo="$(git rev-parse --show-toplevel)"
release_dir="${RELEASE_DIR:-$(cd "$repo/../.." && pwd)/.workspace/releases}"
current_branch="$(git -C "$repo" symbolic-ref --quiet --short HEAD || true)"
candidate_ref="${DEPLOY_COMMIT:-$branch}"
candidate="$(git -C "$repo" rev-parse "$candidate_ref^{commit}")"
branch_tip="$(git -C "$repo" rev-parse "$branch^{commit}")"
head="$(git -C "$repo" rev-parse HEAD)"
tree="$(git -C "$repo" rev-parse "$candidate^{tree}")"
short="${candidate:0:7}"
stamp="$(date +%Y%m%d-%H%M%S)"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/opensight-shangang-build.XXXXXX")"
zip_path="$release_dir/shangang-frontend-$stamp-$short.zip"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

encode_powershell() {
  printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n'
}

cleanup() {
  git -C "$repo" worktree remove --force "$build_dir" >/dev/null 2>&1 || true
}
trap cleanup EXIT

[[ "$current_branch" == "$branch" ]] || fail "run from $branch, found ${current_branch:-detached HEAD}"
[[ "$candidate" == "$branch_tip" ]] || fail "tested commit $candidate is no longer the $branch tip"
[[ "$head" == "$branch_tip" ]] || fail "HEAD is not the current $branch tip"
[[ -d "$repo/node_modules" ]] || fail "node_modules is missing; install dependencies first"

read_manifest="\$ProgressPreference='SilentlyContinue'; \$path='C:\\OpenSight\\frontend-dist\\deployment.json'; if (Test-Path \$path) { (Get-Content -Raw \$path | ConvertFrom-Json).commit }"
deployed="$(ssh "$host" "powershell -NoLogo -NoProfile -NonInteractive -EncodedCommand $(encode_powershell "$read_manifest")" | tr -d '\r' | tail -n 1)"
if [[ "$deployed" =~ ^[0-9a-f]{40}$ ]]; then
  git -C "$repo" cat-file -e "$deployed^{commit}" 2>/dev/null \
    || fail "deployed commit $deployed is unknown locally"
  git -C "$repo" merge-base --is-ancestor "$deployed" "$candidate" \
    || fail "candidate $candidate is not a descendant of deployed $deployed"
elif [[ "${ALLOW_BOOTSTRAP:-0}" != "1" ]]; then
  fail "deployment manifest is missing; rerun once with ALLOW_BOOTSTRAP=1"
fi

mkdir -p "$release_dir"
git -C "$repo" worktree add --detach "$build_dir" "$candidate"
ln -s "$repo/node_modules" "$build_dir/node_modules"
(
  cd "$build_dir"
  npm run build
)
[[ -z "$(git -C "$build_dir" status --porcelain --untracked-files=no)" ]] \
  || fail "build worktree changed tracked source files"

main_js="$(cd "$build_dir/dist" && rg -o 'assets/index\.[A-Za-z0-9_-]+\.js' index.html | head -n 1)"
main_css="$(cd "$build_dir/dist" && rg -o 'assets/index\.[A-Za-z0-9_-]+\.css' index.html | head -n 1)"
[[ -n "$main_js" && -n "$main_css" ]] || fail "main assets were not found in dist/index.html"
index_hash="$(shasum -a 256 "$build_dir/dist/index.html" | awk '{print $1}')"
js_hash="$(shasum -a 256 "$build_dir/dist/$main_js" | awk '{print $1}')"
css_hash="$(shasum -a 256 "$build_dir/dist/$main_css" | awk '{print $1}')"
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\n' \
  '{' \
  "  \"commit\": \"$candidate\"," \
  "  \"tree\": \"$tree\"," \
  "  \"branch\": \"$branch\"," \
  "  \"built_at\": \"$built_at\"," \
  '  "files": {' \
  "    \"index.html\": \"$index_hash\"," \
  "    \"$main_js\": \"$js_hash\"," \
  "    \"$main_css\": \"$css_hash\"" \
  '  }' \
  '}' > "$build_dir/dist/deployment.json"
(
  cd "$build_dir/dist"
  zip -qr "$zip_path" .
)
[[ "$(git -C "$repo" rev-parse "$branch^{commit}")" == "$candidate" ]] \
  || fail "$branch advanced during the build; rerun with the new tip"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "DRY_RUN commit=$candidate artifact=$zip_path"
  exit 0
fi

remote_zip="C:\\OpenSight\\staging\\$(basename "$zip_path")"
scp "$zip_path" "$host:C:/OpenSight/staging/"
deploy_ps="\$ErrorActionPreference='Stop'
\$ProgressPreference='SilentlyContinue'
\$root='C:\\OpenSight'
\$lock=Join-Path \$root 'frontend-deploy.lock'
\$archive='$remote_zip'
\$candidateDir=Join-Path \$root 'frontend-dist.candidate-$stamp-$short'
\$current=Join-Path \$root 'frontend-dist'
\$backup=Join-Path \$root 'frontend-dist.backup-$stamp-$short'
\$handle=\$null
\$writer=\$null
\$movedCurrent=\$false
try {
  \$handle=[IO.File]::Open(\$lock,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  \$writer=New-Object IO.StreamWriter(\$handle)
  \$writer.WriteLine('$candidate')
  \$writer.Flush()
  New-Item -ItemType Directory -Force -Path (Split-Path \$archive) | Out-Null
  Expand-Archive -LiteralPath \$archive -DestinationPath \$candidateDir
  \$manifest=Get-Content -Raw (Join-Path \$candidateDir 'deployment.json') | ConvertFrom-Json
  if (\$manifest.commit -ne '$candidate') { throw 'candidate manifest mismatch' }
  if (Test-Path \$current) {
    Move-Item -LiteralPath \$current -Destination \$backup
    \$movedCurrent=\$true
  }
  try {
    Move-Item -LiteralPath \$candidateDir -Destination \$current
  } catch {
    if (\$movedCurrent -and (Test-Path \$backup) -and -not (Test-Path \$current)) {
      Move-Item -LiteralPath \$backup -Destination \$current
    }
    throw
  }
  Write-Output ('DEPLOYED=$candidate')
  Write-Output ('BACKUP=' + \$backup)
} finally {
  if (\$writer) { \$writer.Dispose() } elseif (\$handle) { \$handle.Dispose() }
  Remove-Item -LiteralPath \$lock -Force -ErrorAction SilentlyContinue
}"
ssh "$host" "powershell -NoLogo -NoProfile -NonInteractive -EncodedCommand $(encode_powershell "$deploy_ps")"

live_manifest="$(curl -fsS "$url/deployment.json")"
live_commit="$(printf '%s' "$live_manifest" | node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).commit")"
[[ "$live_commit" == "$candidate" ]] || fail "live manifest reports $live_commit, expected $candidate"
live_index_hash="$(curl -fsS "$url/" | shasum -a 256 | awk '{print $1}')"
[[ "$live_index_hash" == "$index_hash" ]] || fail "live index hash does not match the release"

echo "DEPLOY_OK commit=$candidate artifact=$zip_path"
