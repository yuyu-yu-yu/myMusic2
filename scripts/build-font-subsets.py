"""Split the Fusion Pixel TTF (≈6.9 MB) into small WOFF2 slices for the web.

  core.woff2  every non-ASCII character used by the static UI (index.html,
              app.js, fx.js, manifest) + ASCII / Latin-1 / punctuation /
              full-width forms. Preloaded, so first paint needs only ~32 KB.
  cjk.woff2   the remaining CJK ideographs (song titles, lyrics, chat).
  ext.woff2   everything else the font covers (Kana, Hangul, symbols …).

The browser only downloads a slice when the page actually renders a character
inside its unicode-range. Re-run after adding new UI copy so it lands in core:

  pip install fonttools brotli
  python3 scripts/build-font-subsets.py

The @font-face block printed at the end replaces the one at the top of
public/styles.css (it carries the exact unicode-range of the core slice).
Remember to bump CACHE in public/sw.js afterwards.
"""

import io
import os

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')
SRC = os.path.join(PUBLIC, 'assets', 'fusion-pixel-12px-monospaced-zh_hans.ttf')
OUT_DIR = os.path.join(PUBLIC, 'assets', 'fonts')
UI_SOURCES = ['index.html', 'app.js', 'fx.js', 'manifest.webmanifest']


def to_ranges(codepoints):
    ranges = []
    for cp in sorted(codepoints):
        if ranges and cp == ranges[-1][1] + 1:
            ranges[-1][1] = cp
        else:
            ranges.append([cp, cp])
    return ', '.join(
        f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in ranges
    )


def build(codepoints, name):
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.notdef_outline = True
    options.hinting = False
    font = TTFont(SRC)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    buf = io.BytesIO()
    font.flavor = 'woff2'
    font.save(buf)
    path = os.path.join(OUT_DIR, f'fusion-pixel-{name}.woff2')
    with open(path, 'wb') as fh:
        fh.write(buf.getvalue())
    return len(buf.getvalue())


def main():
    text = ''
    for name in UI_SOURCES:
        with open(os.path.join(PUBLIC, name), encoding='utf-8') as fh:
            text += fh.read()
    ui_chars = {ord(ch) for ch in text if ord(ch) > 0x7F}
    base = (
        set(range(0x20, 0x7F))
        | set(range(0xA0, 0x100))
        | set(range(0x2000, 0x2070))
        | set(range(0x3000, 0x3040))
        | set(range(0xFF00, 0xFFF0))
    )
    cmap = set(TTFont(SRC).getBestCmap())
    core = (ui_chars | base) & cmap
    cjk = {
        cp for cp in cmap
        if 0x3400 <= cp <= 0x4DBF or 0x4E00 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFAFF
    } - core
    ext = cmap - core - cjk

    os.makedirs(OUT_DIR, exist_ok=True)
    slices = [('core', core), ('cjk', cjk), ('ext', ext)]
    for name, cps in slices:
        print(f'{name}: {len(cps)} codepoints, {build(cps, name)} bytes')

    # Browsers check same-family faces last-to-first and only fetch a slice
    # when an earlier match lacks the glyph, so the CJK slice can declare the
    # whole ideograph blocks (keeps the CSS small) as long as core comes last.
    ranges = {
        'ext': to_ranges(ext),
        'cjk': 'U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF',
        'core': to_ranges(core),
    }
    print('\n/* ---- paste into public/styles.css ---- */')
    for name in ['ext', 'cjk', 'core']:
        print('@font-face {')
        print("  font-family: 'Fusion Pixel';")
        print(f"  src: url('/assets/fonts/fusion-pixel-{name}.woff2') format('woff2');")
        print('  font-display: swap;')
        print(f'  unicode-range: {ranges[name]};')
        print('}\n')


if __name__ == '__main__':
    main()
