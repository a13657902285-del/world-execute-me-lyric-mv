#!/bin/bash
# Chunked render for seg_14 (183.0299 -> 197.4938) to avoid OOM browser crashes.
# Renders 3 sub-chunks sequentially, then concats into out/seg_14.mp4
cd ~/workspace/video-project/wem-render || exit 1
CHUNKS=(
  "183.0299 187.8512 14a"
  "187.8512 192.6725 14b"
  "192.6725 197.4938 14c"
)
for c in "${CHUNKS[@]}"; do
  set -- $c; S=$1; E=$2; TAG=$3
  OUT="out/chunk_${TAG}.mp4"
  if [ -f "$OUT" ]; then
    DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null || echo 0)
    echo "[$(date +%H:%M)] chunk $TAG exists dur=$DUR, skip"
    continue
  fi
  echo "[$(date +%H:%M)] chunk $TAG: $S -> $E start"
  node export/export.mjs --width 1920 --height 1080 --fps 60 --cq 26 --start "$S" --end "$E" --out "$OUT" >> "out/chunk_${TAG}.log" 2>&1
  RC=$?
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null || echo 0)
  echo "[$(date +%H:%M)] chunk $TAG done rc=$RC dur=$DUR"
  if [ "$RC" != "0" ]; then echo "CHUNK $TAG FAILED"; exit 2; fi
done
echo "[$(date +%H:%M)] all chunks done, concat"
printf "file 'chunk_14a.mp4'\nfile 'chunk_14b.mp4'\nfile 'chunk_14c.mp4'\n" > out/chunks_14.txt
ffmpeg -y -v error -f concat -safe 0 -i out/chunks_14.txt -c copy out/seg_14.mp4
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 out/seg_14.mp4 2>/dev/null || echo 0)
echo "[$(date +%H:%M)] seg_14 assembled dur=$DUR"
