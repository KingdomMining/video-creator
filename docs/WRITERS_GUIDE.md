# Writers' guide: interactive cliffhanger shorts

Everything a writer, critic or editor on this project needs. Read it fully before pitching, writing or reviewing.
Also read `docs/PLATFORM_RULES.md` (hard content limits) and the `format` block of
`episodes/deep-signal/series.json` (how consequences, strikes, death and rewind work).

## 1. The format

- A vertical animated short, 61-90 seconds, low-poly 3D animation with a narrator.
- Narration is second person, present tense: "You wake up. The house is silent."
  The viewer is the hero. The hero is shown on screen as an animated character.
- It is **Part 1 of a series**. It ends on a decision with exactly two options. Viewers answer in the
  comments, and the most popular option decides Part 2.
- Every series has a hidden truth that explains everything, clues planted in plain sight, and a planned
  consequence for each option.

## 2. What a winning concept has

1. **An instant premise.** A distracted 13-year-old scrolling a feed understands who "you" are, where you
   are and what is wrong within the first 5 seconds. No backstory dump, no invented jargon.
2. **A hook in the first 2 seconds.** The first sentence drops the viewer into a strange or dangerous
   moment already in progress. The first image is striking on its own.
3. **Escalation.** Roughly every 15 seconds a new fact changes the meaning of what came before.
   Each beat raises the question the next beat answers.
4. **A fair mystery.** There is a hidden truth. Two or three clues are shown or said in Part 1. A sharp
   viewer can reason about the right choice; nobody can be sure.
5. **A real dilemma.** Two concrete physical actions the hero can take right now: open or keep shut,
   run or hide, speak or stay silent, take or leave, trust or refuse. Both are defensible and both are
   risky. The audience should split close to 50/50 and argue. Never good vs evil, never smart vs stupid.
6. **Personal, immediate stakes.** Something the viewer feels in the gut: safety, love, family, guilt,
   a once-in-a-lifetime chance.
7. **Series legs.** The hidden truth can carry 5 to 8 parts without cheating.

## 3. Sense-making rules (hard requirements)

The owner of this channel rejected a script line because it stated a fact whose meaning was unclear
("a call for help takes eighty minutes to reach Earth" in a story where the hero was alone in deep space).
Every line must pass the **cold listener test**: someone hears it once, at speed, with no chance to
re-read, and instantly understands what it means for the hero.

- One idea per sentence. At most 16 words per sentence. Plain, concrete words.
- Never state a number or fact unless that sentence or the next makes its meaning for the hero obvious.
  Bad: "A call for help takes eighty minutes to arrive." Good: "No one can reach you in time."
- No contradictions. If you are alone, nobody helps. If the phone is dead, it cannot ring later unless
  the script shows why.
- Cause and effect. Every action has a motive the viewer can see. Every event has a cause that is shown
  or stated. No coincidences that solve problems.
- Real-world facts are right: physics, biology, medicine, law, technology, geography, how jobs and
  institutions actually work. If you are not sure a detail is right, do not use it.
- If the story bends reality (zombies, time loops, ghosts), state the rule in one simple line and never
  break it.
- The hero behaves like a reasonable person. If the obvious move exists (call the police, leave the
  building, wake someone up) the script must show why it is impossible or already tried.
- Time and place are always clear. The viewer always knows where the hero is and what just changed.
- Clues are fair. Anything the later truth depends on is visible or audible in the episode.
- What is narrated can be shown. If a sentence cannot be drawn, rewrite it.
- The final question must be answerable from what the viewer has seen. Both options must be things the
  hero is physically able to do in that moment.

## 4. Platform rules (hard requirements)

From `docs/PLATFORM_RULES.md`. A concept that needs any of these is dead on arrival:

- No firearms on screen. Threats come from tools, bare hands, creatures, the environment or the unknown.
- No gore, visible wounds, bodies or lingering on injury. Harm is brief, non-graphic or off screen.
- No jump scares. Dread builds; nothing flashes or shrieks.
- No children in danger. All characters in peril are adults.
- No real people, real brands, real wars or real tragedies. Invent everything.
- No suicide or self-harm. No sexual content or nudity; romance stays PG. No slurs, no hate, no drugs.
- No stunts a viewer could imitate and get hurt.
- No profanity.

## 5. What the animation can and cannot show

The films are low-poly 3D: flat-shaded stylised characters and sets, real camera moves, lighting, shadows,
fog, rain, fire, day and night. Write for it.

Works well:
- 1 to 4 characters acting on screen; up to about a dozen background figures (a shambling crowd, guests).
- Walking, running, sneaking, hiding, sitting, reaching, knocking, carrying, falling, hugging, pointing,
  looking around, driving. Emotion comes from body language, staging, light and music.
- Simple creatures: dogs or wolves, birds, fish or sharks, tentacles, a dragon, humanoid monsters.
- 2 to 4 locations per episode: rooms, houses, streets, forests, vehicles, ships, stations, caves.
- Phone and computer screens (text messages, countdowns, maps, news tickers) shown as crisp inserts.
- Weather, darkness, flashlights, fire, storms, water surfaces.

Avoid:
- Subtle facial acting. Faces are simple (eyes, brows, mouth). Do not rely on "a flicker of doubt".
- Fine finger work, complex machinery interaction, cloth or liquid simulation, large-scale destruction.
- Crowds of hundreds, battles, long vehicle chases through detailed cities.
- More than 4 locations or 13 scenes.

## 6. Length budget

- 9 to 13 scenes. A scene is one shot or a short sequence in one location, 4 to 9 seconds of narration.
- **150 to 175 words** of story narration in total, plus the final question (two short sentences,
  at most 14 words together). This lands at about 68-80 seconds. Count the words.
- Sentences of 1 or 2 words are spoken badly by the voice. Use at least 3 words per sentence.
- Another character may speak a short line. Mark it inside the narration with a tag before the sentence:
  `[as:male2]`, `[as:female]`, `[as:old]`, optionally with an effect: `[as:male2,fx:radio]`, `fx:phone`,
  `fx:door` (muffled through a door), `fx:pa` (loudspeaker). A tag applies to the one sentence after it.
  Use at most 3 tagged lines per episode.
- The narrator is male by default. Set `"narrator": "female"` when the hero should clearly be a woman.

## 7. Structure of a Part 1

| Beat | Time | Job |
|------|------|-----|
| Hook | 0-5s | Drop into the moment. Who you are, where, what is wrong. |
| Setup | 5-20s | The normal world and the one rule or fact that matters. Plant clue 1. |
| Turn 1 | 20-35s | Something happens that should not be possible. |
| Turn 2 | 35-55s | It gets personal or closer. Plant clue 2. The obvious way out closes. |
| Twist | 55-68s | One new fact that makes the choice hard. |
| Decision | last 7s | The question. Two options. |

## 8. Consequence design

Each option has a hidden outcome type fixed before the vote: SAFE, COST, REVEAL or MISREAD (see the
Deep Signal bible). The better option is deducible from a clue. A COST that physically harms the hero is
a strike; three strikes and the hero dies, and the audience chooses between "let them rest" and "rewind".
Plan Part 2 for both options before Part 1 is final.

## 9. Output formats

### Pitch (JSON object)
```
{
  "title": "SERIES TITLE, at most 16 characters, memorable",
  "genre": "e.g. zombie outbreak",
  "world": "1-2 sentences: where and when, and the one rule of this world",
  "hero": "who 'you' are, in a few words",
  "first_line": "the opening narration sentence",
  "beats": ["4-6 short beats in order"],
  "cliffhanger": "the final moment",
  "option_a": "2-4 words", "option_b": "2-4 words",
  "why_arguable": "why viewers will split and fight about it",
  "hidden_truth": "what is really going on",
  "clues": ["the clues shown in Part 1"],
  "key_image": "the single most striking image (the thumbnail)",
  "tone": "e.g. dread, bittersweet, absurd-tense",
  "sets": ["2-4 locations"],
  "risks": "anything close to the platform rules or hard to animate, and how it is avoided"
}
```

### Episode script: `episodes/<slug>/part01.json`
```
{
  "series": "SERIES TITLE", "slug": "series-title", "episode": 1,
  "genre": "...", "logline": "one sentence",
  "narrator": "male" | "female",
  "hook": "ON-SCREEN TEXT, at most 5 words, shown in the first 3 seconds",
  "mood": "the feeling of the music and colour, e.g. cold dread, warm then uneasy",
  "cast": [{"id": "hero", "look": "age, build, clothes, hair - simple and distinctive"}],
  "sets": [{"id": "kitchen", "look": "what it looks like, time of day, light"}],
  "scenes": [
    {"id": "s01", "set": "kitchen",
     "text": "Narration for this scene.",
     "shot": "What we see: who is where, what they do, how the camera moves. One or two sentences.",
     "sound": "optional: sounds that matter (a knock, rain, a phone buzz)"}
  ],
  "choice": {"narration": "Do you open the door? Or keep it shut?",
             "question": "WHAT DO YOU DO?", "a": "OPEN THE DOOR", "b": "KEEP IT SHUT"},
  "thumbnail": {"image": "the key image", "title": "SERIES TITLE", "tagline": "3-6 word question or dare"},
  "post": {"title": "platform title, at most 70 characters",
           "description": "1-2 sentences that restate the dilemma and say it is fiction",
           "hashtags": "#fiction plus 4-6 relevant tags"}
}
```

### Series bible: `episodes/<slug>/series.json`
Same shape as `episodes/deep-signal/series.json`: `canon` (the hidden truth, stated plainly, and the
clues shown so far), `state` (strikes 0, harm_log empty, plus story variables), `votes` (empty), and
`part_2_branches` with, for each option: `outcome_type`, `consequence`, `state_changes`, `escalation`
and the next `decision` (two options, each with a hidden `type` and `result`). Do not copy the `format`
block; write `"format": "see episodes/deep-signal/series.json"`.
