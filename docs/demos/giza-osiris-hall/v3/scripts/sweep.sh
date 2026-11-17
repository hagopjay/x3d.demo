#!/usr/bin/env bash
# Leak sweep: private identifiers must not ship. Excludes vendor/. Prints hits and fails if any.
set -uo pipefail
cd "$(dirname "$0")/.."
PAT='@gmail\.com|@[a-z0-9-]+\.(edu|org)|api[_-]?key|secret[_-]?key|token=|BEGIN [A-Z ]*PRIVATE|chan_[0-9A-Za-z]{10,}|cmsg_[0-9A-Za-z]{10,}|session_[0-9A-Za-z]{10,}|claude\.ai/(artifact|code)|C:\\\\Users|/root/|/home/[a-z]+/'
if grep -rnIE "$PAT" . --exclude-dir=vendor --exclude-dir=dist --exclude-dir=rebuilt --exclude=sweep.sh; then echo "SWEEP: hits above"; exit 1; fi
echo "sweep clean (vendor/ excluded)"
