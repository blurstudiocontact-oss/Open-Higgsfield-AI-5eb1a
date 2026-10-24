# ElevenLabs Creative reconstruction (browser)

A browser rebuild of ElevenLabs Creative's **Flows** canvas, reachable from
the **Creative** tab. Code lives in `src/components/CreativeStudio.js`,
`src/lib/creative/` and `src/styles/creative.css`.

## How this was produced

The work followed the staged workflow of the `reverse-engineer-anything` (REA)
skill: a checklist of questions, the evidence each needs, and a finding ledger.

**No REA Evidence backs this reconstruction.** In the session that built it no
REA MCP tools were registered, and ElevenLabs Creative is a hosted web app with
no shipped artifact to analyse. The evidence came instead from the ElevenLabs
Creative connector, which answers questions about a real workspace. These
read-only calls were used:

- `creative_get_flow_node_types`: every node type with its display name,
  output port and modality, input ports, default model, model list and
  parameter schema (names, types, enums, ranges, defaults).
- `creative_list_flows` and `creative_get_flow`: the flow record shape
  (`flow_id`, `name`, `updated_at`, `node_count`), and per flow the nodes, edges
  and `node_run_states` (`status`: e.g. `completed`).
- The connector's tool contracts: multiple variations live on one node, a
  downstream node consumes exactly one, and a chosen variation is pinned by
  adding an asset node from its generation id; brand kits; voice search and
  voice design (design → previews → save); asset library.

Rows below are labelled **observed** when that connector reported them and
**documented** when they come from public ElevenLabs API docs. The canvas look
and feel was not observed (no screenshots or captures of the web app), so it
is a design choice.

## Finding ledger

| # | Question | Evidence | Status | Reconstruction |
|---|----------|----------|--------|----------------|
| 1 | What is a flow? | observed | answered | Named canvas of nodes and edges with an update time and node count. Saved in `localStorage`; media in IndexedDB. `store.js` |
| 2 | Which node types exist? | observed | answered | Image Generation, Video Generation, Text to Speech, Sound Effects, Music, LLM, Composition, Image Editor, Dubbing (Audio/Video), Voice Changer, Voice Isolator, Voice Creation, Audio Effects, Speech to Text, plus asset nodes. Avatar and Video to Music are not reproduced. `catalog.js` |
| 3 | How do nodes connect? | observed | answered | One output port per node, typed by modality (text, image, video, audio, voice). Input ports are named (`reference_images`, `start_frame`, `reference_video`, `source`, …); reference fields are ports, not parameters. Wiring checks modality and refuses cycles. |
| 4 | What does a node run produce? | observed | answered | Several variations on the one node (images ×4, speech ×2 by default). Downstream consumes the selected one; **Pin as asset** copies a variation into its own asset node. |
| 5 | Run state? | observed | answered | Per-node status (idle, running, completed, failed). Running a node first runs wired upstream nodes that have no result. |
| 6 | Parameters per node? | observed | partial | Same names and ranges as the workspace schema (e.g. SFX `duration_seconds` 0.5–30, `prompt_influence` 0.3, `loop`; Music `lyrics_type` auto/custom/instrumental; Audio Effects filter, environment, background noise and `distance`). Model lists are cut down to what this app can call. |
| 7 | Composition? | observed | answered | Videos form one sequential track; each audio source gets its own track with volume and mute; with no video the output is mixed audio. |
| 8 | Image Editor? | observed | partial | An ordered list of deterministic ops on a `source` picture, with geometry first. Reproduced ops: crop, rotate/flip, overlay, text, adjust. AI edit ops, masks and `focal: detected` are not reproduced. |
| 9 | Voices? | observed + documented | answered | Voice search through `GET /v2/voices`; Voice Creation designs previews (`/v1/text-to-voice/design`) that must be saved (`/v1/text-to-voice`) before use. A Voice output wires into TTS or Voice Changer. |
| 10 | Brand kits? | observed | partial | Named kits with colours, typography and tone. Applying one adds them to the prompt. The real kits also hold logos and assets. |

## Backends (design choices)

| Node | Runs on |
|------|---------|
| Image Generation | MiniMax Image-01 / Image-01 Live (subject reference from the Reference port) |
| Video Generation | MiniMax H3 (start frame, reference images, reference video edit) |
| LLM | MiniMax M2 / M1 chat completion |
| Text to Speech | ElevenLabs TTS (v3, Multilingual v2, Turbo/Flash v2.5) or MiniMax Speech 02 |
| Music | ElevenLabs Music v1 or MiniMax Music 2.0 (needs lyrics or instrumental) |
| Sound Effects, Voice Changer, Voice Isolator, Speech to Text, Dubbing | ElevenLabs API |
| Voice Creation | ElevenLabs Voice Design v3 or MiniMax Voice Design |
| Image Editor | Canvas 2D in the browser |
| Audio Effects | Web Audio in the browser: biquad filter chains, ring modulator for Robot, synthetic reverb impulses, filtered pink noise for ambience. An approximation of the real effects catalog. Video input yields audio only. |
| Composition | Canvas + `MediaRecorder` (video) or `OfflineAudioContext` (audio-only WAV) in the browser |

Keys are entered in **Creative → Settings**: the MiniMax key is shared with
the rest of the app, and the ElevenLabs key is stored as `elevenlabs_key` in
`localStorage` and only sent to `api.elevenlabs.io`. Remote results are copied
into IndexedDB when the host allows a cross-origin read, so they outlive
MiniMax's expiring URLs.

## Canvas controls

- Drag palette items onto the canvas (or click to add at the centre); drop
  image/video/audio files to create asset nodes.
- Drag from a node's right-hand port to an input port. Drop on a node body to
  use its first compatible port, or on empty canvas to add a connected node.
- Scroll pans, Ctrl/⌘+scroll zooms, **F** fits, Shift+click multi-selects,
  Ctrl/⌘+D duplicates, Delete removes, Ctrl/⌘+Enter runs.
- **Run all** runs every node in dependency order and stops at the first
  failure.

## Unknowns

- The real canvas UI (layout, node chrome, minimap, groups, comments) was not
  observed.
- Server-side Composition timeline edits (gaps, trims) and the Image Editor's
  AI ops have no browser equivalent here.
- MiniMax Music and Voice Design request shapes follow the public API docs and
  have not been exercised against a live key in this session.
