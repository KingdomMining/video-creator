#!/usr/bin/env python3
"""Check an episode script against the writers' guide limits and estimate its running time.

    python tools/script_check.py episodes/<slug>/part01.json

Works before the film exists (scenes do not need a "visual" yet). Exit code 1 if a hard limit is broken.
"""
import json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import make_video as mv

TAG = re.compile(r"\[[^\]]+\]")


def main(path):
    ep = json.loads(Path(path).read_text())
    problems, notes = [], []
    for k in ("series", "slug", "episode", "scenes", "choice", "hook"):
        if k not in ep: problems.append(f"missing top-level field: {k}")
    if problems: print("\n".join("FAIL  " + p for p in problems)); return 1
    if len(ep["series"]) > 16: problems.append(f"series title is {len(ep['series'])} characters (max 16): {ep['series']}")
    if len(ep["hook"].split()) > 5: problems.append(f"hook is {len(ep['hook'].split())} words (max 5)")
    scenes = ep["scenes"]
    if not 9 <= len(scenes) <= 13: problems.append(f"{len(scenes)} scenes (need 9-13)")
    total, tagged = 0, 0
    for i, sc in enumerate(scenes, 1):
        text = sc.get("text", "")
        tagged += len(TAG.findall(text))
        plain = TAG.sub(" ", text)
        for s in mv.sentences(plain) if plain.strip() else []:
            n = len(s.split())
            if n > 16: problems.append(f"scene {i}: sentence has {n} words (max 16): {s}")
        for s in [x.strip() for x in re.split(r"(?<=[.!?…])\s+", plain) if x.strip()]:
            if len(s.split()) < 3: notes.append(f"scene {i}: very short sentence, spoken together with its neighbour: {s}")
        w = len(plain.split()); total += w
        if not sc.get("shot"): notes.append(f"scene {i}: no shot description")
        if w > 30: notes.append(f"scene {i}: {w} words in one scene; consider splitting (a scene should be 4-9 seconds)")
        if w == 0: notes.append(f"scene {i}: no narration")
    if not 155 <= total <= 185: problems.append(f"story narration is {total} words (need 155-185)")
    if tagged > 3: problems.append(f"{tagged} tagged character lines (max 3)")
    ch = ep["choice"]
    cw = len(ch.get("narration", "").split())
    if cw > 14: problems.append(f"final question is {cw} words (max 14)")
    for k in ("a", "b"):
        if len(ch.get(k, "").split()) > 4: problems.append(f"option {k.upper()} is {len(ch[k].split())} words (max 4): {ch[k]}")
    if not ch.get("question"): problems.append("choice.question missing")
    probe = json.loads(json.dumps(ep))
    for sc in probe["scenes"]: sc.setdefault("visual", "space")
    probe.pop("thumbnail", None)
    tl, _, _ = mv.timeline(probe, draft=True)
    dur = tl["duration"] + 0.8          # plus the opening cover frame
    if not 63 <= dur <= 88: problems.append(f"estimated length {dur:.0f}s (need 63-88s to be safely inside 61-90s)")
    print(f"{ep['series']} part {ep['episode']}: {len(scenes)} scenes, {total} story words, question {cw} words, estimated {dur:.0f}s")
    for sc in tl["scenes"]:
        print(f"  {sc['id']:<5} {sc['end'] - sc['start']:5.1f}s  {' '.join(w['w'] for w in sc['words'])[:90].lower()}")
    for p in problems: print("FAIL  " + p)
    for n in notes: print("note  " + n)
    print("RESULT:", "FAIL" if problems else "OK")
    return 1 if problems else 0


if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
