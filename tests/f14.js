// Test F14: Halb ausgefülltes Formular springt nicht zurück, wenn Daten vom Betrieb ankommen.
// Zwei Geräte im selben Betrieb. Nur gegen den Emulator.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/f14.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5071;
const S1 = szenarien[0];

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 5).join("\n   ")); }
  };
  const meldungen = [];
  const geraet = async () => {
    const ctx = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
    const p = await ctx.newPage();
    p.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
    p.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
    await p.clock.setFixedTime(new Date(S1.heute));
    await zugang.vorbereiten(ctx, p, "emulator");
    return { ctx, p };
  };
  const { p: A } = await geraet();
  await A.goto(`http://localhost:${PORT}/?emulator=1`);
  await zugang.warteAufApp(A, "emulator");
  await A.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
  await A.waitForFunction(() => historyData.length > 10);
  await A.evaluate(() => cloudSyncFertig());
  const bid = await A.evaluate(() => betriebId);
  const { p: B } = await geraet();
  await B.goto(`http://localhost:${PORT}/?emulator=1`);
  const uidB = await B.evaluate(async () => { while (!geraeteUid) await new Promise(r => setTimeout(r, 50)); return geraeteUid; });
  await zugang.geraetEintragenOeffentlich(bid, uidB, "Gerät B");
  await B.reload();
  await zugang.warteAufApp(B, "emulator", true);
  await B.waitForTimeout(1500);
  // Zähler: wie oft wird auf Gerät A neu gezeichnet
  await A.evaluate(() => { window.__zeichnen = 0; const alt = buildHistory; window.buildHistory = function () { window.__zeichnen++; return alt.apply(this, arguments); }; });
  const zaehler = () => A.evaluate(() => window.__zeichnen);
  const formular = () => A.evaluate(() => ["liefer-produkt", "liefer-datum", "liefer-menge"].map(id => document.getElementById(id).value));

  try {
    await pruefe("Eigenes Speichern: Bestätigung vom Server zeichnet nicht unnötig neu", async () => {
      await A.evaluate(() => { data.kuehe.anz = 101; save(); });
      await A.evaluate(() => cloudSyncFertig());
      const z = await zaehler();
      await A.waitForTimeout(3000);
      assert.strictEqual(await zaehler(), z, "nach eigener Speicherung neu gezeichnet");
    });

    await pruefe("Lieferung halb ausgefüllt, anderes Gerät ändert etwas → Formular bleibt (MLF, Datum, Menge), Änderung kommt trotzdem an", async () => {
      await A.evaluate(() => showTab("history"));
      await A.selectOption("#liefer-produkt", "mlf");
      await A.fill("#liefer-datum", "2026-12-18");
      await A.fill("#liefer-menge", "777");
      await A.evaluate(() => document.activeElement.blur());   // kein Feld mehr ausgewählt – genau dann wurde früher zurückgesetzt
      const z = await zaehler();
      await B.evaluate(() => { data.kuehe.anz = 122; save(); return cloudSyncFertig(); });
      await A.waitForFunction(() => data.kuehe.anz === 122, null, { timeout: 15000 });
      await A.waitForTimeout(500);
      assert(await zaehler() > z, "Gerät A hat nicht neu gezeichnet");
      assert.deepStrictEqual(await formular(), ["mlf", "2026-12-18", "777"]);
    });

    await pruefe("Danach speichern → Lieferung bei MLF mit 777 kg", async () => {
      const vorher = await A.evaluate(() => lagerData.mlf.bestand);
      await A.click(`button[onclick="addLieferung()"]`);
      const l = await A.evaluate(() => lieferungen[0]);
      assert.strictEqual(l.produkt, "mlf"); assert.strictEqual(l.menge, 777);
      assert(Math.abs(await A.evaluate(() => lagerData.mlf.bestand) - vorher - 777) < 1e-6);
    });

    await pruefe("Finger auf dem Bildschirm: Neuzeichnen wartet bis zum Loslassen (Knopf bleibt unter dem Finger)", async () => {
      await A.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
      const z = await zaehler();
      await B.evaluate(() => { data.kuehe.anz = 133; save(); return cloudSyncFertig(); });
      await A.waitForFunction(() => data.kuehe.anz === 133, null, { timeout: 15000 });
      await A.waitForTimeout(500);
      assert.strictEqual(await zaehler(), z, "während gedrückt neu gezeichnet");
      await A.evaluate(() => document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
      await A.waitForTimeout(300);
      assert(await zaehler() > z, "nach dem Loslassen nicht neu gezeichnet");
      assert(await A.evaluate(() => document.querySelector("#calc").innerText.includes("133")), "Anzeige nicht aktuell");
    });

    await pruefe("Hängt ein Finger fest (z. B. Loslassen verpasst): nach 5 s wird trotzdem neu gezeichnet", async () => {
      await A.evaluate(() => { cloud.zeigerUnten = true; cloud.zeigerSeit = Date.now() - 6000; });
      const z = await zaehler();
      await B.evaluate(() => { data.kuehe.anz = 144; save(); return cloudSyncFertig(); });
      await A.waitForFunction(() => data.kuehe.anz === 144, null, { timeout: 15000 });
      await A.waitForTimeout(500);
      assert(await zaehler() > z);
      await A.evaluate(() => { cloud.zeigerUnten = false; });
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nF14-TEST ROT (${fehler} Fehler)` : "\nF14-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
