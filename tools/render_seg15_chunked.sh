#!/bin/bash
# Chunked render for seg_15 (memory-safe: 3 smaller chunks then concat)
cd ~/workspace/video-project/wem-render || exit 1
CHUNKS=("197.4938 202.3151 chunk_15a" "202.3151 207.1364 chunk_15b" "207.1364 211.9576 chunk_15c")
for c in "${CHUNKS[@]}"; do
  set -- $c; S=$1; E=$2; N=$3
  OUT="out/${N}.mp4"
  if [ -f "$OUT" ]; then
    DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null || echo 0)
    OK=$(python3 -c "d=float('$DUR'); e=round($E-($S),2); print('y' if abs(d-e)<0.6 else 'n')" 2>/dev/null)
    if [ "$OK" = "y" ]; then echo "[$(date +%H:%M)] $N exists dur=$DUR, skip"; continue; fi
    echo "[$(date +%H:%M)] $N bad (dur=$DUR), re-render"
  fi
  echo "[$(date +%H:%M)] $N: $S -> $E start"
  node export/export.mjs --width 1920 --height 1080 --fps 60 --cq 26 --start "$S" --end "$E" --out "$OUT" >> "out/${N}.log" 2>&1
  RC=$?; DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null || echo 0)
  echo "[$(date +%H:%M)] $N done rc=$RC dur=$DUR"
  if [ "$RC" != "0" ]; then echo "CHUNK $N FAILED"; exit 2; fi
done
echo "[$(date +%H:%M)] all chunks done, concat"
printf "file '%s'\n" "$(pwd)/out/chunk_15a.mp4" "$(pwd)/out/chunk_15b.mp4" "$(pwd)/out/chunk_15c.mp4" > out/concat_15.txt
ffmpeg -y -v error -f concat -safe 0 -i out/concat_15.txt -c copy out/seg_15.mp4
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 out/seg_15.mp4 2>/dev/null || echo 0)
echo "[$(date +%H:%M)] seg_15 assembled dur=$DUR"
