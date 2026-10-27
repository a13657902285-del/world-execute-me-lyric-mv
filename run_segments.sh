#!/bin/bash
# 15-segment render driver for world.execute(me); fan MV (1080p60).
# Resumable: skips segments whose out/seg_NN.mp4 already validates.
# Frame-exact tiling: segment NN covers frames [F_N, F_{N+1}) with F_N = -300 + round(N*13017/15).
cd ~/workspace/video-project/wem-render || exit 1
PROG=out/segments_progress.log

ffok() {
  # $1 = file, $2 = expected min duration (s)
  local f="$1" d
  [ -s "$1" ] || return 1
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null) || return 1
  [ -n "$d" ] || return 1
  python3 -c "import sys; sys.exit(0 if float('$d') >= float('$2') - 0.5 else 1)" || return 1
  local v a r fps
  v=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "$f" 2>/dev/null)
  a=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$f" 2>/dev/null)
  [ "$v" = "video" ] && [ "$a" = "audio" ] || return 1
  r=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,avg_frame_rate -of csv=p=0 "$f" 2>/dev/null)
  [ "$r" = "1920,1080,60/1" ] || return 1
  return 0
}

# boundaries: F_0..F_15
mapfile -t F < <(python3 -c "
for n in range(16): print(-300 + round(n*13017/15))")
echo "boundaries: ${F[*]}" | tee -a "$PROG"
python3 -c "
f=[-300+round(n*13017/15) for n in range(16)]
print('total frames:', f[15]-f[0], 'segs:', [f[i+1]-f[i] for i in range(15)])" | tee -a "$PROG"

rm -f out/seg_01.mp4   # stale 48-byte fragment

for n in $(seq 1 15); do
  NN=$(printf "%02d" $n)
  F0=${F[$((n-1))]}; F1=${F[$n]}
  S=$(python3 -c "print(f'{$F0/60:.6f}')"); E=$(python3 -c "print(f'{$F1/60:.6f}')")
  DUR=$(python3 -c "print(f'{($F1-$F0)/60:.2f}')")
  if ffok "out/seg_$NN.mp4" "$DUR"; then
    echo "[$(date +%H:%M)] seg_$NN already OK, skip" | tee -a "$PROG"
    continue
  fi
  echo "[$(date +%H:%M)] seg_$NN frames $F0..$((F1-1)) ($S..$E s) start" | tee -a "$PROG"
  ok=0
  for try in 1 2; do
    if node export/export.mjs --start "$S" --end "$E" --out "out/seg_$NN.mp4" --width 1920 --height 1080 --fps 60 > "out/seg_$NN.log" 2>&1; then
      if ffok "out/seg_$NN.mp4" "$DUR"; then ok=1; break; fi
      echo "[$(date +%H:%M)] seg_$NN try$try failed validation, retry" | tee -a "$PROG"
    else
      echo "[$(date +%H:%M)] seg_$NN try$try export failed, retry" | tee -a "$PROG"
    fi
    sleep 5
  done
  if [ $ok = 1 ]; then
    echo "[$(date +%H:%M)] seg_$NN DONE ($(stat -c%s out/seg_$NN.mp4) bytes)" | tee -a "$PROG"
  else
    echo "[$(date +%H:%M)] seg_$NN FAILED after 2 tries - STOPPING" | tee -a "$PROG"
    exit 3
  fi
done
echo "[$(date +%H:%M)] ALL 15 SEGMENTS DONE" | tee -a "$PROG"
