// Test Paket Fressmengen, Schritt 2: Hauptschalter + Einstellungen › Module (Erweitert mit Standardwerten, Prüfung der Eingaben).
// AUS = alles wie vorher; Schalten ändert keine Daten und keine Anzeige der bisherigen Bereiche.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/fressmenge-schalter.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5073;
const S1 = szenarien[0];

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 5).join("\n   ")); }
  };
  const neueSeite = async (breite) => {
    const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE", viewport: breite ? { width: breite, height: 800 } : undefined });
    const page = await context.newPage();
    page.meldungen = [];
    page.on("dialog", d => { page.meldungen.push(d.message()); d.accept(); });
    page.on("pageerror", e => page.meldungen.push("SEITENFEHLER: " + e.message));
    await zugang.vorbereiten(context, page, "emulator");
    return page;
  };
  // wasserName/wasserKg ausgenommen: nach dem Laden eines alten Backups ergänzt die App sie kurz danach (FEHLER.md F13)
  const stand = p => p.evaluate(() => gleicherStand({ data: { ...data, restbullen: null }, globalCfg: { ...globalCfg, wasserName: undefined, wasserKg: undefined, kuehe2Name: undefined, kuehe2Modus: undefined }, lagerData, historyData, lieferungen }));
  const anzeige = p => p.evaluate(() => { buildCalc(); buildSettings(); buildHistory();
    return ["calc", "settings", "history", "calc2"].map(id => document.getElementById(id).innerHTML).join("\n"); });

  const A = await neueSeite();
  try {
    let daten, bild;
    await pruefe("Normale App: Hauptschalter AUS unter den Einstellungen, kein Reiter „Fressmenge“", async () => {
      await A.goto(`http://localhost:${PORT}/?emulator=1`);
      await zugang.warteAufApp(A, "emulator");
      await A.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
      await A.waitForFunction(() => historyData.length > 10);
      await A.evaluate(() => cloudSyncFertig());
      await A.waitForFunction(() => globalCfg.wasserName && globalCfg.kuehe2Modus, null, { timeout: 15000 }).catch(() => {});
      daten = await stand(A); bild = await anzeige(A);
      assert.strictEqual(await A.evaluate(() => fmAn()), false);
      assert(!(await A.locator("#fm-tab").isVisible()));
      await A.evaluate(() => showTab("settings"));
      assert(await A.locator("#fm-haupt").isVisible());
      assert(!(await A.locator("#fm-haupt").isChecked()));
      assert.strictEqual(await A.locator("#fm-tierzahlHM").count(), 0);
      await A.evaluate(() => showTab("calc"));
      assert(await A.locator("#module").evaluate(e => e.classList.contains("hidden")), "Schalter auf dem Rechner sichtbar");
    });

    await pruefe("Schalter AN → oben erscheint der Reiter „Fressmenge“ mit Unterschaltern und zugeklapptem „Erweitert“", async () => {
      await A.evaluate(() => showTab("settings"));
      await A.check("#fm-haupt");
      assert.strictEqual(await A.evaluate(() => fmAn()), true);
      assert(await A.locator("#fm-tab").isVisible());
      assert.strictEqual(await A.locator("#settings #fm-tierzahlHM, #module #fm-tierzahlHM").count(), 0, "Unterschalter in den Einstellungen");
      await A.click("#fm-tab");
      assert(await A.locator("#fressmenge").isVisible());
      assert(!(await A.locator("#settings").isVisible()));
      for (const k of ["tierzahlHM", "regen", "hitze", "rationsvergleich"]) assert(await A.locator("#fm-" + k).isChecked(), k);
      assert(!(await A.locator("#fm-erweitert").isVisible()));
      await A.click("#fressmenge >> text=Erweitert");
      assert(await A.locator("#fm-erweitert").isVisible());
      assert.strictEqual(await A.inputValue("#fm-restZuschlag"), "4");
      assert.strictEqual(await A.inputValue("#fm-wetterLat"), "52,6");
      assert.strictEqual(await A.inputValue("#fm-erhaltungNel"), "37,3");
      // Gruppen: alle zu, Antippen öffnet eine (nur eine offen), geänderte Werte werden am Kopf gezählt
      assert.strictEqual(await A.locator(".fm-erw-kopf").count(), 9);
      assert(!(await A.locator("#fm-restZuschlag").isVisible()));
      await A.click(".fm-erw-kopf >> text=Reste und Mischen");
      assert(await A.locator("#fm-restZuschlag").isVisible());
      await A.click(".fm-erw-kopf >> text=Waage und Futterwagen");
      assert(!(await A.locator("#fm-restZuschlag").isVisible()) && await A.locator("#fm-waageToleranz").isVisible());
    });

    await pruefe("Erweitert: gültiger Wert wird gemerkt (auch mit Komma), ungültige Werte werden erklärt und zurückgesetzt", async () => {
      await A.evaluate(k => { fmErwOffen = fmErwGruppeVon(k); fmBauen(); }, "restZuschlag");
      await A.fill("#fm-restZuschlag", "5,5"); await A.dispatchEvent("#fm-restZuschlag", "change");
      assert.strictEqual(await A.evaluate(() => fmWert("restZuschlag")), 5.5);
      A.meldungen.length = 0;
      await A.evaluate(k => { fmErwOffen = fmErwGruppeVon(k); fmBauen(); }, "hitzeMax");
      await A.fill("#fm-hitzeMax", "abc"); await A.dispatchEvent("#fm-hitzeMax", "change");
      assert(A.meldungen.some(m => m.includes("Hitzeabzug höchstens") && m.includes("0 bis 30")), A.meldungen.join("|"));
      assert.strictEqual(await A.inputValue("#fm-hitzeMax"), "10");
      await A.evaluate(k => { fmErwOffen = fmErwGruppeVon(k); fmBauen(); }, "restZielVon");
      await A.fill("#fm-restZielVon", "6"); await A.dispatchEvent("#fm-restZielVon", "change");
      assert(A.meldungen.some(m => m.includes("Zielbereich")), A.meldungen.join("|"));
      assert.strictEqual(await A.evaluate(() => fmWert("restZielVon")), 3);
      await A.evaluate(k => { fmErwOffen = fmErwGruppeVon(k); fmBauen(); }, "bewertungMin");
      await A.fill("#fm-bewertungMin", "9"); await A.dispatchEvent("#fm-bewertungMin", "change");
      assert.strictEqual(await A.evaluate(() => fmWert("bewertungMin")), 3);
    });

    await pruefe("Standard wiederherstellen setzt alle Werte zurück; Unterschalter ausschaltbar", async () => {
      await A.click("text=Standard wiederherstellen");
      assert.strictEqual(await A.evaluate(() => fmWert("restZuschlag")), 4);
      assert.deepStrictEqual(await A.evaluate(() => fmCfg.werte), {});
      await A.uncheck("#fm-regen");
      assert.strictEqual(await A.evaluate(() => fmCfg.regen), false);
    });

    await pruefe("Einstellungen bleiben nach dem Neuladen erhalten (im Gerät), Daten beim Ausschalten bleiben", async () => {
      await A.evaluate(k => { fmErwOffen = fmErwGruppeVon(k); fmBauen(); }, "regenMm");
      await A.fill("#fm-regenMm", "4"); await A.dispatchEvent("#fm-regenMm", "change");
      await A.reload(); await zugang.warteAufApp(A, "emulator", true);
      assert.strictEqual(await A.evaluate(() => fmAn()), true);
      assert.strictEqual(await A.evaluate(() => fmWert("regenMm")), 4);
      await A.evaluate(() => fmHauptschalter(false));
      await A.evaluate(() => fmHauptschalter(true));
      assert.strictEqual(await A.evaluate(() => fmWert("regenMm")), 4);
      assert.strictEqual(await A.evaluate(() => fmCfg.regen), false);
    });

    await pruefe("Schalter AUS → Reiter verschwindet (war er offen, geht es zu den Einstellungen)", async () => {
      await A.click("#fm-tab");
      await A.evaluate(() => fmHauptschalter(false));
      assert(!(await A.locator("#fm-tab").isVisible()));
      assert(!(await A.locator("#fressmenge").isVisible()));
      assert(await A.locator("#settings").isVisible());
    });

    await pruefe("Schalten ändert keine Daten und keine Anzeige von Rechner, Einstellungen, History, Taschenrechner", async () => {
      await A.evaluate(() => cloudSyncFertig());
      const jetzt = await stand(A);
      if (jetzt !== daten) { const unt = []; const vgl = (x, y, p) => { if (JSON.stringify(x) === JSON.stringify(y)) return;
        if (x && y && typeof x === 'object' && typeof y === 'object') new Set([...Object.keys(x), ...Object.keys(y)]).forEach(k => vgl(x[k], y[k], p + '.' + k));
        else unt.push(p + ': ' + JSON.stringify(x) + ' → ' + JSON.stringify(y)); };
        vgl(JSON.parse(daten), JSON.parse(jetzt), ''); throw new Error('Daten geändert: ' + unt.slice(0, 5).join(' | ')); }
      const neuBild = await anzeige(A);
      if (neuBild !== bild) { let i = 0; while (neuBild[i] === bild[i]) i++; throw new Error("Anzeige anders bei: " + JSON.stringify(bild.slice(i - 80, i + 80)) + " → " + JSON.stringify(neuBild.slice(i - 80, i + 80))); }
    });

    await pruefe("Testversion (Fritz' Betrieb) startet einmalig mit AN", async () => {
      const T = await neueSeite();
      await T.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
      await zugang.warteAufApp(T, "emulator");
      assert.strictEqual(await T.evaluate(() => fmAn()), true);
      await T.evaluate(() => fmHauptschalter(false));
      await T.reload(); await zugang.warteAufApp(T, "emulator", true);
      assert.strictEqual(await T.evaluate(() => fmAn()), false, "nach Ausschalten wieder AN");
      assert.deepStrictEqual(T.meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });

    await pruefe("Handy (360 px): Reiter „Fressmenge“ mit Erweitert und 5 Reitern oben nicht breiter als der Bildschirm", async () => {
      const H = await neueSeite(360);
      await H.goto(`http://localhost:${PORT}/?emulator=1`);
      await zugang.warteAufApp(H, "emulator");
      await H.evaluate(() => { fmHauptschalter(true); fmErweitertZu = false; showTab("fressmenge"); });
      const b = await H.evaluate(() => ({ seite: document.documentElement.scrollWidth, box: document.getElementById("fressmenge").scrollWidth, fenster: innerWidth }));
      assert(b.seite <= b.fenster && b.box <= b.fenster, JSON.stringify(b));
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(A.meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nSCHALTER-TEST ROT (${fehler} Fehler)` : "\nSCHALTER-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
