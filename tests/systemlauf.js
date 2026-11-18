// Systemdurchlauf Testversion mit eigener Kopie (Wunsch Fritz 17.11.2026): ein ganzer Stalltag wie bei Fritz –
// Restmischung (nur Zugekipptes in der History, Reste gemerkt), Kühe + Gruppe 2 zusammen, andere Karte, Lieferung,
// Lagerbestand stimmt nach jedem Schritt, nach dem Neuladen ist alles noch da, Löschen gibt Lager zurück,
// Uhrzeit/Reste nachtragen, Backup enthält alles – und der echte Betrieb bleibt die ganze Zeit unverändert.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/systemlauf.js"
const path = require("path");
const assert = require("assert");
const fs = require("fs");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5073;
const FS_URL = "http://127.0.0.1:8080/v1/projects/demo-futterrechner/databases/(default)/documents";
const S1 = szenarien[0];
const nah = (a, b, t, was) => assert(Math.abs(a - b) <= t, `${was}: ${a} statt ${b}`);

async function rohDok(pfad) {
  const r = await fetch(`${FS_URL}/${pfad}`, { headers: { Authorization: "Bearer owner" } });
  if (!r.ok) return null;
  const j = await r.json(); delete j.updateTime; delete j.createTime; return JSON.stringify(j);
}
async function rohSammlung(pfad) {
  const r = await fetch(`${FS_URL}/${pfad}?pageSize=300`, { headers: { Authorization: "Bearer owner" } });
  const j = await r.json(); return JSON.stringify((j.documents || []).map(d => [d.name, d.fields]));
}
async function betriebRoh(bid) {
  const t = [];
  for (const d of ["daten/futter", "daten/einstellungen", "daten/lager"]) t.push(await rohDok(`betriebe/${bid}/${d}`));
  for (const c of ["history", "lieferungen", "geraete"]) t.push(await rohSammlung(`betriebe/${bid}/${c}`));
  return t.join("\n");
}

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 6).join("\n   ")); }
  };
  const neueSeite = async () => {
    const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE", acceptDownloads: true });
    const page = await context.newPage();
    page.meldungen = []; page.antwort = null;
    page.on("dialog", d => { page.meldungen.push(d.message()); d.type() === "prompt" ? d.accept(page.antwort === null ? "" : page.antwort) : d.accept(); });
    page.on("pageerror", e => page.meldungen.push("SEITENFEHLER: " + e.message));
    await zugang.vorbereiten(context, page, "emulator");
    return page;
  };
  const A = await neueSeite(), T = await neueSeite();
  let bid, betriebVorher, backupDatei;
  const lager = () => T.evaluate(() => ({ agf: lagerData.agf.bestand, mlf: lagerData.mlf.bestand, wasser: lagerData.wasser ? lagerData.wasser.bestand : 0 }));
  const gesamtStand = () => T.evaluate(() => JSON.stringify({ data: { ...data }, globalCfg, lagerData, historyData, lieferungen, fm: fmCfg, tage: fmTage }));

  try {
    await pruefe("Vorbereitung: normale App mit echten Daten, Testversion per PIN, „Echte Daten kopieren“ → eigene Kopie", async () => {
      await A.goto(`http://localhost:${PORT}/?emulator=1`);
      await zugang.warteAufApp(A, "emulator");
      await A.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
      await A.waitForFunction(() => historyData.length > 10);
      await A.evaluate(() => cloudSyncFertig());
      bid = await A.evaluate(() => betriebId);
      await T.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
      await T.waitForFunction(() => document.getElementById("accessBlock").style.display === "flex", null, { timeout: 30000 });
      const pin = String(10000000 + Math.floor(Math.random() * 89999999));
      const r = await fetch(`${FS_URL}/einladungen/${pin}`, { method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { betriebId: { stringValue: bid }, betriebName: { stringValue: "Test" }, von: { stringValue: "x" }, art: { stringValue: "pin" }, erstellt: { timestampValue: new Date().toISOString() } } }) });
      assert(r.ok);
      await T.evaluate(() => pinBereichZeigen()); await T.fill("#pin-eingabe", pin);
      await Promise.all([T.waitForNavigation(), T.evaluate(() => pinEinloesen())]);
      await zugang.warteAufApp(T, "emulator", true);
      await T.waitForFunction(() => historyData.length > 10);
      await T.evaluate(() => showTab("fressmenge"));
      await Promise.all([T.waitForNavigation(), T.click("#fm-testdaten >> text=Echte Daten kopieren")]);
      await zugang.warteAufApp(T, "emulator", true);
      assert.strictEqual(await T.evaluate(() => testEigeneDaten()), true);
      betriebVorher = await betriebRoh(bid);
    });

    await pruefe("Einrichten wie bei Fritz: Kühe + Gruppe 2 zusammen, Reste aus beiden, Herdenmanager-Ställe, Futtergruppen", async () => {
      await T.evaluate(() => {
        fmCfg.an = true; fmStallzahlenHolen = async () => {}; fmWetterHolen = async () => {};
        globalCfg.kuehe2Modus = "zusammen"; globalCfg.restQuellen = ["kuehe", "kuehe2"]; saveGlobal();
        fmStall = { geholt: new Date().toISOString(), eintraege: {
          s1: { id: "s1", name: "Stall 1", typ: "stall", stall: null, anzahl: 37, gruppen: [{ art: "laktierend", anzahl: 37 }] },
          s2: { id: "s2", name: "Stall 2", typ: "stall", stall: null, anzahl: 41, gruppen: [{ art: "laktierend", anzahl: 41 }] },
          st: { id: "st", name: "Strohstall", typ: "stall", stall: null, anzahl: 14, gruppen: [{ art: "laktierend", anzahl: 12 }, { art: "trocken", anzahl: 2 }] } } };
        fmCfg.gruppen = [{ id: "g1", karte: "kuehe", staelle: ["s1"] }, { id: "g2", karte: "kuehe2", staelle: ["st", "s2"] }];
        fmSpeichern(); showTab("calc"); buildCalc();
      });
      assert.strictEqual(await T.locator(".zusammen-karte").count(), 1);
    });

    await pruefe("Restmischung Bullen: in der History steht nur, was zugekippt wurde (jede Zeile > 0, Summe stimmt); Lager sinkt genau um AGF/MLF/Wasser; Reste und Uhrzeit gemerkt", async () => {
      await T.evaluate(() => { data.restbullen.rest = 130; data.restbullen.rest2 = 150; data.restbullen.ziel = 900; data.restbullen.anz = 0; save(); buildCalc(); });
      const vor = await lager();
      const r = await T.evaluate(() => {
        // Erwartung unabhängig von der App nachrechnen: Soll laut Bullenration minus vorhanden aus den Resten
        const bull = data[restZiel()].items, erwartet = [];
        restMischungZeilen().forEach(({ it, ist }) => {
          if ((it.type === "agf" || it.type === "mlf" || it.type === "wasser") && !bull.some(b => b.type === it.type && b.kg > 0)) return;
          const b = bull.find(b => (it.type && b.type) ? it.type === b.type : b.name === it.name);
          const soll = b ? b.kg * (data.restbullen.anz || data.restbullen.ziel / (b.kg || 1)) : 0;
          if (soll - ist > 0) erwartet.push(+(soll - ist).toFixed(6));
        });
        const n = historyData.length; saveRestBullenHistory(); const e = historyData[0];
        return { neu: historyData.length - n, e, erwartet };
      });
      assert.strictEqual(r.neu, 1, "genau ein neuer Eintrag");
      assert.strictEqual(r.e.kategorie, "restbullen");
      assert(r.e.futter.length > 0 && r.e.futter.every(f => f.kg > 0), "nur zugekippte Futter: " + JSON.stringify(r.e.futter));
      assert.deepStrictEqual(r.e.futter.map(f => +f.kg.toFixed(6)), r.erwartet, "Zeilen wie nachgerechnet");
      nah(r.e.gesamt, r.e.futter.reduce((s, f) => s + f.kg, 0), 1e-6, "Summe");
      assert.deepStrictEqual(r.e.reste, { kuehe: 130, kuehe2: 150 }, "Reste gemerkt");
      assert(r.e.zeit && Math.abs(new Date(r.e.zeit) - Date.now()) < 120000, "Uhrzeit");
      const nach = await lager();
      nah(nach.agf, vor.agf - (r.e.agf || 0), 1e-6, "AGF"); nah(nach.mlf, vor.mlf - (r.e.mlf || 0), 1e-6, "MLF"); nah(nach.wasser, vor.wasser - (r.e.wasser || 0), 1e-6, "Wasser");
      assert.strictEqual(await T.evaluate(() => { const n = historyData.length; saveRestBullenHistory(); return historyData.length - n; }), 0, "zweites Speichern am selben Tag gesperrt");
    });

    await pruefe("Kühe + Gruppe 2 zusammen speichern: zwei Einträge (Kühe, Gruppe 2) mit Uhrzeit; Lager sinkt genau um deren AGF/MLF/Wasser; doppelt speichern gesperrt", async () => {
      await T.evaluate(() => { data.kuehe.anz = 38.5; data.kuehe2.anz = 57.2; save(); buildCalc(); });
      const vor = await lager();
      const r = await T.evaluate(() => { const n = historyData.length; zusammenSpeichern(); return { neu: historyData.length - n, e: historyData.slice(0, 2) }; });
      assert.strictEqual(r.neu, 2);
      assert.deepStrictEqual(r.e.map(x => x.kategorie), ["kuehe", "kuehe2"]);
      r.e.forEach(x => { assert(x.zeit, "Uhrzeit"); assert(x.futter.every(f => f.kg > 0)); nah(x.gesamt, x.futter.reduce((s, f) => s + f.kg, 0), 1e-6, "Summe"); });
      const ab = k => r.e.reduce((s, x) => s + (x[k] || 0), 0), nach = await lager();
      nah(nach.agf, vor.agf - ab("agf"), 1e-6, "AGF"); nah(nach.mlf, vor.mlf - ab("mlf"), 1e-6, "MLF"); nah(nach.wasser, vor.wasser - ab("wasser"), 1e-6, "Wasser");
      assert.strictEqual(await T.evaluate(() => { const n = historyData.length; zusammenSpeichern(); return historyData.length - n; }), 0);
    });

    await pruefe("Andere Karte (Färsen) speichern: ein Eintrag mit Uhrzeit, Lager stimmt", async () => {
      const vor = await lager();
      const e = await T.evaluate(() => { const n = historyData.length; saveHistory("faersen"); return historyData.length - n === 1 ? historyData[0] : null; });
      assert(e && e.kategorie === "faersen" && e.zeit);
      const nach = await lager();
      nah(nach.agf, vor.agf - (e.agf || 0), 1e-6, "AGF"); nah(nach.mlf, vor.mlf - (e.mlf || 0), 1e-6, "MLF");
    });

    await pruefe("Lieferung eintragen (AGF 5000 kg): Lager steigt genau um 5000, Eintrag in Lieferungen", async () => {
      const vor = await lager();
      await T.evaluate(() => { showTab("history"); buildHistory(); });
      await T.evaluate(() => { document.getElementById("liefer-produkt").value = "agf"; document.getElementById("liefer-menge").value = "5000"; addLieferung(); });
      const nach = await lager();
      nah(nach.agf, vor.agf + 5000, 1e-6, "AGF");
      assert.strictEqual(await T.evaluate(() => lieferungen[0].menge), 5000);
    });

    await pruefe("Uhrzeit ändern (10:18) und Reste nachtragen (140) in der History", async () => {
      T.antwort = "10:18";
      await T.evaluate(() => fmZeitAendern(historyData.find(e => e.kategorie === "restbullen").id));
      T.antwort = "140";
      // zwei Abfragen (Stall 1, Strohstall + Stall 2) – beide mit derselben Antwort
      await T.evaluate(() => fmResteAendern(historyData.find(e => e.kategorie === "restbullen").id));
      T.antwort = null;
      const e = await T.evaluate(() => historyData.find(x => x.kategorie === "restbullen"));
      assert.strictEqual(fmUhr(e.zeit), "10:18");
      assert.deepStrictEqual(e.reste, { kuehe: 140, kuehe2: 140 });
      function fmUhr(iso) { const d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
    });

    let stand;
    await pruefe("Neu laden: alles ist noch da (Rationen, Einstellungen, Lager, History, Lieferungen, Fressmenge, gemerkte Tage); Restmischung behält die Werte", async () => {
      stand = JSON.parse(await gesamtStand());
      await T.reload(); await zugang.warteAufApp(T, "emulator", true);
      const neu = JSON.parse(await gesamtStand());
      assert.deepStrictEqual(neu.historyData, stand.historyData, "History");
      assert.deepStrictEqual(neu.lagerData, stand.lagerData, "Lager");
      assert.deepStrictEqual(neu.lieferungen, stand.lieferungen, "Lieferungen");
      assert.deepStrictEqual(neu.globalCfg, stand.globalCfg, "Einstellungen");
      for (const k of ["kuehe", "kuehe2", "faersen", "bullen", "trocken", "kaelber"]) assert.deepStrictEqual(neu.data[k], stand.data[k], "Ration " + k);
      assert.strictEqual(neu.data.restbullen.rest, 130); assert.strictEqual(neu.data.restbullen.rest2, 150); assert.strictEqual(neu.data.restbullen.ziel, 900);
      assert.deepStrictEqual(neu.fm.gruppen, stand.fm.gruppen, "Futtergruppen");
      assert.deepStrictEqual(neu.tage, stand.tage, "gemerkte Tage (Reste, Wetter, Tiere)");
    });

    await pruefe("Öffnen trägt keine falschen Reste ein (keine „0“ für heute, kein Leergefressen)", async () => {
      const r = await T.evaluate(() => { const t = fmTage[fmIso(new Date())]; return t && t.rest; });
      assert.deepStrictEqual(r, { kuehe: 140, kuehe2: 140 });
    });

    await pruefe("History-Eintrag löschen (Färsen): weg, Lager bekommt AGF/MLF zurück, bleibt nach Neuladen so", async () => {
      const vor = await lager();
      const e = await T.evaluate(() => { const e = historyData.find(x => x.kategorie === "faersen"); deleteHistory(e.id); return e; });
      const nach = await lager();
      nah(nach.agf, vor.agf + (e.agf || 0), 1e-6, "AGF"); nah(nach.mlf, vor.mlf + (e.mlf || 0), 1e-6, "MLF");
      await T.reload(); await zugang.warteAufApp(T, "emulator", true);
      assert(!(await T.evaluate(id => historyData.some(x => x.id === id), e.id)), "Eintrag wieder da");
      nah((await lager()).agf, nach.agf, 1e-6, "AGF nach Neuladen");
    });

    await pruefe("Lieferung löschen: Lager sinkt wieder um 5000, bleibt nach Neuladen so", async () => {
      const vor = await lager();
      await T.evaluate(() => deleteLieferung(lieferungen.find(l => l.menge === 5000).id));
      nah((await lager()).agf, vor.agf - 5000, 1e-6, "AGF");
      await T.reload(); await zugang.warteAufApp(T, "emulator", true);
      assert(!(await T.evaluate(() => lieferungen.some(l => l.menge === 5000))));
    });

    await pruefe("Backup erstellen: Datei enthält History (mit Uhrzeit und Resten), Lager, Lieferungen und Rationen", async () => {
      await T.evaluate(() => showTab("history"));
      const [dl] = await Promise.all([T.waitForEvent("download"), T.evaluate(() => exportBackup())]);
      const b = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
      const h = b.historyData || b.history, rb = (h || []).find(x => x.kategorie === "restbullen");
      assert(h && h.length > 10, "History im Backup");
      assert(rb && rb.zeit && rb.reste, "Restmischung mit Uhrzeit und Resten im Backup");
      assert(b.lagerData || b.lager, "Lager im Backup");
      assert(b.zusatz && b.zusatz.fressmenge && b.zusatz.fressmenge.gruppen.length === 2, "Fressmenge-Einrichtung im Backup");
      assert(b.zusatz.fmTage && Object.keys(b.zusatz.fmTage).length > 0, "gemerkte Tage im Backup");
      backupDatei = await dl.path();
    });

    await pruefe("Backup zurückspielen nach „Browserverlauf gelöscht“: History, Lager, Lieferungen, Rationen UND Fressmenge-Einrichtung (Futtergruppen, Rest-Zuschlag), gemerkte Tage sind wieder da", async () => {
      const vorher = JSON.parse(await gesamtStand());
      await T.evaluate(() => { const g = fmCfg.gruppen.find(x => x.karte === "kuehe"); g.zuschlag = 10; localStorage.setItem("fressmenge", JSON.stringify(fmCfg)); });
      const mitZuschlag = JSON.parse(await gesamtStand());
      const [dl] = await Promise.all([T.waitForEvent("download"), T.evaluate(() => exportBackup())]);
      const datei = await dl.path();
      // Gerät „leer“: Fressmenge-Einrichtung und gemerkte Tage weg, History/Lager verändert
      await T.evaluate(() => { fmCfg.gruppen = []; fmTage = {}; localStorage.setItem("fressmenge", JSON.stringify(fmCfg)); localStorage.setItem("fmTage", "{}"); historyData = historyData.slice(5); saveHistoryStorage(); lagerData.agf.bestand = 1; saveLagerStorage(); });
      await T.setInputFiles("#backupFile", datei);
      await T.waitForFunction(() => fmCfg.gruppen.length === 2, null, { timeout: 15000 });
      const neu = JSON.parse(await gesamtStand());
      assert.deepStrictEqual(neu.historyData, mitZuschlag.historyData, "History");
      assert.deepStrictEqual(neu.lagerData, mitZuschlag.lagerData, "Lager");
      assert.deepStrictEqual(neu.lieferungen, mitZuschlag.lieferungen, "Lieferungen");
      assert.deepStrictEqual(neu.fm.gruppen, mitZuschlag.fm.gruppen, "Futtergruppen");
      assert.strictEqual(neu.fm.gruppen.find(x => x.karte === "kuehe").zuschlag, 10, "Rest-Zuschlag");
      assert.deepStrictEqual(neu.tage, mitZuschlag.tage, "gemerkte Tage");
      await T.reload(); await zugang.warteAufApp(T, "emulator", true);
      const nachLaden = JSON.parse(await gesamtStand());
      assert.deepStrictEqual(nachLaden.fm.gruppen, mitZuschlag.fm.gruppen, "Futtergruppen nach Neuladen");
      assert.deepStrictEqual(nachLaden.historyData, mitZuschlag.historyData, "History nach Neuladen");
      void vorher;
    });

    await pruefe("Der echte Betrieb ist nach dem ganzen Tag unverändert (nichts an die echten Daten geschickt)", async () => {
      await T.waitForTimeout(1500);
      assert.strictEqual(await betriebRoh(bid), betriebVorher, "Betrieb wurde verändert!");
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual([...A.meldungen, ...T.meldungen].filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close(); server.close();
  }
  console.log(fehler ? `\nSYSTEMLAUF ROT (${fehler} Fehler)` : "\nSYSTEMLAUF GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
