// Test App-Update 1.2 → 1.3 und Timer-Alarm bei ausgeschaltetem Bildschirm (Android-Emulator, Debug-Version „probe“).
// Voraussetzung: Android-Emulator läuft, Firebase-Emulator läuft (über emulator.ps1). Nie gegen ein echtes Projekt.
// ALT = alte App (1.2), NEU = neue App (1.3). Bilder nach tests/.tmp/app-*.png
const path = require("path");
const assert = require("assert");
const { execSync } = require("child_process");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const SDK = path.join(process.env.LOCALAPPDATA, "Android", "Sdk");
const ADB = `"${path.join(SDK, "platform-tools", "adb.exe")}"`;
const ALT = process.env.ALT || path.join(__dirname, ".tmp", "app-alt-1.2-probe-debug.apk");
const NEU = process.env.NEU || path.join(__dirname, "..", "android", "app", "build", "outputs", "apk", "probe", "debug", "app-probe-debug.apk");
const PAKET = "de.stallultra.futterrechner.test";
const PORT = 5055;
const adb = cmd => execSync(`${ADB} ${cmd}`, { encoding: "utf8" }).trim();
const warte = ms => new Promise(r => setTimeout(r, ms));
const bild = name => { adb("shell screencap -p /sdcard/b.png"); adb(`pull /sdcard/b.png "${path.join(__dirname, ".tmp", name)}"`); };

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
    ws.onerror = () => fehler(new Error("Verbindung zur App fehlgeschlagen"));
    const senden = (method, params) => new Promise(r => { const id = ++n; offen.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (fn, arg) => {
      const expr = `(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`;
      const d = await senden("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if (d.result && d.result.exceptionDetails) throw new Error(d.result.exceptionDetails.exception ? d.result.exceptionDetails.exception.description : "Fehler in der Seite");
      return d.result && d.result.result ? d.result.result.value : undefined;
    };
    const page = {
      evaluate,
      waitForFunction: async (fn, arg, opt) => {
        const bis = Date.now() + ((opt && opt.timeout) || 30000);
        while (Date.now() < bis) { try { if (await evaluate(fn, arg)) return; } catch (e) {} await warte(500); }
        throw new Error("Zeit abgelaufen: " + fn.toString().slice(0, 80));
      },
      reload: () => evaluate(() => { setTimeout(() => location.reload(), 10); return true; })
    };
    ws.onopen = () => ok({ browser: { close: async () => ws.close() }, page });
  });
}
function knoten(text) {
  for (let i = 0; i < 6; i++) {
    try {
      adb("shell uiautomator dump /sdcard/ui.xml");
      const xml = adb("shell cat /sdcard/ui.xml");
      for (const m of xml.matchAll(/<node [^>]*>/g)) {
        const t = ((/ text="([^"]*)"/.exec(m[0]) || [])[1] || "");
        const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(m[0]);
        if (b && t.toLowerCase() === text.toLowerCase()) return { x: Math.round((+b[1] + +b[3]) / 2), y: Math.round((+b[2] + +b[4]) / 2) };
      }
      return null;
    } catch (e) { execSync("ping -n 3 127.0.0.1 > nul"); }
  }
  return null;
}
const meldungDa = () => /Zeit ist um/.test(adb("shell dumpsys notification --noredact"));
// nur wirklich wartende Wecker zählen (Zeilen „Alarm{… Paket}“), nicht die Statistik darunter
const weckerGestellt = () => adb("shell dumpsys alarm").split("\n").some(l => l.includes("Alarm{") && l.includes(PAKET + "}"));
// Ist der Emulator überlastet, legt Android „System UI isn't responding“ darüber – dann „Wait“ tippen
function haengerWeg() { const w = knoten("Wait") || knoten("Warten"); if (w) { adb(`shell input tap ${w.x} ${w.y}`); return true; } return false; }

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n")[0]); }
  };
  for (const p of [PORT, 8080, 9099]) adb(`reverse tcp:${p} tcp:${p}`);
  try { adb(`uninstall ${PAKET}`); } catch (e) {}
  adb(`install "${ALT}"`);
  const url = `http://localhost:${PORT}/?emulator=1`;
  const starten = () => adb(`shell am start -n ${PAKET}/de.stallultra.futterrechner.MainActivity --es testUrl "${url}"`);
  adb("shell input keyevent KEYCODE_WAKEUP"); adb("shell wm dismiss-keyguard");
  starten();
  let { browser, page } = await verbinde();
  let uid;
  try {
    await pruefe("ALTE App 1.2: einrichten, Daten eingeben", async () => {
      await page.waitForFunction(() => typeof geraeteUid !== "undefined" && geraeteUid, null, { timeout: 60000 });
      assert.strictEqual(await page.evaluate(() => APP_VERSION), "1.2");
      uid = await page.evaluate(() => geraeteUid);
      await page.waitForFunction(() => document.getElementById("accessBlock").style.display === "flex", null, { timeout: 30000 });
      await zugang.adminSchreiben("betriebe/APPT", { name: "Hof Timer" });
      await zugang.geraetEintragenOeffentlich("APPT", uid, "Tablet Stall");
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#calc .category"), null, { timeout: 60000 });
      await page.evaluate(() => { data.kuehe.anz = 77; save(); return cloudSyncFertig(); });
    });

    await pruefe("ALTE App: Hinweis „Neue App-Version“ oben, Timer sagt „Bildschirm bleibt an“", async () => {
      await page.evaluate(() => { const s = document.createElement("style"); s.textContent = ".firebase-emulator-warning{display:none!important}"; document.head.appendChild(s); window.scrollTo(0, 0); return true; });
      assert(await page.evaluate(() => !!document.getElementById("app-update")), "Hinweis fehlt");
      await warte(1500);
      bild("app-update-hinweis.png");
      await page.evaluate(() => { timerStart(); return true; });
      assert(await page.evaluate(() => document.querySelector(".timer-hinweis").textContent.includes("Bildschirm bleibt an")));
      console.log("   (Bildschirm-anlassen im WebView verfügbar: " + await page.evaluate(() => !!navigator.wakeLock) + ", aktiv: " + await page.evaluate(() => new Promise(r => setTimeout(() => r(!!timerWachHalten), 1500))) + ")");
      await page.evaluate(() => { timerZurueck(); return true; });
    });

    await pruefe("UPDATE: neue App 1.3 drüber installieren → gleiches Gerät, gleicher Betrieb, Daten da, Hinweis weg", async () => {
      await browser.close().catch(() => {});
      adb(`install -r "${NEU}"`);
      starten();
      ({ browser, page } = await verbinde());
      await page.waitForFunction(() => typeof betriebId !== "undefined" && betriebId && document.querySelector("#calc .category"), null, { timeout: 60000 });
      assert.strictEqual(await page.evaluate(() => APP_VERSION), "1.3");
      assert.strictEqual(await page.evaluate(() => geraeteUid), uid, "Gerät hat sich geändert");
      assert.strictEqual(await page.evaluate(() => betriebId), "APPT");
      assert.strictEqual(await page.evaluate(() => data.kuehe.anz), 77);
      assert(await page.evaluate(() => !document.getElementById("app-update")), "Hinweis noch da");
    });

    await pruefe("Erster Timer-Start: Android fragt nach Benachrichtigungen → Erlauben", async () => {
      await page.evaluate(() => { const s = document.createElement("style"); s.textContent = ".firebase-emulator-warning{display:none!important}"; document.head.appendChild(s);
        timer.modus = "countdown"; timer.dauer = 20; timer.rest = 20; timerStart(); return true; });
      let k = null;
      for (let i = 0; i < 30 && !k; i++) { await warte(1000); if (haengerWeg()) continue; k = knoten("Allow") || knoten("Zulassen") || knoten("Erlauben"); }
      bild("app-erlauben.png");
      assert(k, "Frage nach Benachrichtigungen nicht gefunden");
      adb(`shell input tap ${k.x} ${k.y}`);
      await warte(1000);
      assert(/POST_NOTIFICATIONS: granted=true/.test(adb(`shell dumpsys package ${PAKET}`)), "nicht erlaubt");
      assert(weckerGestellt(), "Wecker nicht beim Handy angemeldet");
      assert(await page.evaluate(() => document.querySelector(".timer-hinweis").textContent.includes("auch bei ausgeschaltetem Bildschirm")));
      await page.evaluate(() => { document.getElementById("timer-kasten").scrollIntoView(); return true; });
      await warte(800);
      bild("app-timer-laeuft.png");
    });

    await pruefe("Bildschirm AUS → nach Ablauf klingelt es und die Meldung steht auf dem Sperrbildschirm", async () => {
      // frischer Timer (25 s) direkt vor dem Ausschalten; eine ältere Meldung vorher beenden
      await page.evaluate(() => { timerZurueck(); timer.dauer = 25; timer.rest = 25; timerStart(); return true; });
      await warte(1500);
      assert(!meldungDa(), "alte Meldung noch da");
      await browser.close().catch(() => {});
      adb("shell input keyevent KEYCODE_SLEEP");
      await warte(2000);
      assert(!meldungDa(), "Meldung zu früh");
      const bis = Date.now() + 60000;
      while (!meldungDa() && Date.now() < bis) await warte(2000);
      assert(meldungDa(), "keine Meldung nach Ablauf");
      adb("shell input keyevent KEYCODE_WAKEUP");
      await warte(2500);
      bild("app-alarm-sperrbildschirm.png");
    });

    await pruefe("App öffnen → roter Alarm in der App; „Alarm aus“ beendet auch die Meldung", async () => {
      adb("shell wm dismiss-keyguard");
      starten();
      ({ browser, page } = await verbinde());
      await page.waitForFunction(() => typeof timer !== "undefined" && timer.alarm && document.querySelector(".timer-alarm"), null, { timeout: 30000 });
      await page.evaluate(() => { const s = document.createElement("style"); s.textContent = ".firebase-emulator-warning{display:none!important}"; document.head.appendChild(s); document.getElementById("timer-kasten").scrollIntoView(); return true; });
      await warte(800);
      bild("app-alarm-in-app.png");
      await page.evaluate(() => { timerAlarmAus(); return true; });
      await warte(1500);
      assert(!meldungDa(), "Meldung noch da");
    });

    await pruefe("Pause / Zurücksetzen meldet den Wecker wieder ab (kein Fehlalarm)", async () => {
      await page.evaluate(() => { timer.dauer = 120; timer.rest = 120; timerStart(); return true; });
      await warte(1000);
      assert(weckerGestellt(), "Wecker nicht gestellt");
      await page.evaluate(() => { timerPause(); return true; });
      await warte(1000);
      assert(!weckerGestellt(), "Wecker nach Pause noch da");
      await page.evaluate(() => { timerStart(); return true; });
      await warte(1000);
      assert(weckerGestellt());
      await page.evaluate(() => { timerZurueck(); return true; });
      await warte(1000);
      assert(!weckerGestellt(), "Wecker nach Zurücksetzen noch da");
    });

    await pruefe("Stoppuhr stellt keinen Wecker", async () => {
      await page.evaluate(() => { timerZurueck(); timerModus("stoppuhr"); timerStart(); return true; });
      await warte(1500);
      assert(!weckerGestellt());
      assert(await page.evaluate(() => timerSekunden() >= 1));
      await page.evaluate(() => { timerZurueck(); timerModus("countdown"); return true; });
    });
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(fehler ? `\nAPP-TIMER-TEST ROT (${fehler} Fehler)` : "\nAPP-TIMER-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { adb, verbinde, warte, bild, meldungDa, PAKET, PORT };
