#!/usr/bin/env bash
# Give existing preview links the latest viewer. Each preview carries its own copy of the
# viewer from when it was made, so after `npm run deploy` old links still show the old UI.
# This swaps in the deployed viewer page and keeps each link's G-code, folder and expiry.
#
#   scripts/refresh-previews.sh                  # every unexpired preview in "Print previews"
#   scripts/refresh-previews.sh vivid-cobble-fgg2  # just these slugs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
die() { echo "refresh-previews.sh: $*" >&2; exit 1; }

KEY="${HERENOW_API_KEY:-$(cat ~/.herenow/credentials 2>/dev/null || true)}"
[ -n "$KEY" ] || die "no here.now API key (set HERENOW_API_KEY or ~/.herenow/credentials)"
API="https://here.now/api/v1"
H=(-H "Authorization: Bearer $KEY" -H "X-HereNow-Client: claude-code/refresh-previews-sh")
MAIN_URL="$(jq -r '.url // empty' "$ROOT/herenow.json")"
[ -n "$MAIN_URL" ] || die "herenow.json has no url"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -sSf "${MAIN_URL%/}/index.html" -o "$WORK/index.html" || die "couldn't download the viewer from $MAIN_URL"
grep -q '<div id="app">' "$WORK/index.html" || die "the main site didn't return the viewer page"

if [ $# -gt 0 ]; then
  SLUGS="$*"
else
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  SLUGS=$(curl -sS -G "$API/publishes" --data-urlencode "folder=Print previews" "${H[@]}" |
    jq -r --arg now "$NOW" '.publishes[]? | select(.expiresAt != null and .expiresAt > $now) | .slug')
fi
[ -n "$SLUGS" ] || { echo "no active previews"; exit 0; }

size() { wc -c < "$1" | tr -d ' '; }
for slug in $SLUGS; do
  dir="$WORK/$slug"
  mkdir -p "$dir"
  info=$(curl -sS "$API/publish/$slug" "${H[@]}")
  expires=$(echo "$info" | jq -r '.expiresAt // empty')
  [ -n "$expires" ] || { echo "skip $slug: not a preview (no expiry)"; continue; }
  # keep the print and its manifest exactly as they are
  for f in print.gcode.gz share.json; do
    curl -sSf "$API/publish/$slug/files/$f" "${H[@]}" -o "$dir/$f" || { echo "skip $slug: missing $f"; continue 2; }
  done
  cp "$WORK/index.html" "$dir/index.html"
  body=$(jq -n --argjson s1 "$(size "$dir/index.html")" --argjson s2 "$(size "$dir/print.gcode.gz")" --argjson s3 "$(size "$dir/share.json")" \
    '{files:[{path:"index.html", size:$s1, contentType:"text/html; charset=utf-8"},
             {path:"print.gcode.gz", size:$s2, contentType:"application/octet-stream"},
             {path:"share.json", size:$s3, contentType:"application/json; charset=utf-8"}]}')
  res=$(curl -sS -X PUT "$API/publish/$slug" "${H[@]}" -H "content-type: application/json" -d "$body")
  version=$(echo "$res" | jq -r '.upload.versionId // empty')
  [ -n "$version" ] || { echo "skip $slug: update failed: $res"; continue; }
  echo "$res" | jq -c '.upload.uploads[]' | while read -r u; do
    p=$(echo "$u" | jq -r .path)
    curl -sSf -X PUT "$(echo "$u" | jq -r .url)" -H "Content-Type: $(echo "$u" | jq -r '.headers["Content-Type"]')" --data-binary "@$dir/$p" > /dev/null
  done
  fin=$(curl -sS -X POST "$API/publish/$slug/finalize" "${H[@]}" -H "content-type: application/json" -d "{\"versionId\":\"$version\"}")
  echo "$fin" | jq -e '.success' > /dev/null || { echo "skip $slug: finalize failed: $fin"; continue; }
  # put the original expiry back if the update moved it
  now_s=$(date -u +%s)
  exp_s=$(date -u -j -f '%Y-%m-%dT%H:%M:%S' "${expires%%.*}" +%s 2>/dev/null || date -u -d "$expires" +%s)
  after=$(curl -sS "$API/publish/$slug" "${H[@]}" | jq -r '.expiresAt // empty')
  if [ "${after:0:16}" != "${expires:0:16}" ] && [ "$exp_s" -gt "$now_s" ]; then
    curl -sS -X PATCH "$API/publish/$slug/metadata" "${H[@]}" -H "content-type: application/json" \
      -d "{\"ttlSeconds\": $((exp_s - now_s))}" > /dev/null
  fi
  echo "refreshed $slug (expires ${expires:0:10})"
done
