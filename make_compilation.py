#!/usr/bin/env python3
"""Merge several finished parts of one series into a single video (the channel rule: every 5 parts).

    python make_compilation.py <slug> 1 5        parts 1 to 5 -> out/<slug>-parts1-5.mp4 and -meta.mp4

Flow of the result: Part 1 (cover, story, the choice) -> Part 2 opens with "You voted: 60% A, 40% B, so A it is",
its story and its choice -> ... -> the last part's choice and the end card. Each part keeps its own vote-result
opening (the "previous" block in its episode JSON), so the percentages shown are the real ones for that decision.
Parts that have not been built yet are built first.
"""
import json, subprocess, sys
from pathlib import Path
import make_video as mv

ROOT, OUT = mv.ROOT, mv.OUT


def main(slug, first, last):
    parts = []
    for n in range(first, last + 1):
        ep_path = ROOT / "episodes" / slug / f"part{n:02d}.json"
        ep = json.loads(ep_path.read_text())
        name = mv.slug_of(ep)
        if n > first and "previous" not in ep:
            sys.exit(f"{ep_path} has no \"previous\" block (the vote on Part {n - 1}); add the real percentages first.")
        mp4, tlp = OUT / f"{name}.mp4", OUT / f"{name}.timeline.json"
        if not (mp4.exists() and tlp.exists() and (OUT / f"{name}-meta.mp4").exists()):
            mv.build(ep_path)
        parts.append((name, json.loads(tlp.read_text()), ep))
    out_name = f"{slug}-parts{first}-{last}"
    for suffix in ("", "-meta"):
        ins, filt, labels = [], [], []
        for i, (name, tl, ep) in enumerate(parts):
            a = 0.0 if i == 0 else tl["cover"]                                                    # later parts start at their vote result
            b = tl["duration"] if i == len(parts) - 1 else (tl["outro"]["start"] if tl.get("outro") else tl["duration"])   # only the last part keeps the end card
            ins += ["-i", str(OUT / f"{name}{suffix}.mp4")]
            filt.append(f"[{i}:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS[v{i}];"
                        f"[{i}:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.12,afade=t=out:st={b - a - 0.15:.3f}:d=0.15[a{i}]")
            labels.append(f"[v{i}][a{i}]")
        filt.append("".join(labels) + f"concat=n={len(parts)}:v=1:a=1[v][a]")
        dst = OUT / f"{out_name}{suffix}.mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *ins, "-filter_complex", ";".join(filt), "-map", "[v]", "-map", "[a]",
                        "-c:v", "libx264", "-profile:v", "high", "-crf", "20", "-preset", "medium", "-g", "60", "-pix_fmt", "yuv420p",
                        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
                        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(dst)], check=True)
        print("->", dst)
    # cover image for the compilation: Part 1's thumbnail with a "PARTS 1-5" label
    name, tl, ep = parts[0]
    if tl.get("thumb"):
        tl2 = dict(tl); tl2["partLabel"] = f"PARTS {first}-{last}"
        tmp = OUT / f"{out_name}.timeline.json"; tmp.write_text(json.dumps(tl2))
        mv.node(tmp, "--thumb", OUT / f"{out_name}-thumb.jpg"); tmp.unlink()
    ep = parts[-1][2]; post = parts[0][2].get("post", {}); brand = mv.BRAND or {}
    (OUT / f"{out_name}.txt").write_text(
        f"TITLE\n{ep['series'].title()}: Parts {first}-{last}, the story so far\n\nDESCRIPTION\n"
        f"Every choice was made by the audience. {post.get('description', '')}\n{brand.get('name', '')} {brand.get('handle', '')}\n\n"
        f"{post.get('hashtags', '#fiction #story #whatwouldyoudo')}\n")


if __name__ == "__main__":
    if len(sys.argv) != 4: sys.exit(__doc__)
    main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
