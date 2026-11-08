package com.whistlow.cloudplay;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/** Xbox guide-style side panel: dark, rounded, with a clear white focus ring for controllers. */
class MenuPanel {

    static final class Item {
        final int icon;
        final String label;
        final String detail;
        final Runnable action;
        final boolean section; // draws a divider above this item

        Item(int icon, String label, String detail, boolean section, Runnable action) {
            this.icon = icon;
            this.label = label;
            this.detail = detail;
            this.section = section;
            this.action = action;
        }
    }

    private final Activity act;
    private final List<Item> items = new ArrayList<>();
    private String title = "CloudPlay";
    private String subtitle;

    MenuPanel(Activity act) {
        this.act = act;
    }

    MenuPanel title(String t, String sub) {
        title = t;
        subtitle = sub;
        return this;
    }

    MenuPanel add(int icon, String label, Runnable action) {
        items.add(new Item(icon, label, null, false, action));
        return this;
    }

    MenuPanel add(int icon, String label, String detail, Runnable action) {
        items.add(new Item(icon, label, detail, false, action));
        return this;
    }

    MenuPanel section(int icon, String label, Runnable action) {
        items.add(new Item(icon, label, null, true, action));
        return this;
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                act.getResources().getDisplayMetrics()));
    }

    Dialog show(Runnable onDismiss) {
        Dialog d = new Dialog(act, R.style.CPPanel);

        LinearLayout panel = new LinearLayout(act);
        panel.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xF2161616);
        float r = dp(18);
        bg.setCornerRadii(new float[]{r, r, 0, 0, 0, 0, r, r});
        panel.setBackground(bg);
        panel.setPadding(dp(14), dp(20), dp(14), dp(14));

        // Header: logo + title + subtitle
        LinearLayout header = new LinearLayout(act);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(8), 0, dp(8), dp(14));
        ImageView logo = new ImageView(act);
        logo.setImageResource(R.drawable.ic_logo);
        header.addView(logo, new LinearLayout.LayoutParams(dp(36), dp(36)));
        LinearLayout titles = new LinearLayout(act);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(dp(12), 0, 0, 0);
        TextView t = new TextView(act);
        t.setText(title);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        titles.addView(t);
        if (subtitle != null) {
            TextView s = new TextView(act);
            s.setText(subtitle);
            s.setTextColor(0xFFA8A8A8);
            s.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            titles.addView(s);
        }
        header.addView(titles);
        panel.addView(header);

        LinearLayout list = new LinearLayout(act);
        list.setOrientation(LinearLayout.VERTICAL);
        View first = null;
        for (Item it : items) {
            if (it.section) {
                View div = new View(act);
                div.setBackgroundColor(0x1FFFFFFF);
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
                lp.setMargins(dp(10), dp(6), dp(10), dp(6));
                list.addView(div, lp);
            }
            View row = row(it, d);
            if (first == null) first = row;
            list.addView(row);
        }
        ScrollView scroll = new ScrollView(act);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.addView(list);
        panel.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        TextView hint = new TextView(act);
        hint.setText("Ⓐ Select    Ⓑ Close");
        hint.setTextColor(0xFF7A7A7A);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        hint.setPadding(dp(10), dp(10), 0, 0);
        panel.addView(hint);

        d.setContentView(panel);
        Window w = d.getWindow();
        if (w != null) {
            w.setGravity(Gravity.END | Gravity.FILL_VERTICAL);
            w.setLayout(Math.min(dp(380), act.getResources().getDisplayMetrics().widthPixels),
                    ViewGroup.LayoutParams.MATCH_PARENT);
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            w.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
        if (onDismiss != null) d.setOnDismissListener(x -> onDismiss.run());
        final View focus = first;
        d.setOnShowListener(x -> { if (focus != null) focus.requestFocus(); });
        d.show();
        return d;
    }

    private View row(Item it, Dialog d) {
        LinearLayout row = new LinearLayout(act);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(50));
        row.setPadding(dp(14), 0, dp(14), 0);
        row.setFocusable(true);
        row.setClickable(true);
        row.setBackground(rowBackground());

        ImageView icon = new ImageView(act);
        icon.setImageResource(it.icon);
        icon.setAlpha(0.92f);
        row.addView(icon, new LinearLayout.LayoutParams(dp(22), dp(22)));

        TextView label = new TextView(act);
        label.setText(it.label);
        label.setTextColor(Color.WHITE);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        label.setPadding(dp(16), 0, 0, 0);
        row.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        if (it.detail != null) {
            TextView detail = new TextView(act);
            detail.setText(it.detail);
            detail.setTextColor(0xFF16C60C);
            detail.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            row.addView(detail);
        }

        row.setOnClickListener(v -> {
            d.dismiss();
            if (it.action != null) it.action.run();
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(2), 0, dp(2));
        row.setLayoutParams(lp);
        return row;
    }

    private StateListDrawable rowBackground() {
        StateListDrawable s = new StateListDrawable();
        GradientDrawable focused = new GradientDrawable();
        focused.setColor(0x26FFFFFF);
        focused.setStroke(dp(2), Color.WHITE);
        focused.setCornerRadius(dp(10));
        GradientDrawable pressed = new GradientDrawable();
        pressed.setColor(0x33FFFFFF);
        pressed.setCornerRadius(dp(10));
        s.addState(new int[]{android.R.attr.state_pressed}, pressed);
        s.addState(new int[]{android.R.attr.state_focused}, focused);
        s.addState(new int[]{}, new ColorDrawable(Color.TRANSPARENT));
        return s;
    }
}
