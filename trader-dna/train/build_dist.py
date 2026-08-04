"""Inline model.json into a self-contained dist/index.html (single file, no fetch).
Also writes app/model.json alongside app/index.html for the fetch-based deploy."""
import json, os
HERE = os.path.dirname(__file__)
APP = os.path.join(HERE, "..", "app")
DIST = os.path.join(HERE, "..", "dist")
os.makedirs(DIST, exist_ok=True)

html = open(os.path.join(APP, "index.html")).read()
model = open(os.path.join(APP, "model.json")).read()

# inline the model as a global before any app code; loadModel() prefers it over fetch.
# escape any "</" so a stray sequence can't close the script tag early.
safe = model.replace('</', '<\\/')
out = html.replace('</head>', '<script>window.__DNA_MODEL__=' + safe + ';</script>\n</head>', 1)
assert 'window.__DNA_MODEL__' in out, "injection failed"

with open(os.path.join(DIST, "index.html"), "w") as f:
    f.write(out)
kb = os.path.getsize(os.path.join(DIST, "index.html")) / 1024
print(f"wrote dist/index.html ({kb:.0f} KB, model inlined)")
