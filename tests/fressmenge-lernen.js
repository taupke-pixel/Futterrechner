// Test Paket Fressmengen, Punkt 12: Lernen Regen/Hitze (Phase A „lernt noch“ → Phase B „gelernt“), Korrektur-Zeilen mit
// [heute aus] (Testversion nur Anzeige), Wochenend-Effekt (auffällige Montage zählen nicht, Meldung).
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/fressmenge-lernen.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5084;
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const tt = d => String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
const tagMinus = n => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - n); return d; };
// Wetter: jeder 3. Tag Regen, sonst jeder ungerade Tag heiß; heute Regen, morgen heiß
const istRegen = n => n % 3 === 0, istHeiss = n => !istRegen(n) && n % 2 === 1;

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 6).join("\n   ")); }
  };
  let trocken = false;
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  await context.route(/api\.open-meteo\.com/, r => {
    const time = [], tmax = [], rh = [], regen = [];
    for (let n = 92; n >= -2; n--) { time.push(iso(tagMinus(n))); const heiss = !trocken && (istHeiss(n) || n === -1); tmax.push(heiss ? 30 : 10); rh.push(70); regen.push(!trocken && istRegen(n) ? 7.5 : 0); }
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ daily: { time, temperature_2m_max: tmax, relative_humidity_2m_mean: rh, precipitation_sum: regen } }) });
  });
  await context.route(/firestore\.googleapis\.com\/v1\/projects\/herdenmanager/, r => r.fulfill({ status: 404, body: "{}" }));
  const page = await context.newPage();
  const meldungen = [];
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await zugang.vorbereiten(context, page, "emulator");
  // History: n Tage Vorlage 2000 kg / 40 Tiere, Rest am Folgetag; Regen- und Hitzetage: Rest 200 kg (statt 80)
  const anlegen = async (tage, restFn) => {
    await page.evaluate(([e]) => { historyData = e; fmTage = Object.fromEntries(Object.entries(fmTage).map(([d, t]) => [d, { wetter: t.wetter }])); fmCfg.erledigt = {}; fmSpeichern(); },
      [[...Array(tage).keys()].map(i => i + 1).flatMap(n => [
        { id: "v" + n, datum: tt(tagMinus(n)), kategorie: "kuehe", tiere: 40, gesamt: 2000, agf: 0, mlf: 0, futter: [] },
        { id: "r" + n, datum: tt(tagMinus(n - 1)), kategorie: "restbullen", tiere: 9, gesamt: 0, agf: 0, mlf: 0, futter: [] }])]);
    for (let n = 1; n <= tage; n++) await page.evaluate(([d, kg]) => { fmTag(d).rest = { kuehe: kg }; }, [iso(tagMinus(n - 1)), restFn(n)]);
    await page.evaluate(() => { fmTageMerken(); fmBauen(); });
  };

  try {
    await page.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
    await zugang.warteAufApp(page, "emulator");
    await page.evaluate(() => { fmCfg.gruppen = [{ id: "g1", name: "Hochleistung", karte: "kuehe", art: "rest", staelle: [], auswerten: true }]; fmCfg.milchpreisMlp = "x"; fmSpeichern(); showTab("fressmenge"); });
    await page.waitForFunction(() => fmTage[fmIso(new Date())] && fmTage[fmIso(new Date())].wetter);
    const wetterTag = n => istRegen(n) || istHeiss(n);

    await pruefe("Phase A mit 12 Tagen: „Regen: lernt noch (4 von 15 Regentagen …)“, keine Korrektur-Zeile", async () => {
      await anlegen(12, n => wetterTag(n) ? 200 : 80);
      const t = await page.evaluate(() => fmLernText(fmLernErgebnis("regen")));
      assert(t.startsWith("Regen: lernt noch (4 von 15 Regentagen"), t);
      assert.strictEqual(await page.locator(".fm-korrektur").count(), 0);
    });

    await pruefe("Phase B mit 60 Tagen: Regen und Hitze gelernt (Fressmenge −6,5 % an solchen Tagen); Lernstand in „Erweitert“", async () => {
      await anlegen(60, n => wetterTag(n) ? 200 : 80);
      const e = await page.evaluate(() => [fmLernErgebnis("regen"), fmLernErgebnis("hitze")]);
      assert(e[0].gelernt && e[1].gelernt, JSON.stringify(e));
      assert(e[0].betroffen >= 15 && e[0].normal >= 15, JSON.stringify(e[0]));
      // je Tier 45 statt 48 kg, Mittel 46 kg: 45/46 − 48/46 = −6,5 %
      assert(e[0].wirkung < -0.05 && e[0].wirkung > -0.08, JSON.stringify(e[0]));
      await page.evaluate(() => { fmEinrichtungZu = false; fmErweitertZu = false; fmBauen(); });
      assert((await page.textContent("#fm-erweitert")).includes("Regen: gelernt – an Regentagen −"));
    });

    await pruefe("Heute Regen → Zeile „Regen 7,5 mm · Grassilage, Maissilage +7 %“, morgen Hitze → „Mischung −7 %“; [heute aus] blendet aus", async () => {
      await page.evaluate(() => { fmEinrichtungZu = true; fmBauen(); });
      const r = await page.textContent('.fm-korrektur[data-art="regen"]');
      assert(r.includes("Regen 7,5 mm · Grassilage, Maissilage +7 %"), r);
      const h = await page.textContent('.fm-korrektur[data-art="hitze"]');
      assert(h.includes("Hitze 30 °C · Mischung −7 %") && h.includes("Testversion: nur Anzeige"), h);
      await page.click('.fm-korrektur[data-art="regen"] >> text=heute aus');
      assert.strictEqual(await page.locator('.fm-korrektur[data-art="regen"]').count(), 0);
      await page.evaluate(() => { fmCfg.hitze = false; fmBauen(); });
      assert.strictEqual(await page.locator('.fm-korrektur[data-art="hitze"]').count(), 0, "Unterschalter Hitze aus, Zeile noch da");
      await page.evaluate(() => { fmCfg.hitze = true; delete fmCfg.heuteAus; fmSpeichern(); });
    });

    await pruefe("Hitzeabzug höchstens wie in „Erweitert“ (3 %)", async () => {
      await page.evaluate(() => { fmCfg.werte = { ...fmCfg.werte, hitzeMax: 3 }; fmBauen(); });
      assert((await page.textContent('.fm-korrektur[data-art="hitze"]')).includes("Mischung −3 %"));
      await page.evaluate(() => { delete fmCfg.werte.hitzeMax; fmSpeichern(); });
    });

    await pruefe("Wochenend-Effekt: Montags deutlich weniger → Meldung, Montage zählen nicht für die Empfehlung", async () => {
      trocken = true; await page.evaluate(() => fmWetterHolen(true)); await page.waitForTimeout(300);
      // Vorlage-Tag Sonntag → Rest gehört zum Sonntag; wir machen die Montage (Vorlage am Montag) auffällig
      await anlegen(35, n => tagMinus(n).getDay() === 1 ? 300 : 80);
      const m = await page.evaluate(() => fmMeldungen(fmCfg.gruppen[0], fmReihe(fmCfg.gruppen[0])).map(x => x.text));
      assert(m.some(x => x.startsWith("📅 Montags fressen die Kühe") && x.includes("weniger")), m.join(" | "));
      assert((await page.textContent('.fm-auswertung[data-gruppe="g1"] .fm-text')).includes("Rest 4,0 % · passt"), "Montage verfälschen die Empfehlung");
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(x => x.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nLERNEN-TEST ROT (${fehler} Fehler)` : "\nLERNEN-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
