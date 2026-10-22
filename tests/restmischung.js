// Test Restmischung Bullen mit einer oder zwei Kuhmischungen (Auswahl in den Einstellungen). Nur gegen den Emulator.
// Die erwarteten Werte werden hier unabhängig von der App nachgerechnet:
//   Ist kg je Futter = Summe über die gewählten Mischungen (Anteil des Futters in der Mischung × vorhandene Restmenge),
//   gleiches Futter (gleicher Name bzw. AGF/MLF) aus beiden Mischungen zusammengezählt;
//   Soll kg = kg je Bulle × Bullenzahl; Zeile = Soll − Ist; Summe läuft ab der gesamten vorhandenen Restmenge.
// Start: powershell -File tests\emulator.ps1 "node tests/restmischung.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5063;
const S1 = szenarien[0];

function erwartet(backup, quellen, resten, anz) {
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
  const bull = d.bullen.items;
  let lauf = resten.reduce((s, r) => s + r, 0);
  const tabelle = [], gespeichert = [];
  zeilen.forEach(({ it, ist }) => {
    if ((it.type === "agf" || it.type === "mlf") && !bull.some(b => b.type === it.type && b.kg > 0)) return;
    const b = bull.find(b => (it.type && b.type) ? it.type === b.type : b.name === it.name);
    const soll = b ? b.kg * anz : 0;
    const diff = soll - ist;
    lauf += diff;
    const name = it.type === "agf" ? g.agfName : it.type === "mlf" ? g.mlfName : it.name;
    tabelle.push([name, ist.toFixed(1), soll.toFixed(1), lauf.toFixed(1)]);
    if (diff > 0) gespeichert.push([name, diff]);
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
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 4).join("\n   ")); }
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
  const feld = i => page.locator(".cat-restbullen + .cat-body input").nth(i);

  try {
    await pruefe("Standard: nur Kühe gewählt, ein Feld „Restmischung vorhanden“", async () => {
      await page.evaluate(() => showTab("calc"));
      const txt = await page.textContent(".cat-restbullen + .cat-body");
      assert(txt.includes("Restmischung vorhanden (kg)"));
      assert.strictEqual(await page.locator(".cat-restbullen + .cat-body input").count(), 3);
    });

    await pruefe("Einstellungen: Färsen dazu wählen → zwei Felder (Kühe, Färsen)", async () => {
      await page.evaluate(() => showTab("settings"));
      await page.locator("#restquellen-wahl label", { hasText: "Färsen" }).locator("input").click();
      await page.evaluate(() => showTab("calc"));
      const txt = await page.textContent(".cat-restbullen + .cat-body");
      assert(txt.includes("Restmischung Kühe vorhanden (kg)") && txt.includes("Restmischung Färsen vorhanden (kg)"), txt.slice(0, 200));
      assert.strictEqual(await page.locator(".cat-restbullen + .cat-body input").count(), 4);
    });

    await pruefe("Zwei Mischungen: 300 kg Kuh-Rest + 200 kg Färsen-Rest, 10 Bullen → Tabelle stimmt", async () => {
      await feld(0).fill("300"); await feld(0).blur();
      await feld(1).fill("200"); await feld(1).blur();
      await feld(3).fill("10"); await feld(3).blur();
      const soll = erwartet(S1.backup, ["kuehe", "faersen"], [300, 200], 10).tabelle;
      assert.deepStrictEqual(await tabelleLesen(page), soll);
    });

    await pruefe("Zwei Mischungen speichern: History-Eintrag und AGF-Abzug stimmen", async () => {
      const vorher = await page.evaluate(() => lagerData.agf.bestand);
      await page.click(`button[onclick="saveRestBullenHistory()"]`);
      const e = await page.evaluate(() => historyData.find(h => h.kategorie === "restbullen" && h.datum === getToday()));
      const soll = erwartet(S1.backup, ["kuehe", "faersen"], [300, 200], 10).gespeichert;
      assert.deepStrictEqual(e.futter.map(f => [f.name, +f.kg.toFixed(6)]), soll.map(([n, k]) => [n, +k.toFixed(6)]));
      const agf = soll.filter(([n]) => n === S1.backup.globalCfg.agfName).reduce((s, [, k]) => s + k, 0);
      const nachher = await page.evaluate(() => lagerData.agf.bestand);
      assert(Math.abs((vorher - nachher) - agf) < 1e-6, `AGF-Abzug ${vorher - nachher}, erwartet ${agf}`);
    });

    await pruefe("Höchstens zwei, mindestens eine Mischung", async () => {
      await page.evaluate(() => showTab("settings"));
      await page.locator("#restquellen-wahl label", { hasText: "Kälber" }).locator("input").click();
      assert(meldungen.some(m => m.includes("Höchstens zwei")));
      assert.deepStrictEqual(await page.evaluate(() => restQuellen()), ["kuehe", "faersen"]);
      await page.locator("#restquellen-wahl label", { hasText: "Kühe" }).locator("input").click();
      await page.locator("#restquellen-wahl label", { hasText: "Färsen" }).locator("input").click();
      assert(meldungen.some(m => m.includes("Mindestens eine")));
      assert.deepStrictEqual(await page.evaluate(() => restQuellen()), ["faersen"]);
    });

    await pruefe("Nur Färsen gewählt: ein Feld, Rechnung mit der Färsen-Ration", async () => {
      await page.evaluate(() => showTab("calc"));
      assert.strictEqual(await page.locator(".cat-restbullen + .cat-body input").count(), 3);
      await feld(0).fill("250"); await feld(0).blur();
      await feld(2).fill("12"); await feld(2).blur();
      const soll = erwartet(S1.backup, ["faersen"], [250], 12).tabelle;
      assert.deepStrictEqual(await tabelleLesen(page), soll);
    });

    await pruefe("Auswahl wird gespeichert (nach Neuladen und auf anderen Geräten gleich)", async () => {
      await page.evaluate(async () => { await cloudSyncFertig(); ["futter", "gCfg", "history", "lager", "lieferungen"].forEach(k => localStorage.removeItem(k)); });
      await page.reload();
      await zugang.warteAufApp(page, "emulator", true);
      await page.waitForTimeout(800);
      assert.deepStrictEqual(await page.evaluate(() => restQuellen()), ["faersen"]);
    });

    await pruefe("Eingaben der Restmischung bleiben nach dem Neuladen stehen (wie am nächsten Tag)", async () => {
      // nach dem Neuladen oben: Färsen-Rest 250 kg, 12 Bullen (eingegeben im Schritt „Nur Färsen gewählt“)
      assert.deepStrictEqual(await page.evaluate(() => [data.restbullen.rest, data.restbullen.anz]), [250, 12]);
      assert.strictEqual(await feld(0).inputValue(), "250");
      assert.strictEqual(await feld(2).inputValue(), "12");
      const soll = erwartet(S1.backup, ["faersen"], [250], 12).tabelle;
      assert.deepStrictEqual(await tabelleLesen(page), soll);
    });

    await pruefe("Zweites Gerät öffnet → sieht die letzte Restmischung; danach überschreibt es die Eingaben des ersten NICHT", async () => {
      const bid = await page.evaluate(() => betriebId);
      const ctxB = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
      const B = await ctxB.newPage();
      B.on("dialog", d => d.accept());
      await B.clock.setFixedTime(new Date(S1.heute));
      await zugang.vorbereiten(ctxB, B, "emulator");
      await B.goto(`http://localhost:${PORT}/?emulator=1`);
      const uidB = await B.evaluate(async () => { while (!geraeteUid) await new Promise(r => setTimeout(r, 50)); return geraeteUid; });
      await zugang.geraetEintragenOeffentlich(bid, uidB, "Gerät B");
      await B.reload();
      await zugang.warteAufApp(B, "emulator", true);
      await B.waitForTimeout(800);
      assert.deepStrictEqual(await B.evaluate(() => [data.restbullen.rest, data.restbullen.anz]), [250, 12], "Gerät B sieht die letzte Restmischung nicht");
      // Gerät A tippt eine neue Restmischung ein …
      await page.evaluate(() => showTab("calc"));
      await feld(0).fill("333"); await feld(0).blur();
      await page.evaluate(() => cloudSyncFertig());
      // … Gerät B ändert danach etwas anderes (Tierzahl) und speichert dabei seine (alte) Restmischung mit
      await B.evaluate(() => { data.kuehe.anz = 121; save(); });
      await B.evaluate(() => cloudSyncFertig());
      await page.waitForFunction(() => data.kuehe.anz === 121, null, { timeout: 15000 });
      await page.waitForTimeout(500);
      assert.strictEqual(await page.evaluate(() => data.restbullen.rest), 333, "Eingabe von Gerät A wurde überschrieben");
      assert.strictEqual(await feld(0).inputValue(), "333");
      await ctxB.close();
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nRESTMISCHUNG-TEST ROT (${fehler} Fehler)` : "\nRESTMISCHUNG-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
