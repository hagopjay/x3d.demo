# Applying the source patch

The complete ZIP is ready to run. `Evidence-Edition-upgrade.patch` is an additional text-source diff against the supplied `Semantic Twin Lab.zip`.

To apply it separately, extract the original ZIP into a clean folder, copy the patch there, and run these commands beside its original `index.html`:

```bash
git apply --check Evidence-Edition-upgrade.patch
git apply Evidence-Edition-upgrade.patch
python3 serve.py
```

A Git working tree is not required by `git apply`. The patch includes new source, tests, documentation and evidence JSON. Unchanged vendor files and original data remain supplied by the original ZIP. The complete enhanced ZIP includes them all.

No remote repository, merge, push, or publication is performed by this patch.
