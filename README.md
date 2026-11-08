# CloudPlay

A minimal Android app that opens https://www.xbox.com/en-us/play full-screen in landscape.

## Settings
Press Back (or hold View/Select on your controller for 1 second) to open the menu, then **Settings**:

- **Stream quality:** resolution (720p / 1080p / 1080p high quality), H.264 profile, max bitrate, server region
- **Picture:** fit/zoom/stretch, sharpness, saturation, contrast, brightness
- **Performance:** highest refresh rate, low-latency Wi-Fi, sustained performance mode, stream stats overlay
- **App:** start page, reset settings, sign out and clear data

Stream settings are applied by reloading the page when you leave Settings.

## Get the APK
Latest build: https://github.com/whistlow/CloudPlay/releases/download/latest/cloudplay-debug.apk

Every push to `main` builds a debug APK. Open the **Actions** tab, pick the latest
"Build debug APK" run, and download the `cloudplay-debug-apk` artifact (a zip containing
`app-debug.apk`). You can also start a build manually with **Run workflow**.

Install it on your phone after allowing installs from unknown sources.
