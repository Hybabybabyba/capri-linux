"""Builds the cut-in strips and her faces (the panel portrait) in assets/capri/ from frames of the show.

Source: the "Capri Cyberpunk2" GIF on Tenor (Edgerunners 2 footage, 148 frames), its 498x498 version
(the sharpest one: the webp and mp4 versions smear the colours):
https://tenor.com/view/capri-cyberpunk2-cyberpunk-2-edgerunners-2-cyberpunk-edgerunners-2-capricorn-gif-5541033963201170705
https://media1.tenor.com/m/TOW1CCj7DREAAAAC/capri-cyberpunk2-cyberpunk-2.gif
plus assets/capri/capri-face.png (from the reference stills; it is also her "grin" face).

    python tools/build-cutins.py path/to/capri.gif

Needs Pillow.
"""
import sys
from pathlib import Path
from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'capri'
CUTIN = (360, 240)
FACE = (256, 256)
BASE = 374

CUTINS = {
    'laugh': (138, (40, 64, 374, 287)),
    'eyes': (135, (0, 128, 374, 377)),
    'many': (123, (0, 62, 374, 311)),
    'look': (99, (0, 74, 374, 323)),
}
FACES = {
    'calm': (6, (85, 55, 275, 245)),
    'aside': (36, (55, 40, 245, 230)),
    'smug': (57, (80, 40, 270, 230)),
    'wide': (90, (60, 45, 280, 265)),
    'look': (99, (34, 58, 334, 358)),
    'laugh': (138, (92, 26, 374, 308)),
    'many': (123, (12, 12, 362, 362)),
}

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    frames = [f.convert('RGB') for f in ImageSequence.Iterator(Image.open(sys.argv[1]))]
    k = frames[0].width / BASE
    crop = lambda i, box: frames[i].crop(tuple(round(v * k) for v in box))
    for name, (i, box) in CUTINS.items():
        crop(i, box).resize(CUTIN, Image.LANCZOS).save(OUT / f'cutin-{name}.png', optimize=True)
    for name, (i, box) in FACES.items():
        crop(i, box).resize(FACE, Image.LANCZOS).save(OUT / f'face-{name}.png', optimize=True)
    face = Image.open(OUT / 'capri-face.png').convert('RGB')
    face.crop((16, 58, 241, 208)).resize(CUTIN, Image.LANCZOS).save(OUT / 'cutin-grin.png', optimize=True)
    print('cut-ins and faces written to', OUT)

if __name__ == '__main__':
    main()
