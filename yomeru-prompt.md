# Yomeru (よめる) — First Working Prototype

## What I'm Building

A PWA that lets me point my phone camera at Japanese text (signs, menus, labels) and get an instant translation. I live in Japan and Google Translate's camera feature is too slow, unreliable, and requires internet. I want something that works **100% offline** after the initial install/download.

No cloud APIs. No AI provider keys. Everything runs on-device in the browser.

## Core UX Principle

**Progressive disclosure — the user should never stare at nothing.** The pipeline is:
1. Camera viewfinder is live → user sees something immediately
2. Text regions are detected and highlighted with bounding boxes → user knows the app "sees" the text
3. Japanese characters appear (OCR result) → user sees what was recognized
4. Morphological analysis breaks the text into words (Japanese has no spaces)
5. Dictionary translations appear for each word/phrase → usable result, fully offline

Each layer appears as soon as it's ready. The whole flow should feel like ~1-3 seconds, not a loading spinner.

## Tech Stack

- **PWA** — mobile-first web app, must work from phone browser, installable
- **Vite + React + TypeScript** — fast dev, familiar tooling

### OCR Layer
- **Tesseract.js** (v5) — for OCR, using the `jpn` and `jpn_vert` trained data
- Tesseract WASM + trained data files are cached locally after first download
- I know Tesseract isn't the best for Japanese — it's fine for a prototype. The architecture should make it easy to swap in a better model later (see Model Manager below)

### Text Processing Layer
- **TinySegmenter** — lightweight Japanese morphological analyzer that runs in JS (~7KB, no dependencies). Segments Japanese text into individual words since Japanese has no spaces.
  - npm package: `tiny-segmenter`
  - This is critical for dictionary lookups — you can't look up a whole sentence, you need individual words

### Translation Layer (Offline Dictionary)
- **JMdict/EDICT** — the standard open-source Japanese-English dictionary
  - Source: http://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project
  - Download the JMdict_e.gz (English-only version, ~15MB compressed)
  - Parse it at build time into a compact JSON lookup structure keyed by:
    - Kanji form (e.g., 味噌 → "miso, fermented soybean paste")
    - Kana reading (e.g., みそ → same)
  - Store the processed dictionary in IndexedDB on first load
  - Lookup pipeline: segment text → look up each word → display definitions
- For compound words and phrases that aren't in the dictionary, show the individual word translations side by side — the user can piece it together

### Offline Storage
- **IndexedDB** — store dictionary data, cached model weights, user preferences
- **Service Worker** — cache app shell, Tesseract WASM + trained data
- **Cache API** — pre-load all assets for full offline use

## Model Manager (Important Architectural Decision)

Design the OCR and translation layers behind clean interfaces so models can be swapped later. Build a simple "Model Manager" screen where users can:

1. **See what's installed**: list of downloaded models with size info
2. **Download additional models**: when online, browse available models and download them to IndexedDB/Cache
3. **Switch active models**: pick which OCR or translation model to use

For the prototype, the only available model is Tesseract.js with `jpn` data. But the architecture should support adding options later like:
- Different Tesseract trained data (e.g., `jpn_vert` for vertical text)
- ONNX-based models (PaddleOCR, manga-ocr) via ONNX Runtime Web
- Different dictionary versions or specialized glossaries (food, train, medical)

### Model interface (conceptual):

```typescript
interface OCRModel {
  id: string;
  name: string;
  description: string;
  size: number; // bytes
  isDownloaded: boolean;
  recognize(image: ImageData): Promise<OCRResult>;
}

interface TranslationModel {
  id: string;
  name: string;
  description: string;
  size: number;
  isDownloaded: boolean;
  translate(segments: string[]): Promise<TranslationResult[]>;
}

interface OCRResult {
  lines: {
    text: string;
    confidence: number;
    bbox: { x: number; y: number; width: number; height: number };
  }[];
}

interface TranslationResult {
  original: string;
  reading?: string;      // hiragana reading
  translations: string[];
  partOfSpeech?: string;
}
```

## File Structure

```
yomeru/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── public/
│   ├── manifest.json
│   └── sw.js
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── components/
    │   ├── Camera.tsx              # Camera viewfinder using getUserMedia
    │   ├── TextOverlay.tsx         # Renders bounding boxes + translations over camera
    │   ├── PhaseIndicator.tsx      # Shows current pipeline stage
    │   ├── ResultsPanel.tsx        # Scrollable list of translated items
    │   └── ModelManager.tsx        # Download/manage models screen
    ├── services/
    │   ├── ocr/
    │   │   ├── types.ts            # OCRModel interface
    │   │   ├── tesseract.ts        # Tesseract.js implementation
    │   │   └── registry.ts         # Available OCR models registry
    │   ├── translation/
    │   │   ├── types.ts            # TranslationModel interface
    │   │   ├── dictionary.ts       # JMdict/EDICT dictionary implementation
    │   │   ├── segmenter.ts        # TinySegmenter wrapper
    │   │   └── registry.ts         # Available translation models registry
    │   ├── storage/
    │   │   ├── indexeddb.ts        # IndexedDB wrapper for dictionary + model data
    │   │   └── model-cache.ts      # Download and cache model files
    │   └── pipeline.ts             # Orchestrates: capture → OCR → segment → translate
    ├── hooks/
    │   ├── useCamera.ts            # Camera stream management
    │   └── usePipeline.ts          # React hook wrapping the pipeline
    └── styles/
        └── global.css
```

## Camera Implementation Details

- Use `navigator.mediaDevices.getUserMedia` with `{ video: { facingMode: 'environment' } }` for the rear camera
- Render the video stream to a `<video>` element, overlay a canvas for bounding boxes
- Capture a frame on button press (not continuous scanning — that's a later optimization)
- The captured frame goes into the OCR pipeline

## OCR Details

- Initialize a Tesseract.js worker on app load with `jpn` language data
- On frame capture: run `worker.recognize(imageData)`
- Extract bounding boxes from `result.data.words` or `result.data.lines`
- Display boxes immediately over the camera view at the correct positions
- Show the recognized Japanese text inside each box

## Translation Pipeline Detail

This is the core offline flow:

```
OCR output: "本日のおすすめ味噌ラーメン"
    ↓
TinySegmenter: ["本日", "の", "おすすめ", "味噌", "ラーメン"]
    ↓
JMdict lookup per segment:
  - 本日 → "today, this day"
  - の → (particle, possessive)
  - おすすめ → "recommendation, suggestion"
  - 味噌 → "miso, fermented soybean paste"
  - ラーメン → "ramen, Chinese-style noodles"
    ↓
Display: "Today's recommended miso ramen"
```

For the prototype, even just showing the word-by-word breakdown is extremely useful. A more natural combined translation can come later with an on-device NMT model.

## First Launch / Download Flow

Since this is offline-first, the first launch requires downloading assets:

1. User opens the app for the first time (needs internet)
2. Show a clean onboarding screen: "Yomeru needs to download language data to work offline"
3. Download and cache:
   - Tesseract WASM core (~2MB)
   - Japanese trained data (~8MB)
   - Processed JMdict dictionary (~15-20MB compressed)
4. Show download progress with clear feedback
5. Once complete: "You're all set! Yomeru now works completely offline."
6. Service worker caches everything — app works without internet from now on

## Visual Design

- Dark theme — this will be used in restaurants, stations, dimly lit places
- Minimal chrome — the camera viewfinder should take up most of the screen
- Bounding boxes: orange border while processing, green when translated
- Japanese text in a clean font, translation in a slightly larger, bolder font below it
- For word-by-word results, show a clean card-style breakdown:
  - Each word on its own line
  - Japanese (kanji) | reading (hiragana) | English meaning
  - Tap a word for more dictionary detail
- Bottom bar: scan button (centered, prominent), phase indicator (small dots/text showing pipeline stage)
- The overall feel should be: fast, confident, no-nonsense

## PWA Requirements

- `manifest.json` with app name "Yomeru", appropriate icons, `display: standalone`
- Service worker that caches: app shell, Tesseract WASM + trained data, dictionary data
- Should be installable to home screen on iOS and Android
- Must work fully offline after first download

## What NOT to Build Yet

- No continuous/live scanning (just button press for now)
- No AR-style overlay that follows text in real-time
- No cloud API calls of any kind
- No user accounts or history
- No multi-language support (Japanese → English only)
- No fancy onboarding beyond the download screen
- No app store submission
- No on-device NMT model (dictionary lookup is enough for v1)

## Getting Started

After scaffolding, it should just be:
```bash
npm install
npm run dev
```

And I should be able to open it on my phone (via local network or ngrok), point the camera at Japanese text, hit scan, and see a translation. No API keys needed. No internet needed (after first load).

## Success Criteria

I pick up my phone, open the app (in airplane mode), point it at a Japanese menu in front of me, tap the scan button, and within 2-3 seconds I can see the Japanese text broken into words with English meanings. That's it. That's the whole thing.
