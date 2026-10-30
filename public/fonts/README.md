# Fonts

Stump sets everything in Gantari, self-hosted under the SIL Open Font License
1.1 in `gantari/LICENSE.txt`. The Latin WOFF2 files for weights 400, 500, 600,
700 and 800 come from Fontsource's Gantari distribution (5.2.8); upstream:
https://github.com/Lafontype/Gantari. Code uses the system monospace stack.

The root document links `/fonts/fonts.css` once and preloads the 400 and 800
files (`src/base/font-head.ts`, a recorded adaptation). Do not import this CSS
from a component. Every body-font stack uses `--font-body`; controls inherit it.

`outfit/` is Base's default face, kept as Base ships it; Stump does not load it.
