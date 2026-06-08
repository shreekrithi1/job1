#!/bin/bash
cd "$HOME/claude/Projects/jobsearch"
rm -f .git/HEAD.lock .git/index.lock
git remote set-url origin https://github.com/shreekrithi1/jobs.git
git add -A
git commit -m "${1:-update}" 2>/dev/null || echo "Nothing new to commit"
git push origin main
echo ""
echo "✅ Done! Vercel will deploy in ~60 seconds."
read -p "Press Enter to close..."
