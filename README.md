# OBS Lite

Electron-based screen recorder source project.

## Recent recording-quality changes

- Requests that the desktop capture omit the mouse pointer (`cursor: "never"`).
  Support for this legacy Chromium desktop-capture constraint can vary by Electron/Chromium version and operating system, so test a short recording on the target machine.
- Explicit resolution presets now request matching minimum and maximum dimensions rather than only setting maximum dimensions.
- Added a 70 Mbps high-detail bitrate option and raised the default bitrate to 50 Mbps.
- Kept source-native capture available so the recorder does not upscale a lower-resolution source and call it true 4K.

## Important limitations

This project uses Electron's `desktopCapturer` and browser `MediaRecorder`; it is not the OBS Studio capture/encoding engine. Actual sharpness and frame rate depend on the selected display/window, operating system capture APIs, GPU, encoder support, and system load. A high bitrate cannot restore detail that was already lost by the capture source.

The cursor suppression request is best-effort with the current legacy `getUserMedia` desktop-capture path. If the target Electron build ignores it, the next step is to migrate capture to Electron's display-media request handler and test its cursor option on the target OS.

## Development

Install dependencies with `npm install`, then run `npm start`.
