# Ah & Jump · asset kit

- body-1.png / body-2.png / body-3.png  1254×1254, transparent. Three headless outfits on one template, one picked at random each round. The player's face is cropped from the camera and drawn at the neck (142 px tall on an 840 px canvas), with a 16 px cream (#fffdf2) outline. Fallback when no face is captured: a blurred disc with a white line smiley, drawn in code. Rope handles per body (avatar space): body-1 x±86 y-178, body-2 x±77 y-177, body-3 x±89 y-186.
- hair/  Two hairstyles behind the face, each split into a still cap plus swinging parts: braids-cap + braid-left + braid-right (body-1), pony-cap + pony-tail (body-2). 640 px frame, source 1254 px, scale 0.36 onto the face; head centre (627,330) sits 46 px above the neck; braid pivots (425,370)/(830,370), ponytail pivot (600,110). A spring driven by vertical speed swings them.
- court.png  941×1672. Vertical court background.
- Rope is drawn in code: outline #263c47 7 px, body #ee9cd2 4.8 px, highlight #ffd9f2 1.2 px. On a fall the body turns #ff777d.
- Palette: bg #142c29 · yellow #ffe052 · coral #ff716f · purple #9b88ff · cream #fffdf0 · teal #4ec9b0 · ink #234436.
- Sounds: jump, land, count, go, fall, win synthesized with WebAudio. Result stingers shared with the salon game: audio/ending-great.mp3 (win), audio/ending-bad.mp3 (faceplant).
- Music: synthesized bed, 126 bpm, F / C / Dm / Bb, kick + hats + clap + bass + plucks, from countdown to result, fades on a fall. Gain 0.09 with the mic, 0.16 in practice.
- Voice: volume-onset gate, not speech recognition. Threshold auto-calibrated between 0.004 and 0.08; rearms after 130 ms of quiet; minimum 250 ms between jumps.
- Round: 15 s. One "ah", one jump. Four jump poses picked at random (poses.mjs).
