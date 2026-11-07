# OBS Lite

Lightweight Electron screen recorder for crisp, smooth game footage.

## Run
`npm install` then `npm start`

## Build
- `npm run dist:mac` - .dmg (build on a Mac)
- `npm run dist:win` - installer + portable .exe (build on Windows, or use GitHub Actions)
- Or push to GitHub: Actions builds both and you download them from the run's "Artifacts".

## Features
- Records to MP4 (H.264) when supported, WebM fallback; written straight to disk (Videos/OBS Lite)
- Presets: Smooth 1080p60, Crispy 1440p60, Ultra 4K60; settings are remembered
- System audio + microphone mixed (Windows); microphone only on macOS
- 3-2-1 countdown, minimize-on-start, global hotkeys F9 (start/stop) and F10 (pause)

## Notes
- Real 4K needs a 4K source; a lower-resolution screen is never upscaled.
- macOS asks for Screen Recording permission the first time; allow it and restart.
