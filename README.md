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

- **Image Studio** — Text-to-image with MiniMax Image-01 (8 aspect ratios). Upload a portrait to switch to subject reference (Image-01 or Image-01 Live) and place the same person in a new scene.
- **Video Studio** — Text-to-video with MiniMax H3, or upload a start frame to animate it. Duration 5 / 10 / 15 s, resolution 768P or 2K, and an `adaptive` ratio for image-to-video.
- **Cinema Studio** — Higgsfield AI-style interface for photorealistic cinematic shots with pro camera controls (Lens, Focal Length, Aperture), rendered with MiniMax Image-01.
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

The browser calls MiniMax through same-origin proxy paths (`/minimax-api`, `/minimax-cdn`), served by the Vite dev server and, on Netlify, by `netlify.toml`. On any other host, add the same two proxies or set **OBS Studio → Settings → MiniMax → API base URL**.

## 🏗️ Architecture

```
src/
├── components/
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
│   ├── obs/              # OBS engine: scenes, sources, compositor, audio, outputs, H3 jobs
│   └── uploadHistory.js  # localStorage CRUD + canvas thumbnail generation for upload history
├── styles/
│   ├── global.css        # Global styles and animations
│   ├── studio.css        # Studio-specific styles
│   ├── obs.css           # OBS page styles
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

H3 call shapes follow the live-verified notes in [joeVenner/awesome-minimax-h3](https://github.com/joeVenner/awesome-minimax-h3), indexed by [MiniMax-AI/awesome-minimax-h3-integration](https://github.com/MiniMax-AI/awesome-minimax-h3-integration). During development, Vite proxies `/minimax-api` to `api.minimax.io` and `/minimax-cdn` to the result CDN to avoid CORS.

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
