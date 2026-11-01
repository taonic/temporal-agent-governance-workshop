"""Give the "03 / Temporal" frame in ex3-nexus.html room below its inner frames.

Archify ends every frame a fixed 20px below its lowest box, ignoring `pad`, so the Temporal
frame's bottom edge lands on the Nexus and Durable execution frames' bottoms. Run this after
each `archify finalize` of ex3-nexus, then re-export the PNG. Archify's provenance check no
longer matches the patched HTML; re-render from the candidate to check it again.
"""

import re
from pathlib import Path

EXTRA = 24
HTML = Path(__file__).with_name("ex3-nexus.html")

html = HTML.read_text()
pattern = re.compile(r'(data-composition-frame-label="03 / Temporal"[^>]*? height=")(\d+(?:\.\d+)?)(")')
patched, count = pattern.subn(lambda m: f"{m[1]}{float(m[2]) + EXTRA:g}{m[3]}", html)
if count != 1:
    raise SystemExit(f"expected one Temporal frame rect, found {count}")
HTML.write_text(patched)
print(f"Temporal frame: {EXTRA}px more at the bottom")
