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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        if (savedInstanceState == null) {
            getSupportFragmentManager().beginTransaction()
                    .replace(android.R.id.content, new SettingsFragment())
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

    public static class SettingsFragment extends PreferenceFragmentCompat {

        @Override
        public void onViewCreated(@androidx.annotation.NonNull android.view.View view, Bundle savedInstanceState) {
            super.onViewCreated(view, savedInstanceState);
            setDivider(null);
            // Keep settings in a readable centered column on wide landscape screens.
            androidx.recyclerview.widget.RecyclerView list = getListView();
            float density = getResources().getDisplayMetrics().density;
            int width = getResources().getDisplayMetrics().widthPixels;
            int column = Math.round(720 * density);
            int side = Math.max(Math.round(8 * density), (width - column) / 2);
            list.setPadding(side, Math.round(8 * density), side, Math.round(32 * density));
            list.setClipToPadding(false);
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
                applyEnabled(engine != null ? engine.getValue() : "betterxcloud", (String) v);
                return true;
            });
            applyEnabled(engine != null ? engine.getValue() : "betterxcloud",
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
                                    .replace(android.R.id.content, new SettingsFragment())
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
