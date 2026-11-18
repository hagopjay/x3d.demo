#!/usr/bin/env bash
# x3d_mcp XSD + semantic + profile gate for giza-vi.x3d; writes validation-vi.json (a receipt for these exact bytes).
# Usage from v6/: X3D_MCP_SRC=/path/to/x3d_mcp/src bash build/gate.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${X3D_MCP_SRC:?set X3D_MCP_SRC to the x3d_mcp src directory}"
OUT=$(python3 ../v3/build/gate.py giza-vi.x3d | head -1)
COMMIT=$(git -C "$X3D_MCP_SRC/.." rev-parse --short HEAD 2>/dev/null || echo unknown)
python3 -I - "$OUT" "$COMMIT" <<'P'
import sys,json,hashlib,datetime
out,commit=sys.argv[1:3]; r=json.loads(out); b=open('giza-vi.x3d','rb').read()
r['sha256']=hashlib.sha256(b).hexdigest(); r['bytes']=len(b); r['validator']='x3d_mcp '+commit; r.pop('sha',None)
r['checked_at']=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
json.dump(r,open('validation-vi.json','w'),indent=1); print(json.dumps(r,indent=1))
assert r['xsd'] and r['sem_e']==0, 'GATE FAILED'
P
