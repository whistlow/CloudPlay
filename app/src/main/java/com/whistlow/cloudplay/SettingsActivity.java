package com.whistlow.cloudplay;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.preference.ListPreference;
import androidx.preference.Preference;
import androidx.preference.PreferenceFragmentCompat;
import androidx.preference.PreferenceManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class SettingsActivity extends AppCompatActivity {

    static final int CONTAINER_ID = 0x7f0c0f01;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        float d = getResources().getDisplayMetrics().density;

        // Blur whatever is behind (the Xbox page) where the device supports it: liquid glass.
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_BLUR_BEHIND);
            android.view.WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.setBlurBehindRadius(Math.round(40 * d));
            getWindow().setAttributes(lp);
        }

        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(0x59000000);
        root.setOnClickListener(v -> finish());

        android.widget.LinearLayout panel = new android.widget.LinearLayout(this);
        panel.setOrientation(android.widget.LinearLayout.VERTICAL);
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TL_BR,
                new int[]{0xD9393C5C, 0xCC2C2E48});
        bg.setCornerRadius(18 * d);
        bg.setStroke(Math.round(d), 0x33FFFFFF);
        panel.setBackground(bg);
        panel.setClickable(true); // don't close when tapping inside
        panel.setElevation(24 * d);
        panel.setPadding(Math.round(28 * d), Math.round(20 * d), Math.round(28 * d), Math.round(6 * d));

        android.widget.LinearLayout head = new android.widget.LinearLayout(this);
        head.setGravity(android.view.Gravity.CENTER_VERTICAL);
        android.widget.TextView title = new android.widget.TextView(this);
        title.setText("Settings");
        title.setTextColor(0xFFFFFFFF);
        title.setTextSize(22);
        title.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        head.addView(title, new android.widget.LinearLayout.LayoutParams(0, -2, 1f));
        android.widget.TextView close = new android.widget.TextView(this);
        close.setText("\u2715");
        close.setTextColor(0xFFFFFFFF);
        close.setTextSize(20);
        close.setGravity(android.view.Gravity.CENTER);
        close.setOnClickListener(v -> finish());
        head.addView(close, new android.widget.LinearLayout.LayoutParams(Math.round(44 * d), Math.round(44 * d)));
        panel.addView(head);

        android.widget.FrameLayout container = new android.widget.FrameLayout(this);
        container.setId(CONTAINER_ID);
        panel.addView(container, new android.widget.LinearLayout.LayoutParams(-1, 0, 1f));

        android.util.DisplayMetrics m = getResources().getDisplayMetrics();
        android.widget.FrameLayout.LayoutParams plp = new android.widget.FrameLayout.LayoutParams(
                Math.min(m.widthPixels - Math.round(32 * d), Math.round(1100 * d)),
                m.heightPixels - Math.round(40 * d), android.view.Gravity.CENTER);
        root.addView(panel, plp);
        setContentView(root);

        if (savedInstanceState == null) {
            getSupportFragmentManager().beginTransaction()
                    .replace(CONTAINER_ID, new SettingsFragment())
                    .commit();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                    android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    /** Draws each settings section as a rounded card under its green header, Xbox-style. */
    static class CardDecoration extends androidx.recyclerview.widget.RecyclerView.ItemDecoration {
        private final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        private final android.graphics.Paint stroke = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        private final float radius, gap;

        CardDecoration(float density) {
            paint.setColor(0x14FFFFFF);
            stroke.setColor(0x1FFFFFFF);
            stroke.setStyle(android.graphics.Paint.Style.STROKE);
            stroke.setStrokeWidth(density);
            radius = 14 * density;
            gap = 14 * density;
        }

        private static boolean isHeader(androidx.recyclerview.widget.RecyclerView parent, android.view.View v) {
            int pos = parent.getChildAdapterPosition(v);
            androidx.recyclerview.widget.RecyclerView.Adapter<?> a = parent.getAdapter();
            if (pos < 0 || !(a instanceof androidx.preference.PreferenceGroupAdapter)) return false;
            return ((androidx.preference.PreferenceGroupAdapter) a).getItem(pos)
                    instanceof androidx.preference.PreferenceCategory;
        }

        @Override
        public void getItemOffsets(@androidx.annotation.NonNull android.graphics.Rect out,
                                   @androidx.annotation.NonNull android.view.View v,
                                   @androidx.annotation.NonNull androidx.recyclerview.widget.RecyclerView parent,
                                   @androidx.annotation.NonNull androidx.recyclerview.widget.RecyclerView.State state) {
            if (isHeader(parent, v) && parent.getChildAdapterPosition(v) > 0) out.top = (int) gap;
        }

        @Override
        public void onDraw(@androidx.annotation.NonNull android.graphics.Canvas c,
                           @androidx.annotation.NonNull androidx.recyclerview.widget.RecyclerView parent,
                           @androidx.annotation.NonNull androidx.recyclerview.widget.RecyclerView.State state) {
            float left = parent.getPaddingLeft(), right = parent.getWidth() - parent.getPaddingRight();
            float top = -1, bottom = -1;
            for (int i = 0; i < parent.getChildCount(); i++) {
                android.view.View v = parent.getChildAt(i);
                if (v.getVisibility() != android.view.View.VISIBLE || v.getHeight() == 0) continue;
                if (isHeader(parent, v)) {
                    if (top >= 0) draw(c, left, top, right, bottom);
                    top = -1;
                    continue;
                }
                if (top < 0) top = v.getTop() + v.getTranslationY();
                bottom = v.getBottom() + v.getTranslationY();
            }
            if (top >= 0) draw(c, left, top, right, bottom);
        }

        private void draw(android.graphics.Canvas c, float l, float t, float r, float b) {
            android.graphics.RectF rect = new android.graphics.RectF(l, t, r, b);
            c.drawRoundRect(rect, radius, radius, paint);
            c.drawRoundRect(rect, radius, radius, stroke);
        }
    }

    public static class SettingsFragment extends PreferenceFragmentCompat {

        @Override
        public void onViewCreated(@androidx.annotation.NonNull android.view.View view, Bundle savedInstanceState) {
            super.onViewCreated(view, savedInstanceState);
            setDivider(null);
            // Keep settings in a readable centered column on wide landscape screens.
            androidx.recyclerview.widget.RecyclerView list = getListView();
            float density = getResources().getDisplayMetrics().density;
            int width = getResources().getDisplayMetrics().widthPixels;
            int column = Math.round(900 * density);
            int side = Math.max(Math.round(8 * density), (width - column) / 2);
            list.setPadding(side, Math.round(8 * density), side, Math.round(32 * density));
            list.setClipToPadding(false);
            list.addItemDecoration(new CardDecoration(density));
        }

        @Override
        public void onCreatePreferences(Bundle savedInstanceState, String rootKey) {
            setPreferencesFromResource(R.xml.preferences, rootKey);
            setupRegions();
            setupActions();
            setupDependencies();
        }

        /** Grey out settings that the current engine or clarity preset doesn't use. */
        private void setupDependencies() {
            ListPreference engine = findPreference("engine");
            ListPreference preset = findPreference("clarity_preset");
            if (engine != null) engine.setOnPreferenceChangeListener((p, v) -> {
                applyEnabled((String) v, preset != null ? preset.getValue() : "off");
                return true;
            });
            if (preset != null) preset.setOnPreferenceChangeListener((p, v) -> {
                applyEnabled(engine != null ? engine.getValue() : "cloudplay", (String) v);
                return true;
            });
            applyEnabled(engine != null ? engine.getValue() : "cloudplay",
                    preset != null ? preset.getValue() : "off");
        }

        private void applyEnabled(String engine, String preset) {
            boolean cp = "cloudplay".equals(engine);
            // Quality settings work with both engines; only fit and stats are Basic-engine only
            // (the Advanced engine has its own in the in-game Settings).
            String note = "With the Advanced engine, change this in the in-game Settings";
            ListPreference fit = findPreference("video_fit");
            if (fit != null) {
                fit.setEnabled(cp);
                if (cp) {
                    fit.setSummaryProvider(ListPreference.SimpleSummaryProvider.getInstance());
                } else {
                    fit.setSummaryProvider(null);
                    fit.setSummary(note);
                }
            }
            Preference stats = findPreference("show_stats");
            if (stats != null) {
                stats.setEnabled(cp);
                stats.setSummary(cp ? "Resolution, FPS, ping, bitrate, packet loss and decode time" : note);
            }
            Preference info = findPreference("bx_info");
            if (info != null) info.setVisible(!cp);
            boolean custom = "custom".equals(preset);
            for (String k : new String[]{"clarity_algo", "sharpness", "saturation", "contrast", "brightness"}) {
                Preference p = findPreference(k);
                if (p != null) p.setEnabled(custom);
            }
        }

        private void setupRegions() {
            ListPreference region = findPreference("region");
            if (region == null) return;
            SharedPreferences sp = PreferenceManager.getDefaultSharedPreferences(requireContext());
            List<String> names = new ArrayList<>(sp.getStringSet(MainActivity.KEY_REGIONS, Collections.emptySet()));
            Collections.sort(names);

            List<String> entries = new ArrayList<>();
            List<String> values = new ArrayList<>();
            entries.add("Auto (Xbox picks the closest)");
            values.add("auto");
            for (String n : names) {
                entries.add(n);
                values.add(n);
            }
            region.setEntries(entries.toArray(new CharSequence[0]));
            region.setEntryValues(values.toArray(new CharSequence[0]));

            if (names.isEmpty()) {
                region.setSummaryProvider(null);
                region.setSummary("Auto. Sign in and open the play page once to load the server list.");
            } else {
                region.setSummaryProvider(ListPreference.SimpleSummaryProvider.getInstance());
            }
        }

        private void setupActions() {
            Preference reset = findPreference("reset");
            if (reset != null) reset.setOnPreferenceClickListener(p -> {
                new AlertDialog.Builder(requireContext())
                        .setTitle("Reset all settings?")
                        .setPositiveButton("Reset", (d, w) -> {
                            Context ctx = requireContext();
                            SharedPreferences sp = PreferenceManager.getDefaultSharedPreferences(ctx);
                            Set<String> regions = new HashSet<>(sp.getStringSet(MainActivity.KEY_REGIONS, Collections.emptySet()));
                            sp.edit().clear().putStringSet(MainActivity.KEY_REGIONS, regions).commit();
                            PreferenceManager.setDefaultValues(ctx, R.xml.preferences, true);
                            getParentFragmentManager().beginTransaction()
                                    .replace(CONTAINER_ID, new SettingsFragment())
                                    .commit();
                        })
                        .setNegativeButton("Cancel", null)
                        .show();
                return true;
            });

            Preference licenses = findPreference("licenses");
            if (licenses != null) licenses.setOnPreferenceClickListener(p -> {
                String text;
                try (java.io.InputStream in = requireContext().getAssets().open("better-xcloud/LICENSE")) {
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    text = out.toString("UTF-8");
                } catch (java.io.IOException e) {
                    text = "MIT License";
                }
                new AlertDialog.Builder(requireContext())
                        .setTitle("Open-source licenses")
                        .setMessage(text)
                        .setPositiveButton("OK", null)
                        .show();
                return true;
            });

            Preference crash = findPreference("last_crash_view");
            if (crash != null) {
                final String report = PreferenceManager.getDefaultSharedPreferences(requireContext())
                        .getString("last_crash", null);
                if (report != null) {
                    crash.setSummary("Tap to view and copy (send it to whoever helps you fix it)");
                    crash.setOnPreferenceClickListener(p -> {
                        new AlertDialog.Builder(requireContext())
                                .setTitle("Last crash report")
                                .setMessage(report)
                                .setPositiveButton("Copy", (d, w) -> {
                                    android.content.ClipboardManager cm = (android.content.ClipboardManager)
                                            requireContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                                    if (cm != null) cm.setPrimaryClip(android.content.ClipData.newPlainText("crash", report));
                                })
                                .setNeutralButton("Clear", (d, w) -> {
                                    PreferenceManager.getDefaultSharedPreferences(requireContext())
                                            .edit().remove("last_crash").apply();
                                    crash.setSummary("No crashes recorded");
                                    crash.setOnPreferenceClickListener(null);
                                })
                                .setNegativeButton("Close", null)
                                .show();
                        return true;
                    });
                }
            }

            Preference touchReset = findPreference("touch_reset");
            if (touchReset != null) touchReset.setOnPreferenceClickListener(p -> {
                PreferenceManager.getDefaultSharedPreferences(requireContext())
                        .edit().remove("touch_layout").apply();
                Toast.makeText(requireContext(), "Touch layout reset", Toast.LENGTH_SHORT).show();
                return true;
            });

            Preference clear = findPreference("clear_data");
            if (clear != null) clear.setOnPreferenceClickListener(p -> {
                new AlertDialog.Builder(requireContext())
                        .setTitle("Sign out and clear data?")
                        .setMessage("You'll need to sign in to Xbox again.")
                        .setPositiveButton("Clear", (d, w) -> {
                            PreferenceManager.getDefaultSharedPreferences(requireContext())
                                    .edit().putBoolean(MainActivity.KEY_PENDING_CLEAR, true).commit();
                            Toast.makeText(requireContext(), "Signed out", Toast.LENGTH_SHORT).show();
                            requireActivity().finish();
                        })
                        .setNegativeButton("Cancel", null)
                        .show();
                return true;
            });
        }
    }
}
