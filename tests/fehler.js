// Test der behobenen Fehler aus FEHLER.md (jeder Fehler einzeln). Nur gegen den Emulator.
// Start: powershell -File tests\emulator.ps1 "node tests/fehler.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5056;
const URL = `http://localhost:${PORT}/?emulator=1`;
const S1 = szenarien[0];

async function geraetMitDaten(browser, heute) {
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  const page = await context.newPage();
  const meldungen = [];
  const g = { context, page, meldungen, antworten: [] };
  // Dialoge: nächste vorgegebene Antwort (true = OK, false = Abbrechen), sonst OK
  page.on("dialog", d => { meldungen.push(d.message()); const a = g.antworten.shift(); (a === false ? d.dismiss() : d.accept()); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  if (heute) await page.clock.setFixedTime(new Date(heute));
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto(URL);
  await zugang.warteAufApp(page, "emulator");
  await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
  await page.waitForFunction(() => historyData.length > 10, null, { timeout: 20000 });
  await page.evaluate(() => cloudSyncFertig());
  return g;
}

const neuLaden = async page => {
  await page.evaluate(async () => { await cloudSyncFertig(); ["futter", "gCfg", "history", "lager", "lieferungen"].forEach(k => localStorage.removeItem(k)); });
  await page.reload();
  await zugang.warteAufApp(page, "emulator", true);
};

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n")[0]); }
  };
  try {
    const g = await geraetMitDaten(browser, S1.heute);
    const p = g.page;
    const rm = i => p.locator(".cat-restbullen + .cat-body input").nth(i);

    await pruefe("F1: Restmischung speichern zieht AGF dauerhaft vom Lager ab (auch nach Neuladen)", async () => {
      await rm(0).fill("850"); await rm(0).blur();
      await rm(2).fill("9"); await rm(2).blur();
      const vorher = await p.evaluate(() => lagerData.agf.bestand);
      await p.click(`button[onclick="saveRestBullenHistory()"]`);
      const abzug = await p.evaluate(() => historyData[0].agf);
      assert(abzug > 0, "Testdaten: kein AGF-Abzug");
      await neuLaden(p);
      const nachher = await p.evaluate(() => lagerData.agf.bestand);
      assert(Math.abs(nachher - (vorher - abzug)) < 1e-6, `Bestand ${nachher}, erwartet ${vorher - abzug}`);
    });

    await pruefe("F2: Restmischung nur einmal pro Tag (auch bei schnellem Doppel-Tipp)", async () => {
      const anzahl = () => p.evaluate(() => historyData.filter(h => h.kategorie === "restbullen" && h.datum === getToday()).length);
      assert.strictEqual(await anzahl(), 1);
      await p.evaluate(() => { saveRestBullenHistory(); saveRestBullenHistory(); });
      assert.strictEqual(await anzahl(), 1);
      assert(g.meldungen.includes("Heute bereits gespeichert"));
    });

    await pruefe("F3: Restmischung-Eingaben bleiben nach Neuladen erhalten", async () => {
      await rm(0).fill("612.5"); await rm(0).blur();
      await rm(1).fill("700"); await rm(1).blur();
      const soll = await p.evaluate(() => JSON.stringify(data.restbullen));
      await neuLaden(p);
      assert.strictEqual(await p.evaluate(() => JSON.stringify(data.restbullen)), soll);
      assert.strictEqual(await rm(0).inputValue(), "612.5");
    });

    await pruefe("F4: „Backup laden“ fragt vorher – Abbrechen lässt alles unverändert", async () => {
      const vorher = await p.evaluate(() => historyData.length);
      g.antworten.push(false);
      await p.setInputFiles("#backupFile", { name: "leer.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ historyData: [] })) });
      await p.waitForTimeout(1000);
      assert(g.meldungen.some(m => m.includes("ersetzen")), "keine Rückfrage");
      assert.strictEqual(await p.evaluate(() => historyData.length), vorher, "Daten wurden trotz Abbrechen ersetzt");
      // Dieselbe Datei nochmal wählen und bestätigen → wird geladen
      g.antworten.push(true);
      await p.setInputFiles("#backupFile", { name: "leer.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ historyData: [] })) });
      await p.waitForFunction(() => historyData.length === 0, null, { timeout: 10000 });
    });

    await pruefe("F8: Taschenrechner ohne eval – rechnet richtig und rundet sinnvoll", async () => {
      const rechne = async tasten => {
        await p.evaluate(() => { showTab("calc2"); press("C"); });
        for (const t of tasten) await p.evaluate(t => press(t), t);
        return p.textContent("#disp");
      };
      assert.strictEqual(await rechne(["0", ".", "1", "+", "0", ".", "2", "="]), "0.3");
      assert.strictEqual(await rechne(["2", "+", "3", "*", "4", "="]), "14");
      assert.strictEqual(await rechne(["1", "0", "-", "4", "/", "2", "="]), "8");
      assert.strictEqual(await rechne(["8", ".", "*", "2", "="]), "16");
      assert.strictEqual(await rechne(["7", "*", "-", "2", "="]), "-14");
      assert.strictEqual(await rechne(["1", "+", "*", "="]), "0");             // unsinnige Eingabe → leer wie bisher
      assert.strictEqual(await rechne(["1", "2", ".", "5", "*", "3", "="]), "37.5");
      // Schadcode wird nicht ausgeführt
      const ergebnis = await p.evaluate(() => { expr = "alert(1)"; press("="); return document.getElementById("disp").innerText; });
      assert.strictEqual(ergebnis, "0");
    });

    await pruefe("F10: Liegt „Bestellen bis“ in der Vergangenheit, steht dort „sofort bestellen“", async () => {
      await p.evaluate(() => { lagerData.mlf.bestand = 1; lagerData.mlf.lieferzeit = 5; historyData.unshift({ id: "f10", datum: getToday(), kategorie: "kuehe", tiere: 1, gesamt: 300, agf: 0, mlf: 300, futter: [] }); buildHistory(); });
      const txt = await p.textContent("#history");
      assert(txt.includes("sofort bestellen"), "Hinweis fehlt");
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(g.meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nFEHLER-TEST ROT (${fehler} Fehler)` : "\nFEHLER-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
