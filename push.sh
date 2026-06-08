#!/bin/bash
cd "$(dirname "$0")"
rm -f .git/HEAD.lock .git/index.lock .git/objects/maintenance.lock
git remote set-url origin https://github.com/shreekrithi1/jobs.git
git add -A
git commit -m "${1:-update}"
git push origin main
