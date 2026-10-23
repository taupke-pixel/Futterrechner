package de.stallultra.futterrechner;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

/**
 * Wecker für den Timer der Webseite: meldet sich auch bei ausgeschaltetem Bildschirm oder geschlossener App.
 * Die Webseite stellt ihn über FutterrechnerApp.alarmStellen(Endzeit) und löscht ihn über FutterrechnerApp.alarmLoeschen().
 */
public class TimerAlarm extends BroadcastReceiver {

    static final String KANAL = "timer_alarm";
    static final int MELDUNG = 4711;

    static void kanalAnlegen(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(KANAL) != null) return;
        NotificationChannel k = new NotificationChannel(KANAL, "Timer-Alarm", NotificationManager.IMPORTANCE_HIGH);
        k.setDescription("Meldet sich, wenn der Timer abgelaufen ist");
        k.setSound(ton(), new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        k.enableVibration(true);
        k.setVibrationPattern(new long[]{0, 600, 400, 600});
        k.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(k);
    }

    private static Uri ton() {
        Uri t = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        return t != null ? t : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
    }

    private static PendingIntent ausloeser(Context c) {
        return PendingIntent.getBroadcast(c, 0, new Intent(c, TimerAlarm.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent appOeffnen(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Wecker auf die Endzeit (Millisekunden seit 1970) stellen; ein vorheriger wird ersetzt. */
    static void stellen(Context c, long ende) {
        kanalAnlegen(c);
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ende, ausloeser(c));
        } else {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(ende, appOeffnen(c)), ausloeser(c));
        }
    }

    /** Wecker abbestellen und eine klingelnde Meldung beenden. */
    static void loeschen(Context c) {
        c.getSystemService(AlarmManager.class).cancel(ausloeser(c));
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(MELDUNG);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        kanalAnlegen(c);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, KANAL) : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("⏰ Zeit ist um!")
            .setContentText("Der Timer im Futterrechner ist abgelaufen. Tippen zum Öffnen.")
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(appOeffnen(c));
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_MAX).setSound(ton()).setVibrate(new long[]{0, 600, 400, 600});
        }
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT;   // Ton wiederholt sich, bis die Meldung angetippt oder weggewischt wird
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(MELDUNG, n);
    }
}
