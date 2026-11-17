# Film guide: turning a script into a finished video

For the team that animates one episode. Read `docs/STAGE3D.md` first (the stage, the preview tool, the frame
and its safe zones), then the kit references in `docs/kit/` (each has a catalogue image: look at them) and
`docs/AUDIO.md`.

## 1. What you start with and what you deliver

Start: `episodes/<slug>/part01.json` (the approved script: narration per scene, a `shot` description per scene,
cast, sets, the choice, thumbnail idea) and `episodes/<slug>/series.json` (the story bible with the hidden
truth: never reveal more than the script does, but stay consistent with it).

**Do not change the narration, the choice or the story.** If a line cannot be animated or timed, flag it.

Deliver:
- `renderer/films/<slug>/world.js`: the cast, the sets and the look of this film, shared by all its shots.
- `renderer/films/<slug>/shots_*.js`: one shot per scene, plus the thumbnail shot.
- The production fields added to `part01.json` (below).
- A finished build: `python make_video.py episodes/<slug>/part01.json` produces both cuts, the thumbnail and
  the post text in `out/`.

## 2. File layout and naming

```js
// renderer/films/<slug>/world.js
(() => {
  const F = (window.FILMS = window.FILMS || {});
  F['<slug>'] = {
    cast: { hero: () => Actors.make({...}), ... },      // functions: every shot builds its own copies
    sets: { kitchen(s, o) { ...adds the set to stage s, returns handles (lights, doors, anchor points)... } },
    look: { night(s) { ...sky, fog, key and fill lights... } },
  };
})();

// renderer/films/<slug>/shots_a.js
(() => {
  const W = window.FILMS['<slug>'];
  S3.shot('<px>_s01', { build(s) {...}, update(s, lt, d) {...} });     // <px> = a 2-3 letter prefix unique to the film
})();
```
Every file is wrapped in `(() => { ... })();`. Shot names are `<px>_<scene id>`; the thumbnail shot is `<px>_thumb`.

## 3. Production fields in the episode JSON

```
"scripts": ["renderer/films/<slug>/world.js", "renderer/films/<slug>/shots_a.js", ...],   load order
"style":   {"accent": "#5ad7ff", "warn": "#ff3344", "hi": "#ffe14a", "titleFont": "Anton", "titleWeight": 400,
            "bloom": 0.38, "vignette": 0.72, "grain": 0.06},
"music":   {"mood": "dread", "key": "Dm", "bpm": 84},          see docs/AUDIO.md
"space":   "room",                                             reverb character
"scenes": [{
   "id": "s01", "visual": "<px>_s01", "params": {},
   "text": "...unchanged narration...",
   "pre": 0.4,          silent beat before the narration of this scene starts
   "hold": 0.8,         silent beat after it ends (use for an action or a sound to land)
   "min": 5.0,          minimum scene length
   "ambience": "rain",
   "sfx": [{"type": "door_knock", "on": "knocks", "offset": 0.2},     at the moment the narrator says a word
           {"type": "thunder", "at": 1.5}, {"type": "phone_buzz", "at": -1.2}],   seconds from scene start, or from its end if negative
   "in": "cut" | "fade" | "flash",
   "post": {"bloom": 0.5, "grade": {"color": "#ff2200", "alpha": 0.12, "mode": "soft-light"}}
}],
"thumbnail": {"visual": "<px>_thumb", "title": "SERIES TITLE", "tagline": "WOULD YOU OPEN IT?",
              "layout": "top" | "center" | "bottom", "colors": ["#ffffff", "#ffe14a"]}
```
`style.titleFont` must be a family from `renderer/fonts/fonts.json` (use the weight listed there) or Inter.
Pick a font and an accent colour that fit the genre; the ten films must not look alike.

## 4. Timing: animation follows the narration

- `python make_video.py episodes/<slug>/part01.json --draft` prints every scene's start and length from
  estimated speech (instant). `--timeline` does the same from the real voice (about a minute the first time,
  cached afterwards). Scene lengths come from the narration plus `pre`, `hold`, `min`.
- Inside a shot, `s.cue('word', fallback)` is the local time the narrator says that word. Land the action on
  it: `const k = S3.ramp(lt, s.cue('knocks', 2) - 0.2, s.cue('knocks', 2) + 0.1)`. Never hard-code a time for
  something the narrator describes.
- `d` (the shot length) changes when the voice is rendered. Write `update` so it works for any `d`: drive
  slow moves with `lt / d`, and timed actions with cues.
- The video opens with the thumbnail held for 0.8 s while the first words are already being spoken; scene 1
  starts at 0.8 s. The last scene continues under the choice card for about 7 s: keep it alive (a slow move,
  a looming threat) and keep its key subject visible above y 1400.

## 5. Looking at your work

```bash
node renderer/render.js --shot <px>_s03 --scripts renderer/films/<slug>/world.js,renderer/films/<slug>/shots_a.js --n 6 --dur 7 --out /tmp/claude-0/s03.jpg --guides --text "the narration of this scene"
python make_video.py episodes/<slug>/part01.json --draft --sheet 24          # the whole film, 24 frames, with captions
python make_video.py episodes/<slug>/part01.json --draft --still 31.5 --guides
python make_video.py episodes/<slug>/part01.json --draft --thumb             # the thumbnail
```
Look at every image with the Read tool. Render close-ups when something is small. A shot is not done until you
have looked at it at the start, the middle and the end, with `--guides` and with its captions.

## 6. What a finished shot looks like

- Reads in one second: who, where, doing what. It shows what the narration says, at the moment it says it.
- The subject is inside the safe area and not under the caption band. Characters' feet touch the ground,
  nothing floats or passes through anything, eyelines point at what the character is looking at.
- The characters act: they move, look, react, shift weight. Nobody stands frozen in the default pose.
- The camera moves with purpose, and something else in the frame is alive too.
- Lit with intent: a readable subject, depth, a colour idea. Never flat, never murky.
- Consistent with the other shots: same characters and clothes, same set, same time of day unless the story
  changed it; screen direction and positions carry over a cut.
- Inside the platform rules: no firearms, no gore or visible wounds, no jump scares, no children in danger.
- Different from the shot before it: change the size, the angle or the subject at every cut.

## 7. The thumbnail

`<px>_thumb` is one striking, simple image of the story's dilemma: one clear subject, strong light and colour,
readable at the size of a postage stamp. It doubles as the first frame of the video, so it must be complete at
`lt = 0` (it may drift slowly afterwards). The title and tagline are drawn automatically (`layout` picks top,
centre or bottom): compose the picture so the text does not cover the subject, and keep everything important
inside the central 4:5 area (y 285-1635; `--guides` shows it). Not gory, not misleading: it shows a real moment
of this episode.

## 8. Sound

Choose the music mood, the ambience per scene and the effects from the lists in `docs/AUDIO.md`. Every visible
action that would make a sound gets one (footsteps, doors, knocks, phone buzzes, thunder), placed with `on` or
`at`. No sudden loud shrieks. The narration must stay the clearest thing in the mix.
