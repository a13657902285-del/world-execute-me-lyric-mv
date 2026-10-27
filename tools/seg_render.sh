#!/bin/bash
# Segmented render driver for wem-render. Resumable: skips segments whose mp4
# already exists with a sane duration. Logs to out/. Run in background.
cd ~/workspace/video-project/wem-render || exit 1
BOUNDS=(-5.0000 9.4638 23.9277 38.3915 52.8554 67.3192 81.7830 96.2469 110.7107 125.1746 139.6384 154.1022 168.5661 183.0299 197.4938 211.9576)
for i in $(seq 1 15); do
  NN=$(printf "%02d" $i)
  S=${BOUNDS[$((i-1))]}; E=${BOUNDS[$i]}
  OUT="out/seg_${NN}.mp4"
  EXP=$(python3 -c "print(round($E-($S),2))")
  if [ -f "$OUT" ]; then
    DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null || echo 0)
    OK=$(python3 -c "d=float('$DUR'); e=$EXP; print('y' if abs(d-e)<0.6 else 'n')" 2>/dev/null)
    if [ "$OK" = "y" ]; then echo "[$(date +%H:%M)] seg $NN OK (${DUR}s), skip"; continue; fi
    echo "[$(date +%H:%M)] seg $NN bad (dur=$DUR vs $EXP), re-render"
  fi
  echo "[$(date +%H:%M)] seg $NN: $S -> $E (${EXP}s) start"
  node export/export.mjs --width 1920 --height 1080 --fps 60 --cq 26 --start "$S" --end "$E" --out "$OUT" >> "out/seg_${NN}.log" 2>&1
  RC=$?
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null || echo 0)
  echo "[$(date +%H:%M)] seg $NN done rc=$RC dur=$DUR"
  if [ "$RC" != "0" ]; then echo "SEGMENT $NN FAILED (rc=$RC), aborting driver"; exit 2; fi
done
echo "[$(date +%H:%M)] ALL 15 SEGMENTS DONE"
