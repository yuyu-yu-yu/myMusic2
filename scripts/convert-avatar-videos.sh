#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
generated_dir="$root_dir/public/avatar/generated"
webm_dir="$root_dir/public/avatar/webm"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to convert avatar MP4 files to WebM." >&2
  echo "Install ffmpeg, then rerun: bash scripts/convert-avatar-videos.sh" >&2
  exit 1
fi

mkdir -p "$webm_dir"

shopt -s nullglob
files=("$generated_dir"/*.mp4)

if [ "${#files[@]}" -eq 0 ]; then
  echo "No MP4 files found in $generated_dir"
  exit 0
fi

for file in "${files[@]}"; do
  name="$(basename "$file" .mp4)"
  out="$webm_dir/${name}.webm"
  echo "Converting $file -> $out"
  ffmpeg -y -i "$file" \
    -vf "fps=24,scale=720:-1:flags=neighbor" \
    -c:v libvpx-vp9 \
    -b:v 0 \
    -crf 34 \
    -an \
    "$out"
done
