// Test „Kühe + Kühe Gruppe 2 zusammen mischen“ (Wunsch Fritz 15.11.2026):
//  - Einstellungen: dritte Auswahl; Gruppe 2 einmal mit der Grundmischung vorbelegt, danach eigene Ration je Kuh (26.11.)
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

    await pruefe("Einstellungen: dritte Auswahl „zusammen mit Kühe mischen“ → Gruppe 2 wird einmal mit der Grundmischung vorbelegt (gleiche Futter, Werte, Reihenfolge), alle Felder frei, Zugabe MLF bleibt", async () => {
      await page.evaluate(() => { showTab("settings"); buildSettings(); });
      assert.deepStrictEqual(await page.$$eval("#kuehe2-modus option", o => o.map(x => x.value)), ["normal", "aufwerten", "zusammen"]);
      await page.selectOption("#kuehe2-modus select", "zusammen");
      const r = await page.evaluate(() => ({ k1: data.kuehe.items.map(i => [i.type || i.name, i.kg]), k2: data.kuehe2.items.map(i => [i.type || i.name, i.kg]) }));
      r.k1.forEach(([n, kg], i) => { if (kg > 0) assert.deepStrictEqual(r.k2[i], [n, kg], "Zeile " + i); });
      assert.deepStrictEqual(r.k2.find(x => x[0] === "mlf"), ["mlf", 4]);
      assert.deepStrictEqual(r.k2[6], ["Mineral 2", 0], "freies Zugabe-Feld von Gruppe 2 überschrieben");
      assert.strictEqual(await page.locator(".zusammen-wie-kuehe").count(), 0, "keine grauen Zeilen mehr");
      assert.strictEqual(await page.evaluate(() => [...document.querySelectorAll("#settings input")].filter(x => x.disabled).length), 0, "gesperrte Felder");
      assert((await page.textContent("#kuehe2-modus")).includes("komplette Ration je Kuh"));
    });

    await pruefe("Kühe ändern (Mais 29 → 31) → Gruppe 2 bleibt bei ihrer eigenen Ration (29), wird nicht mehr überschrieben; danach wieder 29", async () => {
      await page.evaluate(() => { data.kuehe.items[0].kg = 31; save(); buildCalc(); buildSettings(); });
      assert.strictEqual(await page.evaluate(() => data.kuehe2.items[0].kg), 29);
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
      assert(t.includes(`▼ Kühe abladen bis ${PLAN_REST.toFixed(0)} kg (${PLAN1.toFixed(0)} kg · `), t);
      assert(!/\b[1-5]\. /.test(t), "keine Schritt-Nummern");
      assert(t.includes("Dazumischen für Kühe Gruppe 2"), t);
      assert(t.includes(`${(S2 * MLF).toFixed(1)}`), t);
      assert(t.includes(`→ Rest: Kühe Gruppe 2 ${(PLAN_REST + S2 * MLF).toFixed(0)} kg`), t);
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
      await page.evaluate(r => { data.kuehe2.zusRest = r; data.kuehe2.zusRestTag = getToday(); data.kuehe2.zusAnpassen = true; save(); buildCalc(); }, R);
      const t = await page.locator(".zusammen-karte").innerText();
      assert(t.includes(`✎ Waage zeigte ${R} kg → Kühe hat ${(G - R).toFixed(0)} kg bekommen`), t);
      assert(t.includes(`auch +${Math.round((fk - 1) * 100)} %`), t);
      assert(t.includes("Nachladen und dazumischen für Kühe Gruppe 2"), t);
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
      await page.evaluate(r => { data.kuehe2.zusRest = r; data.kuehe2.zusRestTag = getToday(); data.kuehe2.zusAnpassen = false; save(); buildCalc(); }, R);
      const t = await page.locator(".zusammen-karte").innerText();
      assert(t.includes(`Kühe Gruppe 2 wird normal gefüttert – die ${(G - R - PLAN1).toFixed(0)} kg mehr rechnet die Auswertung beim Rest mit.`), t);
      await page.click(".zusammen-karte .save-btn");
      const e = await eintraege(), e1 = e.find(x => x.k === "kuehe"), e2 = e.find(x => x.k === "kuehe2");
      assert(Math.abs(e1.mehr - (G - R - PLAN1)) < 1e-6, "mehr " + e1.mehr);
      assert(Math.abs(e2.g - S2 * (PRO1 + MLF)) < 1e-6, "Gruppe 2 " + e2.g);
      assert.strictEqual(e2.mehr, undefined);
    });

    await pruefe("Zu viel Rest (Waage 3000 kg): Gruppe 2 bekommt alles im Wagen + MLF, nichts abgezogen oder doppelt", async () => {
      await heuteLeeren();
      await page.evaluate(() => { data.kuehe2.zusRest = 3000; data.kuehe2.zusRestTag = getToday(); data.kuehe2.zusAnpassen = null; buildCalc(); });
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

    await pruefe("Mit Herdenmanager: Tierzahl je Gruppe (alle Tiere, auch Trockensteher) + Abladen je Stall in der eingestellten Reihenfolge", async () => {
      const r = await page.evaluate(() => {
        const pl = (id, name, anzahl, lakt) => ({ id, name, typ: "stall", stall: null, anzahl, gruppen: [{ art: "laktierend", anzahl: lakt }, ...(anzahl > lakt ? [{ art: "trocken", anzahl: anzahl - lakt }] : [])] });
        fmStall = { geholt: new Date().toISOString(), eintraege: { s1: pl("s1", "Stall 1", 37, 37), s2: pl("s2", "Stall 2", 47, 47), stroh: pl("stroh", "Strohstall", 8, 5) } };
        fmCfg.an = true; fmCfg.tierzahlHM = true; globalCfg.restQuellen = ["kuehe", "kuehe2"];
        fmCfg.gruppen = [{ id: "ga", name: "Altmelker", karte: "kuehe", art: "rest", staelle: ["stroh", "s1"], auswerten: true },
                         { id: "gb", name: "Hochleistung", karte: "kuehe2", art: "rest", staelle: ["s2"], auswerten: true }];
        showTab("calc"); buildCalc();
        const k = document.querySelector(".zusammen-karte");
        return { hm: [...k.querySelectorAll(".zusammen-hm")].map(e => e.innerText), ablade: k.querySelector(".zusammen-abladen").innerText, rest: k.querySelector(".zusammen-rest").innerText,
                 fremd: k.querySelectorAll(".fm-hm-zeile, .fm-abladen").length, G: zusammenPlan().G, geplant: zusammenPlan().geplant };
      });
      // Tierzahl + 4 % Rest-Zuschlag: Kühe 45 → 46,8, Gruppe 2 47 → 48,9
      assert.strictEqual(r.hm.length, 2, r.hm.join(" | "));
      assert(r.hm[0].includes("Herdenmanager: 45 + 4 % Rest – übernehmen") && r.hm[1].includes("Herdenmanager: 47 + 4 % Rest"), r.hm.join(" | "));
      assert.strictEqual(r.fremd, 0, "allgemeine Ergänzung in der gemeinsamen Karte");
      const stroh = PLAN1 * 8 / 45;
      assert(r.ablade.includes(`▼ Strohstall abladen bis ${(G - stroh).toFixed(0)} kg (${stroh.toFixed(0)} kg · `), r.ablade);
      assert(r.ablade.includes(`▼ Stall 1 abladen bis ${PLAN_REST.toFixed(0)} kg`), r.ablade);
      assert(r.rest.includes(`→ Rest: Stall 2`), r.rest);
      await page.locator("button.zusammen-hm").first().click();
      assert.strictEqual(await page.evaluate(() => data.kuehe.anz), 46.8);
      await page.evaluate(s1 => { data.kuehe.anz = s1; fmCfg.an = false; fmCfg.gruppen = []; fmStall = null; globalCfg.restQuellen = ["kuehe"]; save(); buildCalc(); }, S1);
      assert.strictEqual(await page.locator(".zusammen-hm").count(), 0);
    });

    await pruefe("Eigene Ration je Kuh in Gruppe 2 (Prüf-Beispiel Fritz 26.11.): Anteil 78 % (41,4 kg, begrenzt durch Schnitt 2), Zugabe Mais 357,5 · Schnitt 5 226,1 · AGF 91,7 · MLF 165; doppeltes Futter wird zusammengezählt; fehlendes Futter → Warnung", async () => {
      const r = await page.evaluate(() => {
        const alt = JSON.stringify({ k: data.kuehe, k2: data.kuehe2 }); historyData = historyData.filter(h => h.datum !== getToday());
        const setze = (liste, werte) => { liste.forEach(i => i.kg = 0); werte.forEach(([n, kg], i) => { if (n === "agf" || n === "mlf") liste.find(x => x.type === n).kg = kg; else { liste[i].name = n; delete liste[i].type; liste[i].kg = kg; } }); };
        setze(data.kuehe.items, [["Mais", 27], ["Schnitt 5", 14], ["Schnitt 2", 9], ["Stroh", 0.2], ["agf", 3]]);
        setze(data.kuehe2.items, [["Mais", 27.5], ["Schnitt 5", 15], ["Schnitt 2", 7], ["Stroh", 0.2], ["agf", 4], ["mlf", 3]]);
        data.kuehe.anz = 35; data.kuehe2.anz = 55; data.kuehe2.zusRest = null; showTab("calc"); buildCalc();
        const plan = () => { const p = zusammenPlan(); return { f: p.f, eng: p.engpass && p.engpass.name, z: Object.fromEntries(p.zugabe.map(z => [z.it.type || z.it.name, Math.round(z.kg * 10) / 10])), ord: p.zugabe.map(z => z.it.type || z.it.name), ord2: data.kuehe2.items.filter(i => i.kg > 0).map(i => i.type || i.name).filter(n => p.zugabe.some(z => (z.it.type || z.it.name) === n)), text: document.querySelector(".zusammen-karte").innerText }; };
        const a = plan();
        document.querySelector(".zusammen-voll").click();   // „passt so – 100 % Grundmischung“
        const v = plan(); v.zuViel = Object.fromEntries(zusammenPlan().zuViel.map(z => [z.it.type || z.it.name, Math.round(z.kg * 10) / 10]));
        const e2 = (() => { const p = zusammenPlan(); return Math.round(p.zeilen2.reduce((s, z) => s + z.ist + Math.max(0, z.diff), 0) * 10) / 10; })();
        document.querySelector(".zusammen-genau").click();
        v.zurueck = zusammenPlan().f; v.e2 = e2;
        data.kuehe2.items[0].kg = 21; data.kuehe2.items[6].name = "Mais"; delete data.kuehe2.items[6].type; data.kuehe2.items[6].kg = 6.5; buildCalc();   // Mais 21 + 6,5
        const b = plan();
        data.kuehe2.items[2].kg = 0; buildCalc();   // Schnitt 2 fehlt
        const c = plan();
        const o = JSON.parse(alt); data.kuehe = o.k; data.kuehe2 = o.k2; save(); buildCalc();
        return { a, b, c, v };
      });
      assert(Math.abs(r.a.f - 7 / 9) < 1e-9 && r.a.eng === "Schnitt 2", JSON.stringify(r.a));
      assert.deepStrictEqual(r.a.ord, r.a.ord2, "Dazumischen in der Reihenfolge von Gruppe 2");
      assert.deepStrictEqual(r.a.z, { Mais: 357.5, "Schnitt 5": 226.1, Stroh: 2.4, agf: 91.7, mlf: 165 });
      assert(r.a.text.includes("Vor dem Laden wählen") && r.a.text.includes("78 % Grundmischung (41.4 kg je Tier), weil Kühe Gruppe 2 weniger Schnitt 2 bekommt"), r.a.text);
      assert(!r.a.text.includes("fehlt"), r.a.text);
      assert.deepStrictEqual(r.b.z, r.a.z, "doppeltes Mais-Feld nicht zusammengezählt");
      // „passt so“: volle Grundmischung, nur Mehrbedarf dazu; Schnitt 2 bekommt Gruppe 2 2 kg/Tier mehr (110 kg), wird so gespeichert
      assert.strictEqual(r.v.f, 1);
      assert.deepStrictEqual(r.v.z, { Mais: 27.5, "Schnitt 5": 55, agf: 55, mlf: 165 });
      assert.deepStrictEqual(r.v.zuViel, { "Schnitt 2": -110 });
      assert(r.v.text.includes("100 % Grundmischung (53.2 kg je Tier). Kühe Gruppe 2 bekommt dadurch etwas mehr Schnitt 2 als in der Ration (genau wären 78 %)") && r.v.text.includes("mehr als Ration (passt so)") && r.v.text.includes("+110.0"), r.v.text);
      assert.strictEqual(r.v.e2, Math.round(55 * (53.2 + 0.5 + 1 + 1 + 3) * 10) / 10, "Gruppe 2 gespeichert");
      assert(Math.abs(r.v.zurueck - 7 / 9) < 1e-9, "genau rechnen");
      assert.strictEqual(r.c.f, 0);
      assert(r.c.text.includes("fehlt Schnitt 2 aus der Grundmischung"), r.c.text);
    });

    await pruefe("Kein zweites MLF-Feld in Gruppe 2: beim Umstellen wird getauscht statt doppelt angelegt; ein vorhandenes leeres zweites MLF-Feld wird ein normales Feld (Name MLF bleibt)", async () => {
      const r = await page.evaluate(() => {
        const alt = JSON.stringify({ k: data.kuehe, k2: data.kuehe2, n: globalCfg.mlfName, m: globalCfg.kuehe2Modus });
        globalCfg.mlfName = "Kraft";
        const it = (o) => Object.assign({ kg: 0 }, o);
        // 1) vorhandene Doppelung (wie auf dem Tablet 27.11.)
        data.kuehe2.items = [it({ name: "Stroh", kg: 0.2 }), it({ type: "agf", kg: 3 }), it({ type: "mlf" }), it({ type: "mlf", kg: 4 }), it({ name: "Mais", kg: 30 }), it({ type: "wasser", kg: 2 })];
        showTab("settings"); buildSettings();
        const t1 = data.kuehe2.items.map(i => i.type || i.name);
        // 2) Umstellen mit anderer Reihenfolge: MLF bei Kühe an Stelle 2, bei Gruppe 2 an Stelle 4
        kuehe2ModusSetzen("normal");
        data.kuehe.items = [it({ name: "Stroh", kg: 0.2 }), it({ type: "agf", kg: 3 }), it({ type: "mlf", kg: 1 }), it({ name: "Mais", kg: 23 }), it({ name: "Futter 5" }), it({ type: "wasser", kg: 2 })];
        data.kuehe2.items = [it({ name: "Stroh", kg: 0.2 }), it({ type: "agf", kg: 3 }), it({ name: "Futter 3" }), it({ name: "Mais", kg: 30 }), it({ type: "mlf", kg: 4 }), it({ type: "wasser", kg: 2 })];
        kuehe2ModusSetzen("zusammen");
        const t2 = data.kuehe2.items.map(i => (i.type || i.name) + " " + i.kg);
        const o = JSON.parse(alt); data.kuehe = o.k; data.kuehe2 = o.k2; globalCfg.mlfName = o.n; kuehe2ModusSetzen(o.m); save();
        return { t1, t2 };
      });
      assert.deepStrictEqual(r.t1, ["Stroh", "agf", "Futter 3", "mlf", "Mais", "wasser"]);
      assert.deepStrictEqual(r.t2, ["Stroh 0.2", "agf 3", "mlf 1", "Mais 23", "Futter 3 0", "wasser 2"]);
    });

    await pruefe("„Anders abgeladen“ von gestern gilt heute nicht mehr (wieder wie geplant)", async () => {
      const r = await page.evaluate(() => {
        historyData = historyData.filter(h => h.datum !== getToday());
        data.kuehe2.zusRest = 1490; data.kuehe2.zusRestTag = "26.11.2000"; buildCalc();
        const gestern = zusammenPlan().echt;
        data.kuehe2.zusRestTag = undefined; buildCalc();
        const ohneTag = zusammenPlan().echt;
        data.kuehe2.zusRestTag = getToday(); buildCalc();
        const heute = zusammenPlan().echt;
        data.kuehe2.zusRest = null; data.kuehe2.zusRestTag = null; save(); buildCalc();
        return { gestern, ohneTag, heute };
      });
      assert.deepStrictEqual(r, { gestern: null, ohneTag: null, heute: 1490 });
    });

    await pruefe("Zurück auf „eigene Mischung“ → Rechner genau wie vorher; Gruppe 2 behält die übernommenen Werte zum Weiterbearbeiten", async () => {
      await page.evaluate(() => { kuehe2ModusSetzen("normal"); showTab("calc"); buildCalc(); });
      assert.strictEqual(await page.locator(".zusammen-karte").count(), 0);
      await page.evaluate(() => { showTab("settings"); buildSettings(); });
      assert.strictEqual(await page.locator(".zusammen-wie-kuehe").count(), 0, "graue Zeilen bei eigener Mischung");
    });

    await pruefe("Gemeinsame Karte: „kilo“ + Gesamt antippen → Zielgewicht, beide Tierzahlen im gleichen Verhältnis", async () => {
      const alt = await page.evaluate(() => [data.kuehe.anz, data.kuehe2.anz, globalCfg.kuehe2Modus]);
      await page.evaluate(() => { kuehe2ModusSetzen("zusammen"); data.kuehe.anz = 40; data.kuehe2.anz = 60; kiloMode.zusammen = false; showTab("calc"); buildCalc(); });
      const vor = await page.evaluate(() => parseFloat(document.getElementById("total-zusammen").dataset.val));
      await page.click(".zusammen-karte .kilo-btn");
      await page.click("#total-zusammen");
      await page.fill("#edit-zusammen", String(Math.round(vor * 1.1)));
      await page.press("#edit-zusammen", "Enter");
      const r = await page.evaluate(() => ({ a: data.kuehe.anz, b: data.kuehe2.anz, g: parseFloat(document.getElementById("total-zusammen").dataset.val) }));
      assert(Math.abs(r.a / r.b - 40 / 60) < 0.01, JSON.stringify(r));
      assert(Math.abs(r.g - vor * 1.1) < vor * 0.01, JSON.stringify(r) + " vor " + vor);
      // Einzelkarten (Bullen, Trockensteher): kilo + Gesamt wie in der normalen App
      for (const k of ["bullen", "trocken"]) {
        const altK = await page.evaluate(k => JSON.stringify(data[k]), k);
        await page.evaluate(k => { data[k].items.forEach((it, i) => it.kg = i === 0 ? 10 : 0); data[k].anz = 10; kiloMode[k] = true; buildCalc(); }, k);
        await page.click("#total-" + k); await page.fill("#edit-" + k, "150"); await page.press("#edit-" + k, "Enter");
        assert.strictEqual(await page.evaluate(k => data[k].anz, k), 15, k);
        await page.evaluate(([k, a]) => { kiloMode[k] = false; data[k] = JSON.parse(a); save(); buildCalc(); }, [k, altK]);
      }
      await page.evaluate(a => { kiloMode.zusammen = false; data.kuehe.anz = a[0]; data.kuehe2.anz = a[1]; kuehe2ModusSetzen(a[2]); save(); }, alt);
    });

    await pruefe("Wasser steht bei Gruppe 2 immer zuletzt – auch wenn Kühe ein Futter haben, das Gruppe 2 fehlt, und anders abgeladen wurde", async () => {
      const r = await page.evaluate(() => {
        const alt = JSON.stringify([data.kuehe, data.kuehe2]);
        kuehe2ModusSetzen("zusammen");
        data.kuehe.items.find(i => i.type === "wasser").kg = 2; data.kuehe2.items.find(i => i.type === "wasser").kg = 2;
        data.kuehe2.items.forEach(i => { if (!i.type && i.name === "Stroh") i.kg = 0; });
        data.kuehe2.zusRest = 1500; data.kuehe2.zusRestTag = getToday();
        const p = zusammenPlan(), typen = p.zeilen2.map(z => z.it.type || z.it.name);
        [data.kuehe, data.kuehe2] = JSON.parse(alt); kuehe2ModusSetzen("normal"); save();
        return { typen, stroh: p.zeilen2.some(z => z.it.name === "Stroh" && z.ist > 0) };
      });
      assert(r.stroh, "Stroh (nur Kühe) steckt im Rest: " + r.typen.join(", "));
      assert.strictEqual(r.typen[r.typen.length - 1], "wasser", r.typen.join(", "));
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
