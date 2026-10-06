package de.stallultra.futterrechner;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;

/**
 * Futterrechner als App: eine Hülle um die Webseite.
 * - Lädt die Seite von GitHub Pages (START_URL) → Updates kommen automatisch mit der Webseite.
 * - Eigener Speicher (getrennt vom Browser): die Gerätefreigabe bleibt erhalten, auch wenn der Browserverlauf gelöscht wird.
 * - Öffnet Einladungen (QR-Code / „In der App öffnen“) direkt.
 * - „Backup erstellen“ / „Backup laden“ funktionieren über die Android-Dateiauswahl.
 */
public class MainActivity extends Activity {

    private static final int DATEI_WAEHLEN = 1;
    private static final int DATEI_SPEICHERN = 2;

    private WebView webView;
    private String startHost;
    private ValueCallback<Uri[]> dateiRueckgabe;
    private byte[] zuSpeichern;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Nur Debug-Versionen: Fernsteuerung für automatische Tests erlauben
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        // Erkennungszeichen für die Webseite (dann zeigt sie z. B. keinen „In der App öffnen“-Knopf)
        s.setUserAgentString(s.getUserAgentString() + " FutterrechnerApp/" + BuildConfig.VERSION_NAME);
        // Ohne Netz (Stall): Seite aus dem Zwischenspeicher laden
        s.setCacheMode(hatNetz() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        CookieManager.getInstance().setAcceptCookie(true);

        webView.addJavascriptInterface(new Bruecke(), "FutterrechnerApp");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return externOeffnen(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.getSettings().setCacheMode(hatNetz() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
                // „Backup erstellen“ lädt eine Datei über einen blob-Link herunter. Das kann die WebView nicht selbst –
                // deshalb wird die Datei an die App übergeben und dort über die Android-Dateiauswahl gespeichert.
                view.evaluateJavascript(
                    "(function(){if(window.__appDownload)return;window.__appDownload=true;" +
                    "var orig=HTMLAnchorElement.prototype.click;" +
                    "HTMLAnchorElement.prototype.click=function(){" +
                    " if(this.download&&this.href&&this.href.indexOf('blob:')===0){var n=this.download;" +
                    "  fetch(this.href).then(function(r){return r.blob()}).then(function(b){var f=new FileReader();" +
                    "   f.onload=function(){FutterrechnerApp.speichern(n,String(f.result).split(',')[1]||'',b.type||'application/json')};" +
                    "   f.readAsDataURL(b)});return;}" +
                    " return orig.apply(this,arguments)};})();", null);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                // „Backup laden“
                if (dateiRueckgabe != null) dateiRueckgabe.onReceiveValue(null);
                dateiRueckgabe = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Backup-Datei wählen"), DATEI_WAEHLEN);
                } catch (ActivityNotFoundException e) {
                    dateiRueckgabe = null;
                    return false;
                }
                return true;
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(zielAdresse(getIntent()));
        }
    }

    /** Welche Seite laden? Normal die Startseite, bei einer Einladung die Startseite mit ?einladung=… */
    private String zielAdresse(Intent intent) {
        String start = BuildConfig.START_URL;
        // Nur in Debug-Versionen (nie in der verschickten APK): andere Startseite zum Testen, z. B. lokaler Emulator
        if (BuildConfig.DEBUG && intent != null && intent.getStringExtra("testUrl") != null) {
            start = intent.getStringExtra("testUrl");
            startHost = Uri.parse(start).getHost();
        }
        Uri daten = intent != null ? intent.getData() : null;
        if (daten == null) return start;
        String code = null;
        if ("futterrechner".equals(daten.getScheme())) {
            code = daten.getQueryParameter("code");
        } else if ("https".equals(daten.getScheme())) {
            code = daten.getQueryParameter("einladung");
        }
        if (code != null && code.matches("[A-Za-z0-9]{8,64}")) {
            return start + (start.contains("?") ? "&" : "?") + "einladung=" + code;
        }
        return start;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getData() != null) webView.loadUrl(zielAdresse(intent));
    }

    /** Links zu anderen Seiten (E-Mail, fremde Webseiten) im passenden Programm öffnen, die eigene Seite in der App. */
    private boolean externOeffnen(Uri uri) {
        String host = startHost != null ? startHost : Uri.parse(BuildConfig.START_URL).getHost();
        String schema = uri.getScheme();
        if (("https".equals(schema) || "http".equals(schema)) && host.equals(uri.getHost())) {
            return false; // eigene Seite: in der App bleiben
        }
        try {
            Intent i;
            if ("intent".equals(schema)) {
                i = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
            } else {
                i = new Intent(Intent.ACTION_VIEW, uri);
            }
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "Kann nicht geöffnet werden", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private boolean hatNetz() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return true;
        NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /** Wird aus der Webseite aufgerufen (window.FutterrechnerApp). */
    private class Bruecke {
        /** Text über das Android-Teilen-Menü verschicken (WhatsApp, SMS, E-Mail …). */
        @JavascriptInterface
        public void teilen(String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                startActivity(Intent.createChooser(i, "Teilen über"));
            });
        }

        @JavascriptInterface
        public void speichern(String dateiname, String base64, String typ) {
            runOnUiThread(() -> {
                try {
                    zuSpeichern = Base64.decode(base64, Base64.DEFAULT);
                } catch (IllegalArgumentException e) {
                    Toast.makeText(MainActivity.this, "Datei fehlerhaft", Toast.LENGTH_SHORT).show();
                    return;
                }
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(typ == null || typ.isEmpty() ? "application/json" : typ);
                i.putExtra(Intent.EXTRA_TITLE, dateiname == null || dateiname.isEmpty() ? "futterrechner-backup.json" : dateiname);
                startActivityForResult(i, DATEI_SPEICHERN);
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == DATEI_WAEHLEN) {
            Uri[] ergebnis = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) ergebnis = new Uri[]{data.getData()};
            if (dateiRueckgabe != null) dateiRueckgabe.onReceiveValue(ergebnis);
            dateiRueckgabe = null;
        } else if (requestCode == DATEI_SPEICHERN) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && zuSpeichern != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    out.write(zuSpeichern);
                    Toast.makeText(this, "Backup gespeichert", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "Speichern fehlgeschlagen", Toast.LENGTH_LONG).show();
                }
            }
            zuSpeichern = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Firestore schreibt beim Verstecken der Seite (visibilitychange) noch offene Änderungen
        CookieManager.getInstance().flush();
    }
}
