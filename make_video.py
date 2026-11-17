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
        try:
            from piper import SynthesisConfig
            _voice.synthesize_wav(text, w, syn_config=SynthesisConfig(length_scale=1.06, noise_scale=0.55, noise_w_scale=0.75))
        except (ImportError, TypeError):
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

def fftconv(x, ir):
    n = len(x) + len(ir) - 1
    m = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[: len(x)]

def reverb(x, rs, decay=2.6):
    n = int(SR * decay); t = env_t(n)
    ir = lowpass(rs.standard_normal(n), 5) * np.exp(-t * 6.9 / decay) * np.minimum(1, t * 120)
    return fftconv(x, ir / np.sqrt((ir ** 2).sum()))

def sfx(kind, rs):
    if kind == "knock":
        t = env_t(int(SR * 0.6))
        hit = np.sin(2 * np.pi * (72 - 60 * t) * t) * np.exp(-t * 13) * 1.2 + lowpass(rs.standard_normal(len(t)), 24) * np.exp(-t * 50) * 2.2
        for f, a, dk in [(183, .30, 9), (317, .22, 12), (521, .14, 16), (803, .07, 22)]:   # steel hull ring
            hit += np.sin(2 * np.pi * f * t) * a * np.exp(-t * dk)
        out = np.zeros(int(SR * 1.4))
        for i in range(3):
            o = int(i * 0.32 * SR); out[o:o + len(hit)] += hit
        return out * 0.8
    if kind == "thud":
        t = env_t(int(SR * 0.5))
        return (np.sin(2 * np.pi * (58 - 40 * t) * t) * np.exp(-t * 11) + lowpass(rs.standard_normal(len(t)), 40) * np.exp(-t * 40) * 1.5) * 0.7
    if kind == "alarm":
        t = env_t(int(SR * 2.4)); ph = (t % 0.8) / 0.8
        f = np.where(ph < 0.5, 620, 470)
        saw = lowpass(2 * ((np.cumsum(f) / SR) % 1) - 1, 10)
        return saw * 0.085 * np.minimum(1, (0.4 - np.abs(ph % 0.5 - 0.2)) * 12).clip(0, 1) * np.minimum(1, (2.4 - t) * 4)
    if kind == "static":
        t = env_t(int(SR * 1.2)); n = rs.standard_normal(len(t))
        return (n - lowpass(n, 8)) * 0.12 * (0.5 + 0.5 * np.sin(2 * np.pi * 9 * t) ** 2) * np.minimum(1, (1.2 - t) * 5) * np.minimum(1, t * 20)
    if kind in ("boom", "impact"):
        t = env_t(int(SR * 2.0))
        return (np.sin(2 * np.pi * (58 - 16 * t) * t) * np.exp(-t * 3) + lowpass(rs.standard_normal(len(t)), 60) * np.exp(-t * 7) * 3) * 0.8
    if kind == "beep":
        t = env_t(int(SR * 0.12))
        return np.sin(2 * np.pi * 1200 * t) * 0.12 * np.minimum(1, (0.12 - t) * 80)
    if kind == "riser":
        t = env_t(int(SR * 1.8)); n = rs.standard_normal(len(t))
        return ((n - lowpass(n, 20)) * 0.15 + np.sin(2 * np.pi * (140 + 260 * t) * t) * 0.1) * (t / 1.8) ** 2.5
    if kind == "whoosh":
        t = env_t(int(SR * 0.5)); n = rs.standard_normal(len(t))
        return lowpass(n, 14) * np.sin(np.pi * t / 0.5) ** 2 * 0.22
    if kind == "tick":
        t = env_t(int(SR * 0.03))
        return np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 200) * 0.3
    raise ValueError(f"unknown sfx {kind}")

def score(theme, dur, cstart, rs):
    """Stereo underscore: minor pad, sub, sparse bells, a heartbeat that builds, dissonant strings into the choice."""
    t = env_t(int(SR * dur)); tr = {"space": 1.0, "bunker": 0.891, "war": 0.794}.get(theme, 1.0)
    out = np.zeros((2, len(t)))
    for i, (f, amp) in enumerate([(36.71, .9), (73.42, 1), (110, .7), (146.83, .55), (174.61, .5), (220, .35), (329.63, .16), (349.23, .1)]):
        for det in (-0.25, 0.25):
            lfo = 0.55 + 0.45 * np.sin(2 * np.pi * (0.05 + 0.03 * rs.random()) * t + rs.random() * 6)
            v = np.sin(2 * np.pi * (f * tr + det) * t + rs.random() * 6) * amp * lfo
            pan = 0.5 + (0.38 if det > 0 else -0.38) * (i > 1)
            out[0] += v * (1 - pan); out[1] += v * pan
    out *= 0.11
    bells = np.zeros(len(t))
    seq = [14, 21, 17, 14, 12, 17, 13, 14, 9, 12, 14, 17, 21, 19, 17, 12]
    for k in range(int(dur / 2.9)):
        st = seq[k % len(seq)]; at = 1.2 + k * 2.9
        if at > dur - 1: break
        f = 293.66 * tr * 2 ** (st / 12); bt = env_t(int(SR * 2.4))
        b = (np.sin(2 * np.pi * f * bt) + 0.35 * np.sin(2 * np.pi * f * 2.01 * bt) + 0.12 * np.sin(2 * np.pi * f * 3.02 * bt)) * np.exp(-bt * 2.2) * np.minimum(1, bt * 300)
        o = int(at * SR); b = b[: len(t) - o]; bells[o:o + len(b)] += b * 0.07
    ramp = np.clip((t - (cstart - 9)) / 9, 0, 1) ** 2 * (t < cstart) + (t >= cstart) * 0.35
    strings = sum(np.sin(2 * np.pi * f * tr * t + 3 * np.sin(2 * np.pi * 5.5 * t)) for f in (659.25, 698.46, 987.77)) * (0.7 + 0.3 * np.sin(2 * np.pi * 11 * t)) * ramp * 0.03
    beat = 1.05 - 0.4 * np.clip(t / max(cstart, 1), 0, 1)                       # heartbeat accelerates
    ph = np.cumsum(1 / beat) / SR % 1
    heart = np.sin(2 * np.pi * 44 * t) * (np.exp(-ph * 11) + 0.6 * np.exp(-((ph - 0.22) % 1) * 13)) * (0.25 + 0.9 * np.clip(t / max(cstart, 1), 0, 1))
    wind = lowpass(rs.standard_normal(len(t)), 220) * 5 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.07 * t))
    mono = bells + strings + heart * 0.34 + wind * 0.02
    out += mono
    out[0] += np.roll(bells, 300) * 0.5; out[1] += np.roll(bells, -500) * 0.5
    return out * np.minimum(1, t * 1.5) * np.minimum(1, (dur - t) * 1.2), bells + strings


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
          "bloom": ep.get("bloom"), "scenes": scenes, "chunks": chunk(words[:n_story]), "sfx": events,
          "choice": {"start": round(cstart, 3), "question": ch["question"], "a": ch["a"], "b": ch["b"]}}
    tl_path = out_dir / f"{slug}.timeline.json"; tl_path.write_text(json.dumps(tl))
    print(f"{slug}: {duration:.1f}s, {len(words)} words")

    if still is not None:
        jpg = out_dir / f"{slug}-{still:05.1f}.jpg"
        subprocess.run(["node", str(ROOT / "renderer/render.js"), str(tl_path), "--still", str(still), str(jpg)], check=True)
        print(jpg); return

    n = int(SR * duration)
    music, wet_src = score(ep["theme"], duration, cstart, rs)
    music, wet_src = music[:, :n], wet_src[:n] * 0.6
    voice, fx = np.zeros(n), np.zeros(n)
    def add(buf, at, a, g=1.0):
        o = max(0, int(at * SR)); a = a[: n - o]; buf[o:o + len(a)] += a * g
    for at, a in voice_clips: add(voice, at, a, 1.3)
    for sc in scenes[1:]: events.append({"type": "whoosh", "t": sc["start"] - 0.25})
    for e in events: add(fx, e["t"], sfx(e["type"], rs), 0.5 if e["type"] == "tick" else 1.0)
    send = wet_src + fx * 0.55 + voice * 0.09
    mix = music * ep.get("music_gain", 1.0) + voice + fx + np.stack([reverb(send, rs), reverb(send, rs)]) * 0.5
    mix = np.tanh(mix * 1.5) * 0.93
    wav_path = out_dir / f"{slug}.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix.T * 32767).astype(np.int16).tobytes())

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
