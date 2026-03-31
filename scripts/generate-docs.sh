#!/usr/bin/env bash
# generate:docs — push docs/ to the GitHub wiki
#
# The GitHub wiki is a separate git repository at:
#   https://github.com/<owner>/<repo>.wiki.git
#
# PREREQUISITE: Enable the wiki on GitHub first:
#   Repository Settings → Features → Wikis → check the box,
#   then create at least one page so the wiki git repo is initialised.
#
# Usage: npm run generate:docs
# Requires: git

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WIKI_DIR="$(mktemp -d)"
REMOTE="$(git -C "$REPO_ROOT" remote get-url origin)"
WIKI_REMOTE="${REMOTE%.git}.wiki.git"

cleanup() { rm -rf "$WIKI_DIR"; }
trap cleanup EXIT

echo "📚 Cloning wiki from $WIKI_REMOTE …"
if ! git clone --quiet "$WIKI_REMOTE" "$WIKI_DIR" 2>/dev/null; then
  echo ""
  echo "❌ Could not clone the GitHub wiki."
  echo ""
  echo "   The wiki needs to be enabled and initialised on GitHub before this"
  echo "   script can push to it. Follow these steps:"
  echo ""
  echo "   1. Go to: ${REMOTE%.git}/settings"
  echo "   2. Scroll to 'Features' and tick the 'Wikis' checkbox."
  echo "   3. Open the Wiki tab, click 'Create the first page', and save it."
  echo "   4. Re-run:  npm run generate:docs"
  echo ""
  exit 1
fi

echo "📋 Copying docs …"
cp "$REPO_ROOT/README.md" "$WIKI_DIR/Home.md"
for f in "$REPO_ROOT/docs/"*.md; do
  cp "$f" "$WIKI_DIR/$(basename "$f")"
done

echo "💾 Committing …"
git -C "$WIKI_DIR" add -A
CHANGES=$(git -C "$WIKI_DIR" status --porcelain | wc -l | tr -d ' ')
if [ "$CHANGES" -eq 0 ]; then
  echo "✅ Wiki is already up to date."
else
  git -C "$WIKI_DIR" commit -m "docs: sync from main $(date -u +%Y-%m-%d)"
  git -C "$WIKI_DIR" push origin HEAD
  echo "✅ Wiki updated ($CHANGES file(s) changed)."
fi
