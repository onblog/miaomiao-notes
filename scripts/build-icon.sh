#!/usr/bin/env bash
# Regenerate the macOS app icon from build/icon.png.
#
# The master artwork is a 1024x1024 PNG with a rounded plate baked in
# (corner radius 229px = macOS icon grid). It must keep a TRANSPARENT
# background outside that plate: flattening it onto opaque white shows up as an
# outer white frame in Finder / Dock / Launchpad.
#
# Density rule: the cat fills ~93% of the canvas (>=3% clear of the plate edge
# on every side) so the icon does not read as a white square with a small cat in
# the middle. Keep that ratio when swapping the artwork; the plate is pure white
# and every pixel with alpha < 250 must carry white RGB, otherwise the leftover
# dark residue shows up once the master is flattened (apple-touch-icon, og).
#
# History: this used to render build/icon.svg with headless Chrome. The artwork
# is now an illustration rather than a vector, so the PNG is the source of truth
# and the script only needs sips + iconutil plus ImageMagick for the alpha guard.
set -euo pipefail

cd "$(dirname "$0")/.."

MASTER="build/icon.png"
ICONSET="build/icon.iconset"
ICNS="build/icon.icns"
SIZE=1024

if [[ ! -f "$MASTER" ]]; then
  echo "error: $MASTER not found — the master artwork is a committed PNG" >&2
  exit 1
fi

read -r width height < <(sips -g pixelWidth -g pixelHeight "$MASTER" | awk '/pixel/ {print $2}' | paste -sd' ' -)
if [[ "$width" != "$SIZE" || "$height" != "$SIZE" ]]; then
  echo "error: $MASTER must be ${SIZE}x${SIZE} (got ${width}x${height})" >&2
  exit 1
fi

# Guard against a regression to an opaque background: it is invisible in the
# master PNG preview but shows up as a white ring once the icon is installed.
if command -v magick >/dev/null 2>&1; then
  corner=$(magick "$MASTER" -format "%[pixel:p{0,0}]" info:)
  if [[ "$corner" != *",0)"* ]]; then
    echo "error: corner pixel is not transparent ($corner) — refusing to build a white-framed icon" >&2
    exit 1
  fi
fi

echo "==> slicing $ICONSET"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# size -> iconset filenames
emit() {
  local px=$1
  shift
  for name in "$@"; do
    sips -z "$px" "$px" "$MASTER" --out "$ICONSET/$name" >/dev/null
  done
}

emit 16   icon_16x16.png
emit 32   icon_16x16@2x.png icon_32x32.png
emit 64   icon_32x32@2x.png
emit 128  icon_128x128.png
emit 256  icon_128x128@2x.png icon_256x256.png
emit 512  icon_256x256@2x.png icon_512x512.png
emit 1024 icon_512x512@2x.png

echo "==> packing $ICNS"
iconutil -c icns "$ICONSET" -o "$ICNS"

echo "done: $ICNS"
