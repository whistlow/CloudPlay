package com.whistlow.cloudplay;

import android.hardware.input.InputManager;
import android.util.SparseArray;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;

import org.json.JSONObject;

/**
 * Reads connected controllers straight from Android and exposes them to the page in the
 * W3C "standard gamepad" layout. The page polls {@link #version()} / {@link #state()}, so
 * input reaches the stream without waiting on WebView's own gamepad support.
 */
class GamepadBridge implements InputManager.InputDeviceListener {

    private static final int MAX_PADS = 4;

    private static final class Pad {
        int slot;
        String id;
        final float[] b = new float[17];
        final float[] a = new float[4];
        long t;
        boolean rightStickZ;   // right stick on Z/RZ (Xbox-style) vs RX/RY
        boolean analogLt, analogRt, hat;
    }

    private final SparseArray<Pad> byDevice = new SparseArray<>();
    private final Pad[] slots = new Pad[MAX_PADS];
    private volatile int version;
    private int jsonVersion = -1;
    private String json = "[]";

    static boolean isGamepad(InputDevice d) {
        if (d == null) return false;
        int s = d.getSources();
        return (s & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
                || (s & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    int version() {
        return version;
    }

    synchronized String state() {
        if (jsonVersion == version) return json;
        StringBuilder sb = new StringBuilder(256).append('[');
        boolean first = true;
        for (Pad p : slots) {
            if (p == null) continue;
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"i\":").append(p.slot)
              .append(",\"id\":").append(JSONObject.quote(p.id))
              .append(",\"t\":").append(p.t)
              .append(",\"b\":[");
            for (int i = 0; i < p.b.length; i++) {
                if (i > 0) sb.append(',');
                sb.append(round(p.b[i]));
            }
            sb.append("],\"a\":[");
            for (int i = 0; i < 4; i++) {
                if (i > 0) sb.append(',');
                sb.append(round(p.a[i]));
            }
            sb.append("]}");
        }
        json = sb.append(']').toString();
        jsonVersion = version;
        return json;
    }

    private static String round(float v) {
        if (v == 0f) return "0";
        if (v == 1f) return "1";
        return String.valueOf(Math.round(v * 1000f) / 1000f);
    }

    private Pad pad(InputDevice d) {
        Pad p = byDevice.get(d.getId());
        if (p != null) return p;
        int slot = -1;
        for (int i = 0; i < MAX_PADS; i++) if (slots[i] == null) { slot = i; break; }
        if (slot < 0) return null;
        p = new Pad();
        p.slot = slot;
        p.id = String.format("%s (STANDARD GAMEPAD Vendor: %04x Product: %04x)",
                d.getName(), d.getVendorId(), d.getProductId());
        p.rightStickZ = d.getMotionRange(MotionEvent.AXIS_RZ) != null
                || d.getMotionRange(MotionEvent.AXIS_RX) == null;
        p.analogLt = d.getMotionRange(MotionEvent.AXIS_LTRIGGER) != null
                || d.getMotionRange(MotionEvent.AXIS_BRAKE) != null;
        p.analogRt = d.getMotionRange(MotionEvent.AXIS_RTRIGGER) != null
                || d.getMotionRange(MotionEvent.AXIS_GAS) != null;
        p.hat = d.getMotionRange(MotionEvent.AXIS_HAT_X) != null;
        byDevice.put(d.getId(), p);
        slots[slot] = p;
        return p;
    }

    private void changed(Pad p) {
        p.t++;
        version++;
    }

    private static int buttonIndex(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: return 0;
            case KeyEvent.KEYCODE_BUTTON_B: return 1;
            case KeyEvent.KEYCODE_BUTTON_X: return 2;
            case KeyEvent.KEYCODE_BUTTON_Y: return 3;
            case KeyEvent.KEYCODE_BUTTON_L1: return 4;
            case KeyEvent.KEYCODE_BUTTON_R1: return 5;
            case KeyEvent.KEYCODE_BUTTON_L2: return 6;
            case KeyEvent.KEYCODE_BUTTON_R2: return 7;
            case KeyEvent.KEYCODE_BUTTON_SELECT:
            case KeyEvent.KEYCODE_BACK: return 8;
            case KeyEvent.KEYCODE_BUTTON_START:
            case KeyEvent.KEYCODE_MENU: return 9;
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 10;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 11;
            case KeyEvent.KEYCODE_DPAD_UP: return 12;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 13;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 14;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 15;
            case KeyEvent.KEYCODE_BUTTON_MODE: return 16;
            default: return -1;
        }
    }

    /** @return true if the event came from a controller and was recorded. */
    synchronized boolean onKey(KeyEvent e) {
        InputDevice d = e.getDevice();
        if (!isGamepad(d)) return false;
        int idx = buttonIndex(e.getKeyCode());
        if (idx < 0) return false;
        if (e.getAction() != KeyEvent.ACTION_DOWN && e.getAction() != KeyEvent.ACTION_UP) return false;
        Pad p = pad(d);
        if (p == null) return false;
        // Analog triggers report through axes; ignore their digital duplicates.
        if ((idx == 6 && p.analogLt) || (idx == 7 && p.analogRt)) return true;
        if ((idx >= 12 && idx <= 15) && p.hat) return true;
        float v = e.getAction() == KeyEvent.ACTION_DOWN ? 1f : 0f;
        if (p.b[idx] != v) {
            p.b[idx] = v;
            changed(p);
        }
        return true;
    }

    synchronized boolean onMotion(MotionEvent e) {
        if ((e.getSource() & InputDevice.SOURCE_JOYSTICK) != InputDevice.SOURCE_JOYSTICK
                || e.getAction() != MotionEvent.ACTION_MOVE) return false;
        InputDevice d = e.getDevice();
        if (!isGamepad(d)) return false;
        Pad p = pad(d);
        if (p == null) return false;

        boolean dirty = false;
        dirty |= set(p.a, 0, axis(e, d, MotionEvent.AXIS_X));
        dirty |= set(p.a, 1, axis(e, d, MotionEvent.AXIS_Y));
        dirty |= set(p.a, 2, axis(e, d, p.rightStickZ ? MotionEvent.AXIS_Z : MotionEvent.AXIS_RX));
        dirty |= set(p.a, 3, axis(e, d, p.rightStickZ ? MotionEvent.AXIS_RZ : MotionEvent.AXIS_RY));
        if (p.analogLt) {
            dirty |= set(p.b, 6, Math.max(e.getAxisValue(MotionEvent.AXIS_LTRIGGER), e.getAxisValue(MotionEvent.AXIS_BRAKE)));
        }
        if (p.analogRt) {
            dirty |= set(p.b, 7, Math.max(e.getAxisValue(MotionEvent.AXIS_RTRIGGER), e.getAxisValue(MotionEvent.AXIS_GAS)));
        }
        if (p.hat) {
            float hx = e.getAxisValue(MotionEvent.AXIS_HAT_X), hy = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
            dirty |= set(p.b, 12, hy < -0.5f ? 1 : 0);
            dirty |= set(p.b, 13, hy > 0.5f ? 1 : 0);
            dirty |= set(p.b, 14, hx < -0.5f ? 1 : 0);
            dirty |= set(p.b, 15, hx > 0.5f ? 1 : 0);
        }
        if (dirty) changed(p);
        return true;
    }

    private static float axis(MotionEvent e, InputDevice d, int axis) {
        InputDevice.MotionRange r = d.getMotionRange(axis, e.getSource());
        if (r == null) return 0f;
        float v = e.getAxisValue(axis);
        float flat = Math.max(r.getFlat(), 0.05f);
        return Math.abs(v) <= flat ? 0f : Math.max(-1f, Math.min(1f, v));
    }

    private static boolean set(float[] arr, int i, float v) {
        v = Math.max(-1f, Math.min(1f, v));
        if (arr[i] == v) return false;
        arr[i] = v;
        return true;
    }

    /** Release everything (e.g. when the app goes to the background). */
    synchronized void releaseAll() {
        for (Pad p : slots) {
            if (p == null) continue;
            java.util.Arrays.fill(p.b, 0f);
            java.util.Arrays.fill(p.a, 0f);
            changed(p);
        }
    }

    @Override
    public void onInputDeviceAdded(int deviceId) {
    }

    @Override
    public synchronized void onInputDeviceRemoved(int deviceId) {
        Pad p = byDevice.get(deviceId);
        if (p == null) return;
        byDevice.remove(deviceId);
        slots[p.slot] = null;
        version++;
    }

    @Override
    public synchronized void onInputDeviceChanged(int deviceId) {
    }
}
