// Test F12: App direkt nach „Speichern“ (bzw. „Backup laden“) beendet → Lager-Abzug genau einmal, History-Eintrag da.
// Prüft App-Anzeige UND den Wert auf dem Server, für viele Zeitpunkte des Beendens, plus ein zweites Gerät gleichzeitig.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/f12.js"
const path = require("path");
const http = require("http");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5068;
const S1 = szenarien[0];
const holen = url => new Promise((ok, nein) => http.get(url, { headers: { Authorization: "Bearer owner" } }, r => {
  let d = ""; r.on("data", c => d += c); r.on("end", () => { try { ok(JSON.parse(d)); } catch (e) { nein(e); } }); }).on("error", nein));
const zahl = f => f ? +(f.doubleValue ?? f.integerValue ?? 0) : 0;

// Gesamtbestand auf dem Server = Grundbestand + Summen aller Geräte
async function serverBestand(bid) {
  const d = await holen(`http://127.0.0.1:8080/v1/projects/demo-futterrechner/databases/(default)/documents/betriebe/${bid}/daten/lager`);
  const f = d.fields;
  const res = {};
  for (const p of ["agf", "mlf"]) {
    let s = zahl(f.inhalt.mapValue.fields[p].mapValue.fields.bestand);
    const b = f.buchungen ? f.buchungen.mapValue.fields || {} : {};
    Object.values(b).forEach(g => { s += zahl((g.mapValue.fields || {})[p]); });
    res[p] = Math.round(s * 1e6) / 1e6;
  }
  return [res.agf, res.mlf];
}

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 6).join("\n   ")); }
  };
  const neuesGeraet = async () => {
    const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
    const page = await context.newPage();
    const meldungen = [];
    page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
    page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
    await page.clock.setFixedTime(new Date(S1.heute));
    await zugang.vorbereiten(context, page, "emulator");
    return { context, page, meldungen };
  };
  const lager = p => p.evaluate(() => [lagerData.agf.bestand, lagerData.mlf.bestand]);
  const neuLaden = async p => { await p.reload(); await zugang.warteAufApp(p, "emulator", true); await p.waitForTimeout(2500); };
  const fertig = async p => { await p.evaluate(() => cloudSyncFertig()); await p.waitForTimeout(1500); };

  try {
    for (const warte of [0, 50, 100, 300, 500, 700, 1500]) {
      await pruefe(`Kühe speichern, App nach ${warte} ms beendet → Abzug genau einmal (App + Server), History-Eintrag da`, async () => {
        const { context, page, meldungen } = await neuesGeraet();
        await page.goto(`http://localhost:${PORT}/?emulator=1`);
        await zugang.warteAufApp(page, "emulator");
        await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
        await page.waitForFunction(() => historyData.length > 10);
        await fertig(page);
        const bid = await page.evaluate(() => betriebId);
        await page.evaluate(() => { showTab("calc"); saveHistory("kuehe"); });
        const soll = await lager(page);
        await page.waitForTimeout(warte);
        await neuLaden(page);
        assert.deepStrictEqual(await lager(page), soll, "App-Anzeige Lager");
        assert.strictEqual(await page.evaluate(() => historyData.filter(h => h.kategorie === "kuehe" && h.datum === getToday()).length), 1, "History-Eintrag");
        await fertig(page);
        assert.deepStrictEqual(await serverBestand(bid), soll, "Server");
        // noch einmal neu laden: bleibt gleich (nichts wird ein drittes Mal geschickt)
        await neuLaden(page);
        assert.deepStrictEqual(await lager(page), soll, "nach zweitem Neuladen");
        assert.deepStrictEqual(meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
        await context.close();
      });
    }

    for (const warte of [100, 500]) {
      await pruefe(`Backup laden, App nach ${warte} ms beendet → Lager genau wie im Backup`, async () => {
        const { context, page } = await neuesGeraet();
        await page.goto(`http://localhost:${PORT}/?emulator=1`);
        await zugang.warteAufApp(page, "emulator");
        await fertig(page);
        const bid = await page.evaluate(() => betriebId);
        await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
        await page.waitForFunction(() => historyData.length > 10);
        const soll = [S1.backup.lagerData.agf.bestand, S1.backup.lagerData.mlf.bestand];
        assert.deepStrictEqual(await lager(page), soll);
        await page.waitForTimeout(warte);
        await neuLaden(page);
        assert.deepStrictEqual(await lager(page), soll, "App-Anzeige Lager");
        await fertig(page);
        assert.deepStrictEqual(await serverBestand(bid), soll, "Server");
        await context.close();
      });
    }

    await pruefe("Zwei Geräte buchen gleichzeitig, eins wird sofort beendet → beide Abzüge zählen genau einmal", async () => {
      const A = await neuesGeraet();
      await A.page.goto(`http://localhost:${PORT}/?emulator=1`);
      await zugang.warteAufApp(A.page, "emulator");
      await A.page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
      await A.page.waitForFunction(() => historyData.length > 10);
      await fertig(A.page);
      const bid = await A.page.evaluate(() => betriebId);
      const B = await neuesGeraet();
      await B.page.goto(`http://localhost:${PORT}/?emulator=1`);
      const uidB = await B.page.evaluate(async () => { while (!geraeteUid) await new Promise(r => setTimeout(r, 50)); return geraeteUid; });
      await zugang.geraetEintragenOeffentlich(bid, uidB, "Gerät B");
      await neuLaden(B.page);
      const start = await lager(A.page);
      assert.deepStrictEqual(await lager(B.page), start);
      // A speichert Kühe und wird sofort beendet, B trägt gleichzeitig eine AGF-Lieferung von 1000 kg ein
      await A.page.evaluate(() => { showTab("calc"); saveHistory("kuehe"); });
      const abzugA = (await lager(A.page)).map((v, i) => start[i] - v);
      const reload = neuLaden(A.page);
      await B.page.evaluate(() => { lagerData.agf.bestand += 1000; saveLagerStorage(); });
      await reload;
      await fertig(A.page); await fertig(B.page);
      await A.page.waitForTimeout(2000);
      const soll = [start[0] - abzugA[0] + 1000, start[1] - abzugA[1]];
      assert.deepStrictEqual(await serverBestand(bid), soll, "Server");
      assert.deepStrictEqual(await lager(A.page), soll, "Gerät A");
      assert.deepStrictEqual(await lager(B.page), soll, "Gerät B");
      await A.context.close(); await B.context.close();
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nF12-TEST ROT (${fehler} Fehler)` : "\nF12-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
