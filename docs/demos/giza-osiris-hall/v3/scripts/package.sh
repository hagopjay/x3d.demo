#!/usr/bin/env bash
# Build dist/giza-atlas-v3.zip with a top-level folder, ready to extract and run.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist; rm -f dist/giza-atlas-v3.zip; OUT="$PWD/dist/giza-atlas-v3.zip"
T=$(mktemp -d); mkdir "$T/giza-atlas-v3"
tar --exclude=./dist --exclude=./rebuilt --exclude=./__pycache__ --exclude='*.pyc' -cf - . | tar -xf - -C "$T/giza-atlas-v3"
(cd "$T" && python3 -I -c "
import zipfile,os
z=zipfile.ZipFile('$OUT','w',zipfile.ZIP_DEFLATED,compresslevel=9)
for d,_,fs in os.walk('giza-atlas-v3'):
    for f in sorted(fs): z.write(os.path.join(d,f))
z.close()")
rm -rf "$T"; ls -l dist/giza-atlas-v3.zip; sha256sum dist/giza-atlas-v3.zip
