#!/usr/bin/env bash
# generate:docs — push docs/ to the GitHub wiki
#
# The GitHub wiki is a separate git repository at:
#   https://github.com/<owner>/<repo>.wiki.git
#
# This script clones the wiki (if not already cloned), copies all markdown
# files from docs/ into it, commits, and pushes. README.md is also copied
# as Home.md (the wiki landing page).
#
# Usage: npm run generate:docs
# Requires: git, gh (GitHub CLI authenticated)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WIKI_DIR="$(mktemp -d)"
REMOTE="$(git -C "$REPO_ROOT" remote get-url origin)"
WIKI_REMOTE="${REMOTE%.git}.wiki.git"

echo "📚 Cloning wiki from $WIKI_REMOTE …"
git clone --quiet "$WIKI_REMOTE" "$WIKI_DIR" 2>/dev/null || {
  # Wiki may not exist yet — initialise an empty repo
  git init --quiet "$WIKI_DIR"
  git -C "$WIKI_DIR" remote add origin "$WIKI_REMOTE"
}

echo "📋 Copying docs …"
# Landing page
cp "$REPO_ROOT/README.md" "$WIKI_DIR/Home.md"
# All docs pages
for f in "$REPO_ROOT/docs/"*.md; do
  dest="$(basename "$f")"
  cp "$f" "$WIKI_DIR/$dest"
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

rm -rf "$WIKI_DIR"
