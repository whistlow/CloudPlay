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
    private static final long MENU_HOLD_MS = 1000;

    private WebView webView;
    private android.widget.FrameLayout root;
    private android.widget.ImageButton gear;
    private volatile boolean streaming;
    private ScriptHandler scriptHandler;
    private String fallbackScript;
    private String scriptBody;
    private String bxScript;
    private Rumbler rumbler;
    private final GamepadBridge gamepads = new GamepadBridge();
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
        PreferenceManager.setDefaultValues(this, R.xml.preferences, false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        scriptBody = readAsset("cloudplay.js");
        rumbler = new Rumbler(this);

        createWebView(savedInstanceState);

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) s.setOffscreenPreRaster(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);     // reuse cached site files between launches
        s.setGeolocationEnabled(false);
        s.setSaveFormData(false);
        s.setSupportMultipleWindows(false); // keep sign-in popups in this view
        // Present as regular Chrome: drop the WebView markers from the UA string and brand list.
        s.setUserAgentString(s.getUserAgentString().replace("; wv", "").replace("Version/4.0 ", ""));
        applyChromeBrands(s);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new NativeBridge(), "CloudPlayNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (fallbackScript != null) view.evaluateJavascript(fallbackScript, null);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Renderer crashed or was killed for memory: rebuild instead of crashing the app.
                if (view == webView) {
                    if (root != null) root.removeAllViews();
                    view.destroy();
                    webView = null;
                    scriptHandler = null;
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
        return "betterxcloud".equals(prefs().getString("engine", "betterxcloud"));
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
                    new UserAgentMetadata.Builder(cur).setBrandVersionList(list).build());
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
        String mode = p.getString("settings_button", "auto");
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

    private void installScript() {
        String js = "window.__CP_CFG=" + appliedConfig + ";\n" + scriptBody;
        if (useBetterXcloud()) {
            if (bxScript == null) bxScript = readAsset("better-xcloud/better-xcloud.user.js");
            JSONObject flags = new JSONObject();
            try {
                JSONObject device = new JSONObject();
                device.put("deviceType", "unknown");
                device.put("userAgent", webView.getSettings().getUserAgentString());
                flags.put("CheckForUpdate", false); // bundled copy; updated with the app
                flags.put("DeviceInfo", device);
            } catch (JSONException ignored) {
            }
            js += "\n;window.BX_FLAGS=" + flags + ";\n" + bxScript;
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            if (scriptHandler != null) scriptHandler.remove();
            scriptHandler = WebViewCompat.addDocumentStartJavaScript(
                    webView, js, Collections.singleton("https://*.xbox.com"));
            fallbackScript = null;
        } else {
            fallbackScript = js;
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
            o.put("engine", p.getString("engine", "betterxcloud"));
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
            o.put("lowLatency", p.getBoolean("low_latency", true));
            o.put("clarityPreset", p.getString("clarity_preset", "off"));
            o.put("remotePlayMode", p.getString("remote_play_mode", "standard"));
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

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(MainActivity.this::finishAndRemoveTask);
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
            appliedConfig = cfg;
            installScript();
            if (!url.equals(appliedUrl)) {
                appliedUrl = url;
                webView.loadUrl(url);
            } else {
                webView.reload();
            }
            Toast.makeText(this, "Settings applied", Toast.LENGTH_SHORT).show();
        }

        applyPerformance();
        updateGear();
        InputManager im = (InputManager) getSystemService(Context.INPUT_SERVICE);
        if (im != null) im.registerInputDeviceListener(gamepads, handler);
        enterImmersive();
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(showMenuRunnable);
        releaseWifiLock();
        rumbler.stop();
        gamepads.releaseAll();
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
                for (Display.Mode m : d.getSupportedModes()) {
                    if (m.getPhysicalWidth() == cur.getPhysicalWidth()
                            && m.getPhysicalHeight() == cur.getPhysicalHeight()
                            && m.getRefreshRate() > best.getRefreshRate()) {
                        best = m;
                    }
                }
                modeId = best.getModeId();
            }
            if (lp.preferredDisplayModeId != modeId) {
                lp.preferredDisplayModeId = modeId;
                getWindow().setAttributes(lp);
            }
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

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent e) {
        gamepads.onMotion(e);
        return super.dispatchGenericMotionEvent(e);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        boolean fromPad = isFromGamepad(e);
        if (fromPad) gamepads.onKey(e);

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
         .section(R.drawable.ic_m_exit, "Exit", this::finishAndRemoveTask);
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
