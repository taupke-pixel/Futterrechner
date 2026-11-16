// Test Wünsche Fritz 16.11.2026: Zeitstempel bei allen Karten (Uhrzeit in der History änderbar), „Waage zeigt insgesamt“,
// Reste auf 24 Std. umgerechnet, Futterzeiten bei Gruppen ohne Reste, Menge nach TS der Ration, Rest-Zuschlag,
// PDF-Dateifeld außerhalb des Reiters (Tastatur), Zuklappen.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/fressmenge-zeiten.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5093;

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
  let antwort = null;
  page.on("dialog", d => { meldungen.push(d.message()); d.type() === "prompt" ? d.accept(antwort === null ? "" : antwort) : d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await zugang.vorbereiten(context, page, "emulator");

  try {
    await page.goto(`http://localhost:${PORT}/?emulator=1`);
    await zugang.warteAufApp(page, "emulator");
    await page.evaluate(() => {
      data.faersen.items.forEach((it, i) => it.kg = i === 0 ? 20 : 0); data.faersen.anz = 10;
      fmCfg.an = true; fmSpeichern(); showTab("calc"); buildCalc();
    });

    await pruefe("Speichern merkt sich die Uhrzeit (jede Karte); Rechnung des Eintrags unverändert", async () => {
      const r = await page.evaluate(() => { saveHistory("faersen"); const e = historyData[0]; return { k: e.kategorie, g: e.gesamt, zeit: e.zeit }; });
      assert.strictEqual(r.k, "faersen"); assert.strictEqual(r.g, 200);
      assert(r.zeit && Math.abs(new Date(r.zeit) - Date.now()) < 60000, "zeit " + r.zeit);
    });

    await pruefe("History: „gefüttert um …“, antippen = Uhrzeit ändern (10:18)", async () => {
      await page.evaluate(() => { historyCollapsed.tageslog = false; getKategorien().forEach(c => historyCollapsed.kategorien[c] = true); showTab("history"); buildHistory(); });
      const z = await page.evaluate(() => [...document.querySelectorAll("#history .fm-zeit")].map(e => e.textContent));
      assert(z.some(t => t.includes("gefüttert um")), z.join(" | "));
      antwort = "10:18";
      await page.evaluate(() => fmZeitAendern(historyData[0].id));
      const d = await page.evaluate(() => { const x = new Date(historyData[0].zeit); return [x.getHours(), x.getMinutes(), fmIso(x) === fmAusDatum(historyData[0].datum)]; });
      assert.deepStrictEqual(d, [10, 18, true]);
      antwort = null;
    });

    await pruefe("Schalter AUS: Speichern genau wie vorher (ohne Uhrzeit), keine Uhrzeit-Zeilen", async () => {
      const r = await page.evaluate(() => { fmCfg.an = false; data.trocken.items.forEach((it, i) => it.kg = i === 0 ? 10 : 0); data.trocken.anz = 2; saveHistory("trocken"); buildHistory();
        const x = { zeit: historyData[0].zeit, zeilen: document.querySelectorAll("#history .fm-zeit").length }; fmCfg.an = true; return x; });
      assert.deepStrictEqual(r, { zeit: undefined, zeilen: 0 });
    });

    await pruefe("Restmischung: „Waage zeigt insgesamt 280“ bei erstem Rest 130 → zweiter Rest 150", async () => {
      await page.evaluate(() => { globalCfg.restQuellen = ["kuehe", "kuehe2"]; data.restbullen.rest = 130; data.restbullen.rest2 = 0; data.restbullen.collapsed = false; showTab("calc"); buildCalc(); });
      await page.fill(".fm-waage-gesamt input", "280");
      await page.locator(".fm-waage-gesamt input").dispatchEvent("change");
      assert.strictEqual(await page.evaluate(() => data.restbullen.rest2), 150);
    });

    await pruefe("Reste mit Uhrzeit auf 24 Std. umgerechnet: 30 Std. bis zur nächsten Fütterung, Rest 100 von 2000 kg → 24 % statt 5 %", async () => {
      const q = await page.evaluate(() => [fmReiheBewerten([{ datum: "2026-11-01", vorlage: 2000, mehr: 0, rest: 100, tiere: 40, stunden: 30 }])[0],
                                          fmReiheBewerten([{ datum: "2026-11-01", vorlage: 2000, mehr: 0, rest: 100, tiere: 40, stunden: null }])[0]]);
      assert(Math.abs(q[0].quote - 24) < 1e-9, "Quote " + q[0].quote);
      assert(Math.abs(q[0].jeTier - 1520 / 40) < 1e-9, "je Tier " + q[0].jeTier);
      assert(Math.abs(q[1].quote - 5) < 1e-9, "ohne Uhrzeit " + q[1].quote);
    });

    await pruefe("fmReihe nimmt die Uhrzeiten aus der History (Abstand zur nächsten Fütterung)", async () => {
      const r = await page.evaluate(() => {
        const alt = historyData; historyData = [];
        const tag = (n, h) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d; };
        [[3, 8], [2, 14], [1, 8]].forEach(([n, h]) => { const d = tag(n, h); historyData.push({ id: "z" + n, datum: d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }), kategorie: "kuehe", tiere: 40, gesamt: 2000, futter: [], zeit: d.toISOString() }); });
        const reihe = fmReihe({ id: "gx", karte: "kuehe", art: "rest" });
        historyData = alt;
        return reihe.map(t => t.stunden);
      });
      assert.deepStrictEqual(r, [30, 18, null]);
    });

    await pruefe("Ohne Reste: Futterzeiten – im Schnitt alle 20 Std. gefüttert → Menge +20 %, „Menge anpassen“ ändert den Lernfaktor", async () => {
      const r = await page.evaluate(() => {
        fmStall = { geholt: new Date().toISOString(), eintraege: { d: { id: "d", name: "Diele", typ: "stall", stall: null, anzahl: 10, gruppen: [{ art: "faerse", anzahl: 10, tageBisKalbung: "190–199" }] } } };
        fmCfg.gruppen = [{ id: "go", name: "Diele", karte: "faersen", art: "ohne", staelle: ["d"], auswerten: true }];
        fmCfg.lern = { go: { faktor: 2, seit: "2026-01-01" } };
        const start = new Date(); start.setHours(6, 0, 0, 0); start.setDate(start.getDate() - 3);
        historyData = historyData.filter(e => e.kategorie !== "faersen");
        for (let i = 0; i < 4; i++) { const d = new Date(start.getTime() + i * 20 * 3600000);
          historyData.unshift({ id: "f" + i, datum: d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }), kategorie: "faersen", tiere: 10, gesamt: 200, futter: [], zeit: d.toISOString() }); }
        return { f: fmFutterzeiten(fmCfg.gruppen[0]), html: fmZeitenHtml(fmCfg.gruppen[0]) };
      });
      assert(Math.abs(r.f.mittel - 20) < 1e-9 && r.f.n === 3, JSON.stringify(r.f));
      assert(r.html.includes("alle 20,0 Std.") && r.html.includes("+20 %"), r.html);
      await page.evaluate(() => fmZeitenUebernehmen("go"));
      assert(Math.abs(await page.evaluate(() => fmCfg.lern.go.faktor) - 2.4) < 1e-9);
      assert((await page.evaluate(() => fmZeitenHtml(fmCfg.gruppen[0]))).includes("sammelt noch"), "nach dem Anpassen zählen nur neue Fütterungen");
    });

    await pruefe("Ohne Reste: Menge nach TS der Ration – TS steigt (mehr Stroh) 45 % → 50 % → Menge × 0,9", async () => {
      const r = await page.evaluate(() => {
        const alt = fmTsVon; const g = fmCfg.gruppen[0]; fmCfg.lern.go = { faktor: 2, seit: fmIso(new Date()) };
        fmTsVon = () => 0.45; const m1 = fmGruppeMenge(g).kg;   // merkt sich TS beim ersten Mal
        fmTsVon = () => 0.5; const m2 = fmGruppeMenge(g);
        fmTsVon = alt;
        return { m1, m2: m2.kg, f: m2.tsFaktor, ts: fmCfg.lern.go.ts };
      });
      assert.strictEqual(r.ts, 0.45);
      assert(Math.abs(r.f - 0.9) < 1e-9 && Math.abs(r.m2 - r.m1 * 0.9) < 1e-9, JSON.stringify(r));
    });

    await pruefe("Rest-Zuschlag: Rechner bietet Tiere + 4 % an; Auswertung „Übernehmen“ ändert den Zuschlag, nicht die Ration", async () => {
      const r = await page.evaluate(() => {
        fmStall.eintraege.s1 = { id: "s1", name: "Stall 1", typ: "stall", stall: null, anzahl: 50, gruppen: [{ art: "laktierend", anzahl: 48 }, { art: "trocken", anzahl: 2 }] };
        fmCfg.gruppen.push({ id: "gk", name: "Kühe", karte: "kuehe", art: "rest", staelle: ["s1"], auswerten: true });
        data.kuehe.items.forEach((it, i) => it.kg = i === 0 ? 40 : 0); data.kuehe.anz = 50;
        showTab("calc"); buildCalc();
        const zeile = document.querySelector("#calc .fm-hm-zeile").textContent;
        const ration = data.kuehe.items.map(i => i.kg);
        fmUebernehmen("gk", "mehr");
        return { zeile, ration, nachher: data.kuehe.items.map(i => i.kg), zuschlag: fmCfg.gruppen.find(g => g.id === "gk").zuschlag, ziel: fmTierzahlMitZuschlag(fmCfg.gruppen.find(g => g.id === "gk"), 50) };
      });
      assert(r.zeile.includes("Herdenmanager: 50 Tiere + 4 % Rest") && r.zeile.includes("übernehmen"), r.zeile);
      assert.deepStrictEqual(r.nachher, r.ration);
      assert.strictEqual(r.zuschlag, 7); assert.strictEqual(r.ziel, 53.5);
    });

    await pruefe("PDF-Dateifeld liegt außerhalb des Reiters (Tastatur-„Weiter“ öffnet keine Dateiauswahl); Eingaben haben „Fertig“", async () => {
      await page.evaluate(() => showTab("fressmenge"));
      const r = await page.evaluate(() => ({ imReiter: document.querySelectorAll("#fressmenge input[type=file]").length, feld: !!document.getElementById("fm-pdf-datei"), eltern: document.getElementById("fm-pdf-datei").parentNode === document.body }));
      assert.deepStrictEqual(r, { imReiter: 0, feld: true, eltern: true });
      await page.evaluate(() => { fmEinrichtungZu = false; fmBauen(); });
      await page.focus("#fm-milchpreis");
      assert.strictEqual(await page.getAttribute("#fm-milchpreis", "enterkeyhint"), "done");
    });

    await pruefe("Zuklappen: Futtermittel und einzelne Futtergruppe (nur Name + Tierzahl)", async () => {
      await page.evaluate(() => { fmZu = {}; fmZuUmschalten("futtermittel"); fmZuUmschalten("g:go"); });
      const r = await page.evaluate(() => ({ kopf: document.querySelector(".fm-futtermittel-kopf").textContent.trim(), zu: document.querySelector('.fm-gruppe[data-gruppe="go"]').textContent.replace(/\s+/g, " ").trim(), select: document.querySelectorAll('.fm-gruppe[data-gruppe="go"] select').length }));
      assert(r.kopf.startsWith("▶"), r.kopf);
      assert.strictEqual(r.zu, "▶ Diele · 10 Tiere"); assert.strictEqual(r.select, 0);
      await page.evaluate(() => { fmZuUmschalten("futtermittel"); fmZuUmschalten("g:go"); });
      assert.strictEqual(await page.evaluate(() => document.querySelectorAll('.fm-gruppe[data-gruppe="go"] select').length) > 0, true);
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close(); server.close();
  }
  console.log(fehler ? `ZEITEN-TEST ROT (${fehler} Fehler)` : "ZEITEN-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
