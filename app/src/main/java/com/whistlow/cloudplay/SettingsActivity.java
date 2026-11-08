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
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    public static class SettingsFragment extends PreferenceFragmentCompat {

        @Override
        public void onCreatePreferences(Bundle savedInstanceState, String rootKey) {
            setPreferencesFromResource(R.xml.preferences, rootKey);
            setupRegions();
            setupActions();
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
