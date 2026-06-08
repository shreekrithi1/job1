#!/bin/bash
cd "$HOME/claude/Projects/jobsearch"
rm -f .git/HEAD.lock .git/index.lock
git add -A
git commit -m "${1:-update}" 2>/dev/null || echo "Nothing new to commit"

echo "→ Pushing to job1..."
git remote set-url origin https://github.com/shreekrithi1/job1.git
git push origin main

echo "→ Pushing to jobs (Vercel)..."
git remote set-url origin https://github.com/shreekrithi1/jobs.git
git push origin main

echo ""
echo "✅ Done! Vercel will deploy in ~60 seconds."
read -p "Press Enter to close..."
