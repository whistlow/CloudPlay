package com.whistlow.cloudplay;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.view.Display;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.hardware.input.InputManager;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.preference.PreferenceManager;
import androidx.webkit.ScriptHandler;
import androidx.webkit.UserAgentMetadata;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public class MainActivity extends AppCompatActivity {

    static final String DEFAULT_URL = "https://www.xbox.com/en-us/play";
    static final String KEY_REGIONS = "known_regions";
    static final String KEY_PENDING_CLEAR = "pending_clear";
    static final String EXTRA_EXIT = "exit";
    private static final long MENU_HOLD_MS = 1000;

    private WebView webView;
    private android.widget.FrameLayout root;
    private android.widget.ImageButton gear;
    private volatile boolean streaming;
    private ScriptHandler scriptHandler;
    private String fallbackScript;
    private String fallbackBx;
    private ScriptHandler bxHandler;
    private String scriptBody;
    private String bxScript;
    private Rumbler rumbler;
    private final GamepadBridge gamepads = new GamepadBridge();
    private Runnable modeRunnable;
    private boolean modeHeld, modeLeft;
    private String appliedConfig;
    private String appliedUrl;
    private WifiManager.WifiLock wifiLock;
    private android.app.Dialog menu;
    private volatile boolean headerButton;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable showMenuRunnable = this::showMenu;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, ex) -> {
            try {
                java.io.StringWriter sw = new java.io.StringWriter();
                ex.printStackTrace(new java.io.PrintWriter(sw));
                String trace = sw.toString();
                PreferenceManager.getDefaultSharedPreferences(getApplicationContext()).edit()
                        .putString("last_crash", new java.util.Date() + "\n" + trace.substring(0, Math.min(4000, trace.length())))
                        .commit();
            } catch (Throwable ignored) {
            }
            if (prev != null) prev.uncaughtException(t, ex);
        });
        PreferenceManager.setDefaultValues(this, R.xml.preferences, false);
        // One-time: the app's own engine by default. The bundled enhancement engine rewrites the
        // Xbox site's code and can bring back the older home layout; the app covers its features.
        if (!prefs().getBoolean("engine_basic_v1", false)) {
            prefs().edit().putString("engine", "cloudplay").putBoolean("engine_basic_v1", true).apply();
        }
                // One-time: zero-buffer mode off (it caused blocky video glitches on busy Wi-Fi).
        if (!prefs().getBoolean("ll_off_v1", false)) {
            prefs().edit().putBoolean("low_latency", false).putBoolean("ll_off_v1", true).apply();
        }
        // One-time move to the new Auto Remote Play connection.
        if (!prefs().getBoolean("rp_auto_v1", false)) {
            prefs().edit().putString("remote_play_mode", "auto").putBoolean("rp_auto_v1", true).apply();
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        scriptBody = readAsset("cloudplay.js");
        rumbler = new Rumbler(this);

        if (getIntent() != null && getIntent().getBooleanExtra(EXTRA_EXIT, false)) {
            finishAndRemoveTask();
            return;
        }
        createWebView(savedInstanceState);
        askNotificationPermissionOnce();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                showMenu();
            }
        });
        enterImmersive();
    }

    // ---------------------------------------------------------------- WebView

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void createWebView(Bundle state) {
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF000000);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);     // reuse cached site files between launches
        s.setGeolocationEnabled(false);
        s.setSaveFormData(false);
        s.setSupportMultipleWindows(false); // keep sign-in popups in this view
        // Present as regular Chrome: drop the WebView markers from the UA string and brand list.
        String ua = s.getUserAgentString().replace("; wv", "").replace("Version/4.0 ", "");
        // Large-screen devices get a tablet user agent (no "Mobile"), which Xbox's server takes
        // for a TV and answers with the older TV layout, swapping to the regular one only once
        // the page's code has loaded. Saying "Mobile" gets the regular layout from the start.
        if (!ua.contains(" Mobile")) ua = ua.replace(" Safari/", " Mobile Safari/");
        s.setUserAgentString(ua);
        applyChromeBrands(s);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new NativeBridge(), "CloudPlayNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (fallbackScript != null) view.evaluateJavascript(fallbackScript, null);
                if (fallbackBx != null) view.evaluateJavascript(fallbackBx, null);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Renderer crashed or was killed for memory: rebuild instead of crashing the app.
                if (view == webView) {
                    if (root != null) root.removeAllViews();
                    view.destroy();
                    webView = null;
                    scriptHandler = null;
                    bxHandler = null;
                    createWebView(null);
                    Toast.makeText(MainActivity.this, "Browser restarted", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(0xFF000000);
        root.addView(webView, new android.widget.FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(createGear());
        setContentView(root);
        updateGear();
        webView.requestFocus();

        appliedConfig = buildConfig();
        installScript();
        appliedUrl = startUrl();
        if (state != null) {
            webView.restoreState(state);
        } else {
            webView.loadUrl(appliedUrl);
        }
    }

    private boolean useBetterXcloud() {
        return "betterxcloud".equals(prefs().getString("engine", "cloudplay"));
    }

    private static void applyChromeBrands(WebSettings s) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) return;
        try {
            UserAgentMetadata cur = WebSettingsCompat.getUserAgentMetadata(s);
            java.util.List<UserAgentMetadata.BrandVersion> list = new java.util.ArrayList<>();
            String major = null, full = null;
            for (UserAgentMetadata.BrandVersion b : cur.getBrandVersionList()) {
                if (b.getBrand().toLowerCase().contains("webview")) {
                    major = b.getMajorVersion();
                    full = b.getFullVersion();
                } else {
                    list.add(b);
                    if (major == null && b.getBrand().equals("Chromium")) {
                        major = b.getMajorVersion();
                        full = b.getFullVersion();
                    }
                }
            }
            if (major == null) return;
            list.add(new UserAgentMetadata.BrandVersion.Builder()
                    .setBrand("Google Chrome").setMajorVersion(major).setFullVersion(full).build());
            WebSettingsCompat.setUserAgentMetadata(s,
                    new UserAgentMetadata.Builder(cur).setBrandVersionList(list).setMobile(true).build());
        } catch (Exception ignored) {
        }
    }

    // ------------------------------------------------- floating settings button

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private View createGear() {
        gear = new android.widget.ImageButton(this);
        gear.setImageResource(R.drawable.ic_settings);
        gear.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        gear.setPadding(dp(13), dp(13), dp(13), dp(13));
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        bg.setColor(0xD91C1C1C);
        bg.setStroke(dp(1), 0x40FFFFFF);
        gear.setBackground(bg);
        gear.setFocusable(false);           // keep controller focus on the game
        gear.setContentDescription("Settings");
        gear.setElevation(dp(6));
        gear.setOnClickListener(v -> showMenu());
        gear.setOnLongClickListener(v -> {
            startActivity(new Intent(this, SettingsActivity.class));
            return true;
        });
        return gear;
    }

    /** Position and show/hide the gear according to settings and whether a game is streaming. */
    private void updateGear() {
        if (gear == null) return;
        SharedPreferences p = prefs();
        String mode = p.getString("floating_gear", "off");
        boolean show = "always".equals(mode) || ("auto".equals(mode) && !streaming && !headerButton);
        gear.setVisibility(show ? View.VISIBLE : View.GONE);

        String pos = p.getString("settings_button_pos", "bottom_right");
        int g = (pos.startsWith("top") ? android.view.Gravity.TOP : android.view.Gravity.BOTTOM)
                | (pos.endsWith("left") ? android.view.Gravity.START : android.view.Gravity.END);
        android.widget.FrameLayout.LayoutParams lp =
                new android.widget.FrameLayout.LayoutParams(dp(52), dp(52), g);
        lp.setMargins(dp(16), dp(16), dp(16), dp(16));
        gear.setLayoutParams(lp);
        gear.setAlpha("always".equals(mode) && streaming ? 0.45f : 1f);
    }

    /**
     * Two document-start scripts: the small app script (re-registered when settings change) and
     * the large settings engine, registered once per WebView. Both skip hidden frames.
     */
    private void installScript() {
        String js = "window.__CP_CFG=" + appliedConfig + ";\n" + scriptBody;
        String bx = null;
        if (useBetterXcloud()) {
            if (bxScript == null) {
                JSONObject flags = new JSONObject();
                try {
                    JSONObject device = new JSONObject();
                    device.put("deviceType", "unknown");
                    device.put("userAgent", webView.getSettings().getUserAgentString());
                    flags.put("CheckForUpdate", false); // bundled copy; updated with the app
                    flags.put("DeviceInfo", device);
                } catch (JSONException ignored) {
                }
                // Stop right away inside iframes: only the main page needs it.
                // ...and on standard Remote Play pages, which run as the plain Xbox website.
                bxScript = "\"use strict\";\nif (window.top !== window) throw 'skip-frame';\n"
                        + "if (window.__cpPureRemote) throw 'skip-remote-play';\n"
                        // The engine starts before the page has an <html> element; anything it
                        // adds to the root waits until the element exists.
                        + "function __cpAppendRoot(el) {\n"
                        + "  if (document.documentElement) return document.documentElement.appendChild(el);\n"
                        + "  new MutationObserver(function (m, o) {\n"
                        + "    if (document.documentElement) { o.disconnect(); document.documentElement.appendChild(el); }\n"
                        + "  }).observe(document, { childList: true });\n"
                        + "  return el;\n"
                        + "}\nwindow.BX_FLAGS="
                        + flags + ";\n" + readAsset("better-xcloud/better-xcloud.user.js")
                        + "\n;window.__bxMainOk = true;";
            }
            bx = bxScript;
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            java.util.Set<String> origins = Collections.singleton("https://*.xbox.com");
            // Order matters: the app script runs before the engine.
            if (scriptHandler != null) scriptHandler.remove();
            if (bxHandler != null) { bxHandler.remove(); bxHandler = null; }
            scriptHandler = WebViewCompat.addDocumentStartJavaScript(webView, js, origins);
            if (bx != null) bxHandler = WebViewCompat.addDocumentStartJavaScript(webView, bx, origins);
            fallbackScript = null;
            fallbackBx = null;
        } else {
            fallbackScript = js;
            fallbackBx = bx;
        }
    }

    private SharedPreferences prefs() {
        return PreferenceManager.getDefaultSharedPreferences(this);
    }

    private String startUrl() {
        String u = prefs().getString("start_url", DEFAULT_URL);
        if (u == null) return DEFAULT_URL;
        u = u.trim();
        if (!u.startsWith("https://") && !u.startsWith("http://")) return DEFAULT_URL;
        return u;
    }

    private String buildConfig() {
        SharedPreferences p = prefs();
        JSONObject o = new JSONObject();
        try {
            o.put("resolution", p.getString("resolution", "1080p"));
            o.put("codec", p.getString("codec", "auto"));
            o.put("maxBitrate", parseInt(p.getString("max_bitrate", "0")));
            o.put("region", p.getString("region", "auto"));
            o.put("videoFit", p.getString("video_fit", "contain"));
            o.put("showStats", p.getBoolean("show_stats", false));
            o.put("engine", p.getString("engine", "cloudplay"));
            JSONObject v = videoConfig();
            for (java.util.Iterator<String> it = v.keys(); it.hasNext(); ) {
                String k = it.next();
                o.put(k, v.get(k));
            }
            o.put("rumble", p.getString("rumble", "auto"));
            o.put("touchMode", p.getString("touch_mode", "auto"));
            o.put("touchOpacity", p.getInt("touch_opacity", 60));
            o.put("touchSize", p.getInt("touch_size", 100));
            o.put("touchLayout", p.getString("touch_layout", ""));
            o.put("controllerInput", p.getString("controller_input", "auto"));
            o.put("lowLatency", p.getBoolean("low_latency", false));
            o.put("clarityPreset", p.getString("clarity_preset", "off"));
            o.put("remotePlayMode", p.getString("remote_play_mode", "auto"));
            o.put("fastArt", p.getBoolean("fast_art", true));
            o.put("rpResolution", p.getString("rp_resolution", "auto"));
            o.put("rpSharpen", p.getString("rp_sharpen", "medium"));
            o.put("rpUpscaler", p.getString("rp_upscaler", "fsr"));
            o.put("rpBuffer", p.getString("rp_buffer", "slight"));
            o.put("rpColor", p.getString("rp_color", "off"));
            o.put("keepAlive", p.getBoolean("keep_alive", true));
            o.put("volume", p.getInt("volume", 100));
            o.put("latencyMode", p.getString("latency_mode", "balanced"));
            o.put("buttonLayout", p.getString("button_layout", "xbox"));
            o.put("deadzone", p.getInt("deadzone", 5));
            o.put("invertY", p.getBoolean("invert_y", false));
            o.put("rumbleStrength", p.getInt("rumble_strength", 100));
            JSONArray regions = new JSONArray();
            java.util.List<String> rl = new java.util.ArrayList<>(p.getStringSet(KEY_REGIONS, Collections.emptySet()));
            Collections.sort(rl);
            for (String r : rl) regions.put(r);
            o.put("regions", regions);
            o.put("bgAudio", p.getBoolean("bg_audio", false));
            o.put("startUrl", startUrl());
        } catch (JSONException ignored) {
        }
        return o.toString();
    }

    /** Clarity boost: a preset, or the custom sliders. */
    private JSONObject videoConfig() {
        SharedPreferences p = prefs();
        String preset = p.getString("clarity_preset", "off");
        String algo;
        int sharp, sat, con, bri;
        switch (preset) {
            case "low":    algo = "unsharp"; sharp = 3; sat = 100; con = 102; bri = 100; break;
            case "medium": algo = "unsharp"; sharp = 5; sat = 105; con = 105; bri = 100; break;
            case "high":   algo = "sharpen"; sharp = 7; sat = 108; con = 108; bri = 100; break;
            case "vivid":  algo = "unsharp"; sharp = 4; sat = 125; con = 110; bri = 102; break;
            case "custom":
                algo = p.getString("clarity_algo", "sharpen");
                sharp = p.getInt("sharpness", 0);
                sat = p.getInt("saturation", 100);
                con = p.getInt("contrast", 100);
                bri = p.getInt("brightness", 100);
                break;
            default:       algo = "sharpen"; sharp = 0; sat = 100; con = 100; bri = 100; break;
        }
        JSONObject o = new JSONObject();
        try {
            o.put("clarityAlgo", algo);
            o.put("sharpness", sharp);
            o.put("saturation", sat);
            o.put("contrast", con);
            o.put("brightness", bri);
        } catch (JSONException ignored) {
        }
        return o;
    }

    private static String engineOf(String cfg) {
        try {
            return new JSONObject(cfg).optString("engine", "");
        } catch (Exception e) {
            return "";
        }
    }

    /** Save a changed setting that the page can apply live, without reloading. */
    private void refreshScriptWithoutReload() {
        appliedConfig = buildConfig();
        installScript();
    }

    private String remotePlayUrl() {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("^(https://www\\.xbox\\.com/[a-zA-Z]{2}-[a-zA-Z]{2})/play")
                .matcher(startUrl());
        return (m.find() ? m.group(1) : "https://www.xbox.com/en-US") + "/play/consoles";
    }

    private static int parseInt(String s) {
        try {
            return Integer.parseInt(s);
        } catch (Exception e) {
            return 0;
        }
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            return "";
        }
    }

    private void clearData() {
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        WebStorage.getInstance().deleteAllData();
        webView.clearCache(true);
        webView.clearHistory();
        webView.loadUrl(startUrl());
    }

    /** Called from the page script. */
    private class NativeBridge {
        @JavascriptInterface
        public void setRegions(String json) {
            try {
                JSONArray a = new JSONArray(json);
                Set<String> s = new HashSet<>(prefs().getStringSet(KEY_REGIONS, Collections.emptySet()));
                for (int i = 0; i < a.length(); i++) s.add(a.getString(i));
                prefs().edit().putStringSet(KEY_REGIONS, s).apply();
            } catch (JSONException ignored) {
            }
        }

        @JavascriptInterface
        public void rumble(int durationMs, double strong, double weak) {
            rumbler.play(durationMs, strong, weak);
        }

        @JavascriptInterface
        public void setStreaming(boolean on) {
            streaming = on;
            runOnUiThread(MainActivity.this::updateGear);
        }

        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(() -> startActivity(new Intent(MainActivity.this, SettingsActivity.class)));
        }

        @JavascriptInterface
        public void setHeaderButton(boolean present) {
            headerButton = present;
            runOnUiThread(MainActivity.this::updateGear);
        }

        @JavascriptInterface
        public void setClarity(String preset) {
            runOnUiThread(() -> {
                prefs().edit().putString("clarity_preset", preset).apply();
                refreshScriptWithoutReload();
                if (webView != null) webView.evaluateJavascript(
                        "window.__cpSetVideo && __cpSetVideo(" + videoConfig() + ")", null);
            });
        }

        /** Save a setting from the in-page panel with its real type (s = text, i = number, b = on/off). */
        @JavascriptInterface
        public void setPrefTyped(String key, String value, String type) {
            runOnUiThread(() -> {
                SharedPreferences.Editor e = prefs().edit();
                if ("b".equals(type)) e.putBoolean(key, "true".equals(value));
                else if ("i".equals(type)) e.putInt(key, parseInt(value));
                else e.putString(key, value);
                e.apply();
                if ("keep_alive".equals(key)) updateKeepAlive();
                if (key.startsWith("rumble") || "wifi_low_latency".equals(key)) applyPerformance();
                if (webView != null) refreshScriptWithoutReload();
            });
        }

        /** Save a setting changed from the in-page panel (applies on the next page load). */
        @JavascriptInterface
        public void setPref(String key, String value) {
            runOnUiThread(() -> {
                SharedPreferences.Editor e = prefs().edit();
                if ("show_stats".equals(key)) e.putBoolean(key, "true".equals(value));
                else e.putString(key, value);
                e.apply();
                if (webView != null) refreshScriptWithoutReload();
            });
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> moveTaskToBack(true));
        }

        @JavascriptInterface
        public void nativeMenu() {
            runOnUiThread(MainActivity.this::showNativeMenu);
        }

        @JavascriptInterface
        public void openMenu() {
            runOnUiThread(MainActivity.this::showMenu);
        }

        @JavascriptInterface
        public int padVersion() {
            return gamepads.version();
        }

        @JavascriptInterface
        public String padState() {
            return gamepads.state();
        }

        @JavascriptInterface
        public void stopRumble() {
            rumbler.stop();
        }

        @JavascriptInterface
        public void saveTouchLayout(String json) {
            runOnUiThread(() -> {
                prefs().edit().putString("touch_layout", json).apply();
                if (webView != null) refreshScriptWithoutReload();
                Toast.makeText(MainActivity.this, "Touch layout saved", Toast.LENGTH_SHORT).show();
            });
        }
    }

    // ------------------------------------------------------------- lifecycle

    @Override
    protected void onResume() {
        super.onResume();
        SharedPreferences p = prefs();
        if (p.getBoolean(KEY_PENDING_CLEAR, false)) {
            p.edit().putBoolean(KEY_PENDING_CLEAR, false).apply();
            clearData();
        }

        String cfg = buildConfig();
        String url = startUrl();
        if (!cfg.equals(appliedConfig) || !url.equals(appliedUrl)) {
            // Apply in place: no reload, so a game or Remote Play session keeps running.
            // Picture, sound, controls and overlays change right away; stream quality is used
            // the next time a stream starts. Only switching engines needs a fresh page.
            boolean engineChanged = !engineOf(cfg).equals(engineOf(appliedConfig));
            appliedConfig = cfg;
            installScript();
            webView.evaluateJavascript("window.__cpApplyCfg&&__cpApplyCfg(" + cfg + ")", null);
            if (!url.equals(appliedUrl)) {
                appliedUrl = url; // the new start page is used next launch
            }
            if (engineChanged && !streaming) {
                webView.reload();
            }
        }

        applyPerformance();
        updateGear();
        InputManager im = (InputManager) getSystemService(Context.INPUT_SERVICE);
        if (im != null) im.registerInputDeviceListener(gamepads, handler);
        updateKeepAlive();
        enterImmersive();
    }

    // ------------------------------------------------------------ background

    private boolean keepAlive() {
        return prefs().getBoolean("keep_alive", true);
    }

    /** Start (while we're in the foreground, as Android requires) or stop the keep-alive service. */
    private void updateKeepAlive() {
        Intent svc = new Intent(this, KeepAliveService.class);
        if (keepAlive()) {
            try {
                androidx.core.content.ContextCompat.startForegroundService(this, svc);
            } catch (Exception ignored) {
            }
        } else {
            stopService(svc);
        }
    }

    private void askNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < 33 || !keepAlive()) return;
        if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        if (prefs().getBoolean("asked_notifications", false)) return;
        prefs().edit().putBoolean("asked_notifications", true).apply();
        requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 7);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && intent.getBooleanExtra(EXTRA_EXIT, false)) finishAndRemoveTask();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (webView != null) webView.evaluateJavascript("window.__cpBackground&&__cpBackground(false)", null);
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (webView != null && keepAlive()) {
            webView.evaluateJavascript("window.__cpBackground&&__cpBackground(true)", null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(showMenuRunnable);
        if (!keepAlive()) releaseWifiLock(); // keep the fast Wi-Fi while the game runs in the background
        rumbler.stop();
        modeLeft = true;
        if (modeRunnable != null) handler.removeCallbacks(modeRunnable);
        gamepads.releaseAll();
        pushPads(); // let the game see all buttons released
        InputManager im = (InputManager) getSystemService(Context.INPUT_SERVICE);
        if (im != null) im.unregisterInputDeviceListener(gamepads);
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        stopService(new Intent(this, KeepAliveService.class));
        releaseWifiLock();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    // ----------------------------------------------------------- performance

    private void applyPerformance() {
        SharedPreferences p = prefs();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            int modeId = 0;
            if (p.getBoolean("max_refresh", true)) {
                @SuppressWarnings("deprecation")
                Display d = getWindowManager().getDefaultDisplay();
                Display.Mode cur = d.getMode();
                Display.Mode best = cur;
                // Highest rate that's a multiple of 60 Hz (60/120/...), so 60 fps streams pace
                // evenly with no judder; otherwise simply the highest.
                Display.Mode best60 = null;
                for (Display.Mode m : d.getSupportedModes()) {
                    if (m.getPhysicalWidth() != cur.getPhysicalWidth()
                            || m.getPhysicalHeight() != cur.getPhysicalHeight()) continue;
                    if (m.getRefreshRate() > best.getRefreshRate()) best = m;
                    float r = m.getRefreshRate();
                    boolean mult60 = Math.abs(r / 60f - Math.round(r / 60f)) < 0.02f && r >= 59f;
                    if (mult60 && (best60 == null || r > best60.getRefreshRate())) best60 = m;
                }
                if (best60 != null) best = best60;
                modeId = best.getModeId();
            }
            if (lp.preferredDisplayModeId != modeId) {
                lp.preferredDisplayModeId = modeId;
                getWindow().setAttributes(lp);
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setPreferMinimalPostProcessing(true); // game-mode on external displays/TVs
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && pm.isSustainedPerformanceModeSupported()) {
                getWindow().setSustainedPerformanceMode(p.getBoolean("sustained_perf", false));
            }
        }

        rumbler.mode = p.getString("rumble", "auto");
        rumbler.strengthPct = p.getInt("rumble_strength", 100);

        if (p.getBoolean("wifi_low_latency", true)) acquireWifiLock();
        else releaseWifiLock();
    }

    @SuppressWarnings("deprecation")
    private void acquireWifiLock() {
        try {
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm == null) return;
                int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                wifiLock = wm.createWifiLock(mode, "CloudPlay");
                wifiLock.setReferenceCounted(false);
            }
            if (!wifiLock.isHeld()) wifiLock.acquire();
        } catch (Exception ignored) {
        }
    }

    private void releaseWifiLock() {
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception ignored) {
        }
    }

    // ------------------------------------------------------------- controls

    private static boolean isFromGamepad(KeyEvent e) {
        int src = e.getSource();
        return (src & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
                || (src & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    // Controller state is sent to the page the instant it changes (no waiting for the next
    // screen refresh), with only one update in flight at a time: anything that changes while
    // one is on its way is folded into the next. Fast, and a busy stick can't flood the page.
    private int pushedPadVersion = -1;
    private boolean padInFlight;

    private void pushPads() {
        if (padInFlight || webView == null) return;
        int v = gamepads.version();
        if (v == pushedPadVersion) return;
        pushedPadVersion = v;
        padInFlight = true;
        webView.evaluateJavascript("window.__cpPads&&__cpPads(" + v + "," + gamepads.state() + ")", r -> {
            padInFlight = false;
            if (gamepads.version() != pushedPadVersion) pushPads();
        });
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent e) {
        if (gamepads.onMotion(e)) pushPads();
        return super.dispatchGenericMotionEvent(e);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        boolean fromPad = isFromGamepad(e);

        // Xbox/Home button: many handhelds use it to leave the app too. Passing the press
        // straight on opened Xbox's Guide panel as you left, so it was still open when you came
        // back. Now it only reaches the page if the app is still in front when it's released
        // (a tap) or after a short hold.
        if (code == KeyEvent.KEYCODE_BUTTON_MODE && fromPad) {
            final InputDevice dev = e.getDevice();
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
                modeHeld = false;
                modeLeft = false;
                modeRunnable = () -> {
                    if (modeLeft || !hasWindowFocus()) return;
                    modeHeld = true;
                    gamepads.setButton(dev, 16, 1f);
                    pushPads();
                };
                handler.postDelayed(modeRunnable, 400);
            } else if (e.getAction() == KeyEvent.ACTION_UP) {
                if (modeRunnable != null) handler.removeCallbacks(modeRunnable);
                modeRunnable = null;
                if (modeHeld) {
                    gamepads.setButton(dev, 16, 0f);
                    pushPads();
                } else if (!modeLeft && hasWindowFocus()) {
                    gamepads.setButton(dev, 16, 1f);
                    pushPads();
                    handler.postDelayed(() -> { gamepads.setButton(dev, 16, 0f); pushPads(); }, 120);
                }
                modeHeld = false;
            }
            return true;
        }

        if (fromPad && gamepads.onKey(e)) pushPads();

        // Hold View/Select to open the CloudPlay menu.
        if (code == KeyEvent.KEYCODE_BUTTON_SELECT || (fromPad && code == KeyEvent.KEYCODE_BACK)) {
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
                handler.postDelayed(showMenuRunnable, MENU_HOLD_MS);
            } else if (e.getAction() == KeyEvent.ACTION_UP) {
                handler.removeCallbacks(showMenuRunnable);
            }
        }

        // Send every controller button straight to the game. Without this, Android turns an
        // unhandled B press into "Back", which would kick you out of the game.
        if (webView != null && fromPad
                && (KeyEvent.isGamepadButton(code) || code == KeyEvent.KEYCODE_BACK
                    || code == KeyEvent.KEYCODE_MENU)) {
            webView.dispatchKeyEvent(e);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private void showMenu() {
        if (isFinishing() || webView == null) return;
        webView.evaluateJavascript("window.__cpMenu ? (__cpMenu.toggle(), 'ok') : 'missing'", r -> {
            if (r == null || r.contains("missing")) showNativeMenu();
        });
    }

    private void showNativeMenu() {
        if (isFinishing() || (menu != null && menu.isShowing())) return;
        final boolean bx = useBetterXcloud();
        String preset = prefs().getString("clarity_preset", "off");
        String presetName = getResources().getStringArray(R.array.clarity_entries)[
                Math.max(0, java.util.Arrays.asList(getResources().getStringArray(R.array.clarity_values)).indexOf(preset))];
        if (presetName.startsWith("Custom")) presetName = "Custom";

        MenuPanel p = new MenuPanel(this)
                .title("Xbox", bx ? "Advanced engine" : "Basic engine")
                .add(R.drawable.ic_m_settings, "Settings",
                        () -> startActivity(new Intent(this, SettingsActivity.class)));
        if (bx) {
            p.add(R.drawable.ic_m_tune, "Advanced settings", () ->
                    webView.evaluateJavascript("window.__cpOpenBx ? __cpOpenBx() : 'missing'", r -> {
                        if (r == null || r.contains("missing")) {
                            Toast.makeText(this, "Sign in first, or open it from the in-game guide menu",
                                    Toast.LENGTH_LONG).show();
                        }
                    }));
        }
        p.section(R.drawable.ic_m_console, "Remote Play (my Xbox)", () -> webView.loadUrl(remotePlayUrl()))
         .add(R.drawable.ic_m_clarity, "Clarity boost", presetName, this::showClarityMenu)
         .add(R.drawable.ic_m_gamepad, "Show / hide touch controls",
                 () -> webView.evaluateJavascript("window.__cpTouch && __cpTouch.toggle()", null))
         .add(R.drawable.ic_m_edit, "Edit touch layout",
                 () -> webView.evaluateJavascript("window.__cpTouch && __cpTouch.edit()", null))
         .section(R.drawable.ic_m_refresh, "Reload", () -> webView.reload())
         .add(R.drawable.ic_m_back, "Go back a page", () -> { if (webView.canGoBack()) webView.goBack(); })
         .add(R.drawable.ic_m_home, "Home", () -> webView.loadUrl(startUrl()))
         .section(R.drawable.ic_m_exit, "Exit", () -> moveTaskToBack(true));
        menu = p.show(this::enterImmersive);
    }

    private void showClarityMenu() {
        final String[] names = getResources().getStringArray(R.array.clarity_entries);
        final String[] values = getResources().getStringArray(R.array.clarity_values);
        String cur = prefs().getString("clarity_preset", "off");
        MenuPanel p = new MenuPanel(this).title("Clarity boost", "Applies instantly");
        for (int i = 0; i < values.length; i++) {
            final String v = values[i];
            p.add(v.equals(cur) ? R.drawable.ic_m_check : R.drawable.ic_m_clarity,
                    names[i].replace(" (sliders below)", " (set in Settings)"),
                    v.equals(cur) ? "On" : null, () -> {
                        prefs().edit().putString("clarity_preset", v).apply();
                        refreshScriptWithoutReload();
                        webView.evaluateJavascript(
                                "window.__cpSetVideo && __cpSetVideo(" + videoConfig() + ")", null);
                    });
        }
        menu = p.show(this::enterImmersive);
    }

    // ------------------------------------------------------------ fullscreen

    private void enterImmersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersive();
    }
}
