# Handoff: where this project stands

Repo: KingdomMining/video-creator, branch `claude/gifted-davinci-77dpy6` (draft PR #1).
Channel: This or That Galaxy (@ThisOrThatGalaxy). Goal: 60-90s vertical animated "choose A or B" story videos
for YouTube, TikTok, Facebook, Instagram.

## Owner's rules (do not drop any)
- Every line must make sense logically and factually; no unexplained facts (see docs/WRITERS_GUIDE.md section 3).
- 61-90 seconds. Two cuts per video: standard (YouTube/TikTok, "comment A or B") and -meta (Facebook/Instagram, "What would you do?").
- Handle @ThisOrThatGalaxy on every frame (automatic) plus subtly inside the scene (renderer/kit/brand.js).
- End card: channel name, handle, Instagram/Facebook/YouTube/TikTok, "want more like this" line (automatic).
- Part 2+ opens with the vote result (percentages supplied by the owner, never invented): "previous" block in the episode JSON.
- Every 5 parts merged into one video: make_compilation.py.
- Consequences persist; 3 strikes = death; then "let him rest" (series ends) or "rewind" (auto-take the other option at the first harmful choice). See episodes/deep-signal/series.json "format".
- Platform rules in docs/PLATFORM_RULES.md: no guns on screen, no gore, no jump scares, no children in danger, no real brands. Narrator voices must be commercially licensed (make_video.py VOICES).

## Done and working
- make_video.py: narration (verified by speech recognition, cached), timeline, both cuts, thumbnail, post text. `--draft`, `--sheet N`, `--still T`, `--thumb`.
- renderer/stage3d.js: three.js low-poly 3D stage (docs/STAGE3D.md). renderer/scenes.js: captions, header, clock/meter HUD, fact cards, choice card, vote card, end card, watermark.
- audio.py (old simple version), make_compilation.py, tools/script_check.py.
- Docs: WRITERS_GUIDE.md, FILM_GUIDE.md, STAGE3D.md, PLATFORM_RULES.md.
- Finished 2D videos: episodes/deep-signal parts 1 and 2 (older engine).

## Unfinished (stopped mid-work, may contain bugs)
- Character systems: renderer/lab/actors_a.js / actors_b.js / actors_c.js (pick one, rename to renderer/kit/actors.js, global `Actors`, write docs/ACTORS.md).
- Kits in renderer/kit/: nature, urban, interior, props, scifi, fantasy (fantasy.js had a load error), creatures, fx, ui2d - partial.
- audio.py rebuild (moods, more effects) - not finished.
- No 3D film made yet. No new scripts written.

## Recommended next step (cheap)
Work on ONE film at a time, without large parallel agent teams:
1. Pick one character system and fix it until a lineup renders well.
2. Write one Part 1 script (docs/WRITERS_GUIDE.md), run tools/script_check.py.
3. Build only the sets that story needs, render with make_video.py, review the contact sheet, deliver.
