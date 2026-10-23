// Test Timer (Countdown + Stoppuhr) auf dem Rechner, im Browser (ohne App-Wecker). Uhr wird im Test vorgespult.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/timer.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5069;
const S1 = szenarien[0];

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 4).join("\n   ")); }
  };
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  const page = await context.newPage();
  const meldungen = [];
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await page.clock.install({ time: new Date(S1.heute) });
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto(`http://localhost:${PORT}/?emulator=1`);
  await page.clock.runFor(1000);
  await zugang.warteAufApp(page, "emulator");
  await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
  await page.waitForFunction(() => historyData.length > 10);
// Anzeige nach dem nächsten Takt (der Timer frischt sie alle 0,25 s auf)
  const anzeige = async () => { await page.clock.runFor(260); return page.textContent("#timer-anzeige"); };
  // Uhr anhalten: ab jetzt läuft die Zeit nur, wenn der Test sie vorspult
  const uhrAnhalten = async () => page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
  const knopf = t => page.locator("#timer-box button", { hasText: t });
  // wasserName/wasserKg ausgenommen: nach dem Laden eines alten Backups ergänzt die App sie kurz danach (FEHLER.md F13)
  const stand = () => page.evaluate(() => { const s = o => Array.isArray(o) ? o.map(s) : (o && typeof o === "object") ? Object.fromEntries(Object.keys(o).sort().map(k => [k, s(o[k])])) : o; return JSON.stringify(s({ data: { ...data, restbullen: null }, lagerData, historyData, lieferungen, globalCfg: { ...globalCfg, wasserName: undefined, wasserKg: undefined } })); });

  try {
    let vorher;
    await pruefe("Timer-Kasten steht auf dem Rechner (unter den Gruppen), Standard Countdown 08:00, im Browser kein Update-Hinweis", async () => {
      await page.evaluate(() => cloudSyncFertig());
      vorher = await stand();
      await uhrAnhalten();
      await page.evaluate(() => showTab("calc"));
      assert(await page.locator("#calc #timer-kasten").isVisible());
      assert.strictEqual(await page.locator("#calc2 #timer-kasten").count(), 0);
      assert.strictEqual(await anzeige(), "08:00");
      assert.strictEqual(await page.locator("#app-update").count(), 0);
      const letzte = await page.evaluate(() => { const k = [...document.querySelectorAll("#calc .category")]; return k[k.length - 1].id; });
      assert.strictEqual(letzte, "timer-kasten");
    });

    await pruefe("Zeit einstellen: 2 Min 30 Sek, +1 Min → 03:30", async () => {
      await page.fill("#timer-min", "2"); await page.dispatchEvent("#timer-min", "change");
      await page.fill("#timer-sek", "30"); await page.dispatchEvent("#timer-sek", "change");
      assert.strictEqual(await anzeige(), "02:30");
      await knopf("+1 Min").click();
      assert.strictEqual(await anzeige(), "03:30");
    });

    await pruefe("Start → läuft rückwärts; Pause hält an; Weiter läuft weiter", async () => {
      await knopf("Start").click();
      await page.clock.runFor(10000);
      assert.strictEqual(await anzeige(), "03:20");
      await knopf("Pause").click();
      await page.clock.runFor(30000);
      assert.strictEqual(await anzeige(), "03:20");
      await knopf("Weiter").click();
      await page.clock.runFor(5000);
      assert.strictEqual(await anzeige(), "03:15");
    });

    await pruefe("Zeit um → roter Alarm „Zeit ist um!“, Anzeige 00:00; „Alarm aus“ setzt auf die eingestellte Zeit zurück", async () => {
      await page.clock.runFor(200000);
      assert(await page.locator(".timer-alarm").isVisible());
      assert.strictEqual(await anzeige(), "00:00");
      await page.locator(".timer-alarm button").click();
      assert.strictEqual(await page.locator(".timer-alarm").count(), 0);
      assert.strictEqual(await anzeige(), "03:30");
    });

    await pruefe("Zurücksetzen während es läuft", async () => {
      await knopf("Start").click();
      await page.clock.runFor(7000);
      await knopf("Zurücksetzen").click();
      assert.strictEqual(await anzeige(), "03:30");
      await page.clock.runFor(300000);
      assert.strictEqual(await page.locator(".timer-alarm").count(), 0, "Alarm nach Zurücksetzen");
    });

    await pruefe("Stoppuhr: zählt vorwärts, Pause, Zurücksetzen; kein Alarm", async () => {
      await knopf("Stoppuhr").click();
      assert.strictEqual(await anzeige(), "00:00");
      await knopf("Start").click();
      await page.clock.runFor(65000);
      assert.strictEqual(await anzeige(), "01:05");
      await knopf("Pause").click();
      await page.clock.runFor(10000);
      assert.strictEqual(await anzeige(), "01:05");
      await knopf("Zurücksetzen").click();
      assert.strictEqual(await anzeige(), "00:00");
      assert.strictEqual(await page.locator(".timer-alarm").count(), 0);
    });

    await pruefe("Wechsel Countdown/Stoppuhr während es läuft → Hinweis, kein Wechsel", async () => {
      await knopf("Start").click();
      await knopf("Countdown").click();
      assert(meldungen.some(m => m.includes("zuerst den laufenden Timer anhalten")));
      assert.strictEqual(await page.evaluate(() => timer.modus), "stoppuhr");
      await knopf("Zurücksetzen").click();
      await knopf("Countdown").click();
    });

    await pruefe("Läuft weiter, während man andere Gruppen aufklappt/eingibt (Rechner wird neu gezeichnet)", async () => {
      await knopf("Start").click();
      await page.clock.runFor(4000);
      await page.evaluate(() => { data.kuehe.collapsed = !data.kuehe.collapsed; buildCalc(); data.kuehe.collapsed = !data.kuehe.collapsed; buildCalc(); });
      await page.clock.runFor(1000);
      assert.strictEqual(await anzeige(), "03:25");
    });

    await pruefe("Nach dem Neuladen läuft er richtig weiter (Uhrzeit-basiert)", async () => {
      await page.clock.resume();
      await page.reload();
      await zugang.warteAufApp(page, "emulator", true);
      await uhrAnhalten();
      await page.evaluate(() => showTab("calc"));
      assert.strictEqual(await page.evaluate(() => timer.laeuft), true);
      // vor dem Neuladen: 03:25 übrig; Neuladen dauert ein paar echte Sekunden
      const t = await anzeige();
      assert(/^03:(0d|1d|2[0-5])$/.test(t), "Anzeige " + t);
      await knopf("Zurücksetzen").click();
    });

    await pruefe("Timer einklappen/aufklappen wie die anderen Gruppen", async () => {
      await page.click("#timer-kasten .cat-header");
      assert(!(await page.locator("#timer-box").isVisible()));
      await page.click("#timer-kasten .cat-header");
      assert(await page.locator("#timer-box").isVisible());
    });

    await pruefe("Timer ändert keine Daten (Rationen, Lager, History, Lieferungen, Einstellungen)", async () => {
      const jetzt = await stand();
      if (jetzt !== vorher) { const v = JSON.parse(vorher), n = JSON.parse(jetzt); const unt = [];
        const vgl = (a, b, p) => { if (JSON.stringify(a) === JSON.stringify(b)) return; if (a && b && typeof a === "object" && typeof b === "object") { new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => vgl(a[k], b[k], p + "." + k)); } else unt.push(p + ": " + JSON.stringify(a) + " → " + JSON.stringify(b)); };
        vgl(v, n, ""); throw new Error("Daten geändert: " + unt.slice(0, 5).join(" | ")); }
    });

    await pruefe("Update-Hinweis nur in alter App (Kennzeichen FutterrechnerApp/1.2), nicht in 1.3", async () => {
      assert.strictEqual(await page.evaluate(() => appVersionAlt()), false);
      const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 15) FutterrechnerApp/1.2" });
      const p = await ctx.newPage();
      await p.goto(`http://localhost:${PORT}/?emulator=1`);
      assert.strictEqual(await p.evaluate(() => appVersionAlt()), true);
      await ctx.close();
      const ctx2 = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 15) FutterrechnerApp/1.3" });
      const p2 = await ctx2.newPage();
      await p2.goto(`http://localhost:${PORT}/?emulator=1`);
      assert.strictEqual(await p2.evaluate(() => appVersionAlt()), false);
      await ctx2.close();
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nTIMER-TEST ROT (${fehler} Fehler)` : "\nTIMER-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
