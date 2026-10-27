#!/bin/bash
# Full 15-segment re-render for the Muse-name/m-mark fix (2026-10-16).
# Mirrors the exact procedure that produced the delivered film:
#   seg_01..13 : single-shot via node export/export.mjs (same flags as run_segments.sh)
#   seg_14,15  : memory-safe 3-chunk renders via tools/render_seg14_chunked.sh / render_seg15_chunked.sh
# Then concat + audio re-encode (AAC 192k, video copy) + QA frame extraction.
# Resumable: valid segments are skipped. NO watchdog timeouts - slow is fine.
# Logs to out/rerun_v2.log. Writes out/RERUN_V2_DONE.txt on success, out/RERUN_V2_FAILED.txt on failure.
set -u
cd ~/workspace/video-project/wem-render || exit 1
LOG=out/rerun_v2.log
PROG() { echo "[$(date '+%m-%d %H:%M')] $*" | tee -a "$LOG"; }

ffok() {
  # $1 = file, $2 = expected min duration (s)
  local f="$1" d
  [ -s "$1" ] || return 1
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null) || return 1
  [ -n "$d" ] || return 1
  python3 -c "import sys; sys.exit(0 if float('$d') >= float('$2') - 0.5 else 1)" || return 1
  local v a r
  v=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "$f" 2>/dev/null)
  a=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$f" 2>/dev/null)
  [ "$v" = "video" ] && [ "$a" = "audio" ] || return 1
  r=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,avg_frame_rate -of csv=p=0 "$f" 2>/dev/null)
  [ "$r" = "1920,1080,60/1" ] || return 1
  return 0
}

# Song-time segment boundaries (identical to tools/seg_render.sh, from the delivered film's procedure)
BOUNDS=(-5.0000 9.4638 23.9277 38.3915 52.8554 67.3192 81.7830 96.2469 110.7107 125.1746 139.6384 154.1022 168.5661 183.0299 197.4938 211.9576)

PROG "=== rerun v2 start (Muse-name/m-mark fix) ==="

# --- seg_01 .. seg_13 : single-shot ---
for i in $(seq 1 13); do
  NN=$(printf "%02d" $i)
  S=${BOUNDS[$((i-1))]}; E=${BOUNDS[$i]}
  DUR=$(python3 -c "print(round($E-($S),2))")
  OUT="out/seg_${NN}.mp4"
  if ffok "$OUT" "$DUR"; then PROG "seg $NN OK (${DUR}s), skip"; continue; fi
  PROG "seg $NN: $S -> $E (${DUR}s) start"
  ok=0
  for try in 1 2; do
    if node export/export.mjs --start "$S" --end "$E" --out "$OUT" --width 1920 --height 1080 --fps 60 >> "out/seg_${NN}.log" 2>&1; then
      if ffok "$OUT" "$DUR"; then ok=1; break; fi
      PROG "seg $NN try$try failed validation, retry"
    else
      PROG "seg $NN try$try export failed, retry"
    fi
    sleep 5
  done
  if [ $ok = 1 ]; then
    PROG "seg $NN DONE ($(stat -c%s "$OUT") bytes)"
  else
    PROG "seg $NN FAILED after 2 tries - STOPPING"
    echo "failed at seg $NN, $(date)" > out/RERUN_V2_FAILED.txt
    exit 3
  fi
done

# --- seg_14, seg_15 : memory-safe chunked (proven 2026-10-15) ---
for NN in 14 15; do
  i=$NN
  S=${BOUNDS[$((i-1))]}; E=${BOUNDS[$i]}
  DUR=$(python3 -c "print(round($E-($S),2))")
  OUT="out/seg_${NN}.mp4"
  if ffok "$OUT" "$DUR"; then PROG "seg $NN OK (${DUR}s), skip"; continue; fi
  PROG "seg $NN chunked render start"
  if bash "tools/render_seg${NN}_chunked.sh" >> "out/chunked_${NN}_v2.log" 2>&1; then
    if ffok "$OUT" "$DUR"; then
      PROG "seg $NN DONE ($(stat -c%s "$OUT") bytes)"
    else
      PROG "seg $NN chunked output failed validation - STOPPING"
      echo "failed at seg $NN (chunked validation), $(date)" > out/RERUN_V2_FAILED.txt
      exit 3
    fi
  else
    PROG "seg $NN chunked script failed - STOPPING"
    echo "failed at seg $NN (chunked script), $(date)" > out/RERUN_V2_FAILED.txt
    exit 3
  fi
done

PROG "ALL 15 SEGMENTS DONE - stitching"

# --- concat ---
printf "file '%s'\n" "$(pwd)/out/seg_01.mp4" "$(pwd)/out/seg_02.mp4" "$(pwd)/out/seg_03.mp4" \
  "$(pwd)/out/seg_04.mp4" "$(pwd)/out/seg_05.mp4" "$(pwd)/out/seg_06.mp4" "$(pwd)/out/seg_07.mp4" \
  "$(pwd)/out/seg_08.mp4" "$(pwd)/out/seg_09.mp4" "$(pwd)/out/seg_10.mp4" "$(pwd)/out/seg_11.mp4" \
  "$(pwd)/out/seg_12.mp4" "$(pwd)/out/seg_13.mp4" "$(pwd)/out/seg_14.mp4" "$(pwd)/out/seg_15.mp4" \
  > out/concat_v2.txt
if ! ffmpeg -y -v error -f concat -safe 0 -i out/concat_v2.txt -c copy out/full_video_v2.mp4; then
  PROG "concat FAILED"; echo "concat failed, $(date)" > out/RERUN_V2_FAILED.txt; exit 4
fi
PROG "concat done: $(stat -c%s out/full_video_v2.mp4) bytes"

# --- final: video copy + audio AAC 192k (mirrors how the delivered film was finished) ---
FINAL='out/world.execute(me);-同人MV-1080p60-v2.mp4'
if ! ffmpeg -y -v error -i out/full_video_v2.mp4 -c:v copy -c:a aac -b:a 192k -movflags +faststart "$FINAL"; then
  PROG "final encode FAILED"; echo "final encode failed, $(date)" > out/RERUN_V2_FAILED.txt; exit 5
fi
FDUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$FINAL" 2>/dev/null)
PROG "final done: $(stat -c%s "$FINAL") bytes, dur=${FDUR}s"

# --- QA frames: 3 per segment ---
mkdir -p out/verify_v2
for i in $(seq 1 15); do
  NN=$(printf "%02d" $i)
  S=${BOUNDS[$((i-1))]}; E=${BOUNDS[$i]}
  DUR=$(python3 -c "print(round($E-($S),2))")
  for k in 1 2 3; do
    T=$(python3 -c "print(round($S + $DUR * $k / 4, 2))")
    ffmpeg -y -v error -ss "$T" -i "out/seg_${NN}.mp4" -frames:v 1 "out/verify_v2/seg_${NN}_$k.png" 2>/dev/null
  done
done
PROG "QA frames extracted to out/verify_v2/ ($(ls out/verify_v2/*.png | wc -l) frames)"

cat > out/RERUN_V2_DONE.txt <<EOF
rerun v2 COMPLETE: $(date -u +%Y-%m-%dT%H:%M:%SZ)
fix: on-screen name 'Muse' + mist-blue m-mark everywhere (code verified pre-render)
final: out/world.execute(me);-同人MV-1080p60-v2.mp4 ($(stat -c%s "$FINAL") bytes, ${FDUR}s)
concat: out/full_video_v2.mp4
qa frames: out/verify_v2/ (3 per segment)
log: out/rerun_v2.log
NEXT: human/agent verifies frames + spot-checks film, then replaces the delivered file
      ~/workspace/your_files/world.execute(me);-同人MV-1080p60.mp4 and the goal files copy,
      and delivers with the prepared publish package (B站+抖音).
EOF
PROG "=== rerun v2 COMPLETE ==="
