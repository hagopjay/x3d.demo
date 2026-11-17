#!/usr/bin/env bash
# Full XSD + semantic + profile gate through the external x3d_mcp validator; writes validation-v3.json (a receipt for these exact bytes).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${X3D_MCP_SRC:?set X3D_MCP_SRC to the x3d_mcp src directory}"
SCENE=${1:-giza-atlas-v3.x3d}
OUT=$(python3 build/gate.py "$SCENE" | head -1)
COMMIT=$(git -C "$X3D_MCP_SRC/.." rev-parse --short HEAD 2>/dev/null || echo unknown)
python3 -I - "$SCENE" "$OUT" "$COMMIT" <<'P'
import sys,json,hashlib,datetime
scene,out,commit=sys.argv[1:4]; r=json.loads(out)
r['sha256']=hashlib.sha256(open(scene,'rb').read()).hexdigest(); r['validator']='x3d_mcp '+commit
r['checked_at']=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'); r.pop('sha',None)
json.dump(r,open('validation-v3.json','w'),indent=1); print(json.dumps(r,indent=1))
assert r['xsd'] and r['sem_e']==0, 'GATE FAILED'
P
