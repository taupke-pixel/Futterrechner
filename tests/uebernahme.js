// Ende-zu-Ende-Test: Übernahme der alten Daten (wie bei den Nutzern beim Livegang). Nur gegen den Emulator.
//  1. Alte Fassung (main, d250375) unter http://localhost:5058 mit Beispieldaten benutzen (Daten liegen im Browser).
//  2. Unter DERSELBEN Adresse die neue Fassung öffnen → Gerät wird freigegeben → „In den Betrieb übernehmen“.
//  3. Alles muss genauso angezeigt werden wie vorher – auch nach dem Neuladen und auf einem zweiten Gerät.
//  4. Zweites altes Gerät desselben Betriebs: deutliche Warnung, Abbrechen lässt die Daten unverändert.
// Start: powershell -File tests\emulator.ps1 "node tests/uebernahme.js"
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { execSync } = require("child_process");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5058;
const S1 = szenarien[0];
const ALT = path.join(__dirname, ".tmp", "basis");

function schnappschuss(page) {
  return page.evaluate(() => {
    historyCollapsed.tageslog = false;
    getKategorien().forEach(c => {
      historyCollapsed.kategorien[c] = true;
      getJahre(c).forEach(j => {
        historyCollapsed.jahre[c + "_" + j] = true;
        getMonate(c, j).forEach(m => {
          historyCollapsed.monate[c + "_" + j + "_" + m] = true;
          getWochen(c, j, m).forEach(w => { historyCollapsed.wochen[c + "_" + j + "_" + m + "_" + w] = true; });
        });
      });
    });
    buildCalc(); buildSettings(); buildHistory();
    const norm = s => s.replace(/⚠ Termin ist vorbei – sofort bestellen!/g, "").replace(/\s+/g, " ").trim(); // F10-Hinweis ist neu
    const text = id => norm(document.getElementById(id).textContent);
    const werte = id => [...document.querySelectorAll("#" + id + " input, #" + id + " select")]
      .filter(e => e.type !== "file").map(e => e.value);
    return {
      rechner: text("calc"), rechnerFelder: werte("calc"),
      einstellungen: text("settings"), einstellungenFelder: werte("settings"),
      history: text("history"), historyFelder: werte("history").filter((v, i, a) => true)
    };
  });
}

function vergleiche(alt, neu, wo) {
  for (const k of Object.keys(alt)) {
    const a = JSON.stringify(alt[k]), b = JSON.stringify(neu[k]);
    if (a !== b) {
      let i = 0; while (i < a.length && a[i] === b[i]) i++;
      throw new Error(`${wo}/${k} weicht ab ab Zeichen ${i}:\n   vorher …${a.slice(Math.max(0, i - 60), i + 60)}…\n   jetzt  …${b.slice(Math.max(0, i - 60), i + 60)}…`);
    }
  }
}

async function main() {
  // Alte Fassung bereitstellen
  fs.mkdirSync(ALT, { recursive: true });
  fs.writeFileSync(path.join(ALT, "index.html"), execSync("git show d250375:index.html", { cwd: path.join(__dirname, "..") }));
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 3).join("\n   ")); }
  };

  // ---- Altes Gerät benutzen ----
  const neuesAltesGeraet = async () => {
    const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE", acceptDownloads: true });
    const page = await context.newPage();
    const g = { context, page, meldungen: [], antworten: [] };
    page.on("dialog", d => { g.meldungen.push(d.message()); const a = g.antworten.shift(); a === false ? d.dismiss() : d.accept(); });
    page.on("pageerror", e => g.meldungen.push("SEITENFEHLER: " + e.message));
    await page.clock.setFixedTime(new Date(S1.heute));
    return g;
  };
  const attrappeAn = async context => zugang.vorbereiten(context, null, "attrappe");
  const attrappeAus = async context => { await context.unrouteAll({ behavior: "ignoreErrors" }); await zugang.vorbereiten(context, null, "emulator"); };

  let server = await starteServer(ALT, PORT);
  const A = await neuesAltesGeraet();
  await attrappeAn(A.context);
  await A.page.goto(`http://localhost:${PORT}/`);
  await A.page.waitForFunction(() => document.querySelector("#calc .category"));
  await A.page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
  await A.page.waitForFunction(() => historyData.length > 10);
  // Wie im Alltag: neue MLF-Lieferung, Kühe speichern, Tierzahl und Warnstufe ändern
  await A.page.evaluate(() => showTab("history"));
  await A.page.selectOption("#liefer-produkt", "mlf");
  await A.page.fill("#liefer-datum", "2026-12-18");
  await A.page.fill("#liefer-menge", "1500");
  await A.page.click(`button[onclick="addLieferung()"]`);
  await A.page.evaluate(() => showTab("calc"));
  await A.page.click(`button[onclick="saveHistory('kuehe')"]`);
  await A.page.locator(".cat-faersen + .cat-body input").first().fill("33");
  await A.page.locator(".cat-faersen + .cat-body input").first().blur();
  await A.page.evaluate(() => { lagerData.agf.orange = 14; saveLagerStorage(); data.restbullen = { rest: 0, ziel: 0, anz: 0, collapsed: false }; });
  // Seite neu laden: genau das sieht der Nutzer heute auf der alten Seite
  await A.page.reload();
  await A.page.waitForFunction(() => document.querySelector("#calc .category"));
  const vorher = await schnappschuss(A.page);
  server.close(); await new Promise(r => setTimeout(r, 300));

  // ---- Livegang: dieselbe Adresse liefert jetzt die neue Fassung ----
  server = await starteServer(path.join(__dirname, ".."), PORT);
  await attrappeAus(A.context);
  const betriebId = "UEBERNAHME-" + Date.now();
  await pruefe("Neue Fassung findet die alten Daten im Browser und zeigt die Zugangsseite", async () => {
    await A.page.goto(`http://localhost:${PORT}/?emulator=1`);
    const uid = await A.page.evaluate(async () => { while (!geraeteUid) await new Promise(r => setTimeout(r, 50)); return geraeteUid; });
    await A.page.waitForFunction(() => document.getElementById("accessBlock").style.display === "flex", null, { timeout: 30000 });
    assert(await A.page.evaluate(() => !!localStorage.getItem("futter") && !!localStorage.getItem("history")), "alte Daten weg");
    // Freigabe (wie durch Fritz)
    await zugang.adminSchreiben(`betriebe/${betriebId}`, { name: "Hof Übernahme" });
    await zugang.geraetEintragenOeffentlich(betriebId, uid, "Handy alt");
    await A.page.reload();
    await zugang.warteAufApp(A.page, "emulator", true);
  });

  await pruefe("Hinweis „Daten von vor dem Umbau“ mit Zusammenfassung", async () => {
    await A.page.evaluate(() => showTab("settings"));
    await A.page.waitForSelector("text=In den Betrieb übernehmen", { timeout: 15000 });
    const txt = await A.page.textContent("#betrieb");
    assert(/\d+ Tageseinträge/.test(txt) && txt.includes("Lieferungen"), "Zusammenfassung fehlt: " + txt.slice(0, 200));
  });

  await pruefe("„In den Betrieb übernehmen“: alles wie vorher (Ration, Lager, MLF-Lieferung, History, Einstellungen)", async () => {
    await A.page.click("text=In den Betrieb übernehmen");
    await A.page.waitForFunction(() => historyData.length > 10, null, { timeout: 20000 });
    await A.page.waitForTimeout(800);
    await A.page.evaluate(() => cloudSyncFertig());
    vergleiche(vorher, await schnappschuss(A.page), "nach Übernahme");
  });

  await pruefe("Nach dem Neuladen (Daten kommen aus der Cloud): alles wie vorher", async () => {
    await A.page.evaluate(() => ["futter", "gCfg", "history", "lager", "lieferungen"].forEach(k => localStorage.removeItem(k)));
    await A.page.reload();
    await zugang.warteAufApp(A.page, "emulator", true);
    await A.page.waitForTimeout(800);
    vergleiche(vorher, await schnappschuss(A.page), "nach Neuladen");
  });

  await pruefe("Neues Gerät (z. B. die App) im selben Betrieb sieht dieselben Daten", async () => {
    const N = await neuesAltesGeraet();
    await zugang.vorbereiten(N.context, null, "emulator");
    // neuer Browser-Speicher = wie eine neu installierte App
    await N.page.goto(`http://localhost:${PORT}/?emulator=1`);
    const uid = await N.page.evaluate(async () => { while (!geraeteUid) await new Promise(r => setTimeout(r, 50)); return geraeteUid; });
    await zugang.geraetEintragenOeffentlich(betriebId, uid, "App");
    await N.page.reload();
    await zugang.warteAufApp(N.page, "emulator", true);
    await N.page.waitForTimeout(800);
    vergleiche(vorher, await schnappschuss(N.page), "zweites Gerät");
    await N.context.close();
  });

  // ---- Zweites altes Gerät desselben Betriebs (ältere Daten) ----
  await pruefe("Zweites altes Handy: deutliche Warnung, Abbrechen ändert nichts", async () => {
    server.close(); await new Promise(r => setTimeout(r, 300));
    server = await starteServer(ALT, PORT);
    const B = await neuesAltesGeraet();
    await attrappeAn(B.context);
    await B.page.goto(`http://localhost:${PORT}/`);
    await B.page.waitForFunction(() => document.querySelector("#calc .category"));
    const aelter = JSON.parse(JSON.stringify(S1.backup));
    aelter.historyData = aelter.historyData.slice(5);
    aelter.lagerData.agf.bestand = 999;
    await B.page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(aelter)) });
    await B.page.waitForFunction(() => historyData.length > 10);
    server.close(); await new Promise(r => setTimeout(r, 300));
    server = await starteServer(path.join(__dirname, ".."), PORT);
    await attrappeAus(B.context);
    await B.page.goto(`http://localhost:${PORT}/?emulator=1`);
    const uid = await B.page.evaluate(async () => { while (!geraeteUid) await new Promise(r => setTimeout(r, 50)); return geraeteUid; });
    await zugang.geraetEintragenOeffentlich(betriebId, uid, "Handy 2 alt");
    await B.page.reload();
    await zugang.warteAufApp(B.page, "emulator", true);
    await B.page.evaluate(() => showTab("settings"));
    await B.page.waitForSelector("text=In den Betrieb übernehmen", { timeout: 15000 });
    B.antworten.push(false);              // Warnung: Abbrechen
    await B.page.click("text=In den Betrieb übernehmen");
    await B.page.waitForTimeout(1500);
    assert(B.meldungen.some(m => m.includes("ACHTUNG")), "keine Warnung");
    await B.page.waitForTimeout(800);
    vergleiche(vorher, await schnappschuss(B.page), "zweites altes Handy nach Abbrechen");
    await B.context.close();
  });

  await pruefe("Keine Seitenfehler", async () => {
    assert.deepStrictEqual(A.meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
  });

  await browser.close();
  server.close();
  console.log(fehler ? `\nÜBERNAHME-TEST ROT (${fehler} Fehler)` : "\nÜBERNAHME-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
