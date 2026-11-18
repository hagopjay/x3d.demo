.PHONY: check browser
check:
	$(MAKE) -C ../v3 check
	node --check giza.js
	node --check witness.js
	node --check hawara.mjs
	node --test tests/*.mjs
	python3 -I tests/check.py
browser:
	node tests/browser.cjs
