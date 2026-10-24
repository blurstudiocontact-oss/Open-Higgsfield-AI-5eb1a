---
name: suno-engineer
description: >
  Write ready-to-paste Suno song prompts: the Style field, structured lyrics
  with meta tags, a title, and exclusions. Use when the user wants a song,
  jingle, beat, instrumental, cover, or extension made in Suno, asks to fix a
  Suno prompt that sounds wrong, or invokes /suno-engineer.
---

# suno-engineer

Turn a song idea into fields the user pastes straight into Suno's **Custom** mode. Suno reads two things above all: the **Style** field (what it sounds like) and the **Lyrics** field (what is sung, and in what order). Everything below serves those two fields.

## Workflow

1. **Pin the brief.** From the request, settle: genre and era, mood, tempo/energy, vocal type (or instrumental), language, length/structure, and the use (TikTok hook, ad jingle, full track, background loop). Fill gaps with sensible defaults and state them; ask only when the genre or purpose is truly unknown.
2. **Write the Style field** (rules below).
3. **Write the lyrics with meta tags** (rules below), or a tag-only skeleton for instrumentals.
4. **Add a title and Exclude list.**
5. **Deliver** in the output format, then offer 1–2 alternate Style lines as variations.

## Style field

A comma-separated list of descriptors, most important first. Suno weights early terms more.

Order: `genre + subgenre, era/scene, mood, tempo/BPM, key instruments, vocal description, production/mix`

- 4–10 strong descriptors beat a paragraph. Concrete sound words ("gated reverb drums", "detuned Juno pads", "808 slides") beat vague praise ("amazing", "high quality", "masterpiece").
- **Never use artist, band, or song names.** Suno rejects or ignores them. Describe the sound instead: not "like The Weeknd" but "80s-inspired synth-pop, dark R&B, falsetto male vocal, glossy retro synths, 108 BPM".
- Fuse at most two genres. Three or more turns to mush.
- Name the vocal explicitly: `breathy female alto`, `raspy male baritone`, `choir`, `rap verses with sung hook`. For no vocals, say `instrumental` here *and* toggle Instrumental.
- BPM and key are hints, not guarantees, but they do pull tempo: `92 BPM`, `minor key`.
- Character limits differ by model version (older models: ~120–200 chars; v4.5 and later allow far more). Keep it tight anyway, since long style fields dilute.

Good: `melodic deep house, late-night, euphoric yet wistful, 122 BPM, rolling bassline, plucked synth arps, airy female vocal chops, wide stereo, polished club mix`

Bad: `a really good emotional song with nice music and great vocals like Avicii`

## Lyrics field

Lyrics are both words *and* the arrangement script. Square-bracket tags tell Suno what section comes next; anything not in brackets gets sung.

### Structure tags

`[Intro]` `[Verse]` / `[Verse 1]` `[Pre-Chorus]` `[Chorus]` `[Post-Chorus]` `[Hook]` `[Bridge]` `[Breakdown]` `[Build]` `[Drop]` `[Instrumental]` `[Guitar Solo]` `[Interlude]` `[Outro]` `[Fade Out]` `[End]`

- Always end with `[Outro]` then `[End]` (or `[Fade Out]`). Without them songs often stop abruptly or ramble.
- Put a short descriptor inside or beside a tag to steer that section: `[Chorus: full band, soaring]`, `[Verse 2: half-time, sparse piano]`, `[Bridge: whispered]`. Keep it to a few words.
- Vocal tags switch delivery: `[Male Vocal]`, `[Female Vocal]`, `[Duet]`, `[Rap]`, `[Spoken Word]`, `[Whisper]`, `[Belted]`, `[Harmonies]`, `[Choir]`.
- Instrumental moments inside a vocal song: `[Instrumental Break]`, `[Sax Solo]`, `[Drop]`. Leave the line under them empty.

### Writing the words

- **Short, even lines.** 6–10 syllables per line, 4 lines per verse, 4–6 per chorus. Lines of similar length within a section give a steady cadence. Long lines get rushed or garbled.
- **Repeat the chorus word for word** each time. Repetition is how Suno (and listeners) recognize the hook. Put the title phrase in the chorus.
- **Rhyme** (AABB or ABAB) and lean on open vowels in held notes ("night", "go", "away").
- `(parentheses)` are usually read as backing vocals or ad-libs: `I keep running (running)`. Use them sparingly.
- Stretch a word for a held note with repeated letters or hyphens: `so-o-o long`, `goooone`.
- Write numbers, acronyms, and odd words phonetically if pronunciation matters: `twenty twenty-six`, `A-I`, `Nee-on`.
- Skip stage directions in plain text. Anything outside brackets may get sung.
- Default length: Intro, V1, Pre, Chorus, V2, Pre, Chorus, Bridge, Chorus, Outro, End. Shorter for jingles/hooks (Intro, Hook, Hook, End).

### Instrumentals

Toggle **Instrumental**, put everything sonic in Style, and use the Lyrics field (if the mode allows it) only for a tag skeleton:

```
[Intro: ambient pads]
[Build]
[Drop: heavy sidechained bass]
[Breakdown: piano only]
[Build]
[Drop]
[Outro]
[End]
```

## Title and Exclude

- **Title:** short and evocative, ideally the chorus hook.
- **Exclude Styles** (when available): list what keeps creeping in, e.g. `autotune, EDM drops, male vocals, distorted guitar`. Plain nouns, no "no" prefix.
- **Sliders** (newer versions): *Weirdness* up for experimental, down for safe/genre-faithful; *Style Influence* up to stick hard to the Style field. Recommend values only if the user mentions them.

## Extend, Cover, Persona, and fixing bad outputs

- **Extend:** give only the lyrics for the *new* part, starting with the next section tag (e.g. `[Bridge]`). Restate the Style unless changing direction on purpose.
- **Cover / remaster with a new style:** keep the lyrics, rewrite only the Style field.
- **Persona:** when the user has a saved voice/persona, keep the Style field about genre and production and let the persona carry vocal identity.
- **Troubleshooting** (match the symptom, change one thing per regeneration):

| Symptom | Fix |
|---|---|
| Wrong genre | Move genre to the very front, remove conflicting genres, add an Exclude |
| Words mumbled or rushed | Shorten lines, even out syllables, spell words phonetically |
| Song ends abruptly / runs on | Add `[Outro]` + `[End]`; trim lyrics |
| Chorus doesn't hit | Repeat it verbatim, add `[Chorus: anthemic, full band]`, put the title in it |
| Tags get sung aloud | Keep tags on their own line, in square brackets, short |
| Vocals in an instrumental | Toggle Instrumental, add `instrumental` to Style, Exclude `vocals` |
| Too generic | Swap adjectives for concrete instruments, textures, era, BPM |

## Output format

Deliver every prompt in this shape, each field in its own code block so it copies cleanly:

**Title**
```
<title>
```

**Style**
```
<comma-separated style descriptors>
```

**Exclude** *(optional)*
```
<comma-separated exclusions>
```

**Lyrics**
```
[Intro]
...
[End]
```

Then one line of **settings** (Custom mode, Instrumental on/off, model if it matters), and **2 alternate Style lines** for variation. Keep commentary to a sentence or two; the fields are the deliverable.

## Example

Request: "an upbeat summer song about a road trip with friends, for a TikTok."

**Title**
```
Windows Down
```

**Style**
```
sunny indie pop, 2010s summer anthem, carefree and nostalgic, 118 BPM, jangly electric guitar, handclaps, bright synth hook, group gang vocals, warm male lead vocal, punchy radio mix
```

**Exclude**
```
sad, slow tempo, heavy distortion
```

**Lyrics**
```
[Intro: guitar riff, handclaps]

[Verse 1]
Gas station coffee, sunrise on the dash
Five of us squeezed in, counting up the cash
Map's in the glovebox, nobody cares
Singing every chorus like we're millionaires

[Pre-Chorus]
And the road keeps rolling on
Like it knows our favorite song

[Chorus: full band, gang vocals]
Windows down, turn it up loud
Hands in the air above the crowd
No way back and we don't mind
Leave the whole world behind (oh-oh)

[Verse 2]
Sunburned shoulders, motel neon glow
Every wrong turn's a place we didn't know

[Pre-Chorus]
And the road keeps rolling on
Like it knows our favorite song

[Chorus: full band, gang vocals]
Windows down, turn it up loud
Hands in the air above the crowd
No way back and we don't mind
Leave the whole world behind (oh-oh)

[Bridge: half-time, just guitar and voices]
Someday we'll be older
Someday we'll be far
But tonight we're forever
Singing in this car

[Chorus: biggest, everyone singing]
Windows down, turn it up loud
Hands in the air above the crowd
No way back and we don't mind
Leave the whole world behind (oh-oh)

[Outro: handclaps fade]
[End]
```

Settings: Custom mode, vocals on. For TikTok, the 15–30 s clip is the first chorus, so keep the intro short.

Alternates:
- `upbeat pop-punk, early 2000s, sunny, 160 BPM, power chords, driving drums, shouted group chorus, bright male vocal`
- `tropical house, feel-good summer, 110 BPM, steel drums, marimba plucks, warm female vocal, laid-back groove`
