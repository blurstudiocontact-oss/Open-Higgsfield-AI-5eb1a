# OBS Studio reconstruction (browser)

A browser reimplementation of OBS Studio's core workflow, reachable from the
**OBS Studio** tab. Code lives in `src/components/ObsStudio.js` and
`src/lib/obs/`.

## How this was produced

The work followed the staged workflow of the `reverse-engineer-anything` (REA)
skill in `.agents/skills/reverse-engineer-anything/`: a checklist of questions,
the evidence each needs, and a finding ledger.

**No REA Evidence backs this reconstruction.** In the session that built it:

- no REA MCP tools were registered;
- acquiring the `rea-agents` CLI through `npx` was blocked by the session's
  permission policy;
- no OBS artifact (binary, package or capture) was available to analyse.

Per the skill's recovery guide, only actual REA output counts as REA Evidence,
so every behaviour below is labelled **documented**: it comes from OBS's public
documentation and well-known UI behaviour, not from an observation of a shipped
OBS build. A later REA pass on a real OBS artifact can upgrade these rows to
observed and correct any divergence.

## Finding ledger

| # | Question | Evidence type | Status | Reconstruction |
|---|----------|---------------|--------|----------------|
| 1 | How are sources and scenes related? | documented | answered | Global sources referenced by per-scene items, so one source can sit in several scenes ("Add existing"). `store.js` |
| 2 | Which source types matter for a minimal OBS? | documented | partial | Display Capture, Video Capture Device, Audio Input Capture, Image, Media Source, Text, Color Source. Browser Source is not reproduced (see unknowns). |
| 3 | How is the scene drawn? | documented | answered | Sources dock top = topmost layer; items painted bottom-up onto a fixed base canvas (default 1920×1080). `compositor.js` |
| 4 | How do you edit an item in the preview? | documented | answered | Red bounding box with 8 handles. Drag to move, snapping to edges/centre (Alt disables). Corners keep aspect ratio (Shift frees it). Arrow keys nudge (Shift ×10), Delete removes. Right-click selects and opens the context menu. |
| 5 | What transform operations exist? | documented | answered | Reset, Fit, Stretch, Center, Rotate 90° CW/CCW, Flip H/V, position/scale/crop fields. |
| 6 | Which filters? | documented | partial | Color Correction (opacity, brightness, contrast, saturation, hue) and Chroma Key (CbCr distance, similarity/smoothness 1–1000). Other filters are not reproduced. |
| 7 | How do transitions behave? | documented | answered | Cut, Fade, Fade to Color, Swipe, Slide with duration. Switching scenes in normal mode transitions program directly. |
| 8 | How does Studio Mode work? | documented | answered | Preview / Program side by side, Transition button, T-Bar. After a transition the old program scene swaps into preview. |
| 9 | How does the audio mixer behave? | documented | answered | Per-source fader on a cubic curve, dB readout, mute, monitoring toggle (off by default), post-fader peak meter on −60..0 dBFS with yellow from −20 dB and red from −9 dB, 1 s peak hold. Sources not on air are silenced. Global Mic/Aux device. |
| 10 | How does recording work? | documented | answered | Program video + mixed audio. Pause/resume. Filename `YYYY-MM-DD hh-mm-ss.ext`. Format and bitrates set in Settings. |
| 11 | How does streaming work? | documented | partial | WHIP service (server URL + bearer token), which OBS 30+ offers. RTMP is not possible from a browser. |
| 12 | What does the status bar report? | documented | answered | LIVE/REC timers, bitrate or size, render time, frames missed to rendering lag, FPS. |
| 13 | Projectors? | documented | partial | Windowed projector of the program output only. |

## Design choices (not claims about OBS)

- Rendering uses a 2D canvas driven by a Web Worker clock, so rendering and
  recording continue in background tabs. Late ticks are dropped and counted as
  lagged frames instead of piling up.
- Chroma key runs on the CPU on a copy downscaled to at most 960 px wide.
  OBS does this in a GPU shader.
- Recording uses `MediaRecorder`: WebM (VP9/VP8 + Opus), or MP4 (H.264/AAC)
  where the browser supports it.
- The scene collection is saved in `localStorage`. Screen captures and local
  media files cannot be restored after a reload: they show a dashed placeholder
  until reactivated from Properties. Large images may be dropped when storage
  is full.

## Unknowns and gaps

- Browser Source: cross-origin iframes cannot be drawn into a canvas.
- Virtual camera, replay buffer, multiple audio tracks, hotkeys, scene
  collections/profiles, the plugin API and obs-websocket are not reproduced.
- Exact defaults (fader curve constants, meter ballistics, snapping distance,
  transition easing) are approximations to verify against an OBS build.
