#!/usr/bin/env bash
# Delete expired preview links. here.now stops serving a site once its TTL passes, but the
# site record stays on the account, so this removes those leftovers for good.
# Only touches sites in the "Print previews" folder whose expiresAt is in the past.
#
#   scripts/cleanup-expired.sh            # delete expired previews
#   scripts/cleanup-expired.sh --dry-run  # just list them
#
# share.sh runs this automatically (quietly) every time it creates a link.
set -euo pipefail
FOLDER="Print previews"
DRY=0
QUIET=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --quiet) QUIET=1 ;;
    *) echo "usage: cleanup-expired.sh [--dry-run] [--quiet]" >&2; exit 1 ;;
  esac
done
KEY="${HERENOW_API_KEY:-$(cat ~/.herenow/credentials 2>/dev/null || true)}"
[ -n "$KEY" ] || { echo "cleanup-expired.sh: no here.now API key" >&2; exit 1; }
H=(-H "Authorization: Bearer $KEY" -H "X-HereNow-Client: claude-code/cleanup-sh")

LIST=$(curl -sS -G "https://here.now/api/v1/publishes" --data-urlencode "folder=$FOLDER" "${H[@]}")
if ! echo "$LIST" | jq -e '.publishes' > /dev/null 2>&1; then
  # 404 folder_not_found just means no previews were ever filed
  [ "$QUIET" = 1 ] || echo "no \"$FOLDER\" folder yet; nothing to clean"
  exit 0
fi
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EXPIRED=$(echo "$LIST" | jq -r --arg now "$NOW" '.publishes[] | select(.expiresAt != null and .expiresAt < $now) | .slug')
count=0
for slug in $EXPIRED; do
  count=$((count + 1))
  if [ "$DRY" = 1 ]; then
    echo "would delete $slug"
  else
    curl -sS -X DELETE "https://here.now/api/v1/publish/$slug" "${H[@]}" > /dev/null && { [ "$QUIET" = 1 ] || echo "deleted $slug"; }
  fi
done
[ "$QUIET" = 1 ] || echo "$count expired preview(s)$([ "$DRY" = 1 ] && echo ' found' || echo ' removed')"
