# Ah & Jump · asset kit

- body.png  1254×1254, transparent. Headless body holding the rope handles. The player's face is cropped from the camera and drawn at the neck (142 px tall on an 840 px canvas), with a 16 px cream (#fffdf2) outline. Fallback face: 😎, on a fall 😵‍💫.
- court.png  941×1672. Vertical court background.
- Rope is drawn in code: outline #263c47 7 px, body #ee9cd2 4.8 px, highlight #ffd9f2 1.2 px. On a fall the body turns #ff777d.
- Palette: bg #142c29 · yellow #ffe052 · coral #ff716f · purple #9b88ff · cream #fffdf0 · teal #4ec9b0 · ink #234436.
- Sounds are synthesized with WebAudio (jump, land, count, go, fall, win). No audio files.
- Voice: volume-onset gate, not speech recognition. Threshold auto-calibrated between 0.004 and 0.08; rearms after 130 ms of quiet; minimum 250 ms between jumps.
- Round: 15 s. One "ah", one jump. Four jump poses picked at random (poses.mjs).
