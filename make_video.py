#!/usr/bin/env python3
"""Build a ~30s vertical cliffhanger video from an episode JSON.

    python make_video.py episodes/deep-signal/ep01.json
    python make_video.py episodes/deep-signal/ep01.json --still 12.5   # preview one frame
"""
import io, json, re, subprocess, sys, wave
from pathlib import Path
import numpy as np

ROOT = Path(__file__).parent
VOICE = ROOT / "voices" / "en_US-ryan-high.onnx"
VOICE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/"
SR, FPS = 44100, 30
_voice = None


def tts(text):
    """Text -> mono float32 at SR, silence trimmed."""
    global _voice
    if _voice is None:
        if not VOICE.exists():
            VOICE.parent.mkdir(exist_ok=True)
            for f in (VOICE.name, VOICE.name + ".json"):
                subprocess.run(["curl", "-sSL", "-o", str(VOICE.parent / f), VOICE_URL + f], check=True)
        from piper import PiperVoice
        _voice = PiperVoice.load(str(VOICE))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        _voice.synthesize_wav(text, w)
    buf.seek(0)
    with wave.open(buf) as w:
        sr = w.getframerate()
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    loud = np.where(np.abs(a) > 0.02)[0]
    if len(loud):
        a = a[max(0, loud[0] - 400): loud[-1] + 2500]
    n = int(len(a) * SR / sr)
    return np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)


def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text) if s.strip()]


def word_times(sentence, start, dur):
    words = sentence.split()
    wt = [len(re.sub(r"\W", "", w)) + 1.5 + (2.5 if w[-1] in ",;:" else 0) + (4 if w.endswith("...") else 0) for w in words]
    total, out, t = sum(wt), [], start
    for w, x in zip(words, wt):
        d = (dur - 0.08) * x / total
        clean = re.sub(r"[^\w'’\-%]", "", w).upper()
        if clean:
            out.append({"w": clean, "start": round(t, 3), "end": round(t + d, 3), "eos": w[-1] in ".!?…"})
        t += d
    return out


def chunk(words):
    chunks, cur = [], []
    for w in words:
        cur.append(w)
        if w["eos"] or len(cur) == 3 or sum(len(x["w"]) for x in cur) > 13:
            chunks.append(cur); cur = []
    if cur:
        chunks.append(cur)
    out = [{"start": c[0]["start"], "end": c[-1]["end"], "words": c} for c in chunks]
    for a, b in zip(out, out[1:]):
        if b["start"] - a["end"] < 0.5:
            a["end"] = b["start"]
    return out


# ---------- sound design ----------
def lowpass(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")

def env_t(n):
    return np.arange(n) / SR

def sfx(kind, rs):
    if kind == "knock":
        t = env_t(int(SR * 0.3))
        hit = np.sin(2 * np.pi * (75 - 90 * t) * t) * np.exp(-t * 16) + lowpass(rs.standard_normal(len(t)), 30) * np.exp(-t * 45) * 2
        out = np.zeros(int(SR * 1.0))
        for i in range(3):
            o = int(i * 0.32 * SR); out[o:o + len(hit)] += hit
        return out * 0.9
    if kind == "alarm":
        t = env_t(int(SR * 1.5))
        return np.sign(np.sin(2 * np.pi * 740 * t)) * (np.sin(2 * np.pi * 2.2 * t) > 0) * 0.07 * np.minimum(1, (1.5 - t) * 6)
    if kind == "static":
        t = env_t(int(SR * 1.2))
        n = rs.standard_normal(len(t))
        return (n - lowpass(n, 8)) * 0.12 * (0.5 + 0.5 * np.sin(2 * np.pi * 9 * t) ** 2) * np.minimum(1, (1.2 - t) * 5) * np.minimum(1, t * 20)
    if kind in ("boom", "impact"):
        t = env_t(int(SR * 1.6))
        return (np.sin(2 * np.pi * (60 - 20 * t) * t) * np.exp(-t * 3.5) + lowpass(rs.standard_normal(len(t)), 60) * np.exp(-t * 7) * 3) * 0.8
    if kind == "beep":
        t = env_t(int(SR * 0.12))
        return np.sin(2 * np.pi * 1200 * t) * 0.12 * np.minimum(1, (0.12 - t) * 80)
    if kind == "riser":
        t = env_t(int(SR * 1.5))
        n = rs.standard_normal(len(t))
        return ((n - lowpass(n, 20)) * 0.15 + np.sin(2 * np.pi * (150 + 300 * t) * t) * 0.1) * (t / 1.5) ** 2
    if kind == "tick":
        t = env_t(int(SR * 0.03))
        return np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 200) * 0.3
    raise ValueError(f"unknown sfx {kind}")

def drone(theme, dur, rs):
    t = env_t(int(SR * dur))
    f = {"space": 55.0, "bunker": 49.0, "war": 46.25}.get(theme, 55.0)
    x = np.zeros_like(t)
    for mult, amp, lfo in [(1, 1, .11), (1.005, .8, .07), (1.5, .45, .13), (2, .35, .05), (3.01, .12, .17), (4.76, .06, .09)]:
        x += np.sin(2 * np.pi * f * mult * t + rs.random() * 6) * amp * (0.6 + 0.4 * np.sin(2 * np.pi * lfo * t + rs.random() * 6))
    x += lowpass(rs.standard_normal(len(t)), 200) * 6 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.08 * t))
    pulse = np.sin(2 * np.pi * 42 * t) * np.exp(-((t % 1.0) * 9)) * (0.3 + 1.2 * t / dur)   # heartbeat that builds
    x = x / np.abs(x).max() * 0.5 + pulse * 0.5
    return x * np.minimum(1, t * 2) * np.minimum(1, (dur - t) * 1.5)


def build(ep_path, still=None):
    ep = json.loads(Path(ep_path).read_text())
    slug = f"{re.sub(r'[^a-z0-9]+', '-', ep['series'].lower()).strip('-')}-ep{ep['episode']:02d}"
    out_dir = ROOT / "out"; out_dir.mkdir(exist_ok=True)
    rs = np.random.default_rng(ep["episode"] * 7 + len(ep["series"]))

    t, voice_clips, words, scenes, events = 0.35, [], [], [], []
    def speak(text):
        nonlocal t
        for s in sentences(text):
            a = tts(s); d = len(a) / SR
            voice_clips.append((t, a)); words.extend(word_times(s, t, d)); t += d + 0.16

    for sc in ep["scenes"]:
        start = scenes[-1]["end"] if scenes else 0.0
        speak(sc["text"])
        t += sc.get("hold", 0)
        end = t + 0.05
        for e in sc.get("sfx", []):
            at = e["at"]; events.append({"type": e["type"], "t": round(start + at if at >= 0 else end + at, 3)})
        scenes.append({"visual": sc["visual"], "params": sc.get("params", {}), "start": round(start, 3), "end": round(end, 3)})
    ch = ep["choice"]
    cstart = t + 0.1
    scenes[-1]["end"] = 9999
    t = cstart + 0.45
    n_story = len(words)
    speak(ch["narration"])
    narr_end = t
    duration = round(narr_end + ch.get("hold", 4.5), 2)
    events += [{"type": "riser", "t": cstart - 1.5}, {"type": "impact", "t": cstart}]
    events += [{"type": "tick", "t": round(x, 3)} for x in np.arange(cstart + 0.5, duration - 0.2, 0.5)]

    tl = {"fps": FPS, "duration": duration, "theme": ep["theme"], "series": ep["series"], "episode": ep["episode"], "hook": ep.get("hook"),
          "scenes": scenes, "chunks": chunk(words[:n_story]), "sfx": events,
          "choice": {"start": round(cstart, 3), "question": ch["question"], "a": ch["a"], "b": ch["b"]}}
    tl_path = out_dir / f"{slug}.timeline.json"; tl_path.write_text(json.dumps(tl))
    print(f"{slug}: {duration:.1f}s, {len(words)} words")

    if still is not None:
        jpg = out_dir / f"{slug}-{still:05.1f}.jpg"
        subprocess.run(["node", str(ROOT / "renderer/render.js"), str(tl_path), "--still", str(still), str(jpg)], check=True)
        print(jpg); return

    n = int(SR * duration)
    mix = drone(ep["theme"], duration, rs)[:n] * 0.2
    def add(at, a, g=1.0):
        o = max(0, int(at * SR)); a = a[: n - o]; mix[o:o + len(a)] += a * g
    for at, a in voice_clips: add(at, a, 1.25)
    for e in events: add(e["t"], sfx(e["type"], rs))
    mix = np.tanh(mix * 1.4) * 0.93
    wav_path = out_dir / f"{slug}.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())

    mp4 = out_dir / f"{slug}.mp4"
    subprocess.run(["node", str(ROOT / "renderer/render.js"), str(tl_path), str(wav_path), str(mp4)], check=True)
    (out_dir / f"{slug}.txt").write_text(
        f"{ep['series']} — Episode {ep['episode']}\n{ch['question']}\nA: {ch['a']}\nB: {ch['b']}\n"
        f"Comment A or B 👇 The top answer decides Episode {ep['episode'] + 1}.\n\n{ep.get('hashtags', '#story #whatwouldyoudo #choose #cliffhanger #interactive')}\n")
    wav_path.unlink(); tl_path.unlink()
    print(f"-> {mp4}")


if __name__ == "__main__":
    args = sys.argv[1:]
    still = None
    if "--still" in args:
        i = args.index("--still"); still = float(args[i + 1]); del args[i:i + 2]
    if not args:
        sys.exit(__doc__)
    for p in args:
        build(p, still)
