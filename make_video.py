#!/usr/bin/env python3
"""Build a vertical cliffhanger video from an episode JSON.

  python make_video.py EP.json              full build: narration, mix, both cuts, thumbnail, post text
  python make_video.py EP.json --draft      timeline from ESTIMATED speech lengths (no voice, instant)
  python make_video.py EP.json --timeline   timeline from the REAL narration (voice + speech check, cached)
  python make_video.py EP.json --still 12.5 one frame        } add --draft to skip the voice,
  python make_video.py EP.json --sheet 16   contact sheet    } --guides to show platform UI zones,
  python make_video.py EP.json --thumb      thumbnail only   } --soft for the Facebook/Instagram end card
  python make_video.py EP.json --audio      audio mix only

Every mode writes out/<slug>-part<N>.timeline.json and prints the scene table (shot name, start, length).
Outputs of a full build: out/<slug>-part<N>.mp4 (YouTube, TikTok), -meta.mp4 (Facebook, Instagram),
-thumb.jpg, .txt and -meta.txt (title, description, hashtags).
"""
import hashlib, io, json, re, subprocess, sys, wave
from pathlib import Path
import numpy as np
import audio
from audio import SR

ROOT = Path(__file__).parent
OUT = ROOT / "out"
FPS = 30
TAKES = 6          # re-record a line up to this many times until speech recognition hears it as written
LEAD = 0.30        # seconds of music before the first word
GAP = 0.16         # pause between sentences
COVER = 0.8        # the thumbnail is held as the opening frames for this long (when the episode has one)

# Narrator and character voices. ALL must be licensed for commercial use (see docs/PLATFORM_RULES.md).
# Do NOT add en_US-ryan (CC BY-NC-SA) or hfc_* (non-commercial).   name: (model, repo folder, speed, gain)
VOICES = {
    "male":    ("en_US-bryce-medium",  "en/en_US/bryce/medium",  0.80, 1.00),   # public domain (speaker's own release)
    "female":  ("en_US-ljspeech-high", "en/en_US/ljspeech/high", 0.92, 1.00),   # public domain (LJ Speech)
    "male2":   ("en_US-joe-medium",    "en/en_US/joe/medium",    0.95, 1.00),   # CC0
    "male3":   ("en_US-john-medium",   "en/en_US/john/medium",   0.92, 1.00),   # public domain (LibriVox)
    "old":     ("en_US-norman-medium", "en/en_US/norman/medium", 0.95, 1.00),   # public domain (LibriVox)
    "female2": ("en_US-kristin-medium", "en/en_US/kristin/medium", 0.92, 1.00), # public domain (LibriVox)
    "brit_f":  ("en_GB-cori-high",     "en/en_GB/cori/high",     0.95, 1.00),   # public domain (LibriVox)
}
HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
BRAND = json.loads((ROOT / "brand.json").read_text()) if (ROOT / "brand.json").exists() else None   # {"name", "handle"}: drawn on every frame
_models, _asr = {}, None


def synth(text, voice):
    """Text -> mono float32 at SR, silence trimmed."""
    model, folder, speed, gain = VOICES[voice]
    if voice not in _models:
        f = ROOT / "voices" / f"{model}.onnx"
        if not f.exists():
            f.parent.mkdir(exist_ok=True)
            for name in (f.name, f.name + ".json"):
                subprocess.run(["curl", "-sSL", "-o", str(f.parent / name), f"{HF}{folder}/{name}"], check=True)
        from piper import PiperVoice
        _models[voice] = PiperVoice.load(str(f))
    from piper import SynthesisConfig
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        _models[voice].synthesize_wav(text, w, syn_config=SynthesisConfig(length_scale=speed, noise_scale=0.55, noise_w_scale=0.75))
    buf.seek(0)
    with wave.open(buf) as w:
        sr = w.getframerate()
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    loud = np.where(np.abs(a) > 0.02)[0]
    if len(loud):
        a = a[max(0, loud[0] - 400): loud[-1] + 2500]
    n = int(len(a) * SR / sr)
    return (np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a) * gain).astype(np.float32)


def heard(a):
    """Speech-recognise a clip -> [(word, start, end)]."""
    global _asr
    if _asr is None:
        from faster_whisper import WhisperModel
        _asr = WhisperModel("small.en", device="cpu", compute_type="int8")
    a16 = np.interp(np.linspace(0, len(a) - 1, int(len(a) * 16000 / SR)), np.arange(len(a)), a).astype(np.float32)
    segs, _ = _asr.transcribe(a16, word_timestamps=True, beam_size=5)
    return [(w.word.strip(), float(w.start), float(w.end)) for sg in segs for w in sg.words]

def norm(w):
    return re.sub(r"[^a-z0-9]", "", w.lower().replace("grey", "gray"))

def toks(text):
    text = text.lower().replace("-", " ").replace("i'm", "i am").replace("’", "'")
    text = re.sub(r"\boption ay\b", "option a", text).replace("%", " percent")
    return [norm(w) for w in text.split() if norm(w)]

def misheard(script, hw):
    """How many words the recogniser heard differently. Digits count as matching a spelled-out number."""
    import difflib
    a, b = toks(script), toks(" ".join(w for w, _, _ in hw)); bad = 0
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op != "equal" and not (j2 > j1 and all(any(ch.isdigit() for ch in x) for x in b[j1:j2])): bad += max(i2 - i1, j2 - j1)
    return bad


def take(text, voice):
    """Best of several takes of one line, verified by speech recognition. Cached on disk, so timings are stable."""
    key = hashlib.sha1(json.dumps([VOICES[voice][:3], text]).encode()).hexdigest()[:20]
    f = OUT / ".cache" / f"{key}.npz"
    if f.exists():
        z = np.load(f, allow_pickle=False)
        return z["a"], json.loads(str(z["hw"])), int(z["bad"])
    a = synth(text, voice); hw = heard(a); bad = misheard(text, hw)
    for _ in range(TAKES - 1):
        if bad == 0: break
        a2 = synth(text, voice); hw2 = heard(a2); b2 = misheard(text, hw2)
        if b2 < bad: a, hw, bad = a2, hw2, b2
    f.parent.mkdir(parents=True, exist_ok=True)
    np.savez(f, a=a, hw=json.dumps(hw), bad=bad)
    return a, hw, bad


def sentences(text):
    """Split into sentences; never after an initial ("R. Voss"); never leave a 1-2 word fragment alone."""
    parts = [x.strip() for x in re.split(r"(?<![A-Z]\.)(?<=[.!?…:])\s+", text) if x.strip()]
    out = []
    for x in parts:
        if out and (len(x.split()) <= 2 or len(out[-1].split()) <= 2): out[-1] += " " + x
        else: out.append(x)
    return out

def lines_of(text, narrator):
    """Narration -> [(sentence, voice, fx)]. A tag like [as:male2,fx:radio] applies to the one sentence after it."""
    out, pending = [], None
    for tok in re.split(r"(\[[^\]]+\])", text):
        tok = tok.strip()
        if not tok: continue
        if tok.startswith("["):
            pending = dict(kv.split(":", 1) for kv in tok[1:-1].replace(" ", "").split(",") if ":" in kv)
            continue
        for i, s in enumerate(sentences(tok)):
            if i == 0 and pending:
                v = pending.get("as", narrator)
                out.append((s, v if v in VOICES else narrator, pending.get("fx")))
            else:
                out.append((s, narrator, None))
        pending = None
    return out

def word_times(sentence, start, dur):
    words = sentence.split()
    wt = [len(re.sub(r"\W", "", w)) + 1.5 + (2.5 if w[-1] in ",;:" else 0) + (4 if w.endswith("...") else 0) for w in words]
    total, out, t = sum(wt), [], start
    for w, x in zip(words, wt):
        d = (dur - 0.08) * x / total
        clean = re.sub(r"[^\w'’\-%]", "", w).upper()
        if clean:
            out.append({"w": clean, "start": round(t, 3), "end": round(t + d, 3), "eos": w[-1] in ".!?…" and len(w) > 2})
        t += d
    return out

def chunk(words):
    """Group words into caption cards of up to 3 words."""
    chunks, cur = [], []
    for w in words:
        if cur and bool(w.get("alt")) != bool(cur[-1].get("alt")): chunks.append(cur); cur = []
        cur.append(w)
        if w["eos"] or len(cur) == 3 or sum(len(x["w"]) for x in cur) > 13:
            chunks.append(cur); cur = []
    if cur: chunks.append(cur)
    out = [{"start": c[0]["start"], "end": c[-1]["end"], "words": c} for c in chunks]
    for a, b in zip(out, out[1:]):
        if b["start"] - a["end"] < 0.5: a["end"] = b["start"]
    return out


def slug_of(ep):
    s = ep.get("slug") or re.sub(r"[^a-z0-9]+", "-", ep["series"].lower()).strip("-")
    return f"{s}-part{ep['episode']}"


ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split()
def num_words(n):
    """0-100 in words, for the narrator."""
    n = int(round(n))
    if n < 20: return ONES[n]
    if n == 100: return "one hundred"
    return TENS[n // 10 - 2] + ("" if n % 10 == 0 else " " + ONES[n % 10])


def timeline(ep, draft=False):
    """Lay out narration, scenes and sound events on the clock. Returns (timeline dict, voice clips, report).

    Order: cover frame -> (Part 2+: result of the last vote) -> story scenes -> choice card -> end card."""
    narrator = ep.get("narrator", "male")
    respell = ep.get("say", {})                     # {"written": "spoken"} pronunciation fixes
    def SAY(s):
        for k, v in respell.items(): s = re.sub(rf"\b{re.escape(k)}(?!\w)", v, s)
        return s
    th = ep.get("thumbnail") or {}
    brand = ep.get("brand") or BRAND
    cover = float(ep.get("cover", COVER if th.get("visual") else 0))
    t, clips, scenes, events, report = LEAD, [], [], [], []

    def speak(text):
        """Say text starting at the current time; returns its word list."""
        nonlocal t
        said = []
        for s, voice, fx in lines_of(text, narrator):
            if draft:
                d = 0.22 + 0.0742 * len(re.sub(r"[^A-Za-z0-9]", "", s)) * VOICES[voice][2] / VOICES["male"][2]; wt = word_times(s, t, d)   # fitted to real narration
            else:
                a, hw, bad = take(SAY(s), voice)
                if bad: report.append((s, " ".join(w for w, _, _ in hw)))
                d = len(a) / SR; wt = word_times(s, t, d)
                if [norm(w["w"]) for w in wt] == [norm(w) for w, _, _ in hw]:      # heard word for word: use the true timings
                    for w, (_, st, en) in zip(wt, hw): w["start"], w["end"] = round(t + st, 3), round(t + en, 3)
                    for x, y in zip(wt, wt[1:]): x["end"] = y["start"]
                clips.append((t, a, {"fx": fx, "alt": voice != narrator}))
            if voice != narrator:
                for w in wt: w["alt"] = True
            said.extend(wt); t += d + GAP
        return said

    # Part 2 onward: reveal how the audience voted on the previous decision, then the story continues down that path
    vote, prev = None, ep.get("previous")
    if prev:
        a_pct, b_pct = prev["a_pct"], prev["b_pct"]
        chosen = prev.get("chosen") or ("A" if a_pct >= b_pct else "B")
        line = prev.get("narration") or (f"You voted. {num_words(a_pct).capitalize()} percent chose option A. "
                                         f"{num_words(b_pct).capitalize()} percent chose option B. So option {chosen} it is.")
        vw = speak(line)
        so = next((w for w in reversed(vw) if norm(w["w"]) == "so"), None)
        click = so["start"] if so else t - 1.3
        vote = {"start": cover, "end": round(t + 0.35, 3), "click": round(click, 3), "question": prev.get("question", "WHAT DO YOU DO?"),
                "a": prev["a"], "b": prev["b"], "a_pct": a_pct, "b_pct": b_pct, "chosen": chosen}
        events += [{"type": "whoosh", "t": round(cover, 3)}, {"type": "impact", "t": round(click, 3), "gain": 0.6}]
        t += 0.6

    words = []
    for i, sc in enumerate(ep["scenes"]):
        start = scenes[-1]["end"] if scenes else cover
        if scenes: t = max(t, start)
        t += sc.get("pre", 0)
        mine = speak(sc.get("text", "")); words.extend(mine)
        t += sc.get("hold", 0)
        end = max(t + 0.05, start + sc.get("min", 0)); t = max(t, end - 0.05)
        for e in sc.get("sfx", []):
            if "on" in e:
                hit = next((w for w in mine if norm(w["w"]) == norm(e["on"])), None)
                at = (hit["start"] if hit else start) + e.get("offset", 0)
            else:
                at = start + e["at"] if e["at"] >= 0 else end + e["at"]
            events.append({"type": e["type"], "t": round(at, 3), **{k: e[k] for k in ("gain", "pan") if k in e}})
        scenes.append({"id": sc.get("id", f"s{i + 1:02d}"), "visual": sc["visual"], "params": sc.get("params", {}), "start": round(start, 3), "end": round(end, 3),
                       "words": [{"w": w["w"], "t": round(w["start"] - start, 3)} for w in mine],
                       **{k: sc[k] for k in ("in", "post", "ambience", "space", "hud") if k in sc},
                       **({"cards": [{"text": k["text"], "warn": bool(k.get("warn")),
                                      "start": round((next((w["start"] for w in mine if norm(w["w"]) == norm(k["on"])), start) if "on" in k else start + k.get("at", 0)) + k.get("offset", 0), 3),
                                      "end": 0} for k in sc["cards"]]} if sc.get("cards") else {})})
        for k, src in zip(scenes[-1].get("cards", []), sc.get("cards", [])): k["end"] = round(k["start"] + src.get("dur", 2.6), 3)
    ch = ep["choice"]
    cstart = t + 0.1
    t = cstart + 0.45
    speak(ch["narration"])
    t += ch.get("hold", 2.0)
    outro = None
    if brand and brand.get("platforms") and ep.get("outro", True):      # end card: where to find the channel
        ostart = t; t = ostart + 0.5
        speak(brand.get("outro_say", f"Find more from {brand['name']}."))
        outro = {"start": round(ostart, 3)}
        duration = round(t + 0.9, 2)
    else:
        ostart = None; duration = round(t + 1.4, 2)
    scenes[-1]["end"] = duration
    events += [{"type": "riser", "t": round(cstart - 1.6, 3)}, {"type": "impact", "t": round(cstart, 3)}]
    events += [{"type": "tick", "t": round(float(x), 3)} for x in np.arange(cstart + 0.5, (ostart or duration) - 0.2, 0.5)]
    if ostart: events.append({"type": "whoosh", "t": round(ostart - 0.15, 3)})
    if ep.get("cut_whoosh", True):
        events += [{"type": "whoosh", "t": round(sc["start"] - 0.25, 3), "gain": 0.6} for sc in scenes[1:]]
    if cover: events.append({"type": "whoosh", "t": round(max(0, cover - 0.3), 3)})
    tl = {"fps": FPS, "duration": duration, "theme": ep.get("theme", "space"), "series": ep["series"], "episode": ep["episode"], "hook": ep.get("hook"),
          "cover": cover, "style": ep.get("style"), "scripts": ep.get("scripts", []), "soft": False, "brand": brand, "vote": vote, "outro": outro,
          "thumb": ({**th, "title": th.get("title", ep["series"])} if th.get("visual") else None),
          "scenes": scenes, "chunks": chunk(words), "sfx": sorted(events, key=lambda e: e["t"]),
          "choice": {"start": round(cstart, 3), "question": ch["question"], "a": ch["a"], "b": ch["b"]}}
    return tl, clips, report


def node(*a):
    subprocess.run(["node", str(ROOT / "renderer/render.js"), *map(str, a)], check=True)


def build(ep_path, mode="full", arg=None, draft=False, flags=()):
    ep = json.loads(Path(ep_path).read_text())
    slug = slug_of(ep); OUT.mkdir(exist_ok=True)
    tl, clips, report = timeline(ep, draft)
    tl_path = OUT / f"{slug}.timeline.json"; tl_path.write_text(json.dumps(tl))
    nwords = sum(len(c["words"]) for c in tl["chunks"])
    print(f"{slug}: {tl['duration']:.1f}s, {nwords} story words{' (DRAFT timings)' if draft else ''}   [{tl_path}]")
    for sc in tl["scenes"]:
        print(f"  {sc['id']:<5} {sc['visual']:<26} {sc['start']:6.2f} -> {sc['end']:6.2f}  ({sc['end'] - sc['start']:.2f}s)")
    print(f"  choice card at {tl['choice']['start']:.2f}s" + (f", end card at {tl['outro']['start']:.2f}s" if tl["outro"] else "")
          + (f", cover frame held {tl['cover']:.1f}s" if tl["cover"] else "") + (f", vote result until {tl['vote']['end']:.2f}s" if tl["vote"] else ""))
    for want, got in report: print(f"  HEARD DIFFERENTLY:\n    script: {want}\n    heard:  {got}")
    if not draft and not (61 <= tl["duration"] <= 90): print(f"  WARNING: length {tl['duration']:.1f}s is outside 61-90s")

    if mode == "timeline": return
    if mode == "still":
        out = OUT / f"{slug}-{arg:05.1f}.jpg"; node(tl_path, "--still", arg, out, *flags); return
    if mode == "sheet":
        out = OUT / f"{slug}-sheet.jpg"; node(tl_path, "--sheet", arg, out, *flags); return
    if mode == "thumb":
        if tl["thumb"]: node(tl_path, "--thumb", OUT / f"{slug}-thumb.jpg")
        else: print("  no thumbnail.visual in the episode")
        return
    if draft: sys.exit("--draft cannot produce audio or video; drop --draft")

    rs = np.random.default_rng(ep["episode"] * 7 + len(ep["series"]))
    raw, wav = OUT / f"{slug}.raw.wav", OUT / f"{slug}.wav"
    audio.write_wav(raw, audio.mix(ep, tl, clips, rs))
    m = audio.finalize(raw, wav); raw.unlink()
    print(f"  audio: mix loudness {m.get('input_i', '?')} LUFS -> normalised to -14 LUFS")
    if mode == "audio": print(f"-> {wav}"); return

    mp4, meta = OUT / f"{slug}.mp4", OUT / f"{slug}-meta.mp4"
    node(tl_path, wav, mp4, "--meta", meta)
    if tl["thumb"]: node(tl_path, "--thumb", OUT / f"{slug}-thumb.jpg")
    post, ch, nxt = ep.get("post", {}), ep["choice"], ep["episode"] + 1
    for path, cta in ((OUT / f"{slug}.txt", f"Comment A or B. The top answer decides Part {nxt}."),
                      (OUT / f"{slug}-meta.txt", f"What would you do? Part {nxt} follows what most of you would do.")):
        path.write_text(f"TITLE\n{post.get('title', ep['series'] + ' - Part ' + str(ep['episode']))}\n\nDESCRIPTION\n"
                        f"{post.get('description', ch['question'] + ' (A work of fiction.)')}\n{cta}\n"
                        f"{(BRAND or {}).get('name', '')} {(BRAND or {}).get('handle', '')}\n\n"
                        f"{post.get('hashtags', ep.get('hashtags', '#fiction #story #whatwouldyoudo'))}\n")
    wav.unlink()
    print(f"-> {mp4}\n-> {meta}")


if __name__ == "__main__":
    args = sys.argv[1:]
    mode, arg, draft, flags = "full", None, False, []
    for f in ("--guides", "--soft", "--clean"):
        if f in args: args.remove(f); flags.append(f)
    if "--draft" in args: args.remove("--draft"); draft = True; flags.append("--draft"); mode = "timeline"
    for m in ("timeline", "thumb", "audio"):
        if f"--{m}" in args: args.remove(f"--{m}"); mode = m
    for m in ("still", "sheet"):
        if f"--{m}" in args:
            i = args.index(f"--{m}"); mode = m; arg = float(args[i + 1]) if m == "still" else args[i + 1]; del args[i:i + 2]
    if not args: sys.exit(__doc__)
    for p in args: build(p, mode, arg, draft, flags)
