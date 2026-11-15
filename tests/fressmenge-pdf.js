// Test Paket Fressmengen, Punkte 4/5: Berater-Ration als PDF (GS-agri-Rationsblatt) – doppelt lesen, Gegenprobe, Vorschau, Übernehmen.
// Teil 1 (öffentlich): Muster-PDF mit erfundenen Zahlen im gleichen Aufbau wird hier erzeugt; dazu Fehlerfälle
//   (verfälschte Zahl, verrutschte Spalte, fremdes Blatt). Teil 2 (privat): Fritz' echtes PDF aus tests/privat/
//   (nicht im Repository) wird Wert für Wert gegen tests/privat/ration-11-2026.erwartet.json geprüft.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/fressmenge-pdf.js"
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5079;
const PRIVAT_PDF = path.join(__dirname, "privat", "ration-11-2026.pdf");
const PRIVAT_ERW = path.join(__dirname, "privat", "ration-11-2026.erwartet.json");

// Muster-Rationsblatt (erfundene Zahlen) in Punkt-Koordinaten wie das GS-agri-Blatt (y von unten)
const KOPF = [[241, "kg FM"], [283, "kg TM"], [329, "NEL"], [365, "RP"], [398, "nXP"], [435, "RNB"], [477, "Ca"], [504, "P"], [540, "PREIS"]];
const SPALTE_RECHTS = [265, 307, 343, 379, 413, 452, 490, 513, 566];
function seiteHtml(titel, zeilen, total, kennz) {
  const t = (x, y, s, rechts) => `<div style="position:absolute;${rechts ? `right:${595 - x}pt` : `left:${x}pt`};top:${842 - y - 7}pt;font-size:8pt;white-space:pre">${s}</div>`;
  let h = t(123, 766, "GS agri e.G.") + t(162, 752, "Rationsberechnung") + t(34, 739, "BETRIEB") + t(132, 739, "05.01.2027 Milchvieh Standard") + t(125, 726, titel);
  h += t(34, 668, "Stallration/Teil TMR (kg)") + KOPF.map(([x, s]) => t(x, 668, s)).join("");
  const zeile = (y, name, werte) => t(name === "Total" ? 34 : 75, y, name) + werte.map((w, i) => w === null ? "" : t(SPALTE_RECHTS[i], y, w, true)).join("");
  zeilen.forEach((z, i) => { h += zeile(642 - i * 13, z[0], z.slice(1)); });
  h += zeile(642 - zeilen.length * 13 - 1, "Total", total.concat([null]));
  let y = 546; h += t(34, y, "Ration Kennziffern");
  kennz.forEach(([l, v, e]) => { y -= 13; h += t(34, y, l) + t(155, y, v) + t(185, y, e); });
  h += t(223, 28, titel) + t(547, 29, "1 / 1");
  return `<div style="position:relative;width:595pt;height:842pt;page-break-after:always">${h}</div>`;
}
const MUSTER = [
  seiteHtml("Musterhof 01-27 alter Stall", [
    ["Mais Musterhof 25|09-26 ...", "30,0", "10,5", "70,0", "850", "1450", "-95,0", "16,0", "21,0", "45,00"],
    ["Gras Musterhof 05-26 ...", "10,0", "3,0", "18,0", "560", "400", "26,0", "14,0", "11,0", "35,00"],
    ["Stroh", "0,5", "0,4", "1,5", "15", "3", "1,8", "0,6", "0,4", "36,00"],
    ["GS AGF Musterhof 123-...", "3,0", "2,7", "21,0", "870", "610", "42,0", "65,0", "24,0", "371,50"]
  ], ["43,5", "16,6", "110,5", "2295", "2463", "-25,2", "95,6", "56,4"],
  [["TM-Aufn.", "16,6", "Kg/T/Tag"], ["TM", "38", "%"], ["NEL", "6,7", "/ kg TM"], ["RP", "138", "g / kg TM"], ["nXP", "148", "g / kg TM"]]),
  seiteHtml("Musterhof 01-27 neuer Stall", [
    ["Mischung alter Stall 01-27", "40,0", "15,3", "101,6", "2110", "2265", "-23,2", "87,9", "51,9", "65,11"],
    ["GS MLF 184 Stabil", "4,0", "3,6", "26,8", "700", "728", "-4,4", "34,0", "21,6", "305,00"]
  ], ["44,0", "18,9", "128,4", "2810", "2993", "-27,6", "121,9", "73,5"],
  [["TM-Aufn.", "18,9", "Kg/T/Tag"], ["TM", "43", "%"], ["NEL", "6,8", "/ kg TM"], ["RP", "149", "g / kg TM"], ["nXP", "158", "g / kg TM"]])
];

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 6).join("\n   ")); }
  };
  // Muster-PDFs erzeugen
  const erzeuger = await browser.newPage();
  const pdfAus = async html => { await erzeuger.setContent(`<html><body style="margin:0">${html}</body></html>`); return erzeuger.pdf({ width: "210mm", height: "297mm", printBackground: false }); };
  const muster = await pdfAus(MUSTER.join(""));
  const fremd = await pdfAus(`<div style="padding:40pt;font-size:12pt"><h1>Lieferschein</h1><table><tr><td>Mais</td><td>12,0</td></tr><tr><td>Total</td><td>12,0</td></tr></table></div>`);
  fs.mkdirSync(path.join(__dirname, ".tmp"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, ".tmp", "muster-ration.pdf"), muster);

  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  const page = await context.newPage();
  const meldungen = [];
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(d.type() === "prompt" ? "0" : undefined); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await zugang.vorbereiten(context, page, "emulator");
  const lesen = async bytes => page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    window.__items = await fmPdfText(bytes);
    return fmRationLesen(window.__items);
  }, Buffer.from(bytes).toString("base64"));
  const nah = (a, b, tol, was) => assert(Math.abs(a - b) <= (tol || 1e-9), `${was}: ${a} statt ${b}`);

  try {
    await page.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
    await zugang.warteAufApp(page, "emulator");

    await pruefe("Normale App lädt pdf.js nicht von selbst (erst beim Hochladen)", async () => {
      assert.strictEqual(await page.evaluate(() => !!window.pdfjsLib), false);
    });

    let m;
    await pruefe("Muster-PDF: beide Seiten erkannt, alle Werte doppelt gleich gelesen, keine Fehler", async () => {
      m = await lesen(muster);
      assert.strictEqual(m.seiten.length, 2);
      assert.strictEqual(await page.evaluate(() => pdfjsLib.version), "3.11.174");
      m.seiten.forEach((s, i) => assert.deepStrictEqual(s.fehler, [], "Seite " + (i + 1) + ": " + s.fehler.join(" | ")));
      assert.deepStrictEqual(m.seiten.map(s => s.titel), ["Musterhof 01-27 alter Stall", "Musterhof 01-27 neuer Stall"]);
      assert.strictEqual(m.seiten[0].datum, "2027-01-05");
      assert.deepStrictEqual(m.seiten[0].zeilen.map(z => z.werte.fm), [30, 10, 0.5, 3]);
      assert.deepStrictEqual(m.seiten[0].zeilen[3].werte, { fm: 3, tm: 2.7, nel: 21, rp: 870, nxp: 610, rnb: 42, ca: 65, p: 24, preis: 371.5 });
      assert.deepStrictEqual(m.seiten[0].total.werte, { fm: 43.5, tm: 16.6, nel: 110.5, rp: 2295, nxp: 2463, rnb: -25.2, ca: 95.6, p: 56.4 });
      assert.strictEqual(m.seiten[0].kennziffern.tsProzent, 38);
      assert.strictEqual(m.seiten[0].zeilen[2].ungenau, true, "kleine Menge Stroh nicht als ungenau markiert");
    });

    await pruefe("„Mischung alter Stall“ auf Seite 2 = Ration von Seite 1 (Anteil, Nährstoffe, Preis geprüft) → komplette Ration für Stall 2", async () => {
      const z = m.seiten[1].zeilen[0];
      assert.strictEqual(z.basis.seite, 0);
      nah(z.basis.anteil, 40 / 43.5, 1e-9, "Anteil");
      const k = await page.evaluate(() => fmKomplett(fmRationLesen(window.__items), 1).map(x => Math.round(x.kg * 10000) / 10000));
      assert.deepStrictEqual(k, [27.5862, 9.1954, 0.4598, 2.7586, 4]);
      nah(k.reduce((a, b) => a + b, 0), 44, 1e-3, "Summe komplett");
    });

    await pruefe("Verfälschte Zahl (Mais 30,0 → 31,0) → Summe passt nicht zu „Total“", async () => {
      const r = await page.evaluate(() => { const it = JSON.parse(JSON.stringify(window.__items)); it[0].find(x => x.s.trim() === "30,0").s = "31,0"; return fmRationLesen(it).seiten[0].fehler; });
      assert(r.some(f => f.includes("Summe kg FM")), r.join(" | "));
    });

    await pruefe("Verrutschte Zahl (Spalte unklar) → „nicht sicher gelesen“", async () => {
      const r = await page.evaluate(() => { const it = JSON.parse(JSON.stringify(window.__items)); const x = it[0].find(x => x.s.trim() === "850"); x.x += 30; return fmRationLesen(it).seiten[0].fehler; });
      assert(r.some(f => f.includes("nicht sicher gelesen")), r.join(" | "));
    });

    await pruefe("„Mischung …“ passt nicht zur Grundration (Preis/Nährstoffe geändert) → Fehler", async () => {
      const r = await page.evaluate(() => { const it = JSON.parse(JSON.stringify(window.__items)); it[1].find(x => x.s.trim() === "65,11").s = "70,00"; return fmRationLesen(it).seiten[1].fehler; });
      assert(r.some(f => f.includes("Preis passt nicht")), r.join(" | "));
    });

    await pruefe("Kennziffer passt nicht (TM % 38 → 45) → Fehler", async () => {
      const r = await page.evaluate(() => { const it = JSON.parse(JSON.stringify(window.__items)); it[0].find(x => x.s.trim() === "38").s = "45"; return fmRationLesen(it).seiten[0].fehler; });
      assert(r.some(f => f.includes("Kennziffer TM %")), r.join(" | "));
    });

    await pruefe("Fremdes Blatt → „Unbekannter Aufbau“, kein „Übernehmen“", async () => {
      const f = await lesen(fremd);
      assert(f.seiten[0].fehler[0].includes("Unbekannter Aufbau"));
      await page.click("#fm-tab");
      await page.setInputFiles("#fm-pdf-datei", { name: "lieferschein.pdf", mimeType: "application/pdf", buffer: fremd });
      await page.waitForSelector("#fm-import");
      assert((await page.textContent("#fm-import")).includes("Unbekannter Aufbau"));
      assert.strictEqual(await page.locator("#fm-import-ok").count(), 0);
      await page.click("#fm-import >> text=Abbrechen");
    });

    await pruefe("Vorschau Muster-PDF: nur Futterwerte (keine Mischungs-Auswahl), AGF/MLF erkannt, Name vor dem Übernehmen änderbar", async () => {
      await page.evaluate(() => { data.kuehe.items[0].name = "Maissilage"; data.kuehe.items[1].name = "Grassilage"; });
      await page.setInputFiles("#fm-pdf-datei", { name: "muster.pdf", mimeType: "application/pdf", buffer: muster });
      await page.waitForSelector("#fm-import .fm-import-seite");
      assert(!(await page.textContent("#fm-import")).includes("Für Mischung"), "Mischungs-Auswahl in der Vorschau");
      assert((await page.textContent("#fm-import")).includes("Deine Mengen bleiben"));
      assert((await page.textContent("#fm-import")).includes("✓ Alle Werte doppelt gelesen"));
      // Vorschlag aus den eigenen Futter-Namen: „Mais …“ → Maissilage, „Gras …“ → Grassilage
      assert.deepStrictEqual(await page.evaluate(() => fmImport.seiten[0].zeilen.map(z => [z.ziel.typ, z.ziel.name])), [["futter", "Maissilage"], ["futter", "Grassilage"], ["futter", "Stroh"], ["agf", await page.evaluate(() => globalCfg.agfName)]]);
      assert.strictEqual(await page.evaluate(() => fmImport.seiten[1].zeilen[1].ziel.typ), "mlf");
      const feld = page.locator("#fm-import .fm-import-name").first();
      await feld.fill("Maissilage neu"); await feld.dispatchEvent("change");
      assert.strictEqual(await page.evaluate(() => fmImport.seiten[0].zeilen[0].ziel.name), "Maissilage neu");
    });

    await pruefe("Übernehmen: nur Werte je Futter (TS, Nährstoffe, Preis) gespeichert, Mengen/Rationen unverändert; Tabelle „Futtermittel“", async () => {
      const vorher = await page.evaluate(() => JSON.stringify(data));
      await page.click("#fm-import-ok");
      assert.strictEqual(await page.locator("#fm-import").count(), 0);
      assert(meldungen.some(x => x.includes("Werte für 5 Futtermittel übernommen")), meldungen.join(" | "));
      assert.strictEqual(await page.evaluate(() => JSON.stringify(data)), vorher);
      const r = await page.evaluate(() => ({ mais: fmCfg.komponenten["Maissilage neu"][0], agf: fmCfg.komponenten.agf[0], mlf: fmCfg.komponenten.mlf[0], schl: Object.keys(fmCfg.komponenten) }));
      assert.deepStrictEqual(r.schl, ["Maissilage neu", "Grassilage", "Stroh", "agf", "mlf"]);
      nah(r.mais.ts, 35, 1e-9, "TS Mais"); nah(r.mais.nel, 70 / 30, 1e-9, "NEL je kg"); assert.strictEqual(r.mais.preis, 45);
      nah(r.agf.preis, 371.5, 0, "Preis AGF"); nah(r.mlf.ts, 90, 1e-9, "TS MLF");
      const t = await page.locator("#fm-rationen .fm-futtermittel").innerText();
      assert(t.includes("Maissilage neu\t45,00\t35") && t.includes("Stroh\t36,00\t80 ≈"), t);
    });

    await pruefe("Futtermittel-Zeile antippen → Preis und TS ändern (Nährstoffe je kg passen sich der TS an)", async () => {
      page.removeAllListeners("dialog");
      const antworten = ["48", "33"];
      page.on("dialog", d => { meldungen.push(d.message()); d.accept(d.type() === "prompt" ? antworten.shift() : undefined); });
      await page.click('#fm-rationen tr[data-futter="Maissilage neu"]');
      const m = await page.evaluate(() => { const l = fmCfg.komponenten["Maissilage neu"]; return l[l.length - 1]; });
      assert.strictEqual(m.preis, 48); assert.strictEqual(m.ts, 33); nah(m.nel, 70 / 30 * 33 / 35, 1e-9, "NEL je kg nach TS");
      page.removeAllListeners("dialog");
      page.on("dialog", d => { meldungen.push(d.message()); d.accept(d.type() === "prompt" ? "0" : undefined); });
    });

    await pruefe("Ration = Mengen aus den Einstellungen × Futterwerte (TS der Mischung, Hinweise)", async () => {
      const r = await page.evaluate(() => { const k = data.kuehe.items; k.forEach(i => i.kg = 0); k[0].name = "Maissilage neu"; k[0].kg = 30; k.find(i => i.type === "agf").kg = 3; buildCalc();
        const x = fmRationVon("kuehe"); return { fm: x.total.fm, tm: x.total.tm, ts: fmTsVon("kuehe"), fehlt: x.fehlt }; });
      nah(r.fm, 33, 1e-9, "kg FM"); nah(r.tm, 30 * 0.33 + 3 * 0.9, 1e-9, "kg TM"); assert.deepStrictEqual(r.fehlt, []);
      nah(r.ts, (30 * 0.33 + 3 * 0.9) / 33, 1e-9, "TS");
    });

    if (fs.existsSync(PRIVAT_PDF) && fs.existsSync(PRIVAT_ERW)) {
      const erw = JSON.parse(fs.readFileSync(PRIVAT_ERW, "utf8"));
      let echt;
      await pruefe("PRIVAT: Fritz' Berater-PDF – beide Seiten, jeder Wert wie erwartet, keine Fehler", async () => {
        echt = await lesen(fs.readFileSync(PRIVAT_PDF));
        assert.deepStrictEqual(echt.seiten.map(s => s.fehler), [[], []], JSON.stringify(echt.seiten.map(s => s.fehler)));
        assert.deepStrictEqual(echt.seiten.map(s => s.titel), erw.titel);
        assert.deepStrictEqual(echt.seiten.map(s => s.datum), erw.datum);
        erw.zeilen.forEach((zeilen, i) => {
          assert.strictEqual(echt.seiten[i].zeilen.length, zeilen.length, "Anzahl Zeilen Seite " + (i + 1));
          zeilen.forEach((w, j) => assert.deepStrictEqual(echt.seiten[i].zeilen[j].werte, w, `Seite ${i + 1} Zeile ${j + 1}`));
        });
        erw.total.forEach((w, i) => assert.deepStrictEqual(echt.seiten[i].total.werte, w, "Total Seite " + (i + 1)));
        erw.kennziffern.forEach((k, i) => assert.deepStrictEqual(echt.seiten[i].kennziffern, k, "Kennziffern Seite " + (i + 1)));
      });
      await pruefe("PRIVAT: „Mischung alter Stall 11-26“ = Ration alter Stall; komplette Ration neuer Stall stimmt", async () => {
        const z = echt.seiten[erw.basis.seite].zeilen[erw.basis.zeile];
        assert.strictEqual(z.basis.seite, erw.basis.aufSeite);
        nah(z.basis.anteil, erw.basis.anteil, 1e-6, "Anteil");
        const k = await page.evaluate(() => fmKomplett(fmRationLesen(window.__items), 1).map(x => Math.round(x.kg * 10000) / 10000));
        assert.deepStrictEqual(k, erw.komplettStall2);
        nah(k.reduce((a, b) => a + b, 0), 53.5, 1e-3, "Summe");
      });
      await pruefe("PRIVAT: Vorschau – AGF/MLF erkannt, Stroh 0,2 kg als ungenau markiert", async () => {
        await page.evaluate(() => { ["Maissilage", "Grassilage", "Gras 02-26", "Stroh"].forEach((n, i) => { data.kuehe.items[i].name = n; }); });
        await page.setInputFiles("#fm-pdf-datei", { name: "ration.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(PRIVAT_PDF) });
        await page.waitForSelector("#fm-import .fm-import-seite");
        // Zuordnung zu den eigenen Namen: „Gras 02-26 Stickt…“ → Gras 02-26 (genauer Anfang), „Gras 05-25/Dairy…“ → Grassilage
        assert.deepStrictEqual(await page.evaluate(() => fmImport.seiten[0].zeilen.map(z => z.ziel.name)), ["Maissilage", "Grassilage", "Gras 02-26", "Stroh", await page.evaluate(() => globalCfg.agfName)]);
        await page.waitForSelector("#fm-import .fm-import-seite");
        const r = await page.evaluate(() => ({ typen: fmImport.seiten[0].zeilen.map(z => z.ziel.typ), mlf: fmImport.seiten[1].zeilen[1].ziel.typ, stroh: fmImport.seiten[0].zeilen[3].ungenau }));
        assert.deepStrictEqual(r.typen, erw.typen); assert.strictEqual(r.mlf, "mlf"); assert.strictEqual(r.stroh, true);
        assert((await page.textContent("#fm-import")).includes("✓ Alle Werte doppelt gelesen"));
        await page.click("#fm-import >> text=Abbrechen");
      });
    } else console.log("(privater Teil übersprungen – tests/privat/ fehlt)");

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(x => x.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nPDF-TEST ROT (${fehler} Fehler)` : "\nPDF-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
