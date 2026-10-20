#!/usr/bin/env bash
# Regenerates the small media files used by the end-to-end tests (requires ffmpeg).
set -euo pipefail
cd "$(dirname "$0")/../e2e/fixtures"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
# Solid-color photos (distinct, easy to detect by pixel sampling in exported frames).
ff -f lavfi -i "color=c=0xE01818:s=1600x900" -frames:v 1 red-beach.png
ff -f lavfi -i "color=c=0x1830E0:s=1600x900" -frames:v 1 blue-mountain.png
ff -f lavfi -i "color=c=0x18C040:s=900x1600" -frames:v 1 green-portrait.jpg
# Oversized photo (gets stored downscaled to 4096 px on the long side).
ff -f lavfi -i "color=c=0xE0C018:s=6000x4000" -frames:v 1 -q:v 4 huge-yellow.jpg
# Short clip with audio: magenta video + 440 Hz tone.
ff -f lavfi -i "color=c=0xE018E0:s=640x360:r=30" -f lavfi -i "sine=frequency=440:sample_rate=48000" \
   -t 3 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 96k -shortest clip-magenta.mp4
# Background music: 220 Hz tone, 12 s.
ff -f lavfi -i "sine=frequency=220:sample_rate=44100" -t 12 -c:a libmp3lame -b:a 96k music.mp3
# Voice-over stand-in: 660 Hz tone, 2 s, WAV.
ff -f lavfi -i "sine=frequency=660:sample_rate=48000" -t 2 voice.wav
# Invalid inputs.
printf 'this is not media' > notes.txt
head -c 2048 /dev/urandom > broken.png
# depth-scene.jpg is not generated here: it is a 512×512 picture made locally with
# SD-Turbo inside LocVid (prompt: "wide establishing shot of a lighthouse on a rocky
# coast at golden hour, cinematic film still"), used to test depth-based motion.
# kid-football.jpg likewise comes from SD-Turbo in LocVid (prompt: "a boy kicking a
# football on a grass field in front of a village, cartoon illustration, full body,
# vibrant"), used to test the subject cut-out and subject animation.
