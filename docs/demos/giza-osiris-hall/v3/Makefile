# Giza Evidence Atlas v3: one-command loop. `make help` lists targets.
PY ?= python3
PORT ?= 8800
.PHONY: help serve test check gate smoke rebuild package sweep
help:      ## list targets
	@grep -E '^[a-z]+:.*##' Makefile | sed 's/:.*##/ -/'
serve:     ## local server at http://127.0.0.1:$(PORT)/
	$(PY) serve.py --port $(PORT)
test:      ## Node (30) + Python (8) unit/regression tests
	node --test tests/*.js
	$(PY) -I -m unittest discover -s tests
check:     ## every offline check: syntax, JSON, tests, references, rebuild identity
	bash scripts/check.sh
gate:      ## XSD + semantic + profile gate (needs X3D_MCP_SRC=/path/to/x3d_mcp/src); writes validation-v3.json
	bash scripts/gate.sh
smoke:     ## headless-browser smoke test (needs Playwright)
	node scripts/smoke.mjs
rebuild:   ## rebuild scene + colour outputs from bundled bakes into ./rebuilt (no Blender)
	$(PY) build/build_scene2.py rebuilt
package:   ## write dist/giza-atlas-v3.zip (run.bat, run.sh, serve.py included)
	bash scripts/package.sh
sweep:     ## leak sweep before publishing
	bash scripts/sweep.sh
