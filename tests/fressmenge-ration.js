// Test Paket Fressmengen, Punkte 6/7/13: Auswertung in kg TM, Milch aus Energie, drei Zahlen, Hinweise zur Ration,
// eigene Variante + Rationsvergleich, Rationswechsel über mehrere Tage (auf Basis TM). Werte von Hand nachgerechnet.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/fressmenge-ration.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5082;
const tt = d => String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const tagMinus = n => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - n); return d; };

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 6).join("\n   ")); }
  };
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  await context.route(/api\.open-meteo\.com/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ daily: { time: [], temperature_2m_max: [], relative_humidity_2m_mean: [], precipitation_sum: [] } }) }));
  const page = await context.newPage();
  const meldungen = [];
  let promptAntwort = "0";
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(d.type() === "prompt" ? promptAntwort : undefined); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await zugang.vorbereiten(context, page, "emulator");
  const nah = (a, b, tol, was) => assert(Math.abs(a - b) <= tol, `${was}: ${a} statt ${b}`);

  try {
    await page.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
    await zugang.warteAufApp(page, "emulator");
    // Ausgangslage: Gruppe Kühe (Stall s1), MLP 30 kg Milch, 4,2 % Fett, 3,5 % Eiweiß; Komponenten mit Werten je kg FM
    await page.evaluate(([h]) => {
      fmCfg.gruppen = [{ id: "g1", name: "Hochleistung", karte: "kuehe", art: "rest", staelle: ["s1"], auswerten: true }];
      fmMlp = { mlpDatum: "2026-10-20", staelle: { s1: { milchSumme: 1200, anzahl: 40, fettKgSumme: 50.4, eiweissKgSumme: 42, harnstoffMalMilchSumme: 240000, anzahlFrische: 10, anzahlFrischeFeqUeber15: 1, anzahlFrischeEiweissUnter31: 2 } } };
      fmCfg.komponenten = {
        Mais: [{ ab: "2026-11-05", ts: 35, nel: 2.3, rp: 28, nxp: 46, rnb: -3, ca: 0.6, p: 0.7, preis: 45 }],
        agf: [{ ab: "2026-11-05", ts: 89, nel: 6.9, rp: 287, nxp: 202, rnb: 14, ca: 21, p: 8, preis: 370 }],
        Gras: [{ ab: "2026-11-05", ts: 30, nel: 1.9, rp: 50, nxp: 40, rnb: 2, ca: 1.5, p: 1, preis: 35 }]
      };
      data.kuehe.items.forEach(i => i.kg = 0); data.kuehe.items[0].name = "Mais"; data.kuehe.items[0].kg = 40; data.kuehe.items.find(i => i.type === "agf").kg = 4;
      historyData = h; fmSpeichern();
    }, [[1, 2, 3, 4, 5, 6].flatMap(n => [
      { id: "v" + n, datum: tt(tagMinus(n)), kategorie: "kuehe", tiere: 40, gesamt: 2000, agf: 0, mlf: 0, futter: [] },
      { id: "r" + n, datum: tt(tagMinus(n - 1)), kategorie: "restbullen", tiere: 9, gesamt: 0, agf: 0, mlf: 0, futter: [] }])]);
    for (let n = 1; n <= 6; n++) await page.evaluate(d => { fmTag(d).rest = { kuehe: 80 }; fmTageMerken(); }, iso(tagMinus(n - 1)));

    await pruefe("Mit Berater-Ration: gefressen je Tier in kg TM (48 kg FM × TS 39,9 %), Empfehlung in kg TM", async () => {
      const r = await page.evaluate(() => { const t = fmReihe(fmCfg.gruppen[0]).pop(); return { fm: t.jeTier, tm: t.jeTierTm, feld: fmFeld(fmCfg.gruppen[0]) }; });
      nah(r.fm, 48, 1e-9, "kg FM"); nah(r.tm, 48 * 17.56 / 44, 1e-9, "kg TM");
      assert.deepStrictEqual(r.feld, { k: "jeTierTm", e: "kg TM" });
      await page.evaluate(() => { [1, 2, 3, 4, 5, 6].forEach(n => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - n + 1); fmTag(fmIso(d)).rest = { kuehe: 20 }; }); showTab("fressmenge"); });
      const t = await page.textContent('.fm-auswertung[data-gruppe="g1"] .fm-text');
      // 44 kg FM × 0,3991 TS × 1,03 = 18,09 kg TM
      assert(t.includes("Fressmenge +3 %") && t.includes("→ Rest-Zuschlag 7 %"), t);
      await page.evaluate(() => { [1, 2, 3, 4, 5, 6].forEach(n => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - n + 1); fmTag(fmIso(d)).rest = { kuehe: 80 }; }); fmTageMerken(); });
    });

    await pruefe("Drei Zahlen im Verlauf: Milch möglich / MLP, Milchgeld − Futter, Futterkosten (Milchpreis fehlt → Hinweis)", async () => {
      await page.evaluate(() => { fmCfg.milchpreisMlp = "2026-10-20"; fmOffen = "g1"; fmAnsicht = "liste"; fmBauen(); });
      const t = await page.textContent(".fm-drei");
      // Milch aus Energie: (19,155 kg TM × 6,811 MJ − 37,3) / (0,38·4,2 + 0,21·3,5 + 1,05) = 27,6 kg
      const tm = 48 * 17.56 / 44, erwMilch = (tm * (119.6 / 17.56) - 37.3) / (0.38 * 4.2 + 0.21 * 3.5 + 1.05);
      assert(t.includes(`${erwMilch.toFixed(1).replace(".", ",")} / 30,0 kg`), t);
      assert(t.includes("Fett 4,20 %, Eiweiß 3,50 %"), t);
      assert(t.includes("Milchpreis fehlt"), t);
      await page.evaluate(() => { fmCfg.milchpreis = 45; fmBauen(); });
      // 30 kg × 0,45 € − (40 × 45 + 4 × 370)/1000 € = 13,50 − 3,28 = 10,22 €
      assert((await page.textContent(".fm-drei")).includes("10,22 €/Tag"), await page.textContent(".fm-drei"));
    });

    await pruefe("Neue MLP → einmal Frage nach dem Milchpreis (letzter vorausgefüllt), danach nicht mehr", async () => {
      await page.evaluate(() => { fmMlp.mlpDatum = "2026-11-18"; fmOffen = null; fmBauen(); });
      assert((await page.textContent("#fm-frage")).includes("Neue MLP vom 18.11.2026"));
      assert.strictEqual(await page.inputValue("#fm-milchpreis-frage"), "45");
      await page.fill("#fm-milchpreis-frage", "47,5");
      await page.click("#fm-frage >> text=Speichern");
      assert.strictEqual(await page.evaluate(() => fmCfg.milchpreis), 47.5);
      assert.strictEqual(await page.locator("#fm-frage").count(), 0);
      await page.evaluate(() => { fmCfg.milchpreis = 45; fmSpeichern(); });
    });

    await pruefe("Hinweise zur Ration: nur Auffälligkeiten (RNB negativ, Energie knapp für MLP-Leistung)", async () => {
      const h = await page.evaluate(() => fmRationHinweise(fmRationVon("kuehe"), fmCfg.gruppen[0]));
      assert(h.some(x => x.startsWith("RNB negativ (-64,0 g)")), h.join(" | "));
      assert(h.some(x => x === "Energie knapp: reicht für 24,3 kg Milch, MLP 30,0 kg"), h.join(" | "));
      assert(!h.some(x => /Calcium|Phosphor|TS der/.test(x)), "unnötiger Hinweis: " + h.join(" | "));
      assert((await page.textContent('#fm-rationen .fm-ration[data-karte="kuehe"]')).includes("2 Hinweise"));
    });

    await pruefe("Unterschalter „Rationsvergleich“ aus → keine Hinweise", async () => {
      await page.evaluate(() => { fmCfg.rationsvergleich = false; fmBauen(); });
      assert.strictEqual(await page.locator(".fm-ration").count(), 0);
      await page.evaluate(() => { fmCfg.rationsvergleich = true; fmBauen(); });
    });

    await pruefe("Eigene Variante: Mais 40 → 46 kg; Vergleich nebeneinander (Milch aus Energie, Futter je Kuh, Milchgeld − Futter); „Diese nehmen“ in der Testversion gesperrt", async () => {
      await page.click('#fm-rationen .fm-ration[data-karte="kuehe"] button');
      await page.click("text=+ Eigene Variante");
      const feld = page.locator(".fm-variante input").first();
      await feld.fill("46"); await feld.dispatchEvent("change");
      const tab = await page.locator(".fm-vergleich table").innerText();
      // Berater: 24,3 kg Milch, 3,28 €; Variante: (133,4 − 37,3)/3,381 = 28,4 kg, 2,07 + 1,48 = 3,55 €
      assert(tab.includes("Berater") && tab.includes("Eigene Variante 1"), tab);
      assert(tab.includes("24,3 kg") && tab.includes("28,4 kg"), tab);
      assert(tab.includes("3,28 €") && tab.includes("3,55 €"), tab);
      // Milchgeld − Futter: 24,34 × 0,45 − 3,28 = 7,67 €; 28,42 × 0,45 − 3,55 = 9,24 €
      assert(tab.includes("7,67 €") && tab.includes("9,24 €"), tab);
      assert(await page.locator('.fm-variante button:has-text("Diese nehmen")').isDisabled());
    });

    await pruefe("Rationswechsel (TM-Basis): Tag 5 von 10 = halber Weg je Komponente; neue Komponente von 0, Ende = neue Ration", async () => {
      const r = await page.evaluate(() => {
        const von = [{ name: "Mais", typ: "futter", kg: 40 }, { name: globalCfg.agfName, typ: "agf", kg: 4 }];
        const nach = [{ name: "Mais", typ: "futter", kg: 30 }, { name: "Gras", typ: "futter", kg: 20 }, { name: globalCfg.agfName, typ: "agf", kg: 4 }];
        fmWechselStarten("kuehe", von, nach, 10);
        const w = fmCfg.wechsel.kuehe; const d = new Date(); d.setHours(12); d.setDate(d.getDate() - 4); w.start = fmIso(d);
        const ende = new Date(); ende.setDate(ende.getDate() + 20);
        return { tag: fmWechselTag(w), heute: fmWechselRation(w).zeilen.map(z => [z.name, Math.round(z.kg * 1000) / 1000]),
          ende: fmWechselRation(w, fmIso(ende)).zeilen.map(z => [z.name, Math.round(z.kg * 1000) / 1000]),
          tag1: (() => { const w2 = { ...w, start: fmIso(new Date()) }; return [fmWechselTag(w2), fmWechselRation(w2).zeilen.map(z => [z.name, Math.round(z.kg * 1000) / 1000])]; })() };
      });
      assert.strictEqual(r.tag, 5);
      // Mais TM 14 → 10,5: halb = 12,25 kg TM = 35 kg FM; Gras 0 → 6 kg TM: halb = 3 kg TM = 10 kg FM
      assert.deepStrictEqual(r.heute, [["Mais", 35], [await page.evaluate(() => globalCfg.agfName), 4], ["Gras", 10]]);
      assert.deepStrictEqual(r.ende, [["Mais", 30], [await page.evaluate(() => globalCfg.agfName), 4], ["Gras", 20]]);
      assert.strictEqual(r.tag1[0], 1);
      assert.deepStrictEqual(r.tag1[1], [["Mais", 39], [await page.evaluate(() => globalCfg.agfName), 4], ["Gras", 2]]);
    });

    await pruefe("Rationswechsel im Reiter: „Tag 5 von 10“, Pausieren hält an, Dauer ändern, Testversion verändert den Rechner nicht", async () => {
      const vorher = await page.evaluate(() => JSON.stringify(data));
      await page.evaluate(() => { fmSpeichern(); showTab("fressmenge"); });
      assert((await page.textContent('.fm-wechsel[data-karte="kuehe"]')).includes("Rationswechsel Kühe: Tag 5 von 10"));
      await page.click('.fm-wechsel[data-karte="kuehe"] >> text=Pausieren');
      assert(await page.evaluate(() => !!fmCfg.wechsel.kuehe.pause));
      await page.click('.fm-wechsel[data-karte="kuehe"] >> text=Fortsetzen');
      promptAntwort = "20";
      await page.click('.fm-wechsel[data-karte="kuehe"] >> text=Dauer ändern');
      assert.strictEqual(await page.evaluate(() => fmCfg.wechsel.kuehe.tage), 20);
      assert((await page.textContent('.fm-wechsel[data-karte="kuehe"]')).includes("Tag 5 von 20"));
      assert.strictEqual(await page.evaluate(() => JSON.stringify(data)), vorher, "Testversion hat den Rechner verändert");
      promptAntwort = "0";
    });

    await pruefe("Normale App: Wechsel schreibt die Tagesration einmal je Tag in die Mischung; „Abbrechen“ = wieder alte Ration", async () => {
      const r = await page.evaluate(() => {
        const merk = JSON.stringify(data), merkW = JSON.stringify(fmCfg.wechsel); istTestversion = false;
        fmCfg.wechsel.kuehe.tage = 10; delete fmCfg.wechsel.kuehe.angewendet;
        fmWechselAnwenden();
        const heute = data.kuehe.items.filter(i => i.kg > 0).map(i => [i.type || i.name, i.kg]);
        data.kuehe.items[0].kg = 99; fmWechselAnwenden();               // gleicher Tag: nicht noch einmal überschreiben
        const zweimal = data.kuehe.items[0].kg;
        fmCfg.wechsel.kuehe.abgebrochen = true; fmWechselAnwenden();
        const zurueck = data.kuehe.items.filter(i => i.kg > 0).map(i => [i.type || i.name, i.kg]);
        istTestversion = true; data = JSON.parse(merk); fmCfg.wechsel = JSON.parse(merkW); fmSpeichern(); buildCalc();
        return { heute, zweimal, zurueck };
      });
      assert.deepStrictEqual(r.heute.sort(), [["Gras", 10], ["Mais", 35], ["agf", 4]].sort());
      assert.strictEqual(r.zweimal, 99);
      assert.deepStrictEqual(r.zurueck.sort(), [["Mais", 40], ["agf", 4]].sort());
    });

    await pruefe("Neue Ration übernehmen fragt „Sofort oder über __ Tage?“: 14 → Wechsel startet vom bisherigen Rechner-Stand", async () => {
      promptAntwort = "14";
      const r = await page.evaluate(() => {
        delete fmCfg.wechsel; data.kuehe.items.forEach((it, i) => { it.kg = 0; }); data.kuehe.items[0].name = "Mais"; data.kuehe.items[0].kg = 40;
        const ok = fmRationNeu({ karte: "kuehe", titel: "neu", komplett: [{ name: "Mais", typ: "futter", kg: 30 }, { name: "Gras", typ: "futter", kg: 20 }], total: { fm: 50, tm: 16.5 } });
        return { ok, w: fmCfg.wechsel && fmCfg.wechsel.kuehe && { tage: fmCfg.wechsel.kuehe.tage, von: fmCfg.wechsel.kuehe.von.map(z => [z.name, z.kg]) } };
      });
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(r.w, { tage: 14, von: [["Mais", 40]] });
      promptAntwort = "0";
    });

    await pruefe("MLP-Check nur bei Auffälligkeit: 2 von 10 frischen Kühen Eiweiß < 3,1 %, Energie knapp; FEQ (10 %) und Harnstoff (200) unauffällig; „erledigt“", async () => {
      await page.evaluate(() => {
        const d = new Date(); d.setDate(d.getDate() - 20);
        data.kuehe.items.forEach(i => i.kg = 0); data.kuehe.items[0].name = "Mais"; data.kuehe.items[0].kg = 40; data.kuehe.items.find(i => i.type === "agf").kg = 4;
        fmRationStandPruefen(); fmCfg.rationStand.kuehe.datum = fmIso(d);
        fmMlp.mlpDatum = "2026-11-18"; fmCfg.milchpreisMlp = "2026-11-18"; fmCfg.erledigt = {}; delete fmCfg.wechsel; fmOffen = null; fmSpeichern();
      });
      const m = await page.evaluate(() => fmMlpCheck(fmCfg.gruppen[0]).map(x => x.text));
      assert(m.some(x => x.includes("2 von 10 frischen Kühen mit Eiweiß unter 3,1 %")), m.join(" | "));
      assert(m.some(x => x.includes("Energie knapp – Ration reicht für 24,3 kg, Kühe geben 30,0 kg")), m.join(" | "));
      assert(!m.some(x => /Quotient|Harnstoff/.test(x)), m.join(" | "));
      const vorher = await page.locator('.fm-auswertung[data-gruppe="g1"] .fm-meldung').count();
      await page.locator('.fm-auswertung[data-gruppe="g1"] .fm-meldung', { hasText: "frischen Kühen" }).locator("button").click();
      assert.strictEqual(await page.locator('.fm-auswertung[data-gruppe="g1"] .fm-meldung').count(), vorher - 1);
    });

    await pruefe("„Ration neu rechnen“ nach der Wartezeit: gefressen 19,2 kg TM, gerechnet für 17,6 kg TM; vor Ablauf der Wartezeit nicht", async () => {
      const m = await page.evaluate(() => fmNeuRechnen(fmCfg.gruppen[0], fmReihe(fmCfg.gruppen[0])).map(x => x.text));
      assert(m.some(x => x === "🧮 Ration neu rechnen: gefressen 19,2 kg TM je Kuh, gerechnet ist die Ration für 17,6 kg TM"), m.join(" | "));
      const frueh = await page.evaluate(() => { const r = fmCfg.rationStand.kuehe; const alt = r.datum; const d = new Date(); d.setDate(d.getDate() - 5); r.datum = fmIso(d); const x = fmNeuRechnen(fmCfg.gruppen[0], fmReihe(fmCfg.gruppen[0])).length; r.datum = alt; return x; });
      assert.strictEqual(frueh, 0);
      assert(await page.evaluate(() => document.getElementById("fm-tab").classList.contains("tab-orange")), "Reiter nicht eingefärbt");
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(x => x.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nRATION-TEST ROT (${fehler} Fehler)` : "\nRATION-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
