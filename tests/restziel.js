// Test „Restmischung ist für …“ (Bullen = Standard wie bisher, oder Kühe/Färsen/Trockensteher/Kälber). Nur gegen den Emulator.
// Die erwarteten Werte werden hier unabhängig von der App nachgerechnet (gleiche Regeln wie tests/restmischung.js,
// nur mit der gewählten Ziel-Ration statt immer der Bullen-Ration):
//   Ist kg = Anteil des Futters in der vorhandenen Mischung × Restmenge; Soll kg = kg je Tier der Ziel-Ration × Tierzahl;
//   Zeile = Soll − Ist; Summe läuft ab der Restmenge; gespeichert wird nur, was dazu muss (Soll − Ist > 0).
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/restziel.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5066;
const S1 = szenarien[0];

function erwartet(backup, quellen, resten, anz, ziel) {
  const d = backup.data, g = backup.globalCfg;
  const zeilen = [];
  quellen.forEach((cat, qi) => {
    const items = d[cat].items;
    const total = items.reduce((s, i) => s + i.kg, 0);
    items.forEach(it => {
      if (it.kg <= 0) return;
      const ist = it.kg / total * resten[qi];
      const z = qi > 0 && zeilen.find(z => (it.type || z.it.type) ? it.type === z.it.type : z.it.name === it.name);
      if (z) z.ist += ist; else zeilen.push({ it, ist });
    });
  });
  const zielItems = d[ziel].items;
  let lauf = resten.reduce((s, r) => s + r, 0);
  const tabelle = [], gespeichert = [];
  zeilen.forEach(({ it, ist }) => {
    if ((it.type === "agf" || it.type === "mlf") && !zielItems.some(b => b.type === it.type && b.kg > 0)) return;
    const b = zielItems.find(b => (it.type && b.type) ? it.type === b.type : b.name === it.name);
    const soll = b ? b.kg * anz : 0;
    const diff = soll - ist;
    lauf += diff;
    const name = it.type === "agf" ? g.agfName : it.type === "mlf" ? g.mlfName : it.name;
    tabelle.push([name, ist.toFixed(1), soll.toFixed(1), lauf.toFixed(1)]);
    if (diff > 0) gespeichert.push([name, diff, it.type]);
  });
  return { tabelle, gespeichert };
}

async function tabelleLesen(page) {
  return page.evaluate(() => [...document.querySelectorAll(".cat-restbullen + .cat-body table tr")].slice(1)
    .map(tr => [...tr.querySelectorAll("td")].map(td => td.textContent.trim()))
    .filter(z => z.length === 5).map(z => [z[0], z[1], z[2], z[4]]));
}

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
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await page.clock.setFixedTime(new Date(S1.heute));
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto(`http://localhost:${PORT}/?emulator=1`);
  await zugang.warteAufApp(page, "emulator");
  await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
  await page.waitForFunction(() => historyData.length > 10);
  // die neuen Einstellungs-Bereiche sind zugeklappt (Standard) – für diesen Test aufklappen (bleibt auf dem Gerät gemerkt)
  await page.evaluate(() => { einstellungenZu = { kategorien: false, restmischung: false }; localStorage.setItem("einstellungenZu", JSON.stringify(einstellungenZu)); });
  const feld = i => page.locator(".cat-restbullen + .cat-body input").nth(i);
  const restText = () => page.textContent(".cat-restbullen + .cat-body");
  // alles auf dem Start außer der Restmischung (muss von der Einstellung völlig unberührt bleiben)
  const andereGruppen = () => page.evaluate(() => { showTab("calc"); return [...document.querySelectorAll("#calc .category")]
    .filter(k => !k.querySelector(".cat-restbullen")).map(k => k.innerText).join("|"); });
  const ziel = async cat => { await page.evaluate(() => showTab("settings")); await page.selectOption("#restziel-wahl", cat); await page.evaluate(() => showTab("calc")); };

  try {
    let bullenTabelle, andereVorher;
    await pruefe("Standard ohne Einstellung: Restmischung für Bullen, Beschriftung wie bisher", async () => {
      assert.strictEqual(await page.evaluate(() => restZiel()), "bullen");
      await page.evaluate(() => showTab("settings"));
      assert.strictEqual(await page.inputValue("#restziel-wahl"), "bullen");
      await page.evaluate(() => showTab("calc"));
      const txt = await restText();
      assert(txt.includes("Zielgewicht Bullenration (kg)") && txt.includes("Bullen (Anzahl)"), txt.slice(0, 300));
    });

    await pruefe("Bullen: 300 kg Kuh-Rest, 10 Bullen → Tabelle wie nachgerechnet (Bullen-Ration)", async () => {
      andereVorher = await andereGruppen();
      await feld(0).fill("300"); await feld(0).blur();
      await feld(2).fill("10"); await feld(2).blur();
      bullenTabelle = await tabelleLesen(page);
      assert.deepStrictEqual(bullenTabelle, erwartet(S1.backup, ["kuehe"], [300], 10, "bullen").tabelle);
    });

    await pruefe("Umstellen auf Kühe: Beschriftung „Kühe (Anzahl)“, Tierzahl bleibt, Zielgewicht passt zur Kuh-Ration", async () => {
      await ziel("kuehe");
      const txt = await restText();
      assert(txt.includes("Zielgewicht Ration Kühe (kg)") && txt.includes("Kühe (Anzahl)"), txt.slice(0, 300));
      const proKuh = S1.backup.data.kuehe.items.filter(i => i.kg > 0).reduce((s, i) => s + i.kg, 0);
      assert.deepStrictEqual(await page.evaluate(() => [data.restbullen.anz, data.restbullen.ziel]), [10, 10 * proKuh]);
    });

    await pruefe("Kühe: 300 kg Kuh-Rest, 50 Kühe → Tabelle wie nachgerechnet (Kuh-Ration)", async () => {
      await feld(2).fill("50"); await feld(2).blur();
      assert.deepStrictEqual(await tabelleLesen(page), erwartet(S1.backup, ["kuehe"], [300], 50, "kuehe").tabelle);
    });

    await pruefe("Zielgewicht eintippen rechnet die Tierzahl mit der Kuh-Ration (wie bisher bei Bullen)", async () => {
      const proKuh = S1.backup.data.kuehe.items.filter(i => i.kg > 0).reduce((s, i) => s + i.kg, 0);
      await feld(1).fill(String(proKuh * 40)); await feld(1).blur();
      assert.strictEqual(await page.evaluate(() => data.restbullen.anz), 40);
      assert.deepStrictEqual(await tabelleLesen(page), erwartet(S1.backup, ["kuehe"], [300], 40, "kuehe").tabelle);
    });

    await pruefe("Andere Gruppen auf dem Start bleiben völlig unverändert", async () => {
      assert.strictEqual(await andereGruppen(), andereVorher);
    });

    await pruefe("Speichern (Kühe): History-Eintrag und Lager-Abzug AGF/MLF stimmen", async () => {
      const vorher = await page.evaluate(() => ({ agf: lagerData.agf.bestand, mlf: lagerData.mlf.bestand, n: historyData.length }));
      await page.click(`button[onclick="saveRestBullenHistory()"]`);
      const e = await page.evaluate(() => historyData.find(h => h.kategorie === "restbullen" && h.datum === getToday()));
      const soll = erwartet(S1.backup, ["kuehe"], [300], 40, "kuehe").gespeichert;
      assert.deepStrictEqual(e.futter.map(f => [f.name, +f.kg.toFixed(6)]), soll.map(([n, k]) => [n, +k.toFixed(6)]));
      assert.strictEqual(e.tiere, 40);
      const summe = typ => soll.filter(z => z[2] === typ).reduce((s, z) => s + z[1], 0);
      const nachher = await page.evaluate(() => ({ agf: lagerData.agf.bestand, mlf: lagerData.mlf.bestand, n: historyData.length }));
      assert.strictEqual(nachher.n, vorher.n + 1);
      assert(Math.abs((vorher.agf - nachher.agf) - summe("agf")) < 1e-6, `AGF-Abzug ${vorher.agf - nachher.agf}, erwartet ${summe("agf")}`);
      assert(Math.abs((vorher.mlf - nachher.mlf) - summe("mlf")) < 1e-6, `MLF-Abzug ${vorher.mlf - nachher.mlf}, erwartet ${summe("mlf")}`);
    });

    await pruefe("Färsen, Trockensteher, Kälber: jeweils wie nachgerechnet", async () => {
      for (const cat of ["faersen", "trocken", "kaelber"]) {
        await ziel(cat);
        await feld(2).fill("20"); await feld(2).blur();
        assert.deepStrictEqual(await tabelleLesen(page), erwartet(S1.backup, ["kuehe"], [300], 20, cat).tabelle, cat);
      }
    });

    await pruefe("Zurück auf Bullen, gleiche Eingaben → genau dieselbe Tabelle wie am Anfang", async () => {
      await ziel("bullen");
      await feld(2).fill("10"); await feld(2).blur();
      assert.deepStrictEqual(await tabelleLesen(page), bullenTabelle);
      const txt = await restText();
      assert(txt.includes("Zielgewicht Bullenration (kg)") && txt.includes("Bullen (Anzahl)"));
    });

    await pruefe("Einstellung bleibt nach Neuladen", async () => {
      await ziel("kuehe");
      await page.evaluate(async () => { await cloudSyncFertig(); ["futter", "gCfg", "history", "lager", "lieferungen"].forEach(k => localStorage.removeItem(k)); });
      await page.reload();
      await zugang.warteAufApp(page, "emulator", true);
      await page.waitForTimeout(800);
      assert.strictEqual(await page.evaluate(() => restZiel()), "kuehe");
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nRESTZIEL-TEST ROT (${fehler} Fehler)` : "\nRESTZIEL-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
