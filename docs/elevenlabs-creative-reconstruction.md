# ElevenLabs Creative reconstruction (browser)

A browser rebuild of ElevenLabs Creative's **Flows** canvas, reachable from
the **Creative** tab. Code lives in `src/components/CreativeStudio.js`,
`src/lib/creative/` and `src/styles/creative.css`.

## How this was produced

The work followed the `reverse-engineer-anything` (REA) skill in two passes.

### Pass 1: connector observations (no REA Evidence)

The ElevenLabs Creative connector answered questions about a real workspace
through read-only calls: `creative_get_flow_node_types` (node types, ports,
models, parameter schemas), `creative_list_flows` / `creative_get_flow`
(flow, node, edge and `node_run_states` shapes) and the connector's tool
contracts (variations, pinning a variation as an asset node, voice design,
brand kits). Rows from this pass are labelled **connector**.

### Pass 2: REA static analysis of the shipped web app

- REA MCP tools were not registered in the session. `rea doctor --client
  claude_code` (rea-agents 6.7.0 via `npx`) reported the registration
  `missing`; registering needs a client restart, which a cloud session cannot
  do. Per the skill's recovery guide the CLI fallback was used instead.
- Target: the JavaScript shipped by `https://elevenlabs.io/app/flows`. The
  page HTML (fetched 2026-10-24) lists 173 Turbopack chunks under
  `/app_assets/_next/static/chunks/`; all 173 were downloaded unchanged.
- Command: `rea analyze-javascript-application <dir> --source-path …` on the
  7 chunks that mention Flows node types or React Flow:
  `0f1mm38s_b3qv.js`, `392_rjl8onjuz.js`, `1wfc9c3kpvwiz.js`,
  `0wmwywvefp7vm.js`, `42g8z-6nqdpqa.js`, `0fi0gqge31ob0.js`,
  `28er4lzcayfa1.js` (chosen with a plain text search, which is not Evidence).
- Evidence: `ev_ef39c864826805ad913202d885a22523346a929ea601a253741cf9dce35e35d1`,
  artifact root SHA-256 `a4c83939…d0a6`. 7 files parsed, 0 parse failures,
  273,802 AST nodes, 624 findings, semantic graph of 53,578 nodes.
- Limitations REA reported: 166 inventoried files were outside the selected
  scope, so relationships through them are unknown; bundles were parsed as
  inert text and never executed; for `28er4lzcayfa1.js` and
  `0fi0gqge31ob0.js` the semantic graph exceeded the result budget (static
  and module facts kept); static syntax does not prove runtime execution.

Rows from this pass are labelled **REA static** and cite the chunk where the
fact sits. They are static observations of shipped code, not runtime
observations: the app was never run or logged into.

## Finding ledger

| # | Question | Evidence | Status | Reconstruction |
|---|----------|----------|--------|----------------|
| 1 | What is a flow? | connector | answered | Named canvas of nodes and edges with an update time and node count. Saved in `localStorage`; media in IndexedDB. `store.js` |
| 2 | Which canvas node types exist? | REA static (`392_rjl8onjuz.js`, node-type enum) | answered | `content-generation` (one type for image and video generation; the category comes from the model), `text`, `image`, `video`, `audio`, `voice`, `tts`, `sfx`, `music`, `llm`, `composition`, `comment`, `flow-group`, `avatar`, `speech-to-text`, `dubbing`, `voice-changer`, `voice-isolator`, `voice-creation`, `audio-effects`, `image-transform`, `unknown-model`. Reproduced all except Avatar and Video to Music; image and video generation stay two palette entries. `catalog.js` |
| 3 | Which media does each type output? | REA static (`0f1mm38s_b3qv.js`) + connector | answered | Output modality per type, e.g. `voice-isolator`→audio, `dubbing-video`→video, `image-transform`→image. |
| 4 | How do nodes connect? | connector | answered | One output port per node, typed by modality; named input ports (`reference_images`, `start_frame`, `reference_video`, `source`, …). Wiring checks modality and refuses cycles. |
| 5 | What does a node run produce? | connector | answered | Several variations on one node; downstream consumes the selected one; **Pin as asset** copies a variation into its own asset node. |
| 6 | Run state? | connector | answered | Per-node status (idle, running, completed, failed). Running a node first runs wired upstream nodes that have no result. |
| 7 | Where does a new node land? | REA static (`2h1_ql24pdxx0.js`) | answered | Default size 350×300 centred in the view; positions are bucketed on a 40 px grid and cascade by +40/+40 while the cell is taken. Reproduced in `addNode`. |
| 8 | How does focusing work? | REA static (`2h1_ql24pdxx0.js`, `1wfc9c3kpvwiz.js`) | answered | `fitView` on the chosen nodes with `maxZoom` 1.5, padded so the open Structure panel (344 px, left) and Agent panel (328 px default, right) do not cover them. Reproduced in `focusNodes`. |
| 9 | Which canvas library? | REA static (`0wmwywvefp7vm.js`) | answered | React Flow (`@xyflow`). Not reused here: the app is vanilla JS, so the canvas is hand-written with the same behaviour. |
| 10 | Comments and groups? | REA static (enum + `add_group`, `update_group`, `delete_group`, `arrange_groups`) | partial | Sticky-note Comment nodes; Group frames that carry their nodes when moved, can be resized, recoloured and run as a batch (Ctrl+G groups a selection). `arrange_groups` is not reproduced. |
| 11 | Is there an assistant? | REA static (`0f1mm38s_b3qv.js`, operation list; `flows_agent_*` analytics) | partial | An in-app agent edits the flow through operations: `add_node`, `add_static_asset_node`, `add_edges`, `update_node`, `remove_elements`, `add_group`, `run_nodes`, plus read tools (`get_flow_state`, `inspect_node`, `get_node_type_registry`, `get_available_voices`, `list_brand_kits`, …). Reproduced as the **Agent** panel: MiniMax M2 plans `add_node`, `add_edges`, `update_node`, `remove_elements`, `add_group` and `run_nodes` as JSON. Running always asks for confirmation. `agent.js` |
| 12 | Prompt helpers? | REA static (routes `/v1/content/prompts/improve`, `additive-improve`, `maybe-auto-enhance`) | partial | **Improve prompt** button, rewritten by MiniMax M2. The auto-enhance variant is not reproduced. |
| 13 | How do prompts reference other nodes? | REA static (`392_rjl8onjuz.js`, `promptTag`) | unresolved here | The real prompt is a rich-text editor with inline tags carrying `start`/`end` parameters. Here the Prompt port prepends wired text instead. |
| 14 | Library voices on the canvas? | REA static (`voice` type; `referenceNodes` of type Voice) | answered | **Voice** source node: pick an ElevenLabs or MiniMax voice and wire it into TTS or Voice Changer. |
| 15 | Parameters per node? | connector | partial | Same names and ranges as the workspace schema; model lists are cut down to what this app can call. |
| 16 | Composition? | connector | answered | Videos form one sequential track; each audio source gets its own track with volume and mute; with no video the output is mixed audio. |
| 17 | Image Editor? | connector | partial | Ordered deterministic ops on a `source` picture: crop, rotate/flip, overlay, text, adjust. AI ops, masks and `focal: detected` are not reproduced. |
| 18 | Brand kits? | connector | partial | Named kits with colours, typography and tone, added to the prompt. Real kits also hold logos and assets. |
| 19 | Templates? | REA static (`/v1/flows/templates/{templateId}`, `templateInput`/`templateOutput`) | partial | Three built-in starter templates. Template inputs/outputs are not reproduced. |

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
  Ctrl/⌘+A selects all, Ctrl/⌘+G groups, Ctrl/⌘+D duplicates, Delete
  removes, Ctrl/⌘+Enter runs.
- The **Structure** tab lists groups and nodes; clicking one focuses it.
- **✦ Agent** opens the chat panel that edits the flow.
- **Run all** runs every node in dependency order and stops at the first
  failure.

## Unknowns

- The real canvas was never rendered or run: visual design (colours, node
  chrome) is a design choice. REA facts are static only.
- 166 of 173 chunks were outside the REA scope, and the Flows page component
  itself may live in a lazily loaded chunk not listed in the HTML.
- Server-side Composition timeline edits (gaps, trims) and the Image Editor's
  AI ops have no browser equivalent here.
- MiniMax Music and Voice Design request shapes follow the public API docs and
  have not been exercised against a live key in this session.

## Kling extension (not part of ElevenLabs Creative)

Four nodes call the official Kling API through `server/kling-proxy.mjs`
(Netlify function in production, Vite middleware in development):

| Node | Route | Notes |
|------|-------|-------|
| Kling Image | `POST /v1/images/generations` | `aspect_ratio` (9:16 default), `n`, `resolution`, optional face/subject reference |
| Kling Image to Video | `POST /v1/videos/image2video` | start/end frame, `mode` std/pro, `duration` 5/10 |
| Kling Lip Sync | `POST /v1/videos/lip-sync` | `audio2video`, `video_id` of a Kling video (else `video_url`), audio as base64 ≤ 5 MB |
| Kling Avatar | `POST /v1/videos/avatar/image2video` | `image` + `sound_file`, `mode` |

Each task is polled at `GET <route>/<task_id>` until `task_status` is
`succeed`. Auth is a bearer API key, or an HS256 JWT signed from the access
and secret keys (`iss`, `exp` +30 min, `nbf` −5 s). Field names come from
Kling's API spec and the `mcp-kling` client; the Avatar route was not
confirmed against Kling's official page, which only renders in a browser.
Tested end to end against a local mock of these routes, not against Kling.

