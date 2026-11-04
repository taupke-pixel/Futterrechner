// Test Leistungsgruppe 2 („Kühe Gruppe 2“: normal / Rest der Kühe-Mischung + Zugabe), Tonnen in der History,
// Knopf „Alte Jahre löschen“. Erwartete Werte werden hier unabhängig nachgerechnet. Nur gegen den Emulator.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/kuehe2.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5070;
const S1 = szenarien[0];
const nah = (a, b) => Math.abs(a - b) < 1e-6;

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 5).join("\n   ")); }
  };
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE", acceptDownloads: true });
  const page = await context.newPage();
  const meldungen = [];
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await page.clock.setFixedTime(new Date(S1.heute));
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto(`http://localhost:${PORT}/?emulator=1`);
  await zugang.warteAufApp(page, "emulator");
  await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
  await page.waitForFunction(() => historyData.length > 10);
  await page.evaluate(() => cloudSyncFertig());
  // neue Einstellungs-Kästen aufklappen (Standard zu)
  await page.evaluate(() => { einstellungenZu = { kategorien: false, restmischung: false }; localStorage.setItem("einstellungenZu", JSON.stringify(einstellungenZu)); });

  const kasten = () => page.locator("#calc .category.gruppe2");
  const tabelle = () => page.evaluate(() => [...document.querySelectorAll("#calc .category.gruppe2 table tr")].slice(1)
    .map(tr => [...tr.querySelectorAll("td")].map(td => td.textContent.trim())));
  const kueheText = () => page.evaluate(() => { showTab("calc"); const h = document.querySelector("#calc .cat-kuehe"); return h.closest(".category").innerText; });
  const lager = () => page.evaluate(() => [lagerData.agf.bestand, lagerData.mlf.bestand]);
  const KR = S1.backup.data.kuehe.items;   // Kuh-Ration aus dem Backup
  // Ration Gruppe 2 = Kuh-Ration, aber mehr Kraftfutter (AGF 6, MLF 3.5) und ein Futter weniger (Grassilage 8 statt 10)
  const G2 = KR.map(i => ({ ...i, kg: i.type === "agf" ? 6 : i.type === "mlf" ? 3.5 : i.name === "Grassilage" ? 8 : i.kg }));

  try {
    let kueheVorher;
    await pruefe("Neue Gruppe direkt unter Kühe: 0 Tiere, leere Ration, „normale Gruppe“, Häkchen in der Kategorien-Auswahl", async () => {
      kueheVorher = await kueheText();
      const reihe = await page.evaluate(() => [...document.querySelectorAll("#calc .category .cat-header")].map(h => h.className.replace("cat-header ", "").trim()));
      assert.deepStrictEqual(reihe.slice(0, 3), ["cat-kuehe", "cat-kuehe2", "cat-faersen"]);
      assert.deepStrictEqual(await page.evaluate(() => [data.kuehe2.anz, kuehe2Aufwerten(), data.kuehe2.items.every(i => i.kg === 0)]), [0, false, true]);
      await page.evaluate(() => showTab("settings"));
      assert.strictEqual(await page.locator("#kategorien-wahl label", { hasText: "Kühe Gruppe 2" }).count(), 1);
    });

    let start;
    await pruefe("Normal: Ration + 40 Tiere → Tabelle wie Ration × Tiere; Speichern = ganze Ration, Lager-Abzug vollständig", async () => {
      await page.evaluate(g2 => { data.kuehe2.items = g2; data.kuehe2.anz = 40; save(); showTab("calc"); buildCalc(); }, G2);
      const t = await tabelle();
      let lauf = 0; const soll = [];
      G2.filter(i => i.kg > 0).forEach(i => { const g = i.kg * 40; lauf += g; soll.push([i.type === "agf" ? S1.backup.globalCfg.agfName : i.type === "mlf" ? S1.backup.globalCfg.mlfName : i.name, g.toFixed(1), lauf.toFixed(1)]); });
      assert.deepStrictEqual(t.map(z => z.slice(0, 3)), soll);
      start = await lager();
      await kasten().locator("button.save-btn").click();
      const e = await page.evaluate(() => historyData.find(h => h.kategorie === "kuehe2" && h.datum === getToday()));
      assert.deepStrictEqual(e.futter.map(f => +f.kg.toFixed(6)), G2.filter(i => i.kg > 0).map(i => +(i.kg * 40).toFixed(6)));
      const nach = await lager();
      assert(nah(start[0] - nach[0], 6 * 40) && nah(start[1] - nach[1], 3.5 * 40), "Lager-Abzug " + (start[0] - nach[0]) + "/" + (start[1] - nach[1]));
      assert.strictEqual(await kasten().locator("button.save-btn").innerText(), "Gespeichert");
    });

    await pruefe("Kühe-Rechnung bleibt unverändert", async () => {
      assert.strictEqual(await kueheText(), kueheVorher);
    });

    await pruefe("Umbenennen (✎) → neuer Name auf dem Rechner, beim Häkchen und in der History", async () => {
      await page.evaluate(() => showTab("settings"));
      await page.click("#edit-kuehe2");
      await page.keyboard.press("Control+A"); await page.keyboard.type("Hochleistung");
      await page.evaluate(() => document.activeElement.blur());
      assert.strictEqual(await page.locator("#kategorien-wahl label", { hasText: "Hochleistung" }).count(), 1);
      await page.evaluate(() => showTab("calc"));
      assert((await kasten().locator(".cat-header").innerText()).includes("Hochleistung"));
      await page.evaluate(() => buildHistory());
      assert((await page.textContent("#history")).includes("Hochleistung"));
    });

    await pruefe("Vom Rechner entfernen und wieder anzeigen (Häkchen)", async () => {
      await page.evaluate(() => showTab("settings"));
      await page.locator("#kategorien-wahl label", { hasText: "Hochleistung" }).locator("input").click();
      await page.evaluate(() => showTab("calc"));
      assert(!(await kasten().isVisible()));
      await page.evaluate(() => showTab("settings"));
      await page.locator("#kategorien-wahl label", { hasText: "Hochleistung" }).locator("input").click();
      await page.evaluate(() => showTab("calc"));
      assert(await kasten().isVisible());
    });

    await pruefe("Umstellen auf „Rest der Kühe-Mischung + Zugabe“ → Kasten wie Restmischung (Felder, Ist/Soll/Zeit/Summe)", async () => {
      await page.evaluate(() => showTab("settings"));
      await page.selectOption("#kuehe2-modus select", "aufwerten");
      await page.evaluate(() => showTab("calc"));
      const txt = await kasten().innerText();
      assert(txt.includes("Restmischung vorhanden (kg)") && txt.includes("Zielgewicht Ration (kg)") && txt.includes("Tiere (Anzahl)") && txt.includes("Ist kg") && txt.includes("Soll kg"), txt.slice(0, 200));
    });

    await pruefe("Aufwerten: 1490 kg Kühe-Mischung, 40 Tiere → Tabelle wie nachgerechnet", async () => {
      const feld = i => kasten().locator("input").nth(i);
      await feld(0).fill("1490"); await feld(0).blur();
      await feld(2).fill("40"); await feld(2).blur();
      const total = KR.reduce((s, i) => s + i.kg, 0);
      let lauf = 1490; const soll = [];
      KR.filter(i => i.kg > 0).forEach(i => {
        const z = G2.find(b => (i.type || b.type) ? i.type === b.type : i.name === b.name);
        const ist = i.kg / total * 1490, s = z ? z.kg * 40 : 0; lauf += s - ist;
        soll.push([ist.toFixed(1), s.toFixed(1), lauf.toFixed(1)]);
      });
      assert.deepStrictEqual((await tabelle()).map(z => [z[1], z[2], z[4]]), soll);
    });

    await pruefe("Aufwerten speichern (nächster Tag): NUR die Zugabe (AGF/MLF), nichts für weniger Grassilage; Lager nur um die Zugabe", async () => {
      // neuer Tag, damit wieder gespeichert werden darf
      await page.evaluate(() => { window.__getTodayAlt = getToday; window.getToday = () => { const d = new Date(Date.now() + 86400000); return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear(); }; buildCalc(); });
      const vorher = await lager();
      const total = KR.reduce((s, i) => s + i.kg, 0);
      const anteil = typ => KR.find(i => i.type === typ).kg / total * 1490;
      const agf = 6 * 40 - anteil("agf"), mlf = 3.5 * 40 - anteil("mlf");
      await kasten().locator("button.save-btn").click();
      const e = await page.evaluate(() => historyData.find(h => h.kategorie === "kuehe2" && h.datum === getToday()));
      assert.deepStrictEqual(e.futter.map(f => f.name), [S1.backup.globalCfg.agfName, S1.backup.globalCfg.mlfName], JSON.stringify(e.futter));
      assert(nah(e.futter[0].kg, agf) && nah(e.futter[1].kg, mlf));
      const nach = await lager();
      assert(nah(vorher[0] - nach[0], agf) && nah(vorher[1] - nach[1], mlf), "Lager " + (vorher[0] - nach[0]) + "/" + (vorher[1] - nach[1]));
    });

    await pruefe("History: Gruppenwerte ab 1000 kg in Tonnen, darunter kg; Lager und Lieferungen bleiben kg", async () => {
      await page.evaluate(() => { historyCollapsed.tageslog = false; historyCollapsed.kategorien.kuehe = true; historyCollapsed.jahre["kuehe_2026"] = true; buildHistory(); showTab("history"); });
      const h = await page.textContent("#history");
      const sum = S1.backup.historyData.filter(e => e.kategorie === "kuehe" && e.datum.endsWith("2026")).reduce((s, e) => s + e.gesamt, 0)
        + (await page.evaluate(() => historyData.filter(e => e.kategorie === "kuehe" && e.datum.endsWith("2026") && !e.id.startsWith("t")).reduce((s, e) => s + e.gesamt, 0)));
      assert(/Gesamt:\s+\d+\.\d\d t/.test(h), "keine Tonnen in der Jahressumme: " + h.replace(/\s+/g, " ").slice(0, 300));
      const lagerTeil = h.slice(h.indexOf("Lagerbestand"));
      assert(/Bestand:\s+\d+\.\d kg/.test(lagerTeil) && !/Bestand:\s+[\d.]+ t/.test(lagerTeil), "Lager nicht in kg");
      assert.strictEqual(await page.evaluate(() => mengeText(999.94)), "999.9 kg");
      assert.strictEqual(await page.evaluate(() => mengeText(1000)), "1.00 t");
      assert.strictEqual(await page.evaluate(() => mengeText(84099)), "84.10 t");
      assert(sum > 0);
    });

    await pruefe("Alte Jahre löschen: Knopf zeigt 2025; nach Rückfrage Backup + Löschen; letzte 31 Tage, Lager, Lieferungen bleiben", async () => {
      await page.evaluate(() => { window.getToday = window.__getTodayAlt; buildHistory(); });
      const vorher = await page.evaluate(() => ({ n: historyData.length, alt: alteEintraege().length, lager: JSON.stringify(lagerData), lief: JSON.stringify(lieferungen),
        neu: historyData.filter(e => !alteEintraege().includes(e)).map(e => e.id) }));
      assert(vorher.alt > 0, "keine alten Einträge im Test");
      assert((await page.locator("#alte-jahre-loeschen").innerText()).includes("2025"));
      const dl = page.waitForEvent("download", { timeout: 10000 });
      await page.click("#alte-jahre-loeschen");
      await dl;   // Backup wurde erstellt
      assert(meldungen.some(m => m.includes("löschen") && m.includes("Backup")));
      const nach = await page.evaluate(() => ({ n: historyData.length, ids: historyData.map(e => e.id), jahre: [...new Set(historyData.map(e => e.datum.split(".")[2]))],
        lager: JSON.stringify(lagerData), lief: JSON.stringify(lieferungen) }));
      assert.strictEqual(nach.n, vorher.n - vorher.alt);
      assert.deepStrictEqual(nach.ids, vorher.neu);
      assert(!nach.jahre.includes("2025"), "2025 noch da");
      assert.strictEqual(nach.lager, vorher.lager); assert.strictEqual(nach.lief, vorher.lief);
      assert.strictEqual(await page.locator("#alte-jahre-loeschen").count(), 0);
    });

    await pruefe("Letzte 31 Tage bleiben, auch wenn sie aus dem alten Jahr sind (Lager-Durchschnitt)", async () => {
      const r = await page.evaluate(() => {
        const RealDate = Date; const fest = new RealDate(2027, 0, 10);
        const alt = historyData; historyData = [{ datum: "28.12.2026", kategorie: "kuehe", gesamt: 1, futter: [] }, { datum: "15.11.2026", kategorie: "kuehe", gesamt: 1, futter: [] }];
        window.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fest])); } static now() { return fest.getTime(); } };
        const weg = alteEintraege().map(e => e.datum);
        window.Date = RealDate; historyData = alt;
        return weg;
      });
      assert.deepStrictEqual(r, ["15.11.2026"]);
    });

    await pruefe("Nach dem Neuladen: Gruppe 2 mit Ration, Modus und Name da", async () => {
      await page.evaluate(async () => { await cloudSyncFertig(); ["futter", "gCfg", "history", "lager", "lieferungen"].forEach(k => localStorage.removeItem(k)); });
      await page.reload();
      await zugang.warteAufApp(page, "emulator", true);
      await page.waitForTimeout(1000);
      const s = await page.evaluate(() => [globalCfg.kuehe2Name, globalCfg.kuehe2Modus, data.kuehe2.anz, data.kuehe2.rest, data.kuehe2.items.find(i => i.type === "agf").kg]);
      assert.deepStrictEqual(s, ["Hochleistung", "aufwerten", 40, 1490, 6]);
    });

    await pruefe("Altes Backup ohne Gruppe 2 laden → Gruppe 2 leer ergänzt, keine Fehler", async () => {
      await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
      await page.waitForFunction(() => data.kuehe2 && data.kuehe2.anz === 0);
      await page.evaluate(() => showTab("calc"));
      assert(await kasten().isVisible());
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(m => m.startsWith("SEITENFEHLER")), [], meldungen.filter(m => m.startsWith("SEITENFEHLER")).join(" | "));
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nKUEHE2-TEST ROT (${fehler} Fehler)` : "\nKUEHE2-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
