"""Sound: music, effects, ambience, voice effects and the final mix.

Contract used by make_video.py (keep these names and signatures):
    SR                                   sample rate of everything in here
    voice_fx(audio, fx, rs) -> audio     treat one spoken line ("radio", "phone", "door", "pa")
    mix(ep, tl, clips, rs) -> (2, n)     the full stereo mix, float in [-1, 1]
        ep     episode dict (theme / mood / music settings, scenes with ambience)
        tl     timeline dict: duration, scenes[{start,end,visual,ambience}], sfx[{type,t,gain,pan}], choice.start, cover
        clips  [(start_seconds, mono float32 array at SR, attrs)]   attrs: {"fx": ..., "alt": bool}
    finalize(wav_in, wav_out)            loudness-normalise for the platforms (-14 LUFS, -1.5 dBTP)
"""
import json, subprocess, wave
import numpy as np

SR = 44100


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

def band(x, lo, hi):
    """Brick-wall band-pass via FFT (fine for short clips)."""
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, len(x))


def voice_fx(a, fx, rs):
    if not fx: return a
    if fx == "radio":
        y = np.tanh(band(a, 400, 3000) * 4) * 0.5
        return y + (rs.standard_normal(len(a)) * 0.012) * (np.abs(y) > 0.001)
    if fx == "phone":
        return np.tanh(band(a, 350, 3400) * 2.5) * 0.6
    if fx == "door":
        return band(a, 60, 700) * 1.4
    if fx == "pa":
        y = band(a, 250, 4500); d = int(SR * 0.11); e = np.zeros(len(y) + d * 3)
        for i, g in enumerate([1, .45, .22, .1]): e[i * d:i * d + len(y)] += y * g
        return e
    return a


def sfx(kind, rs):
    if kind == "knock":
        t = env_t(int(SR * 0.6))
        hit = np.sin(2 * np.pi * (72 - 60 * t) * t) * np.exp(-t * 13) * 1.2 + lowpass(rs.standard_normal(len(t)), 24) * np.exp(-t * 50) * 2.2
        for f, a, dk in [(183, .30, 9), (317, .22, 12), (521, .14, 16), (803, .07, 22)]:
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
    beat = 1.05 - 0.4 * np.clip(t / max(cstart, 1), 0, 1)
    ph = np.cumsum(1 / beat) / SR % 1
    heart = np.sin(2 * np.pi * 44 * t) * (np.exp(-ph * 11) + 0.6 * np.exp(-((ph - 0.22) % 1) * 13)) * (0.25 + 0.9 * np.clip(t / max(cstart, 1), 0, 1))
    wind = lowpass(rs.standard_normal(len(t)), 220) * 5 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.07 * t))
    mono = bells + strings + heart * 0.34 + wind * 0.02
    out += mono
    out[0] += np.roll(bells, 300) * 0.5; out[1] += np.roll(bells, -500) * 0.5
    return out * np.minimum(1, t * 1.5) * np.minimum(1, (dur - t) * 1.2), bells + strings


def mix(ep, tl, clips, rs):
    dur, cstart = tl["duration"], tl["choice"]["start"]
    n = int(SR * dur)
    music, wet_src = score(ep.get("theme", "space"), dur, cstart, rs)
    music, wet_src = music[:, :n], wet_src[:n] * 0.6
    voice, fx = np.zeros(n), np.zeros(n)
    def add(buf, at, a, g=1.0):
        o = max(0, int(at * SR)); a = a[: max(0, n - o)]; buf[o:o + len(a)] += a * g
    for at, a, attrs in clips:
        add(voice, at, voice_fx(a, (attrs or {}).get("fx"), rs), 1.3)
    for e in tl["sfx"]:
        try: s = sfx(e["type"], rs)
        except ValueError: continue
        add(fx, e["t"], s, e.get("gain", 1.0) * (0.5 if e["type"] == "tick" else 1.0))
    send = wet_src + fx * 0.55 + voice * 0.09
    out = music * ep.get("music_gain", 1.0) + voice + fx + np.stack([reverb(send, rs), reverb(send, rs)]) * 0.5
    return np.tanh(out * 1.5) * 0.93


def write_wav(path, stereo):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(stereo.T, -1, 1) * 32767).astype(np.int16).tobytes())


def finalize(wav_in, wav_out, target=-14.0, peak=-1.5):
    """Two-pass EBU R128 loudness normalisation with ffmpeg. Returns the measured input loudness."""
    f = f"loudnorm=I={target}:TP={peak}:LRA=11"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav_in), "-af", f + ":print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    try:
        m = json.loads(r.stderr[r.stderr.rindex("{"): r.stderr.rindex("}") + 1])
        f += f":measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
    except (ValueError, KeyError):
        m = {}
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_in), "-af", f, "-ar", "48000", str(wav_out)], check=True)
    return m
