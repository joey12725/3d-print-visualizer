#!/usr/bin/env bash
# Publish a sliced G-code file as a self-contained preview link on here.now that
# deletes itself after 14 days. Prints the link (or JSON with --json).
#
#   scripts/share.sh path/to/print.gcode
#   scripts/share.sh job.gcode.3mf --plate 2 --json
#
# Options:
#   --plate N          plate to use from a multi-plate .gcode.3mf (default 1)
#   --name NAME        display name (default: file name)
#   --printer ID       k2plus | a1 | generic (default: detected from the G-code)
#   --ttl-days N       expiry in days (default 14)
#   --json             print a JSON object instead of just the URL
#
# Needs curl, jq, gzip, unzip, base64 and a here.now API key in $HERENOW_API_KEY or
# ~/.herenow/credentials. The viewer page is taken from the deployed main site (see
# herenow.json) so links always get the latest viewer; falls back to dist/index.html.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

die() { echo "share.sh: $*" >&2; exit 1; }
for bin in curl jq gzip unzip base64; do command -v "$bin" > /dev/null || die "missing $bin"; done

FILE="" PLATE=1 NAME="" PRINTER="" TTL_DAYS=14 JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --plate) PLATE="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --printer) PRINTER="$2"; shift 2 ;;
    --ttl-days) TTL_DAYS="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$FILE" ] || die "only one file at a time"; FILE="$1"; shift ;;
  esac
done
[ -n "$FILE" ] || die "usage: share.sh FILE [--plate N] [--name NAME] [--printer k2plus|a1|generic] [--json]"
[ -f "$FILE" ] || die "no such file: $FILE"

KEY="${HERENOW_API_KEY:-$(cat ~/.herenow/credentials 2>/dev/null || true)}"
[ -n "$KEY" ] || die "no here.now API key (set HERENOW_API_KEY or ~/.herenow/credentials)"
API="https://here.now/api/v1"
H=(-H "Authorization: Bearer $KEY" -H "X-HereNow-Client: claude-code/share-sh" -H "content-type: application/json")
MAIN_URL="$(jq -r '.url // empty' "$ROOT/herenow.json" 2>/dev/null || true)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
GCODE="$WORK/print.gcode"
THUMB=""

# ---- extract the G-code
base="$(basename "$FILE")"
magic="$(head -c 2 "$FILE" | od -An -tx1 | tr -d ' \n')"
if [ "$magic" = "504b" ]; then
  plates=$(unzip -Z1 "$FILE" | grep -iE '\.gcode$' | sort -V || true)
  [ -n "$plates" ] || die "$base has no sliced G-code inside (export the plate as a sliced file)"
  entry=$(echo "$plates" | grep -E "plate_${PLATE}\.gcode$" | head -1 || true)
  [ -n "$entry" ] || entry=$(echo "$plates" | sed -n "${PLATE}p")
  [ -n "$entry" ] || die "plate $PLATE not found; plates: $(echo $plates)"
  unzip -p "$FILE" "$entry" > "$GCODE"
  png="${entry%.gcode}.png"
  if unzip -Z1 "$FILE" | grep -qx "$png"; then
    unzip -p "$FILE" "$png" > "$WORK/thumb.png"
    [ "$(wc -c < "$WORK/thumb.png")" -lt 150000 ] && THUMB="data:image/png;base64,$(base64 < "$WORK/thumb.png" | tr -d '\n')"
  fi
  default_name="$(echo "$base" | sed -E 's/\.(gcode\.)?3mf$|\.zip$//')"
  [ "$(echo "$plates" | wc -l | tr -d ' ')" -gt 1 ] && default_name="$default_name · plate_$PLATE"
  default_name="$default_name.gcode"
elif [ "$magic" = "1f8b" ]; then
  gzip -dc "$FILE" > "$GCODE"
  default_name="${base%.gz}"
else
  cp "$FILE" "$GCODE"
  default_name="$base"
fi
NAME="${NAME:-$default_name}"
case "$NAME" in *.gcode|*.GCODE) ;; *) NAME="$NAME.gcode" ;; esac

# ---- facts for the caller (slicer-reported, header + footer)
meta() { { head -n 400 "$GCODE"; tail -n 1200 "$GCODE"; } | grep -m1 -iE "$1" | sed -E "s/$1//I" | tr -d '\r' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g' || true; }
MODEL="$(meta '^; *printer_model *= *')"
TIME="$(meta '^; *total estimated time: *')"
[ -n "$TIME" ] || TIME="$(meta '^; *model printing time: *[^;]*; *total estimated time: *')"
[ -n "$TIME" ] || TIME="$(meta '^; *estimated printing time \(normal mode\) *= *')"
GRAMS="$(meta '^; *filament used \[g\] *= *')"
[ -n "$GRAMS" ] || GRAMS="$(meta '^; *total filament weight \[g\] *: *')"
GRAMS_TOTAL="$(echo "$GRAMS" | tr ',' '\n' | awk '{s+=$1} END {if (NR) printf "%.1f", s}')"

if [ -z "$PRINTER" ]; then
  case "$(echo "$MODEL" | tr 'A-Z' 'a-z')" in
    *k2*plus*) PRINTER=k2plus ;;
    *"a1 mini"*) PRINTER=generic ;;
    *bambu*a1*) PRINTER=a1 ;;
    *) PRINTER=generic ;;
  esac
fi

# ---- viewer page
HTML="$WORK/index.html"
if [ -n "$MAIN_URL" ] && curl -sSf "${MAIN_URL%/}/index.html" -o "$HTML" 2> /dev/null && grep -q '<div id="app">' "$HTML"; then
  :
elif [ -f "$ROOT/dist/index.html" ]; then
  cp "$ROOT/dist/index.html" "$HTML"
else
  die "couldn't get the viewer page from ${MAIN_URL:-herenow.json} and dist/index.html is missing (run npm run build)"
fi

# ---- package
gzip -6 -c "$GCODE" > "$WORK/print.gcode.gz"
TTL=$((TTL_DAYS * 86400))
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
EXP="$(date -u -r $(( $(date -u +%s) + TTL )) +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$(( $(date -u +%s) + TTL ))" +%Y-%m-%dT%H:%M:%SZ)"
jq -n --arg name "$NAME" --arg c "$NOW" --arg e "$EXP" --arg p "$PRINTER" --arg t "$THUMB" \
  --argjson b "$(wc -c < "$WORK/print.gcode.gz" | tr -d ' ')" \
  '{v:1, name:$name, createdAt:$c, expiresAt:$e, printer:$p, bytes:$b} + (if $t == "" then {} else {thumbnail:$t} end)' > "$WORK/share.json"

size() { wc -c < "$1" | tr -d ' '; }
TITLE="$(echo "${NAME%.gcode}" | cut -c1-60)"
BODY=$(jq -n --argjson ttl "$TTL" --arg dn "G-code · $TITLE" --arg dd "Shared 3D print preview (expires ${EXP:0:10})" \
  --argjson s1 "$(size "$HTML")" --argjson s2 "$(size "$WORK/print.gcode.gz")" --argjson s3 "$(size "$WORK/share.json")" \
  '{ttlSeconds:$ttl, displayName:($dn[0:80]), displayDescription:$dd, files:[
     {path:"index.html", size:$s1, contentType:"text/html; charset=utf-8"},
     {path:"print.gcode.gz", size:$s2, contentType:"application/octet-stream"},
     {path:"share.json", size:$s3, contentType:"application/json; charset=utf-8"}]}')

RES=$(curl -sS -X POST "$API/publish" "${H[@]}" -d "$BODY")
SLUG=$(echo "$RES" | jq -r '.slug // empty')
[ -n "$SLUG" ] || die "create failed: $RES"
VERSION=$(echo "$RES" | jq -r '.upload.versionId')
echo "$RES" | jq -c '.upload.uploads[]' | while read -r u; do
  p=$(echo "$u" | jq -r .path)
  case "$p" in index.html) src="$HTML" ;; *) src="$WORK/$p" ;; esac
  curl -sS -f -X PUT "$(echo "$u" | jq -r .url)" -H "Content-Type: $(echo "$u" | jq -r '.headers["Content-Type"]')" --data-binary "@$src" > /dev/null \
    || die "upload of $p failed"
done
FIN=$(curl -sS -X POST "$API/publish/$SLUG/finalize" "${H[@]}" -d "{\"versionId\":\"$VERSION\"}")
echo "$FIN" | jq -e '.success' > /dev/null || die "finalize failed: $FIN"
URL=$(echo "$FIN" | jq -r .siteUrl)
EXP=$(echo "$FIN" | jq -r ".publishStatus.expiresAt // \"$EXP\"")

if [ "$JSON" = 1 ]; then
  jq -n --arg url "$URL" --arg slug "$SLUG" --arg exp "$EXP" --arg name "$NAME" --arg printer "$PRINTER" \
    --arg time "$TIME" --arg grams "$GRAMS_TOTAL" --arg perColor "$GRAMS" \
    '{url:$url, slug:$slug, expiresAt:$exp, name:$name, printer:$printer, printTime:$time,
      filamentGrams:($grams|tonumber? // null),
      filamentGramsPerColor:([$perColor | split(",")[] | (gsub("\\s";"")|tonumber?) ] | map(select(. > 0)))}'
else
  echo "$URL"
fi
