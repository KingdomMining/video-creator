# video-creator

Generates ~30s vertical (1080x1920) animated cliffhanger story videos: narrated scenes, word-by-word captions, sound design, and an A/B "comment below" choice card.

## Make a video
```
pip install piper-tts numpy        # needs ffmpeg + node with playwright
python make_video.py episodes/deep-signal/ep01.json      # -> out/deep-signal-ep01.mp4 (+ .txt post caption)
python make_video.py episodes/*/ep01.json                # batch
python make_video.py episodes/deep-signal/ep01.json --still 12.5   # preview one frame
```
The narrator voice downloads automatically on first run.

## Write an episode
Copy any `episodes/*/ep01.json`. Keep the story ~60-70 words for ~30s.

- `theme`: `space` | `bunker` | `war` (palette + music)
- `hook`: red text shown for the first 3s
- `scenes[]`: `text` (narration), `visual`, optional `params`, `hold` (extra silent seconds), `sfx` (`at` seconds from scene start; negative = from scene end)
- `choice`: `narration`, `question`, `a`, `b`

Visuals: `space`, `corridor`, `door` (`variant: vault`, `figure`, `alarm`, `label`), `console` (`lines`, `radar: false`, `big` countdown), `city`, `room`, `radio` (`freq`), `figure` (`small`, `eyes`, `cam`), `wasteland` (`flares`, `tower`, `figures`).

SFX: `knock`, `alarm`, `static`, `boom`, `beep`.

## Series loop
Post episode -> read comments -> write `epNN+1.json` continuing from the winning choice -> render.
