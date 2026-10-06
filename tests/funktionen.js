// Funktionen-Vergleich: Jeder Handgriff wird gleichzeitig in der ALTEN Fassung (main, d250375) und in der NEUEN
// ausgeführt; nach jedem Schritt muss alles Angezeigte gleich sein (bekannte, freigegebene Änderung F10 ausgenommen).
// Am Ende: neu laden – die neue Fassung lädt dann alles aus der Cloud.
// Start: powershell -File tests\emulator.ps1 "node tests/funktionen.js"
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT_ALT = 5059, PORT_NEU = 5062;
const ALT = path.join(__dirname, ".tmp", "basis");
const S2 = szenarien[1];   // Bayern, Mai 2027 (Feiertage)

// Beispieldaten: Szenario 2 plus ein paar Lieferungen
const BACKUP = JSON.parse(JSON.stringify(S2.backup));
BACKUP.lieferungen = [
  { id: "l3", produkt: "mlf", datum: "20.05.2027", menge: 400 },
  { id: "l2", produkt: "agf", datum: "12.05.2027", menge: 2500 },
  { id: "l1", produkt: "mlf", datum: "02.05.2027", menge: 900.5 }
];

function schnappschuss(page) {
  return page.evaluate(() => {
    const sortiert = o => Array.isArray(o) ? o.map(sortiert) : (o && typeof o === "object") ? Object.fromEntries(Object.keys(o).sort().map(k => [k, sortiert(o[k])])) : o;
    const norm = s => s.replace(/⚠ Termin ist vorbei – sofort bestellen!/g, "").replace(/\s+/g, " ").trim();
    const text = id => norm(document.getElementById(id).textContent);
    const werte = id => [...document.querySelectorAll("#" + id + " input, #" + id + " select")]
      .filter(e => e.type !== "file").map(e => e.value);
    return JSON.stringify({
      rechner: text("calc"), rechnerFelder: werte("calc"),
      einstellungen: text("settings"), einstellungenFelder: werte("settings"),
      history: text("history"), historyFelder: werte("history"),
      tab: document.getElementById("history-tab").className.replace("active", "").replace(/\s+/g, " ").trim(),
      daten: JSON.stringify(sortiert([data.kuehe, data.faersen, data.bullen, globalCfg.bundesland, globalCfg.agfName, globalCfg.agfKg,
        globalCfg.faersenName, lagerData, lieferungen.length, historyData.length, hiddenWarnings]))
    });
  });
}

// Schritte – laufen in beiden Fassungen gleich (gleiche Bedienelemente)
const SCHRITTE = [
  ["Lieferung löschen", async p => { await p.evaluate(() => showTab("history")); await p.locator('button[onclick^="deleteLieferung"]').first().click(); }],
  ["Neue MLF-Lieferung ohne Datum (= heute)", async p => {
    await p.evaluate(() => showTab("history"));
    await p.selectOption("#liefer-produkt", "mlf"); await p.fill("#liefer-menge", "800");
    await p.click('button[onclick="addLieferung()"]');
  }],
  ["Lieferung ohne Menge → Hinweis, nichts gespeichert", async p => {
    await p.evaluate(() => showTab("history")); await p.fill("#liefer-menge", ""); await p.click('button[onclick="addLieferung()"]');
  }],
  ["Warnstufen ändern (AGF orange, MLF rot)", async p => {
    await p.evaluate(() => showTab("history"));
    const o = p.locator('#history input[oninput*="lagerData.agf.orange"]'); await o.fill("9"); await o.blur();
    const r = p.locator('#history input[oninput*="lagerData.mlf.rot"]'); await r.fill("3"); await r.blur();
  }],
  ["Warnung ausblenden", async p => {
    await p.evaluate(() => showTab("calc"));
    const b = p.locator('button[onclick^="hideWarning"]');
    if (await b.count()) await b.first().click();
  }],
  ["Futter umsortieren (Sortieren an, Maissilage runter, MLF hoch, aus)", async p => {
    await p.evaluate(() => showTab("settings"));
    await p.click('button[onclick="toggleSort()"]');
    await p.click(`button[onclick="moveItem('kuehe',0,1)"]`);
    await p.click(`button[onclick="moveItem('kuehe',9,-1)"]`);
    await p.click('button[onclick="toggleSort()"]');
  }],
  ["Futtername und kg in den Einstellungen ändern", async p => {
    await p.evaluate(() => showTab("settings"));
    const n = p.locator(`#settings input[oninput*="data['kuehe'].items[1].name"]`); await n.fill("Maissilage 2027");
    const k = p.locator(`#settings input[oninput*="data['kuehe'].items[1].kg"]`); await k.fill("21.5");
    const k2 = p.locator(`#settings input[oninput*="data['bullen'].items[8].kg"]`); await k2.fill("2.35");
    await p.evaluate(() => buildSettings());
  }],
  ["AGF-Name und kg/s ändern", async p => {
    await p.evaluate(() => showTab("settings"));
    const n = p.locator('#settings input[oninput^="globalCfg.agfName"]').first(); await n.fill("Kraftfutter"); await n.blur();
    const k = p.locator('#settings input[oninput*="globalCfg.agfKg"]'); await k.fill("0.65"); await k.blur();
  }],
  ["Gruppe umbenennen (Färsen → Jungrinder)", async p => {
    await p.evaluate(() => showTab("settings"));
    await p.click("#edit-faersen");
    await p.keyboard.press("Control+A"); await p.keyboard.type("Jungrinder");
    await p.evaluate(() => document.activeElement.blur());
  }],
  ["Bundesland wechseln (Bayern → Niedersachsen, ändert Feiertage/Bestelldatum)", async p => {
    await p.evaluate(() => showTab("settings"));
    await p.selectOption("#settings select", "Niedersachsen");
    await p.evaluate(() => buildHistory());
  }],
  ["Tierzahl ändern", async p => {
    await p.evaluate(() => showTab("calc"));
    const t = p.locator(".cat-kuehe + .cat-body input").first(); await t.fill("86"); await t.blur();
  }],
  ["kilo-Modus: Gesamtmenge 4500 kg eingeben → Tierzahl wird berechnet", async p => {
    await p.evaluate(() => showTab("calc"));
    await p.click(`button[onclick="toggleKilo('kuehe')"]`);
    await p.click("#total-kuehe");
    await p.fill("#edit-kuehe", "4500"); await p.press("#edit-kuehe", "Enter");
    await p.click(`button[onclick="toggleKilo('kuehe')"]`);
  }],
  ["Gruppe zuklappen und wieder aufklappen", async p => {
    await p.evaluate(() => showTab("calc"));
    await p.click(".cat-bullen"); await p.click(".cat-trocken");
    await p.click(".cat-bullen"); await p.click(".cat-trocken");
  }],
  ["Restmischung: vorhanden + Bullenzahl → Zielgewicht", async p => {
    await p.evaluate(() => showTab("calc"));
    const rm = i => p.locator(".cat-restbullen + .cat-body input").nth(i);
    await rm(0).fill("640"); await rm(0).blur(); await rm(2).fill("14"); await rm(2).blur();
  }],
  ["Restmischung wieder auf 0 (Grundzustand)", async p => {
    const rm = i => p.locator(".cat-restbullen + .cat-body input").nth(i);
    await rm(0).fill("0"); await rm(0).blur(); await rm(2).fill("0"); await rm(2).blur();
  }],
  ["Kühe und Mastbullen speichern", async p => {
    await p.evaluate(() => showTab("calc"));
    await p.click(`button[onclick="saveHistory('kuehe')"]`);
    await p.click(`button[onclick="saveHistory('bullen')"]`);
  }],
  ["Kühe nochmal speichern → „Heute bereits gespeichert“ (gesperrt)", async p => {
    await p.evaluate(() => saveHistory("kuehe"));
  }],
  ["Heutigen Kühe-Eintrag löschen (Lager zurückgebucht)", async p => {
    await p.evaluate(() => { const e = historyData.find(h => h.kategorie === "kuehe" && h.datum === getToday()); deleteHistory(e.id); });
  }],
  ["Geänderte Futtermenge neu speichern", async p => {
    await p.evaluate(() => showTab("calc"));
    await p.click(`button[onclick="saveHistory('kuehe')"]`);
  }],
  ["Neue AGF-Lieferung mit Datum", async p => {
    await p.evaluate(() => showTab("history"));
    await p.selectOption("#liefer-produkt", "agf"); await p.fill("#liefer-datum", "2027-05-23"); await p.fill("#liefer-menge", "3250.5");
    await p.click('button[onclick="addLieferung()"]');
  }]
];

async function main() {
  fs.mkdirSync(ALT, { recursive: true });
  fs.writeFileSync(path.join(ALT, "index.html"), execSync("git show d250375:index.html", { cwd: path.join(__dirname, "..") }));
  const sAlt = await starteServer(ALT, PORT_ALT);
  const sNeu = await starteServer(path.join(__dirname, ".."), PORT_NEU);
  const browser = await chromium.launch();
  const geraet = async (modus, url) => {
    const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
    const page = await context.newPage();
    const meldungen = [];
    page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
    page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
    await page.clock.setFixedTime(new Date(S2.heute));
    await zugang.vorbereiten(context, page, modus);
    await page.goto(url);
    await zugang.warteAufApp(page, modus);
    await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(BACKUP)) });
    await page.waitForFunction(() => historyData.length > 10);
    await page.waitForTimeout(500);
    return { page, meldungen };
  };
  const A = await geraet("attrappe", `http://localhost:${PORT_ALT}/`);
  const N = await geraet("emulator", `http://localhost:${PORT_NEU}/?emulator=1`);
  let fehler = 0;
  const vergleiche = async name => {
    await N.page.waitForTimeout(150);
    const a = await schnappschuss(A.page), n = await schnappschuss(N.page);
    if (a === n) { console.log("✔ " + name); return; }
    fehler++;
    let i = 0; while (i < a.length && a[i] === n[i]) i++;
    console.log(`✘ ${name}\n   alt …${a.slice(Math.max(0, i - 80), i + 80)}…\n   neu …${n.slice(Math.max(0, i - 80), i + 80)}…`);
  };
  await vergleiche("Ausgangslage (Backup geladen)");
  for (const [name, schritt] of SCHRITTE) {
    try {
      await schritt(A.page);
      await schritt(N.page);
      await vergleiche(name);
    } catch (e) { fehler++; console.log(`✘ ${name}: ${e.message.split("\n")[0]}`); }
  }
  // Neu laden: alt aus dem Browser, neu aus der Cloud
  await A.page.reload(); await zugang.warteAufApp(A.page, "attrappe");
  await N.page.evaluate(async () => { await cloudSyncFertig(); ["futter", "gCfg", "history", "lager", "lieferungen"].forEach(k => localStorage.removeItem(k)); });
  await N.page.reload(); await zugang.warteAufApp(N.page, "emulator", true); await N.page.waitForTimeout(800);
  await vergleiche("Nach dem Neuladen (neu: alles aus der Cloud)");
  // Meldungen (Hinweisfenster) vergleichen – F4-Rückfrage beim Backup ist neu und gewollt
  const mA = A.meldungen.filter(m => !m.startsWith("Alle Daten des Betriebs")), mN = N.meldungen.filter(m => !m.startsWith("Alle Daten des Betriebs"));
  if (JSON.stringify(mA) === JSON.stringify(mN)) console.log("✔ Gleiche Hinweisfenster (" + mA.join(" | ") + ")");
  else { fehler++; console.log("✘ Hinweisfenster\n   alt " + JSON.stringify(mA) + "\n   neu " + JSON.stringify(mN)); }
  await browser.close(); sAlt.close(); sNeu.close();
  console.log(fehler ? `\nFUNKTIONEN-TEST ROT (${fehler} Fehler)` : "\nFUNKTIONEN-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
