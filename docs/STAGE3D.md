# The 3D stage: how films are animated

Films are low-poly 3D, rendered with three.js r160 in headless Chromium (software WebGL, about 5 frames per
second at 1080x1920) and composited on a 2D canvas that adds bloom, vignette, grain, captions and the choice
card. This file is the contract for everyone who builds kits or shots.

Source of truth for the API is the JSDoc in `renderer/stage3d.js` (short; read it). `renderer/lab/core_test.js`
is a working example of two shots.

## 1. The one rule: everything is a pure function of time

Frames are rendered out of order (previews jump around; the final render goes in order). So:

- `update(s, lt, d, t, p)` must set the **entire** state of the shot from `lt` (seconds since the shot started).
  Positions, rotations, light intensities, camera: all computed from `lt`. Never `+=` anything per frame.
- No `Math.random()`, no `Date`, no `performance.now()`. Use `rng(seed)` (returns a function giving 0..1),
  `S3.noise1(x, seed)`, `S3.hash1(n, seed)`.
- Timing helpers: `S3.ramp(lt, a, b)` is 0 before `a`, 1 after `b`, smooth between. `S3.pulse(lt, a, b, c, d)`
  rises a-b, holds, falls c-d. `lerp(a, b, k)`, `clamp(x)`, `ease(x)`, `mod(a, n)` are global.

## 2. Coordinates and scale

- Units are metres. Y is up. The ground is y = 0. An adult is about 1.75 tall.
- Characters and props face **+Z** by default. `rotation.y` (heading) turns them; positive turns toward +X.
- Real sizes: door 0.9 x 2.1, table top 0.75 high, chair seat 0.45, kitchen counter 0.9, ceiling 2.6,
  car 4.4 long x 1.8 wide x 1.45 high, street lane 3.5 wide, storey 3.0.

## 3. Registering a shot

```js
(() => {                                   // every file is wrapped like this: no top-level const/let/function
  const { box, boxB, cylB, coneB, ball, blob, grp, glow, flare, ramp } = S3;   // lerp, clamp, ease, mod, rng are globals

  S3.shot('zb_alley', {
    build(s, p) {                          // once. `this` is this object: keep references on it.
      s.sky({ top: '#04060f', horizon: '#141c33', stars: 400 });
      s.fog('#0d1322', 12, 60);            // fog colour = clear colour; keep it close to the sky horizon
      s.ground({ color: '#232a2a', vary: 0.06, seg: 40 });
      s.sun({ dir: [-3, 6, -4], color: '#8fb0ff', intensity: 0.25 });   // moonlight, with shadows
      s.hemi('#35486e', '#101418', 0.35);
      this.lamp = s.point([2, 3, 0], '#ffb060', 0.7, 9);
      this.crate = s.add(boxB(1, 1, 1, '#8a5a34', { vary: 0.08 }), { pos: [2, 0, -1], rot: [0, 0.4, 0] });
    },
    update(s, lt, d, t, p) {               // every frame, from lt only
      this.lamp.intensity = this.lamp.userData.base * S3.flicker(lt, 0.3);
      const k = ramp(lt, 0, d);
      s.cam.set({ pos: [3 - k * 2, 1.6, 7 - k * 2], look: [0, 1.2, 0], fov: 48 }).shake(0.01, lt);
    },
    overlay(c, s, lt, d, t, p) { /* optional 2D drawing on the 1080x1920 canvas, after the 3D */ },
    post: { bloom: 0.4, vignette: 0.75, grain: 0.06, grade: { color: '#3050ff', alpha: 0.1, mode: 'soft-light' } },
  });
})();
```

A shot is used by an episode scene: `{"visual": "zb_alley", "text": "narration...", "params": {...}}`.
`p` is that scene's `params` (a shot is rebuilt per distinct params).

### The stage `s`

| Call | What it does |
|------|--------------|
| `s.add(obj, {pos, rot, scale})` | add an object to the scene, returns it |
| `s.sky({top, horizon, bottom, stars})`, `s.skyDisc({dir, color, size, glow})` | gradient sky dome, sun or moon disc |
| `s.fog(color, near, far)` | distance fog and clear colour |
| `s.ground({color, vary, seg})`, `s.terrain({size, seg, height, flat, color})` | flat ground, or hills that are flat near the origin (`.heightAt(x, z)`) |
| `s.sun({dir, color, intensity, area, center})` | key light with soft shadows. `dir` = where the light comes from. `area` = half-size of the shadowed region (default 22 m) |
| `s.hemi(sky, ground, intensity)`, `s.ambient(color, intensity)` | fill light |
| `s.point(pos, color, intensity, range)` | lamp, no shadows. `l.userData.base` = intensity, for flicker |
| `s.spot(pos, target, color, intensity, range, angleDeg, {shadow})` | flashlight, headlight, doorway spill |
| `s.particles({count, size, color, additive, at(i, lt, rand, out)})` | deterministic particles |
| `s.screen(w, h, pxW, pxH, draw(c, lt, t, pxW, pxH))` | a quad whose picture is redrawn every frame |
| `s.tick(fn(lt, t, s))` | run after `update` every frame (self-animating props and effects) |
| `s.cam.set({pos, look, fov, roll})`, `.shake(amp, lt)` | camera. `fov` is vertical: 60 wide, 45 normal, 28 telephoto |
| `s.cue('word', fallback)` | local time at which the narrator says that word in this scene: land actions on the narration |
| `s.sfxTimes('knock')` | local times of sound events in this scene |
| `s.exposure` | overall brightness, default 1 |

### Building blocks (all return a shadow-casting `THREE.Mesh`, chainable `.at(x,y,z) .rot(x,y,z) .scl(k) .to(parent)`)

`box(w,h,d,col,o)`, `boxB` (stands on its origin), `cyl(rTop,rBot,h,sides,col,o)`, `cylB`, `cone(r,h,sides,col,o)`,
`coneB`, `ball(r,col,detail,o)`, `blob(r,col,seed,{squash,bump})` (rocks, foliage), `plane(w,d,col,o)` (flat on the
ground), `quad(w,h,col,o)` (upright), `torus`, `extrude(outline2D, depth, col, {holes})`, `lathe(profile, sides, col)`,
`tube(points, r, col)`, `grp(...children)`.

Material options `o`: `{rough, metal, emissive, ei, opacity, side:'double', vary: 0.08 (per-face brightness
variation: use it on anything organic or large), jitter, seed, shadow:false}`. `col` can be a material:
`S3.mat(color, o)` (cached), `S3.glow(color, k)` (unlit, blooms; for lamps, screens, eyes, fire).

Textures: `S3.canvasTex(w, h, draw)` + `S3.texMat(tex, {basic, emissive})` for facades with lit windows, signs,
posters. `S3.label(text, height, {font, color, bg, glow})` for a text sign. `S3.flare(color, size, opacity)`
for a soft halo around a light.

Camera helpers: `S3.camMix(a, b, k)`, `S3.orbit(center, radius, angle, height)`, `S3.path(points)` ->
`{at(u), heading(u), length}`. `S3.project(s, [x,y,z])` gives canvas pixels inside `overlay`.

## 4. Previewing (do this constantly)

```bash
# one shot, 6 frames across 7 seconds, as a contact sheet
node renderer/render.js --shot zb_alley --scripts renderer/films/zb/world.js,renderer/films/zb/shots.js --n 6 --dur 7 --out /tmp/x.jpg
#   --at 0,2.5,6      exact local times           --params '{"night":true}'
#   --guides          draw the platform UI zones   --clean  hide header and captions
#   --text "the words of this scene"   shows captions the way the final video will
#   --draft           half-resolution 3D (4x faster)   --scale 0.5 --cols 3   tile size and layout
```
Then look at the image with the Read tool. Kit files in `renderer/kit/*.js` load automatically; list your own
files with `--scripts`. A page error is printed and the command exits non-zero.

## 5. The frame: vertical video, covered by platform UI

The canvas is 1080 x 1920. Apps draw their interface over the top 250 px, the bottom 420-480 px and a column of
buttons on the right (x > 940 between y 850 and 1500). Captions are drawn around y 1190.

- Put faces and the key action in x 100-940, y 320-1050.
- Nothing the viewer must see below y 1400. The caption band (y 1080-1300) should not hide the subject's face.
- Compose for a tall frame: use height (foreground low, subject mid, sky or ceiling high), get the camera close,
  and prefer one clear subject over a wide empty view.

## 6. Making it look good

- **Light with intent.** One key light with shadows, one soft fill, then small coloured practical lights
  (lamps, screens, fire) near the characters. Warm against cool reads best. Night scenes still need a readable
  subject: rim or pool of light on the character, darkness around.
- **Fog is depth.** Every exterior gets fog matched to the sky horizon. Interiors: black or a dark wall colour.
- **Colour.** Pick 3-4 hues per film and stick to them. Use `vary` so big surfaces are not flat. Emissive
  accents (`S3.glow`) bloom and draw the eye: use them to point at what matters.
- **Always move the camera**: a slow push-in, drift or orbit plus `shake(0.008-0.02, lt)`. Static frames look dead.
- **Something else moves too**: particles, a flickering lamp, swaying branches, rain, a screen.
- **Stage in depth**: foreground object, subject, background. Overlap them.
- Shots change every 4-9 seconds. Each shot must read in one second: who, where, doing what.

## 7. Performance budget

Per frame the software renderer is fill-rate bound. Keep per shot: under about 60k triangles, at most 6 lights
(one shadowed sun, optionally one shadowed spot), no post-processing passes of your own. Use `canvasTex` for
many small details (windows) instead of many meshes. Thousands of separate meshes are slow: merge or instance.

## 8. Rules for kit files (`renderer/kit/<name>.js`)

- Wrap the file in an IIFE and export exactly one global: `const KitNature = (() => { ...; return {...}; })();`
  No other top-level names (all scripts share one global scope; a duplicate `const` breaks the whole page).
- Every builder is `name(o = {})` and returns a `THREE.Group` at real scale, standing on y = 0, centred on its
  footprint, front toward +Z. Options: colours with good defaults, `seed` for variation, sizes where useful.
- Moving parts are exposed on `group.userData` (for example `userData.door` = the hinged group, `userData.wheels`,
  `userData.lights`), and anything animated is a pure function of time.
- Low-poly: flat shading, few sides, `vary` on organic or large surfaces. Typical prop under 300 triangles.
- Document every builder in `docs/kit/<name>.md` (signature, options, size, what `userData` exposes) and render a
  labelled catalogue image to `docs/kit/<name>.jpg`.
