# CloudPlay

A minimal Android app that opens https://www.xbox.com/en-us/play full-screen in landscape.

## Features
- **Better xCloud built in** (switchable engine): resolution, codec, bitrate, server region, AMD FSR/CAS upscaling, stats, mouse and keyboard and more, from Better xCloud's own settings
- **Remote Play** to your own Xbox, from the CloudPlay menu
- **Controller rumble** on your controller's motors, or on the phone as a fallback
- **Clarity boost** presets (Low / Medium / High / Vivid) or custom sharpen/unsharp-mask sliders, which switch live during a game
- **Touch controls** you can drag and resize in-game (Edit touch layout)
- **Controllers:** native controller bridge (works even where WebView has no gamepad support), rumble, hold View for the menu
- **Performance:** low-latency video buffer, Android game mode, highest refresh rate, low-latency Wi-Fi, sustained performance mode
- **CloudPlay engine** (if Better xCloud is off): its own resolution/codec/bitrate/region/stats settings

Open the CloudPlay menu with the floating gear button (long-press it for settings), Back, or by holding View/Select for 1 second. Better xCloud's settings also have a CloudPlay app settings button.

## Credits
Includes [Better xCloud](https://github.com/redphx/better-xcloud) 6.7.13 by redphx, MIT License
(see `app/src/main/assets/better-xcloud/LICENSE`).

## Get the APK
Latest build: https://github.com/whistlow/CloudPlay/releases/download/latest/cloudplay-debug.apk

Every push to `main` builds a debug APK. Open the **Actions** tab, pick the latest
"Build debug APK" run, and download the `cloudplay-debug-apk` artifact (a zip containing
`app-debug.apk`). You can also start a build manually with **Run workflow**.

Install it on your phone after allowing installs from unknown sources.
