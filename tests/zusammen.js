// Test „Kühe + Kühe Gruppe 2 zusammen mischen“ (Wunsch Fritz 15.11.2026):
//  - Einstellungen: dritte Auswahl; Gruppe 2 übernimmt die Grundmischung von Kühe automatisch (grau), nur Zugabe selbst
//  - Rechner: EINE Karte (1. Grundmischung für beide, 2. Kühe abladen bis …, 3. Zugabe, 4. Rest an Gruppe 2)
//  - „anders abgeladen“ (Waage): nachladen, Gruppe 2 prozentual mitziehen oder normal (Mehrmenge zählt bei den Resten)
//  - Speichern je Gruppe, jedes kg genau einmal, Lager wie bisher, Zeitstempel
//  - die anderen Arten (eigene Mischung, Rest + Zugabe) bleiben genau wie vorher
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/zusammen.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5090;
// Grundmischung je Tier (Kühe) 49,7 kg; Gruppe 2 = dieselbe Grundmischung + 4 kg MLF
const S1 = 37, S2 = 47, PRO1 = 49.7, MLF = 4;
const G = (S1 + S2) * PRO1;                 // Grundmischung für beide
const PLAN1 = S1 * PRO1, PLAN_REST = S2 * PRO1;

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 6).join("\n   ")); }
  };
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  const page = await context.newPage();
  const meldungen = [];
  const normalerDialog = d => { meldungen.push(d.message()); d.accept(); };
  page.on("dialog", normalerDialog);
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await zugang.vorbereiten(context, page, "emulator");
  const sichtbar = sel => page.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null).length, sel);
  const heuteLeeren = () => page.evaluate(() => { historyData = historyData.filter(h => h.datum !== getToday()); });
  const eintraege = () => page.evaluate(() => historyData.filter(x => x.datum === getToday()).map(x => ({ k: x.kategorie, t: x.tiere, g: x.gesamt, agf: x.agf, mlf: x.mlf, zeit: x.zeit, mehr: x.mehr })));

  try {
    await page.goto(`http://localhost:${PORT}/?emulator=1`);
    await zugang.warteAufApp(page, "emulator");
    await page.evaluate(([s1, s2]) => {
      const k = data.kuehe.items; k.forEach(i => i.kg = 0);
      [["Maissilage", 29], ["Grassilage", 9.5], ["Gras 02-26", 7.5], ["Stroh", 0.2]].forEach(([n, kg], i) => { k[i].name = n; k[i].kg = kg; });
      k.find(i => i.type === "agf").kg = 3.5;
      const k2 = data.kuehe2.items; k2.forEach(i => i.kg = 0); k2.find(i => i.type === "mlf").kg = 4; k2[6].name = "Mineral 2";
      data.kuehe.anz = s1; data.kuehe2.anz = s2; data.kuehe.collapsed = false; data.kuehe2.collapsed = false;
      save(); showTab("calc"); buildCalc();
    }, [S1, S2]);
    const vorher = await page.evaluate(() => document.getElementById("calc").innerHTML);

    await pruefe("Einstellungen: dritte Auswahl „zusammen mit Kühe mischen“ → Gruppe 2 übernimmt Grundmischung (gleiche Futter, Werte, Reihenfolge, grau), Zugabe MLF bleibt", async () => {
      await page.evaluate(() => { showTab("settings"); buildSettings(); });
      assert.deepStrictEqual(await page.$$eval("#kuehe2-modus option", o => o.map(x => x.value)), ["normal", "aufwerten", "zusammen"]);
      await page.selectOption("#kuehe2-modus select", "zusammen");
      const r = await page.evaluate(() => ({ k1: data.kuehe.items.map(i => [i.type || i.name, i.kg]), k2: data.kuehe2.items.map(i => [i.type || i.name, i.kg]) }));
      r.k1.forEach(([n, kg], i) => { if (kg > 0) assert.deepStrictEqual(r.k2[i], [n, kg], "Zeile " + i); });
      assert.deepStrictEqual(r.k2.find(x => x[0] === "mlf"), ["mlf", 4]);
      assert.deepStrictEqual(r.k2[6], ["Mineral 2", 0], "freies Zugabe-Feld von Gruppe 2 überschrieben");
      assert.strictEqual(await page.locator(".zusammen-wie-kuehe").count(), 5);
      assert(await page.locator(".zusammen-wie-kuehe input").first().isDisabled());
      assert((await page.textContent("#kuehe2-modus")).includes("Grundmischung wie bei „Kühe“"));
    });

    await pruefe("Kühe ändern (Mais 29 → 31) → Gruppe 2 zieht automatisch mit; danach wieder 29", async () => {
      await page.evaluate(() => { data.kuehe.items[0].kg = 31; save(); buildCalc(); });
      assert.strictEqual(await page.evaluate(() => data.kuehe2.items[0].kg), 31);
      await page.evaluate(() => { data.kuehe.items[0].kg = 29; save(); buildCalc(); buildSettings(); });
    });

    await pruefe("Rechner: EINE Karte „Kühe + Kühe Gruppe 2“, die beiden einzelnen Karten sind weg", async () => {
      await page.evaluate(() => { showTab("calc"); buildCalc(); });
      assert.strictEqual(await sichtbar(".zusammen-karte"), 1);
      assert((await page.textContent(".zusammen-karte .cat-header")).includes("Kühe + Kühe Gruppe 2"));
      const einzeln = await page.evaluate(() => [...document.querySelectorAll("#calc .category:not(.zusammen-karte) .cat-header")].filter(h => /cat-kuehe2?\b/.test(h.className) && h.offsetParent !== null).length);
      assert.strictEqual(einzeln, 0);
    });

    await pruefe(`Schritte: 1. Grundmischung (${S1 + S2} × 49,7 kg), 2. Kühe abladen bis ${PLAN_REST.toFixed(0)} kg, 3. MLF ${S2 * MLF} kg, 4. Rest ${(PLAN_REST + S2 * MLF).toFixed(0)} kg; im Normalfall nichts antippen`, async () => {
      const t = await page.locator(".zusammen-karte").innerText();
      assert(t.includes(`Maissilage\t${(29 * (S1 + S2)).toFixed(1)}`), t);
      assert(t.includes(`2. ▼ Kühe abladen bis ${PLAN_REST.toFixed(0)} kg (${PLAN1.toFixed(0)} kg)`), t);
      assert(t.includes("anders abgeladen? hier antippen"), t);
      assert(t.includes("3. Für Kühe Gruppe 2 dazumischen"), t);
      assert(t.includes(`${(S2 * MLF).toFixed(1)}`), t);
      assert(t.includes(`4. → Kühe Gruppe 2 abladen: ${(PLAN_REST + S2 * MLF).toFixed(0)} kg`), t);
      assert.deepStrictEqual(await page.evaluate(() => zusammenPlan().zugabe.map(z => z.it.type || z.it.name)), ["mlf"]);
    });

    await pruefe("Speichern (normal): je Gruppe ein Eintrag mit den geplanten Mengen, Zeitstempel, Lager wie bisher", async () => {
      const lager = await page.evaluate(() => ({ agf: lagerData.agf.bestand, mlf: lagerData.mlf.bestand }));
      await page.click(".zusammen-karte .save-btn");
      const e = await eintraege(), e1 = e.find(x => x.k === "kuehe"), e2 = e.find(x => x.k === "kuehe2");
      assert(Math.abs(e1.g - PLAN1) < 1e-6 && e1.t === S1, JSON.stringify(e1));
      assert(Math.abs(e2.g - S2 * (PRO1 + MLF)) < 1e-6 && e2.t === S2, JSON.stringify(e2));
      assert(e1.zeit && e1.zeit === e2.zeit, "Zeitstempel");
      const nach = await page.evaluate(() => ({ agf: lagerData.agf.bestand, mlf: lagerData.mlf.bestand }));
      assert(Math.abs((lager.agf - nach.agf) - 3.5 * (S1 + S2)) < 1e-6, "Lager AGF");
      assert(Math.abs((lager.mlf - nach.mlf) - MLF * S2) < 1e-6, "Lager MLF");
      assert((await page.textContent(".zusammen-karte .save-btn")).includes("Gespeichert"));
    });

    const R = 2000, fk = (G - R) / PLAN1;      // Stall 1 hat (G − 2000) statt PLAN1 bekommen
    await pruefe(`Verladen (Waage ${R} statt ${PLAN_REST.toFixed(0)} kg), Gruppe 2 mitziehen: Stall 1 +${Math.round((fk - 1) * 100)} %, Gruppe 2 auch; nachladen + MLF; jedes kg genau einmal`, async () => {
      await heuteLeeren();
      await page.evaluate(r => { data.kuehe2.zusRest = r; data.kuehe2.zusAnpassen = true; save(); buildCalc(); }, R);
      const t = await page.locator(".zusammen-karte").innerText();
      assert(t.includes(`✎ Waage zeigte ${R} kg → Kühe hat ${(G - R).toFixed(0)} kg bekommen`), t);
      assert(t.includes(`auch +${Math.round((fk - 1) * 100)} %`), t);
      assert(t.includes("3. Für Kühe Gruppe 2 nachladen und dazumischen"), t);
      assert(t.includes("Maissilage\t" + (29 * S2 * fk - R * 29 / PRO1).toFixed(1)), t);
      const lager = await page.evaluate(() => ({ agf: lagerData.agf.bestand, mlf: lagerData.mlf.bestand }));
      await page.click(".zusammen-karte .save-btn");
      const e = await eintraege(), e1 = e.find(x => x.k === "kuehe"), e2 = e.find(x => x.k === "kuehe2");
      assert(Math.abs(e1.g - (G - R)) < 1e-6, "Kühe " + e1.g);
      assert(Math.abs(e2.g - S2 * (PRO1 + MLF) * fk) < 1e-6, "Gruppe 2 " + e2.g);
      const agf = 3.5 * (S1 + S2) + (3.5 * S2 * fk - R * 3.5 / PRO1);
      const nach = await page.evaluate(() => ({ agf: lagerData.agf.bestand, mlf: lagerData.mlf.bestand, rest: data.kuehe2.zusRest }));
      assert(Math.abs(e1.agf + e2.agf - agf) < 1e-6 && Math.abs((lager.agf - nach.agf) - agf) < 1e-6, "AGF");
      assert(Math.abs((lager.mlf - nach.mlf) - MLF * S2 * fk) < 1e-6, "MLF");
      assert(Math.abs(e1.mehr - (G - R - PLAN1)) < 1e-6 && Math.abs(e2.mehr - S2 * (PRO1 + MLF) * (fk - 1)) < 1e-6, "mehr");
      assert.strictEqual(nach.rest, null, "Waagen-Eingabe nicht zurückgesetzt");
    });

    await pruefe(`Verladen, Gruppe 2 normal: Gruppe 2 bekommt ihre normale Menge, Stall 1 merkt sich ${(G - R - PLAN1).toFixed(0)} kg „mehr“`, async () => {
      await heuteLeeren();
      await page.evaluate(r => { data.kuehe2.zusRest = r; data.kuehe2.zusAnpassen = false; save(); buildCalc(); }, R);
      const t = await page.locator(".zusammen-karte").innerText();
      assert(t.includes(`Kühe Gruppe 2 wird normal gefüttert – die ${(G - R - PLAN1).toFixed(0)} kg mehr bei Kühe rechnet die Auswertung beim Rest mit.`), t);
      await page.click(".zusammen-karte .save-btn");
      const e = await eintraege(), e1 = e.find(x => x.k === "kuehe"), e2 = e.find(x => x.k === "kuehe2");
      assert(Math.abs(e1.mehr - (G - R - PLAN1)) < 1e-6, "mehr " + e1.mehr);
      assert(Math.abs(e2.g - S2 * (PRO1 + MLF)) < 1e-6, "Gruppe 2 " + e2.g);
      assert.strictEqual(e2.mehr, undefined);
    });

    await pruefe("Zu viel Rest (Waage 3000 kg): Gruppe 2 bekommt alles im Wagen + MLF, nichts abgezogen oder doppelt", async () => {
      await heuteLeeren();
      await page.evaluate(() => { data.kuehe2.zusRest = 3000; data.kuehe2.zusAnpassen = null; buildCalc(); });
      assert((await page.locator(".zusammen-karte").innerText()).includes("schon zu viel"));
      await page.click(".zusammen-karte .save-btn");
      const e = await eintraege();
      assert(Math.abs(e.find(x => x.k === "kuehe").g - (G - 3000)) < 1e-6);
      assert(Math.abs(e.find(x => x.k === "kuehe2").g - (3000 + MLF * S2)) < 1e-6);
    });

    await pruefe("Waage eintippen: App fragt einmal „Gruppe 2 auch erhöhen?“ (Abbrechen = normal füttern)", async () => {
      await heuteLeeren();
      await page.evaluate(() => { data.kuehe2.zusRest = null; buildCalc(); });
      const fragen = [];
      page.off("dialog", normalerDialog);
      const frage = d => { fragen.push(d.message()); d.type() === "prompt" ? d.accept(String(R)) : d.dismiss(); };
      page.on("dialog", frage);
      await page.click(".zusammen-karte .zusammen-abladen");
      page.off("dialog", frage); page.on("dialog", normalerDialog);
      assert(fragen.some(x => x.includes(`Kühe hat ${(G - R - PLAN1).toFixed(0)} kg (+${Math.round((fk - 1) * 100)} %) mehr bekommen`)), fragen.join(" | "));
      assert.strictEqual(await page.evaluate(() => data.kuehe2.zusAnpassen), false);
      await page.evaluate(() => { data.kuehe2.zusRest = null; data.kuehe2.zusAnpassen = null; save(); buildCalc(); });
    });

    await pruefe("Auswertung: Mehrmenge wird beim Rest abgezogen (2000 kg Vorlage, davon 300 kg mehr, Rest 380 kg → 4,7 % statt 19 %)", async () => {
      const q = await page.evaluate(() => fmReiheBewerten([{ datum: "2026-11-01", vorlage: 2000, mehr: 300, rest: 380, tiere: 40 }])[0].quote);
      assert(Math.abs(q - 80 / 1700 * 100) < 1e-9, "Quote " + q);
    });

    await pruefe("Zurück auf „eigene Mischung“ → Rechner genau wie vorher; Gruppe 2 behält die übernommenen Werte zum Weiterbearbeiten", async () => {
      await page.evaluate(() => { kuehe2ModusSetzen("normal"); showTab("calc"); buildCalc(); });
      assert.strictEqual(await page.locator(".zusammen-karte").count(), 0);
      await page.evaluate(() => { showTab("settings"); buildSettings(); });
      assert.strictEqual(await page.locator(".zusammen-wie-kuehe").count(), 0, "graue Zeilen bei eigener Mischung");
    });

    await pruefe("„Rest der Kühe-Mischung + Zugabe“ unverändert (eigene Karte mit Restmischung)", async () => {
      await page.evaluate(() => { kuehe2ModusSetzen("aufwerten"); showTab("calc"); buildCalc(); });
      assert.strictEqual(await page.locator(".zusammen-karte").count(), 0);
      assert((await page.locator("#calc .category", { has: page.locator(".cat-kuehe2") }).innerText()).includes("Restmischung vorhanden (kg)"));
      await page.evaluate(() => kuehe2ModusSetzen("normal"));
    });

    await pruefe("Ohne „zusammen“ ist der Rechner Zeichen für Zeichen wie vorher (Ausgangsstand)", async () => {
      await page.evaluate(() => { const k2 = data.kuehe2.items; k2.forEach(i => i.kg = 0); k2.find(i => i.type === "mlf").kg = 4; data.kuehe2.items.slice(0, 4).forEach((it, i) => { it.name = "Futter " + (i + 1); }); historyData = historyData.filter(h => h.datum !== getToday()); save(); showTab("calc"); buildCalc(); });
      assert.strictEqual(await page.evaluate(() => document.getElementById("calc").innerHTML), vorher);
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(x => x.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nZUSAMMEN-TEST ROT (${fehler} Fehler)` : "\nZUSAMMEN-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
