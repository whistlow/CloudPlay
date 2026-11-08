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
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.preference.PreferenceManager;
import androidx.webkit.ScriptHandler;
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
    private ScriptHandler scriptHandler;
    private String fallbackScript;
    private String scriptBody;
    private String appliedConfig;
    private String appliedUrl;
    private WifiManager.WifiLock wifiLock;
    private AlertDialog menu;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable showMenuRunnable = this::showMenu;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PreferenceManager.setDefaultValues(this, R.xml.preferences, false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        scriptBody = readAsset("cloudplay.js");

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
        s.setSupportMultipleWindows(false); // keep sign-in popups in this view
        s.setUserAgentString(s.getUserAgentString().replace("; wv", ""));

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
                    ViewGroup parent = (ViewGroup) view.getParent();
                    if (parent != null) parent.removeView(view);
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

        setContentView(webView);
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

    private void installScript() {
        String js = "window.__CP_CFG=" + appliedConfig + ";\n" + scriptBody;
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
            o.put("sharpness", p.getInt("sharpness", 0));
            o.put("saturation", p.getInt("saturation", 100));
            o.put("contrast", p.getInt("contrast", 100));
            o.put("brightness", p.getInt("brightness", 100));
            o.put("showStats", p.getBoolean("show_stats", false));
        } catch (JSONException ignored) {
        }
        return o.toString();
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
        enterImmersive();
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(showMenuRunnable);
        releaseWifiLock();
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
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();

        // Hold View/Select to open the CloudPlay menu.
        if (code == KeyEvent.KEYCODE_BUTTON_SELECT) {
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
                handler.postDelayed(showMenuRunnable, MENU_HOLD_MS);
            } else if (e.getAction() == KeyEvent.ACTION_UP) {
                handler.removeCallbacks(showMenuRunnable);
            }
        }

        // Send every controller button straight to the game. Without this, Android turns an
        // unhandled B press into "Back", which would kick you out of the game.
        if (webView != null && isFromGamepad(e)
                && (KeyEvent.isGamepadButton(code) || code == KeyEvent.KEYCODE_BACK)) {
            webView.dispatchKeyEvent(e);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private void showMenu() {
        if (isFinishing() || (menu != null && menu.isShowing())) return;
        String[] items = {"Settings", "Reload", "Go back a page", "Home", "Exit"};
        menu = new AlertDialog.Builder(this)
                .setTitle("CloudPlay")
                .setItems(items, (d, which) -> {
                    switch (which) {
                        case 0:
                            startActivity(new Intent(this, SettingsActivity.class));
                            break;
                        case 1:
                            webView.reload();
                            break;
                        case 2:
                            if (webView.canGoBack()) webView.goBack();
                            break;
                        case 3:
                            webView.loadUrl(startUrl());
                            break;
                        case 4:
                            finishAndRemoveTask();
                            break;
                    }
                })
                .create();
        menu.setOnDismissListener(d -> enterImmersive());
        menu.show();
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
