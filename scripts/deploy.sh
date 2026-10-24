#!/usr/bin/env bash
# Publishes dist/ to here.now. The first run creates the site and records its slug in
# herenow.json; later runs update the same site (same URL). Password and proxy routes
# are site settings/files, so they survive redeploys.
#
#   npm run deploy
#
# Needs an API key in $HERENOW_API_KEY or ~/.herenow/credentials, plus curl and jq.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${HERENOW_API_KEY:-$(cat ~/.herenow/credentials 2>/dev/null || true)}"
[ -n "$KEY" ] || { echo "No here.now API key (set HERENOW_API_KEY or ~/.herenow/credentials)" >&2; exit 1; }
API="https://here.now/api/v1"
H=(-H "Authorization: Bearer $KEY" -H "X-HereNow-Client: claude-code/deploy-sh" -H "content-type: application/json")

[ -f dist/index.html ] || { echo "dist/ is missing — run npm run build first" >&2; exit 1; }
SLUG="$(jq -r '.slug // empty' herenow.json 2>/dev/null || true)"

ctype() {
  case "$1" in
    *.html) echo "text/html; charset=utf-8" ;;
    *.json) echo "application/json; charset=utf-8" ;;
    *) echo "application/octet-stream" ;;
  esac
}

FILES=$(cd dist && find . -type f | sed 's|^\./||' | sort)
MANIFEST=$(for f in $FILES; do
  jq -n --arg p "$f" --argjson s "$(wc -c < "dist/$f" | tr -d ' ')" --arg c "$(ctype "$f")" \
    --arg h "$(shasum -a 256 "dist/$f" | cut -d' ' -f1)" '{path:$p,size:$s,contentType:$c,hash:$h}'
done | jq -s .)
BODY=$(jq -n --argjson files "$MANIFEST" '{files:$files, displayName:"Print Preview", displayDescription:"G-code visualizer for the Creality K2 Plus and Bambu Lab A1"}')

if [ -n "$SLUG" ]; then
  RES=$(curl -sS -X PUT "$API/publish/$SLUG" "${H[@]}" -d "$BODY")
else
  RES=$(curl -sS -X POST "$API/publish" "${H[@]}" -d "$BODY")
fi
NEW_SLUG=$(echo "$RES" | jq -r '.slug // empty')
[ -n "$NEW_SLUG" ] || { echo "Publish failed: $RES" >&2; exit 1; }
VERSION=$(echo "$RES" | jq -r '.upload.versionId')

echo "$RES" | jq -c '.upload.uploads[]' | while read -r u; do
  p=$(echo "$u" | jq -r .path)
  url=$(echo "$u" | jq -r .url)
  ct=$(echo "$u" | jq -r '.headers["Content-Type"] // empty')
  echo "  uploading $p"
  curl -sS -f -X PUT "$url" -H "Content-Type: ${ct:-$(ctype "$p")}" --data-binary "@dist/$p" > /dev/null
done

FIN=$(curl -sS -X POST "$API/publish/$NEW_SLUG/finalize" "${H[@]}" -d "{\"versionId\":\"$VERSION\"}")
echo "$FIN" | jq -e '.success' > /dev/null || { echo "Finalize failed: $FIN" >&2; exit 1; }
WARN=$(echo "$FIN" | jq -r '(.warnings // [])[]')
[ -z "$WARN" ] || { echo "here.now warnings (check proxy routes!):" >&2; echo "$WARN" >&2; }

jq -n --arg slug "$NEW_SLUG" --arg url "$(echo "$FIN" | jq -r .siteUrl)" '{slug:$slug, url:$url}' > herenow.json
echo "Live: $(echo "$FIN" | jq -r .siteUrl)"
