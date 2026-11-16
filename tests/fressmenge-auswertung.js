// Test Paket Fressmengen, Schritt 4: Auswertung im Reiter „Fressmenge“ – Reste aus der bestehenden Restmischung,
// Vorlage aus der History, Restquote/Ampel/Empfehlung, Wetter (Open-Meteo nachgebildet), Verlauf (Diagramm/Liste), Beispieldaten.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/fressmenge-auswertung.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5077;
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const tt = d => String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
const tagMinus = n => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - n); return d; };

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 5).join("\n   ")); }
  };
  const wetterAnfragen = [];
  let wetter = { morgenHeiss: false };
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  await context.route(/api\.open-meteo\.com/, route => {
    wetterAnfragen.push(route.request().url());
    const time = [], tmax = [], rh = [], regen = [];
    for (let i = 92; i >= -2; i--) { const d = tagMinus(i); time.push(iso(d)); tmax.push(i === -1 && wetter.morgenHeiss ? 31 : 8); rh.push(80); regen.push(i === 3 && !wetter.trocken ? 7.5 : 0); }
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ daily: { time, temperature_2m_max: tmax, relative_humidity_2m_mean: rh, precipitation_sum: regen } }) });
  });
  const meldungen = [];
  const neueSeite = async () => { const p = await context.newPage();
    p.on("dialog", d => { meldungen.push(d.message()); d.accept(d.type() === "prompt" ? "Hochleistung" : undefined); });
    p.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message)); return p; };
  await zugang.vorbereiten(context, null, "emulator");
  const A = await neueSeite();
  const page = await neueSeite();

  try {
    await pruefe("Normale App (AUS): kein Wetterabruf, keine Chart-Bibliothek geladen", async () => {
      await A.goto(`http://localhost:${PORT}/?emulator=1`);
      await zugang.warteAufApp(A, "emulator");
      await A.waitForTimeout(800);
      assert.strictEqual(wetterAnfragen.length, 0);
      assert.strictEqual(await A.evaluate(() => !!window.Chart), false);
      await A.close();
    });

    await pruefe("Testversion: Wetter wird geholt (Standort aus Erweitert) und oben angezeigt", async () => {
      await page.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
      await zugang.warteAufApp(page, "emulator");
      await page.click("#fm-tab");
      await page.waitForFunction(() => document.getElementById("fm-wetter"));
      assert(wetterAnfragen[0].includes("latitude=52.6") && wetterAnfragen[0].includes("longitude=8.05") && wetterAnfragen[0].includes("past_days=92"), wetterAnfragen[0]);
      assert((await page.textContent("#fm-wetter")).includes("Heute 8 °C"));
    });

    await pruefe("Ohne Herdenmanager: Kühe (Mischung mit Resten) bekommt die Futtergruppe automatisch → Auswertung sammelt Werte", async () => {
      await page.evaluate(() => fmBauen());
      assert.deepStrictEqual(await page.evaluate(() => fmCfg.gruppen.map(g => [g.karte, g.art])), [["kuehe", "rest"]]);
      assert((await page.textContent(".fm-auswertung")).includes("sammelt noch"));
      assert.strictEqual(await page.locator('#fm-einrichtung .fm-gruppe[data-karte="kuehe"]').count(), 1);
    });

    // Gruppe anlegen (ohne Herdenmanager: Tierzahl aus der History), 8 Tage History mit Vorlage + Restmischung
    await page.evaluate(() => { fmCfg.gruppen = [{ id: "g1", name: "Hochleistung", karte: "kuehe", art: "rest", staelle: [], auswerten: true }]; fmSpeichern(); });
    const restMerken = async (tagVorher, kg) => page.evaluate(([d, kg]) => { fmTag(d).rest = { kuehe: kg }; fmTageMerken(); }, [iso(tagMinus(tagVorher)), kg]);
    const historyAnlegen = async quoten => {
      await page.evaluate(([eintraege]) => { historyData = eintraege; }, [[].concat(...quoten.map((q, i) => {
        const n = quoten.length - i; // n Tage zurück
        return [{ id: "v" + n, datum: tt(tagMinus(n)), kategorie: "kuehe", tiere: 40, gesamt: 2000, agf: 0, mlf: 0, futter: [] },
                { id: "r" + n, datum: tt(tagMinus(n - 1)), kategorie: "restbullen", tiere: 9, gesamt: 0, agf: 0, mlf: 0, futter: [] }];
      }))]);
      for (let i = 0; i < quoten.length; i++) await restMerken(quoten.length - i - 1, quoten[i] === null ? null : 2000 * quoten[i] / 100);
    };

    await pruefe("Reste im Ziel (4 %) → „✓ Rest 4,0 % · passt“", async () => {
      await historyAnlegen([4, 4, 4, 4, 4, 4]);
      await page.evaluate(() => fmBauen());
      const t = await page.textContent('.fm-auswertung[data-gruppe="g1"] .fm-text');
      assert(t.includes("✓") && t.includes("Rest 4,0 % · passt"), t);
    });

    await pruefe("Reste zu niedrig (1 %) → Empfehlung +3 % mit neuer Fressmenge je Kuh; in der Testversion nur ansehen", async () => {
      await historyAnlegen([1, 1, 1, 1, 1, 1]);
      await page.evaluate(() => { data.kuehe.items.forEach((it, i) => it.kg = i === 0 ? 50 : 0); fmBauen(); });
      const t = await page.textContent('.fm-auswertung[data-gruppe="g1"] .fm-text');
      assert(t.includes("Rest 1,0 % · fressen alles auf · Fressmenge +3 %") && t.includes("→ Rest-Zuschlag 7 %"), t);
      assert(await page.locator('.fm-auswertung[data-gruppe="g1"] button:has-text("Übernehmen")').isDisabled());
    });

    await pruefe("Reste zu hoch (8 %) → −3 %", async () => {
      await historyAnlegen([8, 8, 8, 8, 8, 8]);
      await page.evaluate(() => fmBauen());
      assert((await page.textContent('.fm-auswertung[data-gruppe="g1"] .fm-text')).includes("zu viel übrig · Fressmenge −3 %"));
    });

    await pruefe("Ausreißer (ein Tag 12 %) zählt nicht; Regentag (7,5 mm) zählt in der Lernphase nicht", async () => {
      await historyAnlegen([4, 4, 12, 4, 4, 4, 4]);
      await page.evaluate(() => fmBauen());
      const reihe = await page.evaluate(() => fmReihe(fmCfg.gruppen[0]).map(t => ({ q: t.quote, a: !!t.ausreisser, r: t.regenTag })));
      assert(reihe.find(t => t.q === 12).a, JSON.stringify(reihe));
      assert(reihe.some(t => t.r), "kein Regentag erkannt");
      assert((await page.textContent('.fm-auswertung[data-gruppe="g1"] .fm-text')).includes("Rest 4,0 % · passt"));
    });

    await pruefe("Frage „Heute etwas anders?“ bei frischem Ausreißer: „Alles normal“ → Tag zählt; „Später gefüttert“ → Tag zählt nicht; Frage nur einmal", async () => {
      await historyAnlegen([4, 4, 4, 4, 12, 4]);
      await page.evaluate(() => { fmCfg.antworten = {}; fmBauen(); });
      assert(await page.locator("#fm-frage").isVisible(), "keine Frage");
      assert((await page.textContent("#fm-frage")).includes("Rest 12,0 %"));
      await page.click("#fm-frage >> text=Alles normal");
      assert.strictEqual(await page.locator("#fm-frage").count(), 0);
      assert((await page.textContent('.fm-auswertung[data-gruppe="g1"] .fm-text')).includes("zu viel übrig"));
      await page.evaluate(() => { fmCfg.antworten = {}; fmBauen(); });
      await page.click("#fm-frage >> text=Später gefüttert");
      assert.strictEqual(await page.locator("#fm-frage").count(), 0);
      assert((await page.textContent('.fm-auswertung[data-gruppe="g1"] .fm-text')).includes("Rest 4,0 % · passt"));
      await page.evaluate(() => { fmCfg.antworten = {}; fmSpeichern(); });
    });

    await pruefe("Leergefressen 2 Tage → sofort Empfehlung +3 %; aber Hitze morgen → nicht erhöhen", async () => {
      await historyAnlegen([4, 4, 4, 4, 0, 0]);
      await page.evaluate(() => fmBauen());
      assert((await page.textContent('.fm-auswertung[data-gruppe="g1"] .fm-text')).includes("Leergefressen (2 Tage)"));
      wetter.morgenHeiss = true;
      await page.evaluate(() => fmWetterHolen(true));
      await page.waitForFunction(() => /Hitze angesagt|passt|Rest/.test(document.querySelector('.fm-auswertung .fm-text').textContent) && !document.querySelector('.fm-auswertung .fm-text').textContent.includes("Leergefressen"));
      wetter.morgenHeiss = false;
      await page.evaluate(() => fmWetterHolen(true));
    });

    await pruefe("Zu wenige Tage → „sammelt noch Werte“; Tag ohne gemerkten Rest wird ausgelassen", async () => {
      await historyAnlegen([4, null, null, null, null, 4]);
      await page.evaluate(() => fmBauen());
      assert((await page.textContent('.fm-auswertung[data-gruppe="g1"] .fm-text')).includes("sammelt noch Werte (2 von 3 Tagen)"));
    });

    // History frei zusammenstellen: je Tag n (Tage zurück) Vorlage Kühe und am Folgetag Restmischung / normale Bullenration / nichts
    const historyFrei = async tage => {
      const e = [];
      tage.forEach(([n, folge]) => {
        e.push({ id: "v" + n, datum: tt(tagMinus(n)), kategorie: "kuehe", tiere: 40, gesamt: 2000, agf: 0, mlf: 0, futter: [] });
        if (folge === "rest") e.push({ id: "r" + n, datum: tt(tagMinus(n - 1)), kategorie: "restbullen", tiere: 9, gesamt: 0, agf: 0, mlf: 0, futter: [] });
        if (folge === "bullen") e.push({ id: "b" + n, datum: tt(tagMinus(n - 1)), kategorie: "bullen", tiere: 12, gesamt: 500, agf: 0, mlf: 0, futter: [] });
      });
      await page.evaluate(([x]) => { historyData = x; fmCfg.antworten = {}; fmCfg.erledigt = {}; fmSpeichern(); }, [e]);
      for (const [n, folge] of tage) if (folge === "rest") await restMerken(n - 1, 80);
    };

    await pruefe("Normale Bullenration statt Restmischung → EINMAL „Kühe leergefressen?“; „Ja, leergefressen“ = Rest 0", async () => {
      await historyFrei([[6, "rest"], [5, "rest"], [4, "rest"], [3, "rest"], [2, "rest"], [1, "bullen"]]);
      await page.evaluate(() => fmBauen());
      assert((await page.textContent("#fm-frage")).includes("Normale Bullenration heute – Kühe leergefressen?"));
      assert.strictEqual(await page.evaluate(() => document.getElementById("fm-tab").classList.contains("tab-orange")), true, "Reiter nicht eingefärbt");
      await page.click("#fm-frage >> text=Ja, leergefressen");
      assert.strictEqual(await page.locator("#fm-frage").count(), 0);
      assert.strictEqual(await page.evaluate(() => fmReihe(fmCfg.gruppen[0]).pop().rest), 0);
    });

    await pruefe("„Reste anders verwertet“ → Tag zählt nicht", async () => {
      await historyFrei([[6, "rest"], [5, "rest"], [4, "rest"], [3, "rest"], [2, "rest"], [1, "bullen"]]);
      await page.evaluate(() => fmBauen());
      await page.click("#fm-frage >> text=Reste anders verwertet");
      assert.strictEqual(await page.evaluate(() => fmReihe(fmCfg.gruppen[0]).pop().ausgelassen), true);
    });

    await pruefe("2 Tage gar nichts gespeichert → „Keine Reste eingetragen – leergefressen oder vergessen?“; „Vergessen“ = beide Tage zählen nicht", async () => {
      await historyFrei([[6, "rest"], [5, "rest"], [4, "rest"], [3, "rest"], [2, "nichts"], [1, "nichts"]]);
      await page.evaluate(() => fmBauen());
      assert((await page.textContent("#fm-frage")).includes("Keine Reste eingetragen – leergefressen oder vergessen?"));
      await page.click("#fm-frage button:text-is(\"Vergessen\")");
      const r2 = await page.evaluate(() => JSON.stringify({ r: fmReihe(fmCfg.gruppen[0]).slice(-3).map(t => [t.datum, t.fehlt, t.antwort, t.ausgelassen]), a: fmCfg.antworten }));
      assert(JSON.parse(r2).r.slice(-2).every(t => t[3] === true), r2);
      assert.strictEqual(await page.locator("#fm-frage").count(), 0);
    });

    await pruefe("Nur 1 Tag ohne Reste → noch keine Frage", async () => {
      await historyFrei([[6, "rest"], [5, "rest"], [4, "rest"], [3, "rest"], [2, "rest"], [1, "nichts"]]);
      await page.evaluate(() => fmBauen());
      assert.strictEqual(await page.locator("#fm-frage").count(), 0);
    });

    await pruefe("Frühwarnung bei Fressmengen-Einbruch (ohne Regen/Hitze/weniger Tiere), „erledigt“ blendet sie aus; bei Regen keine Warnung", async () => {
      wetter.trocken = true; await page.evaluate(() => fmWetterHolen(true)); await page.waitForTimeout(300);
      await historyAnlegen([4, 4, 4, 4, 4, 10, 10, 10]);
      await page.evaluate(() => { fmCfg.antworten = {}; fmCfg.erledigt = {}; fmBauen(); });
      const m = await page.textContent('.fm-auswertung[data-gruppe="g1"] .fm-meldung');
      assert(m.includes("Frühwarnung: gefressen je Tier −3,0 kg FM in 3 Tagen"), m);
      await page.click('.fm-auswertung[data-gruppe="g1"] .fm-meldung button');
      assert.strictEqual(await page.locator(".fm-meldung").count(), 0);
      wetter.trocken = false; await page.evaluate(() => { fmCfg.erledigt = {}; fmWetterHolen(true); }); await page.waitForTimeout(300);
      await page.evaluate(() => fmBauen());
      assert.strictEqual(await page.locator(".fm-meldung").count(), 0, "Warnung trotz Regentag");
    });

    await pruefe("Gruppe antippen → Verlauf: Diagramm (Chart.js 4.4.1 wird erst jetzt geladen), Liste mit Rest % und Symbolen, Zeitraum", async () => {
      await historyAnlegen([4, 3, 6, 4, 5, 4, 4]);
      await page.evaluate(() => fmBauen());
      await page.click('.fm-auswertung[data-gruppe="g1"] b');
      await page.waitForFunction(() => window.Chart && fmCharts.length === 2, null, { timeout: 20000 });
      assert.strictEqual(await page.evaluate(() => Chart.version), "4.4.1");
      assert(await page.locator("#fm-chart-reste").isVisible());
      await page.click("text=Liste");
      const liste = await page.textContent(".fm-liste");
      assert(liste.includes("6,0 %") && liste.includes("💧"), liste);
      await page.click("text=7 Tage");
      assert.strictEqual(await page.evaluate(() => fmZeitraum), 7);
    });

    await pruefe("Rest-Eingabe in der Restmischung wird mit Tag gemerkt (Wert beim Öffnen zählt nicht)", async () => {
      await page.evaluate(() => { delete fmTage[fmIso(new Date())].rest; fmRestZuletzt = null; localStorage.removeItem("fmRestZuletzt"); fmRestBeobachten({ restbullen: { rest: 50 } }, new Date()); });
      assert.strictEqual(await page.evaluate(() => (fmTage[fmIso(new Date())].rest || {}).kuehe), undefined, "Startwert wurde gezählt");
      await page.evaluate(() => fmRestBeobachten({ restbullen: { rest: 85 } }, new Date()));
      assert.strictEqual(await page.evaluate(() => fmTage[fmIso(new Date())].rest.kuehe), 85);
      // Neu öffnen (Tab hat geschlafen): Änderung seit dem letzten Mal zählt – mit dem Tag der letzten Änderung im Betrieb
      await page.evaluate(() => { fmRestZuletzt = localStorage.getItem("fmRestZuletzt"); const gestern = new Date(); gestern.setDate(gestern.getDate() - 1); fmRestBeobachten({ restbullen: { rest: 120 } }, gestern); });
      assert.strictEqual(await page.evaluate(() => { const g = new Date(); g.setDate(g.getDate() - 1); return fmTage[fmIso(g)].rest.kuehe; }), 120);
      await page.evaluate(() => { fmRestZuletzt = localStorage.getItem("fmRestZuletzt"); fmRestBeobachten({ restbullen: { rest: 120 } }, new Date()); });
      assert.strictEqual(await page.evaluate(() => fmTage[fmIso(new Date())].rest.kuehe), 85, "unveränderter Wert wurde neu gezählt");
    });

    await pruefe("Beispieldaten anzeigen/ausblenden; Testdaten zurücksetzen löscht nur die Fressmengen-Daten", async () => {
      await page.click("text=Beispieldaten anzeigen");
      assert((await page.textContent("#fressmenge")).includes("Beispieldaten (30 Tage)"));
      await page.click("text=Beispieldaten ausblenden");
      const vorher = await page.evaluate(() => localStorage.getItem("futter"));
      await page.evaluate(() => { fmEinrichtungZu = false; fmBauen(); });
      await Promise.all([page.waitForNavigation(), page.click("text=Testdaten zurücksetzen")]);
      await zugang.warteAufApp(page, "emulator", true);
      assert.strictEqual(await page.evaluate(() => localStorage.getItem("fmTage")), null);
      assert.strictEqual(await page.evaluate(() => (fmCfg.gruppen || []).filter(g => (g.staelle || []).length || g.id !== "g_" + g.karte).length), 0, "nur die automatische Gruppe darf bleiben");
      assert.strictEqual(await page.evaluate(() => localStorage.getItem("futter")) !== null, vorher !== null);
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nAUSWERTUNG-TEST ROT (${fehler} Fehler)` : "\nAUSWERTUNG-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
