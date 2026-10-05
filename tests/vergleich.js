// Vergleichstest: prüft, dass alle Rechenergebnisse exakt gleich bleiben.
//
//   node vergleich.js --basis      Erwartete Ergebnisse aus der Original-Fassung (main, Commit d250375) erzeugen
//   node vergleich.js              Aktuelle index.html prüfen (muss Zeichen für Zeichen gleich sein)
//
// Ablauf je Szenario: Seite mit fester Uhrzeit laden → Beispieldaten über „Backup laden“ einspielen →
// Rechner, Restmischung, Speichern, Lieferung, Löschen, Taschenrechner bedienen → nach jedem Schritt alles
// Angezeigte festhalten → „Backup erstellen“ auswerten → Seite neu laden und nochmal festhalten.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const szenarien = require("./szenarien");
const zugang = require("./zugang");

const BASIS_COMMIT = "d250375";
const ERWARTET = path.join(__dirname, "erwartet");
const PORT = 5050;

function holeArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function schnappschuss(page) {
  return page.evaluate(() => {
    // History komplett aufklappen, damit alle Summen sichtbar sind
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
    buildHistory();
    const norm = s => s.replace(/\s+/g, " ").trim();
    const text = id => norm(document.getElementById(id).textContent);
    const werte = id => [...document.querySelectorAll("#" + id + " input, #" + id + " select")]
      .filter(e => e.type !== "file")
      .map(e => (e.type === "checkbox" ? String(e.checked) : e.value));
    return {
      rechner: text("calc"), rechnerFelder: werte("calc"),
      einstellungen: text("settings"), einstellungenFelder: werte("settings"),
      history: text("history"), historyFelder: werte("history"),
      historyTab: document.getElementById("history-tab").className.replace(/\s+/g, " ").trim(),
      taschenrechner: text("calc2")
    };
  });
}

async function backupExport(page) {
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate(() => exportBackup())
  ]);
  return JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
}

async function zeigeTab(page, name) {
  await page.evaluate(n => showTab(n), name);
}

async function laufeSzenario(browser, url, sz, modus) {
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE", acceptDownloads: true });
  const page = await context.newPage();
  const meldungen = [];
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await page.clock.setFixedTime(new Date(sz.heute));
  await zugang.vorbereiten(context, page, modus);

  const ergebnis = { szenario: sz.name, schritte: [] };
  const halte = async name => ergebnis.schritte.push({ schritt: name, ...(await schnappschuss(page)) });

  await page.goto(url);
  await zugang.warteAufApp(page, modus);
  await halte("start");

  if (sz.backup) {
    await page.setInputFiles("#backupFile", {
      name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(sz.backup))
    });
    await page.waitForFunction(() => document.querySelector("#calc .category") !== null);
    await page.waitForTimeout(300);
    await halte("nach-backup-laden");
  }

  // Restmischung
  await zeigeTab(page, "calc");
  const rm = i => page.locator(".cat-restbullen + .cat-body input").nth(i);
  await rm(0).fill(String(sz.restmischung.rest)); await rm(0).blur();
  if (sz.restmischung.ziel !== null) { await rm(1).fill(String(sz.restmischung.ziel)); await rm(1).blur(); }
  if (sz.restmischung.anz !== null) { await rm(2).fill(String(sz.restmischung.anz)); await rm(2).blur(); }
  await halte("restmischung-eingegeben");

  // Kühe speichern, Bullen speichern, Restmischung speichern
  await page.click(`button[onclick="saveHistory('kuehe')"]`);
  await halte("kuehe-gespeichert");
  await page.click(`button[onclick="saveHistory('bullen')"]`);
  await halte("bullen-gespeichert");
  await page.click(`button[onclick="saveRestBullenHistory()"]`);
  await halte("restmischung-gespeichert");

  // Lieferung
  if (sz.lieferung) {
    await zeigeTab(page, "history");
    await page.selectOption("#liefer-produkt", sz.lieferung.produkt);
    if (sz.lieferung.datum) await page.fill("#liefer-datum", sz.lieferung.datum);
    await page.fill("#liefer-menge", String(sz.lieferung.menge));
    await page.click(`button[onclick="addLieferung()"]`);
    await halte("lieferung-gespeichert");
  }

  // Den heute gespeicherten Bullen-Eintrag wieder löschen
  await page.evaluate(() => {
    const e = historyData.find(h => h.kategorie === "bullen" && h.datum === getToday());
    if (e) deleteHistory(e.id);
  });
  await halte("bullen-eintrag-geloescht");

  // Taschenrechner
  await zeigeTab(page, "calc2");
  for (const t of sz.rechner) await page.click(`#calc2 button[onclick="press('${t}')"]`);
  await halte("taschenrechner");

  ergebnis.backupVorNeuladen = await backupExport(page);

  // Neu laden: was ist dauerhaft gespeichert?
  await zugang.vorNeuladen(page, modus);
  await page.reload();
  await zugang.warteAufApp(page, modus);
  await page.waitForTimeout(300);
  await halte("nach-neuladen");
  ergebnis.backupNachNeuladen = await backupExport(page);
  ergebnis.meldungen = meldungen;

  // Cloud-Fassung: ein zweites Gerät im selben Betrieb muss dasselbe sehen
  if (zugang.zweitesGeraet) {
    const zweit = await zugang.zweitesGeraet(browser, page, url, sz, modus, schnappschuss);
    if (zweit) ergebnis.zweitesGeraet = zweit;
  }

  await context.close();
  return ergebnis;
}

// ---------- Vergleich ----------
function ohneIds(o) {
  if (Array.isArray(o)) return o.map(ohneIds);
  if (o && typeof o === "object") {
    const r = {};
    Object.keys(o).sort().forEach(k => { if (k !== "id") r[k] = ohneIds(o[k]); });
    return r;
  }
  return o;
}

function vergleiche(a, b, pfad, fehler) {
  if (fehler.length > 20) return;
  if (typeof a === "number" && typeof b === "number") {
    // Backup-Zahlen: winzige Rundungsreste (< 1e-9) zählen nicht, angezeigt wird ohnehin gerundet
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a))) fehler.push(`${pfad}: erwartet ${a}, jetzt ${b}`);
    return;
  }
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) {
    fehler.push(`${pfad}: erwartet ${JSON.stringify(a)}, jetzt ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) fehler.push(`${pfad}: Anzahl erwartet ${a.length}, jetzt ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) vergleiche(a[i], b[i], `${pfad}[${i}]`, fehler);
    return;
  }
  if (a && typeof a === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.forEach(k => vergleiche(a[k], b[k], `${pfad}.${k}`, fehler));
    return;
  }
  if (a !== b) {
    if (typeof a === "string" && a.length > 80) {
      let i = 0; while (i < a.length && a[i] === b[i]) i++;
      fehler.push(`${pfad}: Unterschied ab Zeichen ${i}:\n   erwartet …${a.slice(Math.max(0, i - 60), i + 60)}…\n   jetzt    …${b.slice(Math.max(0, i - 60), i + 60)}…`);
    } else fehler.push(`${pfad}: erwartet ${JSON.stringify(a)}, jetzt ${JSON.stringify(b)}`);
  }
}

async function main() {
  const basis = process.argv.includes("--basis");
  let wurzel = path.join(__dirname, "..");
  if (basis) {
    wurzel = path.join(__dirname, ".tmp", "basis");
    fs.mkdirSync(wurzel, { recursive: true });
    const html = execSync(`git show ${BASIS_COMMIT}:index.html`, { cwd: path.join(__dirname, "..") });
    fs.writeFileSync(path.join(wurzel, "index.html"), html);
  }
  const html = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
  const modus = zugang.erkenneModus(html);
  const nur = holeArg("--nur");

  const server = await starteServer(wurzel, PORT);
  const browser = await chromium.launch();
  let ok = true;
  try {
    for (const sz of szenarien) {
      if (nur && sz.name !== nur) continue;
      const url = `http://localhost:${PORT}/` + zugang.urlZusatz(modus);
      const erg = await laufeSzenario(browser, url, sz, modus);
      const datei = path.join(ERWARTET, sz.name + ".json");
      if (basis) {
        fs.mkdirSync(ERWARTET, { recursive: true });
        fs.writeFileSync(datei, JSON.stringify(erg, null, 1));
        console.log(`✔ ${sz.name}: Basis gespeichert (${erg.schritte.length} Schritte)`);
        continue;
      }
      const soll = JSON.parse(fs.readFileSync(datei, "utf8"));
      const fehler = [];
      soll.schritte.forEach((s, i) => vergleiche(s, erg.schritte[i] || {}, `${sz.name}/${s.schritt}`, fehler));
      vergleiche(ohneIds(soll.backupVorNeuladen), ohneIds(erg.backupVorNeuladen), `${sz.name}/backup-vor-neuladen`, fehler);
      vergleiche(ohneIds(soll.backupNachNeuladen), ohneIds(erg.backupNachNeuladen), `${sz.name}/backup-nach-neuladen`, fehler);
      vergleiche(soll.meldungen, erg.meldungen, `${sz.name}/meldungen`, fehler);
      if (erg.zweitesGeraet) {
        // Taschenrechner-Verlauf bleibt auf dem Gerät – alles andere muss gleich sein
        const { taschenrechner: _a, schritt: _s, ...ersteGeraet } = soll.schritte[soll.schritte.length - 1];
        const { taschenrechner: _b, ...zweitesGeraet } = erg.zweitesGeraet;
        vergleiche(ersteGeraet, zweitesGeraet, `${sz.name}/zweites-geraet`, fehler);
      }
      if (fehler.length) {
        ok = false;
        console.log(`✘ ${sz.name}: ${fehler.length} Unterschied(e)`);
        fehler.forEach(f => console.log("   " + f));
      } else console.log(`✔ ${sz.name}: identisch (${erg.schritte.length} Schritte, Modus ${modus}${erg.zweitesGeraet ? ", zweites Gerät gleich" : ""})`);
    }
  } finally {
    await browser.close();
    server.close();
    await zugang.aufraeumen(modus);
  }
  if (!basis) console.log(ok ? "\nVERGLEICHSTEST GRÜN – alle Ergebnisse identisch." : "\nVERGLEICHSTEST ROT – Ergebnisse weichen ab!");
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
