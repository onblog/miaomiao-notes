#!/usr/bin/env bash
#
# 从位图主图重新生成站点图标（favicon.ico 以及可选的 apple-touch-icon 等 PNG）。
#
# 主图是 build/icon.png（1024×1024，圆角底板已烘焙进图里，四角透明；
# 底板颜色来自插画自带的奶油底，不是填白）。
# 依赖：sips（macOS 自带） + ImageMagick 7（brew install imagemagick）
#
# 为什么不再从 SVG 渲染：图标美术现在是插画位图，没有对应矢量源；
# 历史遗留的 `magick icon.svg favicon.ico` 坑（缺 librsvg 时 MSVG 渲染器
# 不认 rx / 渐变 / clipPath / alpha，四角会变实心）也随之消失。
#
# 用法：
#   tools/build-icons.sh
#   ICON_PNGS="180:apple-touch-icon.png 512:icon-512.png" tools/build-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${ICON_SRC:-build/icon.png}"
OUT="${ICON_OUT:-site/public}"
NAME="${ICON_NAME:-favicon.ico}"
# 额外 PNG 产物：`尺寸:文件名`，空格分隔。apple-touch 开头的一律压到白底上
# （iOS 会把透明区域涂黑，压白底才不难看）。
PNGS="${ICON_PNGS:-}"

command -v sips   >/dev/null || { echo "缺少 sips（macOS 自带）" >&2; exit 1; }
command -v magick >/dev/null || { echo "缺少 ImageMagick 7：brew install imagemagick" >&2; exit 1; }
[ -f "$SRC" ] || { echo "找不到主图：$SRC" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 16 给标签页、32 给书签/工具栏、48 给 Windows、64/128/256 给高分屏与固定到开始菜单
sizes=(16 32 48)
frames=()
for s in "${sizes[@]}"; do
  sips -z "$s" "$s" "$SRC" --out "$tmp/icon-$s.png" >/dev/null
  frames+=("$tmp/icon-$s.png")
done

magick "${frames[@]}" "$OUT/$NAME"

for spec in $PNGS; do
  size="${spec%%:*}"
  file="${spec#*:}"
  sips -z "$size" "$size" "$SRC" --out "$tmp/png-$file" >/dev/null
  case "$file" in
    apple-touch*) magick "$tmp/png-$file" -background white -alpha remove -alpha off "$OUT/$file" ;;
    *)            cp "$tmp/png-$file" "$OUT/$file" ;;
  esac
done

echo "已生成（主图 ${SRC}）："
magick identify "$OUT/$NAME" | awk '{printf "  %-28s %s\n", $1, $3}'
for spec in $PNGS; do
  file="${spec#*:}"
  printf '  %-28s %sx%s\n' "$OUT/$file" "${spec%%:*}" "${spec%%:*}"
done

# 透明性自检：背景带圆角的图标，四角必须透。
alpha="$(magick "$OUT/$NAME[1]" -format '%[fx:p{1,1}.a]' info:)"
echo "  32px 帧左上角 alpha = ${alpha}（0 表示透明）"
case "$alpha" in
  0|0.0*) : ;;
  *) echo "  ⚠️ 四角不透明：主图四角应当透明，检查 build/icon.png" >&2 ;;
esac
