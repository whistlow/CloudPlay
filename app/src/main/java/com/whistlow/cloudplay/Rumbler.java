package com.whistlow.cloudplay;

import android.content.Context;
import android.os.Build;
import android.os.CombinedVibration;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.InputDevice;

/** Plays game rumble on connected controllers, falling back to the phone's motor. */
class Rumbler {

    private final Context ctx;
    volatile String mode = "auto";      // off | auto | controller | phone
    volatile int strengthPct = 100;

    Rumbler(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    void play(int ms, double strong, double weak) {
        if ("off".equals(mode)) return;
        ms = Math.max(1, Math.min(ms, 5000));
        double k = strengthPct / 100.0;
        strong = clamp(strong * k);
        weak = clamp(weak * k);
        if (strong <= 0.01 && weak <= 0.01) {
            stop();
            return;
        }
        boolean done = false;
        if (!"phone".equals(mode)) done = vibrateControllers(ms, strong, weak);
        if (!done && ("phone".equals(mode) || "auto".equals(mode))) {
            vibrate(phoneVibrator(), ms, Math.max(strong, weak));
        }
    }

    void stop() {
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice d = InputDevice.getDevice(id);
            if (d == null || !isGamepad(d)) continue;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                d.getVibratorManager().cancel();
            } else {
                cancel(legacyVibrator(d));
            }
        }
        cancel(phoneVibrator());
    }

    private boolean vibrateControllers(int ms, double strong, double weak) {
        boolean any = false;
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice d = InputDevice.getDevice(id);
            if (d == null || !isGamepad(d)) continue;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = d.getVibratorManager();
                int[] ids = vm.getVibratorIds();
                if (ids.length >= 2) {
                    // Xbox-style controllers: first motor is the heavy (left) one.
                    vm.vibrate(CombinedVibration.startParallel()
                            .addVibrator(ids[0], effect(ms, strong))
                            .addVibrator(ids[1], effect(ms, weak))
                            .combine());
                    any = true;
                } else if (ids.length == 1) {
                    vm.getVibrator(ids[0]).vibrate(effect(ms, Math.max(strong, weak)));
                    any = true;
                }
            } else {
                Vibrator v = legacyVibrator(d);
                if (v != null && v.hasVibrator()) {
                    vibrate(v, ms, Math.max(strong, weak));
                    any = true;
                }
            }
        }
        return any;
    }

    private static boolean isGamepad(InputDevice d) {
        int s = d.getSources();
        return (s & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
                || (s & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    @SuppressWarnings("deprecation")
    private static Vibrator legacyVibrator(InputDevice d) {
        return d.getVibrator();
    }

    @SuppressWarnings("deprecation")
    private Vibrator phoneVibrator() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return vm != null ? vm.getDefaultVibrator() : null;
        }
        return (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
    }

    private static VibrationEffect effect(int ms, double mag) {
        int amp = (int) Math.round(clamp(mag) * 255);
        return VibrationEffect.createWaveform(new long[]{ms}, new int[]{amp}, -1);
    }

    @SuppressWarnings("deprecation")
    private static void vibrate(Vibrator v, int ms, double mag) {
        if (v == null || !v.hasVibrator()) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(effect(ms, mag));
            } else {
                v.vibrate(ms);
            }
        } catch (Exception ignored) {
        }
    }

    private static void cancel(Vibrator v) {
        try {
            if (v != null) v.cancel();
        } catch (Exception ignored) {
        }
    }

    private static double clamp(double v) {
        return Math.max(0, Math.min(1, v));
    }
}
