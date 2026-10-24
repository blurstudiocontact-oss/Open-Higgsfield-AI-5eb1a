# Open Higgsfield AI: Technical Documentation & Context

This document serves as a comprehensive knowledge base for the Open Higgsfield AI project. It details the architecture, key components, API integration patterns, and state management strategies used in the application.

## 1. Project Vision & Overview

**Open Higgsfield AI** is an ambitious open-source project dedicated to **replicating the full functionality of the Higgsfield platform**.

- **Core Goal:** To build a feature-complete, self-hosted alternative to Higgsfield, starting with **Image Generation** (Nano) and expanding into **Video Generation** (Cinema) and other creative tools.
- **Current State:** The Image Studio ("Nano Banana Pro" interface) is fully operational, featuring a premium dark-mode UI, history management, and generation through the [MiniMax API](https://platform.minimax.io) (Image-01 for images, H3 for video).
- **Future Direction:** The architecture is designed to scale for video generation, model training interfaces, and advanced editing tools, mirroring the evolving capabilities of Higgsfield.

- **Stack:** Vite, Vanilla JavaScript, Tailwind CSS v4.
- **Repository:** `https://github.com/Anil-matcha/Open-Higgsfield-AI`
- **Primary Branch:** `main`

## 2. Architecture & File Structure

The project follows a component-based architecture using vanilla JS, where each component is a function that returns a DOM element.

```tree
src/
├── components/
│   ├── ImageStudio.js    # Core logic: Prompts, model picking, canvas, history.
│   ├── Header.js         # Navigation, user settings, auth status.
│   ├── AuthModal.js      # Modal for capturing and validating the API key.
│   ├── SettingsModal.js   # Panel for managing settings (clearing API key).
│   └── Sidebar.js        # (Currently unused/placeholder) Navigation sidebar.
├── lib/
│   ├── minimax.js        # The API Client. Handles auth, submission, polling and uploads.
│   └── models.js         # MiniMax model catalog (Image-01, H3).
├── styles/
│   ├── global.css        # Global resets, fonts, and animation keyframes.
│   ├── studio.css        # Specific styles for the studio interface.
│   └── variables.css     # CSS custom properties (colors, blur amounts).
├── main.js               # Entry point. Renders the app layout and Header/Studio.
└── style.css             # Tailwind CSS entry file (imports other CSS).
```

## 3. Key Components & Logic

### `ImageStudio.js` (The Brain)
This is the most complex component. It handles:
- **State:** Selected model (`selectedModel`), aspect ratio (`selectedAr`), and generation status.
- **Prompt Input:** A textarea with auto-grow logic and max-height constraints (fixed in `bf2efdb`).
- **Dynamic Controls:**
    - **Model Picker:** Lists models from `models.js`.
    - **Quality/Resolution:** Hidden: Image-01 has a fixed output size per aspect ratio.
- **Generation Flow:**
    1. Checks for API key in `localStorage`. If missing, opens `AuthModal`.
    2. Calls `minimax.generateImage()` (synchronous for Image-01).
    4. On success, adds result to `generationHistory` and displays it.
- **History:**
    - Stored in `localStorage` key `minimax_image_history`.
    - Slides in from the right sidebar.
    - Thumbnails are clickable to re-view; hover to download.

### `minimax.js` (The Engine)
Encapsulates all communication with `api.minimax.io`.
- **Authentication:** `Authorization: Bearer <key>`, key in `localStorage` as `minimax_key`.
- **Images:** `POST /v1/image_generation` (`image-01`, `image-01-live`), synchronous; URLs are in `data.image_urls`.
- **Video (H3):** `POST /v2/video_generation` returns a `task_id`; poll `GET /v1/query/video_generation` until `Success`, then exchange the `file_id` at `GET /v1/files/retrieve` for a `download_url`.
- **Uploads:** `POST /v1/files/upload` (multipart, `purpose=video_generation`).

### `models.js` (The Data)
A small MiniMax catalog (`t2iModels`, `i2iModels`, `t2vModels`, `i2vModels`) whose `inputs` enums drive the aspect ratio, duration and resolution pickers.

## 4. UI & Styling (Tailwind v4)

- **Theme:** Dark mode by default (`bg-app-bg` = `#050505`).
- **Accent:** Neon Yellow-Green (`#d9ff00`) used for primary actions and glows.
- **Glassmorphism:** Extensive use of `backdrop-blur` and `bg-white/5` or `bg-black/60` for panels, headers, and modals.
- **Responsiveness:**
    - **Mobile:** Stacked layout, simplified controls, hidden sidebar.
    - **Desktop:** Wide canvas, floating prompt bar, side-by-side history.
- **Animations:** Custom keyframes in `global.css` for `fade-in-up`, `pulse-glow`, etc.

## 5. Development Setup

- **Proxies:** `/minimax-api` → `https://api.minimax.io` and `/minimax-cdn` → the H3 result CDN, served by Vite in development (`vite.config.js`) and by Netlify in production (`netlify.toml`), to avoid CORS.
- **Environment:** `minimax.js` always uses the proxy paths, unless a custom base URL is saved in OBS Studio → Settings → MiniMax.

## 6. Known Gotchas & Fixes

- **Prompt Bar Overflow:** Fixed by limiting textarea max-height and enabling scrolling.
- **Flux Resolution Picker:** Fixed logic to only show the resolution picker if the model *explicitly* lists enum values for resolution/megapixels.
- **Hero Visibility:** The "Nano Banana Pro" hero text is completely hidden (`display: none`) when an image is shown to prevent bleed-through.
- **API Key Logging:** Debug logs printing the API key were removed for security.

## 7. Future Roadmap (Potential)

- **Video Generation:** Done: Video Studio and the OBS page use MiniMax H3.
- **In-painting/Out-painting:** Add canvas editing tools.
- **User Accounts:** Move beyond local storage for history.
