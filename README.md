# Open Higgsfield AI — Open-Source Alternative to Higgsfield AI

> **The free, open-source alternative to Higgsfield AI.** Generate images and videos with MiniMax Image-01 and MiniMax H3, and run a browser OBS studio, without a closed ecosystem or subscription.

Open Higgsfield AI is an open-source AI image, video, and cinema studio that brings Higgsfield-style creative workflows to everyone. It runs on the [MiniMax API](https://platform.minimax.io): **MiniMax H3** for video (text-to-video, image-to-video and video editing, up to 15 s at 2K with native stereo audio) and **MiniMax Image-01** for images.

**Why Open Higgsfield AI instead of Higgsfield AI?**
- **Free & open-source** — no subscription, no vendor lock-in
- **Self-hosted** — your data stays on your machine
- **One API key** — MiniMax H3 and Image-01 behind a single MiniMax key
- **Extensible** — add your own models, modify the UI, build on top of it

For a deep dive into the technical architecture and the philosophy behind the "Infinite Budget" cinema workflow, see our [comprehensive guide and roadmap](https://medium.com/@anilmatcha/building-open-higgsfield-ai-an-open-source-ai-cinema-studio-83c1e0a2a5f1).

![Studio Demo](docs/assets/studio_demo.webp)

## ✨ Features

- **Reels (home page)** — A TikTok / CapCut-style editor for 9:16 reels. Record in segments from the camera or screen (15 s / 60 s / 3 min, countdown, live filters), or import videos and photos. **Stable Diffusion live** restyles your surroundings in real time while you film: the camera streams to a [Daydream Scope](https://github.com/daydreamlive/scope) server running StreamDiffusionV2 (one-click model download and load, 8 environment presets or your own prompt, live intensity slider), and the transformed video is what gets recorded. Edit on a timeline with a centre playhead: trim by dragging clip edges, split, reorder, duplicate, speed (0.25×–4×), volume, filters, brightness/contrast/saturation, fit/fill, and transitions (dissolve, fade to black, flash, slide, zoom). Add animated text and emoji stickers you can drag on the preview, music, and voiceovers recorded over the reel. AI tools: **MiniMax H3** edits a clip, animates a photo or the current frame, or generates a clip from text; **Image-01** generates a photo. Export renders 1080 × 1920 at 30 fps (MP4 where the browser supports it, otherwise WebM). Projects and media are saved in the browser (localStorage + IndexedDB).
- **Image Studio** — Text-to-image with MiniMax Image-01 (8 aspect ratios). Upload a portrait to switch to subject reference (Image-01 or Image-01 Live) and place the same person in a new scene.
- **Video Studio** — Text-to-video with MiniMax H3, or upload a start frame to animate it. Duration 5 / 10 / 15 s, resolution 768P or 2K, and an `adaptive` ratio for image-to-video.
- **Cinema Studio** — Higgsfield AI-style interface for photorealistic cinematic shots with pro camera controls (Lens, Focal Length, Aperture), rendered with MiniMax Image-01.
- **Creative (ElevenLabs Creative reconstruction)** — A node-based Flows canvas modelled on ElevenLabs Creative. Wire Text, Image, Video, LLM, Text to Speech, Sound Effects, Music, Voice Creation, Voice Changer, Voice Isolator, Speech to Text, Dubbing, Image Editor, Audio Effects and Composition nodes together; each run keeps its variations, the selected one flows downstream, and any variation can be pinned as an asset. Image, video and LLM nodes run on MiniMax; audio nodes run on the ElevenLabs API (optional key) or MiniMax; Image Editor, Audio Effects and Composition run in the browser. Includes an Agent panel that builds and edits flows from chat, comments and groups, a Structure outline, prompt improvement, templates, an asset library, a voice picker and brand kits. Built with the REA skill (static analysis of the shipped web app). See [docs/elevenlabs-creative-reconstruction.md](docs/elevenlabs-creative-reconstruction.md).
- **Kling (UGC style Arcads)** — Kling Image, Kling Image to Video, Kling Lip Sync and Kling Avatar nodes on the Creative canvas, calling the official Kling API through the app's own server relay so renders play right in the app. The **UGC Kling** template builds the face-cam workflow: a 9:16 smartphone-style portrait, a script read by a voice, then either Avatar (photo + voice) or a 5 s Image to Video followed by Lip Sync. See [Kling setup](#kling-setup).
- **OBS Studio** — Browser reconstruction of OBS: scenes and sources (screen, webcam, mic, image, media, text, color), drag/resize preview, filters and chroma key, audio mixer with meters, Studio Mode with transitions and T-Bar, local recording and WHIP streaming. Its **MiniMax H3** dialog edits a recording or clip, animates a studio frame, or generates from text, and drops the result into the scene. See [docs/obs-reconstruction.md](docs/obs-reconstruction.md).
- **Daydream Scope (real-time AI)** — In OBS Studio, a **Daydream Scope (AI)** source streams the webcam or another source to a [Daydream Scope](https://github.com/daydreamlive/scope) server and shows the transformed video live; prompts can change while streaming. The **Daydream** panel manages Scope plugins (install, update, uninstall) and lists the pipelines they add. Requires a Scope server on a GPU machine or cloud box.
- **Upload History** — Reference images are uploaded once and stored locally. A picker panel lets you reuse any previously uploaded image across sessions.
- **Generation History** — Browse, revisit, and download all past generations (persisted in browser storage)
- **API Key Management** — The MiniMax API key is stored in browser localStorage and only sent to the MiniMax API
- **Responsive Design** — Works on desktop and mobile with a dark glassmorphism UI

### 🎬 MiniMax H3

| Mode | Where | Inputs |
| :--- | :--- | :--- |
| **Text-to-Video** | Video Studio, OBS | Prompt |
| **Image-to-Video** | Video Studio, OBS | Start frame + prompt |
| **Video editing** | OBS | Source video (recording, media source or file) + edit instruction, optional reference image |

H3 output is 24 fps with generated stereo audio. Generation is asynchronous and can take several minutes.

### 🎥 Cinema Studio Controls

The **Cinema Studio** offers precise control over the virtual camera, translating your choices into optimized prompt modifiers:

| Category | Available Options |
| :--- | :--- |
| **Cameras** | Modular 8K Digital, Full-Frame Cine Digital, Grand Format 70mm Film, Studio Digital S35, Classic 16mm Film, Premium Large Format Digital |
| **Lenses** | Creative Tilt, Compact Anamorphic, Extreme Macro, 70s Cinema Prime, Classic Anamorphic, Premium Modern Prime, Warm Cinema Prime, Swirl Bokeh Portrait, Vintage Prime, Halation Diffusion, Clinical Sharp Prime |
| **Focal Lengths** | 8mm (Ultra-Wide), 14mm, 24mm, 35mm (Human Eye), 50mm (Portrait), 85mm (Tight Portrait) |
| **Apertures** | f/1.4 (Shallow DoF), f/4 (Balanced), f/11 (Deep Focus) |

### 📁 Upload History & Picker

Every image you upload to MiniMax is saved locally (URL + thumbnail) so you never upload the same file twice:

- Click the upload button to open the **reference image picker**
- Previously uploaded images appear in a 3-column grid with thumbnails
- Click a thumbnail to select it and close the picker
- Upload new images with the **Upload files** button
- Remove individual images from history with the ✕ button
- History persists across browser sessions (stored in `localStorage`)

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- A [MiniMax](https://platform.minimax.io) API key

### Setup

```bash
# Clone the repository
git clone https://github.com/Anil-matcha/Open-Higgsfield-AI.git
cd Open-Higgsfield-AI

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open `http://localhost:5173` in your browser. You'll be prompted to enter your MiniMax API key on first use.

### Production Build

```bash
npm run build
npm run preview
```

The browser calls `https://api.minimax.io` directly, with no proxy. MiniMax must accept requests from the page's origin (CORS) for generation to work.

## 🏗️ Architecture

```
src/
├── components/
│   ├── ReelStudio.js     # TikTok/CapCut-style reel editor: capture, timeline, AI, export
│   ├── ImageStudio.js    # Text-to-image and subject-reference studio
│   ├── VideoStudio.js    # Text-to-video and image-to-video studio (H3)
│   ├── CinemaStudio.js   # Pro studio with camera controls & infinite canvas flow
│   ├── ObsStudio.js      # OBS reconstruction with the MiniMax H3 dialog
│   ├── UploadPicker.js   # Upload button + history panel
│   ├── CameraControls.js # Scrollable picker for camera/lens/focal/aperture
│   ├── Header.js         # App header with settings and controls
│   ├── AuthModal.js      # API key input modal
│   ├── SettingsModal.js  # Settings panel for API key management
│   └── Sidebar.js        # Navigation sidebar
├── lib/
│   ├── minimax.js        # MiniMax API client: H3 video, Image-01, file upload
│   ├── daydream.js       # Daydream Scope client: pipelines, plugins, WebRTC streaming
│   ├── models.js         # MiniMax model catalog (inputs drive the pickers)
│   ├── reels/            # Reel project store (localStorage + IndexedDB) and playback/export engine
│   ├── obs/              # OBS engine: scenes, sources, compositor, audio, outputs, H3 jobs
│   └── uploadHistory.js  # localStorage CRUD + canvas thumbnail generation for upload history
├── styles/
│   ├── global.css        # Global styles and animations
│   ├── studio.css        # Studio-specific styles
│   ├── obs.css           # OBS page styles
│   ├── reels.css         # Reel editor styles
│   └── variables.css     # CSS custom properties
├── main.js               # App entry point
└── style.css             # Tailwind imports
```

## 🔌 API Integration

The app talks to the [MiniMax API](https://platform.minimax.io) with `Authorization: Bearer <key>`:

| Purpose | Call |
| :--- | :--- |
| Video (H3) | `POST /v2/video_generation` with `model: "MiniMax-H3"`, a `content` array (text, `first_frame`, `reference_video`, `reference_image`), `resolution`, `duration`, `ratio` |
| Video status | `GET /v1/query/video_generation?task_id=…` until `Success`, then `GET /v1/files/retrieve?file_id=…` for the `download_url` |
| Images | `POST /v1/image_generation` with `model: "image-01"` (or `image-01-live`), `aspect_ratio`, optional `subject_reference` |
| Uploads | `POST /v1/files/upload` (multipart, `purpose=video_generation`) |

H3 call shapes follow the live-verified notes in [joeVenner/awesome-minimax-h3](https://github.com/joeVenner/awesome-minimax-h3), indexed by [MiniMax-AI/awesome-minimax-h3-integration](https://github.com/MiniMax-AI/awesome-minimax-h3-integration). Requests go straight from the browser to the MiniMax API; there is no proxy.

## 🛠️ Tech Stack

- **Vite** — Build tool & dev server
- **Tailwind CSS v4** — Utility-first styling
- **Vanilla JS** — No framework, pure DOM manipulation
- **MiniMax API** — H3 video and Image-01

## 🤔 How is this different from Higgsfield AI?

Higgsfield AI is a proprietary AI video and image generation platform. **Open Higgsfield AI** is a community-driven, open-source alternative that provides similar creative capabilities without the closed ecosystem:

| | Higgsfield AI | Open Higgsfield AI |
| :--- | :--- | :--- |
| **Cost** | Subscription-based | Free (open-source); you pay MiniMax per generation |
| **Models** | Proprietary | MiniMax H3 and Image-01 |
| **Self-hosting** | No | Yes |
| **Customizable** | No | Fully hackable |
| **Data privacy** | Cloud-based | Your data stays local |
| **Source code** | Closed | MIT licensed |

## 📄 License

MIT

## 🙏 Credits

Video and images by [MiniMax](https://platform.minimax.io) (H3, Image-01).

---
**Deep Dive**: For more details on the "AI Influencer" engine, upcoming "Popcorn" storyboarding features, and the future of this project, read the [full technical overview](https://medium.com/@anilmatcha/building-open-higgsfield-ai-an-open-source-ai-cinema-studio-83c1e0a2a5f1).

---
*Looking for a free Higgsfield AI alternative? Open Higgsfield AI is an open-source AI image and video generation studio and Higgsfield AI replacement that you can self-host, customize, and extend.*

## Kling setup

Kling keys never go in the browser. The app calls `/api/kling/*`, a relay (`server/kling-proxy.mjs`) that adds your key and forwards to the Kling API.

1. Create API keys at [app.klingai.com/global/dev](https://app.klingai.com/global/dev).
2. Set the environment variables (see `.env.example`):
   - `KLING_API_KEY`, or `KLING_ACCESS_KEY` and `KLING_SECRET_KEY`
   - `KLING_PROXY_TOKEN`: a passcode of your choice. Required once deployed, so strangers cannot spend your credits.
3. Locally: put them in a `.env` file and run `npm run dev`. On Netlify: Site configuration → Environment variables, then redeploy (`netlify/functions/kling.mjs` serves the relay).
4. In the app: **Creative → Settings → Kling passcode**, enter the same passcode.

Limits: voice audio sent to Lip Sync or Avatar must be under 5 MB; Lip Sync takes a 5 or 10 s video made by Kling in the last 30 days (or a public video URL).

