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
      assert.strictEqual(await page.evaluate(() => fmZeitenHtml(fmCfg.gruppen[0])), "", "nach dem Anpassen zählen nur neue Fütterungen (nichts anzeigen, solange nichts zu tun ist)");
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
        fmGruppeZuKarte("kuehe").staelle = ["s1"];
        data.kuehe.items.forEach((it, i) => it.kg = i === 0 ? 40 : 0); data.kuehe.anz = 50;
        showTab("calc"); buildCalc();
        const zeile = document.querySelector("#calc .fm-hm-zeile").textContent;
        const ration = data.kuehe.items.map(i => i.kg);
        fmUebernehmen(fmGruppeZuKarte("kuehe").id, "mehr");
        return { zeile, ration, nachher: data.kuehe.items.map(i => i.kg), zuschlag: fmGruppeZuKarte("kuehe").zuschlag, ziel: fmTierzahlMitZuschlag(fmGruppeZuKarte("kuehe"), 50) };
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
      await page.evaluate(() => { fmZu = { "k:faersen": false }; fmZuUmschalten("futtermittel"); fmZuUmschalten("k:faersen"); });
      const r = await page.evaluate(() => ({ kopf: document.querySelector(".fm-futtermittel-kopf").textContent.trim(), zu: document.querySelector('.fm-gruppe[data-karte="faersen"]').textContent.replace(/\s+/g, " ").trim(), select: document.querySelectorAll('.fm-gruppe[data-karte="faersen"] select').length }));
      assert(r.kopf.startsWith("▶"), r.kopf);
      assert(r.zu.includes("Färsen · Diele · 10 Tiere") && r.zu.includes("▶"), r.zu); assert.strictEqual(r.select, 0);
      await page.evaluate(() => { fmZuUmschalten("futtermittel"); fmZuUmschalten("k:faersen"); });
      assert.strictEqual(await page.evaluate(() => document.querySelectorAll('.fm-gruppe[data-karte="faersen"] .fm-stall').length) > 0, true);
    });

    await pruefe("Rechner › Restmischung kompakt: „Rest Stall 1“ + Feld je Zeile, Waage-Feld bleibt, Eingaben wirken wie vorher", async () => {
      await page.evaluate(() => { data.restbullen.collapsed = false; showTab("calc"); buildCalc(); });
      const zeilen = await page.$$eval(".fm-rest-kompakt > div", d => d.map(e => e.textContent.replace(/\s+/g, " ").trim()));
      assert.deepStrictEqual(zeilen, ["Rest Stall 1", "Rest Kühe Gruppe 2", "Waage zeigt insgesamt (kg)", "Ziel (kg)", "Bullen"], zeilen.join(" | "));
      const f = page.locator(".fm-rest-kompakt input").first();
      await f.fill("140"); await f.dispatchEvent("input");
      assert.strictEqual(await page.evaluate(() => data.restbullen.rest), 140);
      assert(!(await page.locator("#calc .cat-header.cat-restbullen >> xpath=..").innerText()).includes("vorhanden (kg)"));
    });

    await pruefe("History: Lieferungen nach Art zum Auf- und Zuklappen (zu = nur „AGF · 2 Lieferungen, zuletzt …“)", async () => {
      await page.evaluate(() => { fmZu = {}; lieferungen = [{ id: "l1", produkt: "agf", datum: "2026-11-10", menge: 1000 }, { id: "l2", produkt: "mlf", datum: "2026-11-08", menge: 500 }, { id: "l3", produkt: "agf", datum: "2026-10-01", menge: 900 }];
        historyCollapsed.lieferungen = false; showTab("history"); buildHistory(); });
      const k = await page.$$eval(".fm-lieferungen-kopf", d => d.map(e => e.textContent.replace(/\s+/g, " ").trim()));
      assert.strictEqual(k.length, 2, k.join(" | "));
      assert(k[0].startsWith("▶") && k[0].includes("· 2 Lieferungen, zuletzt 2026-11-10") && k[1].includes("1 Lieferung,"), k.join(" | "));
      assert.strictEqual(await page.evaluate(() => [...document.querySelectorAll(".fm-lieferungen .history-item")].filter(e => e.offsetParent).length), 0);
      await page.click(".fm-lieferungen-kopf >> nth=0");
      assert.strictEqual(await page.evaluate(() => [...document.querySelectorAll(".fm-lieferungen .history-item")].filter(e => e.offsetParent).length), 2);
    });

    await pruefe("Einstellungen: Restmischung als ein Kasten (Name, „Reste kommen von“, „Gemischt für“)", async () => {
      await page.evaluate(() => { showTab("settings"); buildSettings(); });
      const r = await page.evaluate(() => ({ h: document.getElementById("edit-restbullen").style.display, kopf: document.querySelector("#restquellen-wahl .history-header").textContent.trim(), text: document.getElementById("restquellen-wahl").textContent, name: !!document.querySelector(".fm-rest-name") }));
      assert.strictEqual(r.h, "none");
      assert(r.kopf.includes("Restmischung Bullen"), r.kopf);
      assert(r.name && r.text.includes("Reste kommen von") && r.text.includes("Gemischt für"), r.text);
    });

    await pruefe("Ohne Reste: Reihe fürs Diagramm (kg je Tier auf 24 Std. umgerechnet), Haken „auswerten“ abschaltbar", async () => {
      const r = await page.evaluate(() => fmOhneReihe(fmCfg.gruppen.find(g => g.id === "go")).map(t => [t.stunden, t.jeTier24]));
      assert.deepStrictEqual(r.slice(0, 3), [[20, 24], [20, 24], [20, 24]], JSON.stringify(r));
      assert.deepStrictEqual(r[3], [null, null]);
      await page.evaluate(() => { fmZu["k:faersen"] = false; showTab("fressmenge"); fmEinrichtungZu = false; fmBauen(); });
      await page.uncheck('.fm-gruppe[data-karte="faersen"] .fm-auswerten input');
      assert.strictEqual(await page.evaluate(() => fmCfg.gruppen.find(g => g.id === "go").auswerten), false);
      await page.check('.fm-gruppe[data-karte="faersen"] .fm-auswerten input');
    });

    await pruefe("History: Warnstufen ordentlich als Tabelle (Futter | Orange ab | Rot ab), Eingaben wirken wie vorher", async () => {
      await page.evaluate(() => { historyCollapsed.verlauf = false; showTab("history"); buildHistory(); });
      const z = await page.$$eval(".fm-warnstufen tr", d => d.map(e => e.children[0].textContent.trim()));
      assert.deepStrictEqual(z.slice(0, 3), ["Futter", "AGF", "MLF"], z.join(" | "));
      const f = page.locator(".fm-warnstufen input").first();
      await f.fill("7"); await f.dispatchEvent("input");
      assert.strictEqual(await page.evaluate(() => lagerData.agf.orange), 7);
    });

    await pruefe("Restmischung speichern merkt die Reste im Eintrag; History zeigt sie, antippen = ändern; leere Felder beim Öffnen zählen nicht", async () => {
      const r = await page.evaluate(() => {
        globalCfg.restQuellen = ["kuehe"];
        historyData = historyData.filter(e => e.kategorie !== "restbullen");
        data.restbullen.rest = 130; data.restbullen.anz = 10;
        saveRestBullenHistory();
        const e = historyData[0], heute = fmIso(new Date());
        const vorher = JSON.stringify(fmTage[heute].rest);
        fmRestBeobachten({ restbullen: { rest: 0 } }, new Date());
        return { k: e.kategorie, reste: e.reste, tag: fmTage[heute].rest, gleich: JSON.stringify(fmTage[heute].rest) === vorher };
      });
      assert.strictEqual(r.k, "restbullen"); assert.deepStrictEqual(r.reste, { kuehe: 130 }); assert.deepStrictEqual(r.tag, { kuehe: 130 }); assert(r.gleich);
      await page.evaluate(() => { showTab("history"); buildHistory(); });
      const z = await page.evaluate(() => [...document.querySelectorAll("#history .fm-reste")].map(e => e.textContent));
      assert(z.some(t => t.includes("130 kg") && t.includes("antippen = ändern")), JSON.stringify(z));
      antwort = "140";
      await page.locator("#history .fm-reste").first().evaluate(e => e.click());
      antwort = null;
      assert.deepStrictEqual(await page.evaluate(() => historyData.find(e => e.kategorie === "restbullen").reste), { kuehe: 140 });
    });

    await pruefe("Nach „Übernehmen“ verschwindet der Vorschlag: es zählen nur Fütterungen danach („Rest-Zuschlag jetzt … · sammelt neue Werte“)", async () => {
      const r = await page.evaluate(() => {
        const g = fmGruppeZuKarte("kuehe"); delete g.zuschlagSeit; g.zuschlag = 4;
        historyData = historyData.filter(e => e.kategorie !== "restbullen" && e.kategorie !== "kuehe");
        const de = d => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
        for (let i = 5; i >= 1; i--) {
          const d = new Date(); d.setDate(d.getDate() - i); const d2 = new Date(); d2.setDate(d2.getDate() - i + 1);
          historyData.unshift({ id: "k" + i, datum: de(d), kategorie: "kuehe", tiere: 50, gesamt: 2000, futter: [] });
          historyData.unshift({ id: "r" + i, datum: de(d2), kategorie: "restbullen", tiere: 0, gesamt: 0, futter: [], reste: { kuehe: 0 } });
        }
        const vor = fmBewertung(g, fmReihe(g));
        fmUebernehmen(g.id, "mehr");
        const nach = fmBewertung(g, fmReihe(g));
        showTab("fressmenge"); fmBauen();
        const box = document.querySelector('.fm-auswertung[data-gruppe="' + g.id + '"]');
        return { vor: vor.art, nach: nach.art, text: nach.text, knopf: !!box.querySelector("button.save-btn"), zuschlag: g.zuschlag };
      });
      assert.strictEqual(r.vor, "mehr"); assert.strictEqual(r.nach, "warten"); assert.strictEqual(r.zuschlag, 7);
      assert(r.text.startsWith("Rest-Zuschlag jetzt 7 % · sammelt neue Werte"), r.text);
      assert(!r.knopf, "Übernehmen-Knopf noch da");
    });

    await pruefe("Rest-Zuschlag von Hand in der Futtergruppe; einmalige Bereinigung: falsche Reste „0“ weg, Zuschlag zurück auf den Wert vor dem ersten „Übernehmen“", async () => {
      await page.evaluate(() => { fmEinrichtungZu = false; fmZu["k:kuehe"] = false; fmBauen(); });
      const f = page.locator('.fm-gruppe[data-karte="kuehe"] input.fm-zuschlag');
      await f.fill("5"); await f.dispatchEvent("change");
      assert.strictEqual(await page.evaluate(() => fmGruppeZuKarte("kuehe").zuschlag), 5);
      const r = await page.evaluate(() => {
        const g = fmGruppeZuKarte("kuehe");
        delete fmCfg.restNullBereinigt; fmTage["2026-01-05"] = { rest: { kuehe: 0 } }; fmTage["2026-01-06"] = { rest: { kuehe: 120 } };
        g.zuschlag = 19; fmCfg.protokoll = [{ gruppe: g.name, art: "mehr", vorher: 4 }, { gruppe: g.name, art: "mehr", vorher: 7 }];
        fmRestBereinigen();
        return { a: fmTage["2026-01-05"].rest, b: fmTage["2026-01-06"].rest, z: g.zuschlag, einmal: !!fmCfg.restNullBereinigt };
      });
      assert.deepStrictEqual(r, { a: undefined, b: { kuehe: 120 }, z: 4, einmal: true });
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
