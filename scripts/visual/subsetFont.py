"""Subset the Montserrat variable font into the two WOFF2 files the site loads.

src/assets/Montserrat-VariableFont_wght.ttf is 688 kB. The page loads
fonts/montserrat-var-core.woff2 (~59 kB: Latin, Latin-1, punctuation and
the arrows the project links use) for its own copy, and the browser fetches
fonts/montserrat-var-ext.woff2 (~104 kB: Latin Extended, Vietnamese, more
symbols) only when a character in its range is on screen. The weight axis
and every OpenType feature are kept in both.

The ranges must match the two @font-face `unicode-range`s in src/styles.css.
If the copy gains a character outside CORE, add it to CORE here and there.

    pip install fonttools brotli
    python scripts/visual/subsetFont.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'src' / 'assets' / 'Montserrat-VariableFont_wght.ttf'
OUT = ROOT / 'src' / 'assets' / 'fonts'

CORE = ('U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,'
        'U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+FEFF,U+FFFD')
EXT = ('U+0100-0130,U+0132-0151,U+0154-024F,U+0259,U+02B0-02BA,U+02BD-02C5,U+02C7-02D9,U+02DB,'
       'U+02DD-0303,U+0305-0307,U+0309-0328,U+032A-036F,U+1E00-1EFF,U+20A0-20AB,U+20AD-20CF,'
       'U+2100-2121,U+2123-214F,U+219A-21FF,U+2200-2211,U+2213-2214,U+2216-22FF,U+25A0-25FF,U+FB00-FB06')

OUT.mkdir(exist_ok=True)
for name, ranges in (('core', CORE), ('ext', EXT)):
    target = OUT / f'montserrat-var-{name}.woff2'
    subprocess.run([sys.executable, '-m', 'fontTools.subset', str(SOURCE), f'--unicodes={ranges}',
                    '--layout-features=*', '--flavor=woff2', f'--output-file={target}'], check=True)
    print(f'{target.name}: {target.stat().st_size / 1024:.1f} kB')
