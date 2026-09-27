"""Offline TIFF decoding only. Runtime uses the bundled PNGs, never Python."""
import array
from pathlib import Path
import sys

from PIL import Image

source = Path(sys.argv[1])
with Image.open(source / "lroc_color_poles_4k.tif") as color:
    if color.size != (4096, 2048) or color.mode != "RGB":
        raise ValueError("Expected the NASA 4K RGB color map")
    color_bytes = color.tobytes()

with Image.open(source / "ldem_16_uint.tif") as dem:
    if dem.size != (5760, 2880) or dem.mode != "I;16":
        raise ValueError("Expected the NASA 16 pixels/degree unsigned LOLA map")
    # NASA encodes half-metres relative to 1727400 m. Convert to metres
    # relative to the 1737400 m lunar sphere before resampling in float space.
    heights = dem.convert("F").point(lambda value: value * 0.5 - 10000)
    heights = heights.resize((4096, 2048), Image.Resampling.BILINEAR)
    values = array.array("f", heights.tobytes())
    if sys.byteorder != "little":
        values.byteswap()

sys.stdout.buffer.write(color_bytes)
sys.stdout.buffer.write(values.tobytes())
