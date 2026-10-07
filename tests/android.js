// Test der Android-App (Debug-Version „probe“) im Android-Emulator gegen den lokalen Firebase-Emulator.
// Voraussetzung: Android-Emulator läuft (tests\android.ps1 startet ihn), Firebase-Emulator läuft (über emulator.ps1).
// Die App wird über die Chrome-Fernsteuerung (CDP) bedient – nie gegen ein echtes Projekt.
const path = require("path");
const assert = require("assert");
const { execSync } = require("child_process");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const SDK = path.join(process.env.LOCALAPPDATA, "Android", "Sdk");
const ADB = `"${path.join(SDK, "platform-tools", "adb.exe")}"`;
const APK = path.join(__dirname, "..", "android", "app", "build", "outputs", "apk", "probe", "debug", "app-probe-debug.apk");
const PAKET = "de.stallultra.futterrechner.test";
const PORT = 5055;
const adb = cmd => execSync(`${ADB} ${cmd}`, { encoding: "utf8" }).trim();
const warte = ms => new Promise(r => setTimeout(r, ms));

// Kleine Fernsteuerung der App-WebView (Chrome DevTools Protocol, nur Runtime.evaluate)
async function verbinde() {
  for (let i = 0; i < 60; i++) {
    let pid = "";
    try { pid = adb(`shell pidof ${PAKET}`); } catch (e) {}
    const sockets = adb("shell cat /proc/net/unix").split("\n").map(l => l.trim().split(/\s+/).pop())
      .filter(n => n && pid && n === "@webview_devtools_remote_" + pid);
    if (sockets.length) {
      try { adb("forward --remove tcp:9223"); } catch (e) {}
      adb(`forward tcp:9223 localabstract:${sockets[0].slice(1)}`);
      try {
        const ziele = await (await fetch("http://127.0.0.1:9223/json", { signal: AbortSignal.timeout(5000) })).json();
        const ziel = ziele.find(z => z.type === "page" && z.webSocketDebuggerUrl && /localhost:\d+/.test(z.url || ""));
        if (ziel) return await seite(ziel.webSocketDebuggerUrl);
      } catch (e) {}
    }
    await warte(1000);
  }
  throw new Error("WebView der App nicht gefunden");
}

function seite(wsUrl) {
  return new Promise((ok, fehler) => {
    const ws = new WebSocket(wsUrl);
    let n = 0;
    const offen = new Map();
    ws.onmessage = m => { const d = JSON.parse(m.data); if (offen.has(d.id)) { offen.get(d.id)(d); offen.delete(d.id); } };
    ws.onerror = e => fehler(new Error("Verbindung zur App fehlgeschlagen"));
    const senden = (method, params) => new Promise(r => { const id = ++n; offen.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (fn, arg) => {
      const expr = `(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`;
      const d = await senden("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (d.result && d.result.exceptionDetails) throw new Error(d.result.exceptionDetails.exception ? d.result.exceptionDetails.exception.description : "Fehler in der Seite");
      return d.result && d.result.result ? d.result.result.value : undefined;
    };
    const page = {
      evaluate,
      waitForFunction: async (fn, arg, opt) => {
        const bis = Date.now() + ((opt && opt.timeout) || 30000);
        while (Date.now() < bis) {
          try { if (await evaluate(fn, arg)) return; } catch (e) {}
          await warte(500);
        }
        throw new Error("Zeit abgelaufen: " + fn.toString().slice(0, 80));
      },
      reload: () => evaluate(() => { setTimeout(() => location.reload(), 10); return true; })
    };
    ws.onopen = () => ok({ browser: { close: async () => ws.close() }, page });
  });
}
// Bildschirm-Elemente über die Android-Bedienungshilfe finden (Text → Position in Bildschirmpunkten)
function uiDump() {
  for (let i = 0; i < 6; i++) {
    try { adb("shell uiautomator dump /sdcard/ui.xml"); return adb("shell cat /sdcard/ui.xml"); }
    catch (e) { execSync("ping -n 3 127.0.0.1 > nul"); }   // Android ist gerade beschäftigt – kurz warten
  }
  throw new Error("Bildschirmliste nicht lesbar");
}
function knotenAlle(text) {
  const xml = uiDump();
  const ent = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const r = [];
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const tag = m[0];
    const t = ent((/ text="([^"]*)"/.exec(tag) || [])[1] || "") + " " + ent((/ content-desc="([^"]*)"/.exec(tag) || [])[1] || "");
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    if (b && t.includes(text)) r.push({ text: t.trim(), x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] });
  }
  return r;
}const knoten = text => knotenAlle(text)[0];
function bildschirm() { const m = /(\d+)x(\d+)/.exec(adb("shell wm size")); return { b: +m[1], h: +m[2] }; }
function statusleisteUnten() {
  const d = adb("shell dumpsys window windows");
  const m = /statusBars[^\n]*?frame=\[\d+,\d+\]\[\d+,(\d+)\]/.exec(d) || /StatusBar[\s\S]*?mFrame=\[\d+,\d+\]\[\d+,(\d+)\]/.exec(d);
  return m ? +m[1] : 0;
}
function bedienleisteOben() {
  const d = adb("shell dumpsys window windows");
  const m = /navigationBars[^\n]*?frame=\[\d+,(\d+)\]\[\d+,\d+\]/.exec(d);
  return m ? +m[1] : bildschirm().h;
}

async function main() {  const server = await starteServer(path.join(__dirname, ".."), PORT);
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n")[0]); }
  };
  // Handy-„localhost“ auf diesen PC umleiten (Webseite + Firebase-Emulator)
  for (const p of [PORT, 8080, 9099]) adb(`reverse tcp:${p} tcp:${p}`);
  adb(`install -r "${APK}"`);
  adb(`shell pm clear ${PAKET}`);
  const url = `http://localhost:${PORT}/?emulator=1`;
  adb(`shell am start -n ${PAKET}/de.stallultra.futterrechner.MainActivity --es testUrl "${url}"`);
  let { browser, page } = await verbinde();
  try {
    await pruefe("App startet, kennt sich als App (FutterrechnerApp im Kennzeichen)", async () => {
      await page.waitForFunction(() => typeof geraeteUid !== "undefined" && geraeteUid, null, { timeout: 60000 });
      assert(await page.evaluate(() => navigator.userAgent.includes("FutterrechnerApp")));
      assert.strictEqual(await page.evaluate(() => inApp), true);
    });

    let uid;
    await pruefe("Zugangsseite, nach Eintragen in einen Betrieb startet der Rechner", async () => {
      uid = await page.evaluate(() => geraeteUid);
      await page.waitForFunction(() => document.getElementById("accessBlock").style.display === "flex", null, { timeout: 30000 });
      await zugang.adminSchreiben("betriebe/APP", { name: "Hof App" });
      await zugang.geraetEintragenOeffentlich("APP", uid, "Emulator-Handy");
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#calc .category"), null, { timeout: 60000 });
    });

    await pruefe("Speichern landet in der Cloud", async () => {
      await page.evaluate(() => { data.kuehe.anz = 55; save(); });
      await page.evaluate(() => cloudSyncFertig());
      const r = await (await fetch("http://127.0.0.1:8080/v1/projects/demo-futterrechner/databases/(default)/documents/betriebe/APP/daten/futter",
        { headers: { Authorization: "Bearer owner" } })).json();
      assert.strictEqual(String(r.fields.inhalt.mapValue.fields.kuehe.mapValue.fields.anz.integerValue), "55");
    });

    await pruefe("App neu starten: Gerät bleibt freigeschaltet (eigener Speicher)", async () => {
      await browser.close().catch(() => {});
      adb(`shell am force-stop ${PAKET}`);
      adb(`shell am start -n ${PAKET}/de.stallultra.futterrechner.MainActivity --es testUrl "${url}"`);
      ({ browser, page } = await verbinde());
      await page.waitForFunction(() => document.querySelector("#calc .category"), null, { timeout: 60000 });
      assert.strictEqual(await page.evaluate(() => geraeteUid), uid);
      assert.strictEqual(await page.evaluate(() => data.kuehe.anz), 55);
    });

    await pruefe("Kopfzeile: „Betrieb & Geräte“ lässt sich antippen (nicht unter der Statusleiste)", async () => {
      await page.evaluate(() => { showTab("calc"); window.scrollTo(0, 0); return true; });
      let k = null;
      for (let i = 0; i < 10 && !k; i++) { await warte(1000); k = knoten("Betrieb & Geräte"); }
      assert(k, "Link nicht gefunden");
      const statusleiste = statusleisteUnten();
      assert(k.y1 >= statusleiste, `Link liegt unter der Statusleiste (y=${k.y1}, Statusleiste bis ${statusleiste})`);
      adb(`shell input tap ${Math.round((k.x1 + k.x2) / 2)} ${Math.round((k.y1 + k.y2) / 2)}`);
      await warte(1500);
      const ok = await page.evaluate(() => !document.getElementById("settings").classList.contains("hidden") &&
        document.getElementById("betrieb").getBoundingClientRect().top < window.innerHeight);
      assert(ok, "Tippen hat den Bereich Betrieb & Geräte nicht geöffnet");
      adb("shell screencap -p /sdcard/oben.png"); adb(`pull /sdcard/oben.png "${path.join(__dirname, ".tmp", "app-oben.png")}"`);
    });

    await pruefe("Unten: „Teilen“ (App weitergeben) liegt über der Bedienleiste und öffnet das Teilen-Menü", async () => {
      // Hinweisbalken des Firebase-Emulators (gibt es nur im Test) ausblenden
      await page.evaluate(() => { const s = document.createElement("style"); s.textContent = ".firebase-emulator-warning{display:none!important}"; document.head.appendChild(s);
        showTab("settings"); window.scrollTo(0, document.body.scrollHeight); return true; });
      await warte(1500);
      adb("shell screencap -p /sdcard/unten.png"); adb(`pull /sdcard/unten.png "${path.join(__dirname, ".tmp", "app-unten.png")}"`);
      const alle = knotenAlle("Teilen");
      assert(alle.length, "Teilen-Knopf nicht gefunden");
      const k = alle.sort((a, b) => b.y1 - a.y1)[0];
      const leiste = bedienleisteOben();
      assert(k.y2 <= leiste, `Teilen-Knopf unter der Bedienleiste (unten=${k.y2}, Bedienleiste ab ${leiste})`);
      adb(`shell input tap ${Math.round((k.x1 + k.x2) / 2)} ${Math.round((k.y1 + k.y2) / 2)}`);
      await warte(2500);
      const akt = adb("shell dumpsys activity activities").split("\n").filter(l => /topResumedActivity|mResumedActivity/.test(l)).join(" ");
      assert(/Chooser|ResolverActivity|intentresolver/i.test(akt), "Teilen-Menü nicht offen: " + akt);
      adb("shell input keyevent KEYCODE_BACK");
      await warte(1000);
    });

    await pruefe("„Backup erstellen“ öffnet die Android-Speichern-Auswahl", async () => {      adb("logcat -c");
      await page.evaluate(() => exportBackup());
      await warte(3000);
      const akt = adb("shell dumpsys activity activities").split("\n").filter(l => /topResumedActivity|mResumedActivity/.test(l)).join(" ");
      assert(/documentsui|DocumentsActivity/i.test(akt), "Dateiauswahl nicht offen: " + akt);
      adb("shell input keyevent KEYCODE_BACK");
      await warte(1000);
    });

    await pruefe("Einladung per futterrechner://einladung?code=… öffnet die App mit der Einladung", async () => {
      // Erst (bei geschlossener App) das Gerät aus dem Betrieb nehmen, damit die Einladung angezeigt wird
      await browser.close().catch(() => {});
      adb(`shell am force-stop ${PAKET}`);
      for (const p of [`betriebe/APP/geraete/${uid}`, `geraetezuordnung/${uid}`])
        await fetch(`http://127.0.0.1:8080/v1/projects/demo-futterrechner/databases/(default)/documents/${p}`, { method: "DELETE", headers: { Authorization: "Bearer owner" } });
      await zugang.adminSchreiben("einladungen/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk23456", { betriebId: "APP", betriebName: "Hof App", von: "x", art: "qr" });
      await fetch("http://127.0.0.1:8080/v1/projects/demo-futterrechner/databases/(default)/documents/einladungen/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk23456?updateMask.fieldPaths=erstellt", {
        method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { erstellt: { timestampValue: new Date().toISOString() } } })
      });
      await browser.close().catch(() => {});
      adb(`shell am force-stop ${PAKET}`);
      // Debug: testUrl als Startseite, die Einladung kommt über den Link dazu
      adb(`shell am start -a android.intent.action.VIEW -d "futterrechner://einladung?code=ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk23456" -n ${PAKET}/de.stallultra.futterrechner.MainActivity --es testUrl "${url}"`);
      ({ browser, page } = await verbinde());
      await page.waitForFunction(() => document.getElementById("einladung-inhalt") && document.getElementById("einladung-inhalt").textContent.includes("Hof App"), null, { timeout: 60000 });
      // In der App gibt es keinen Knopf „In der App öffnen“, sondern direkt „Diesem Betrieb beitreten“
      assert.strictEqual(await page.evaluate(() => document.getElementById("einladung-knopf").textContent.trim()), "Diesem Betrieb beitreten");
      await page.evaluate(() => { document.getElementById("einladung-knopf").click(); return true; });
      await page.waitForFunction(() => typeof betriebId !== "undefined" && betriebId === "APP" && document.querySelector("#calc .category"), null, { timeout: 60000 });
    });
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(fehler ? `\nAPP-TEST ROT (${fehler} Fehler)` : "\nAPP-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
