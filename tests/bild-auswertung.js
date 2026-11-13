// Bildschirmfotos: Reiter „Fressmenge“ mit Auswertung (Beispieldaten) und Rechner-Ergänzung (tests/.tmp/auswertung-*.png), Handy-Format.
// Mit echten Stallzahlen: Kopplungscode als Umgebungsvariable FM_KOPPLUNG (nie ins Repository schreiben).
const path = require("path");
const { chromium, devices } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

(async () => {
  const server = await starteServer(path.join(__dirname, ".."), 5078);
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"], locale: "de-DE", timezoneId: "Europe/Berlin" });
  const page = await context.newPage();
  page.on("dialog", d => d.accept());
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto("http://localhost:5078/?emulator=1&testversion=1");
  await zugang.warteAufApp(page, "emulator");
  const code = process.env.FM_KOPPLUNG || "";
  await page.evaluate(c => { fmCfg.kopplung = c; fmCfg.gruppen = [
    { id: "g1", name: "Hochleistung", karte: "kuehe", art: "rest", staelle: [], auswerten: true },
    { id: "g2", name: "Altmelker", karte: "kuehe2", art: "rest", staelle: [], auswerten: true }]; fmSpeichern(); }, code);
  if (code) {
    await page.evaluate(() => fmStallzahlenHolen(true));
    await page.waitForFunction(() => fmStall, null, { timeout: 20000 });
    await page.evaluate(() => { const id = n => (fmPlaetze().find(p => p.name === n && p.typ === "stall") || {}).id;
      fmCfg.gruppen[0].staelle = [id("Stall 1"), id("Strohstall")].filter(Boolean); fmCfg.gruppen[1].staelle = [id("Stall 2")].filter(Boolean); fmSpeichern(); });
  }
  await page.click("#fm-tab");
  await page.evaluate(() => { fmDemo = true; fmEinrichtungZu = true; fmBauen(); window.scrollTo(0, 0); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, ".tmp", "auswertung-1.png") });
  await page.evaluate(() => fmGruppeOeffnen("g1"));
  await page.waitForFunction(() => window.Chart && fmCharts.length === 2, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.locator(".fm-auswertung").first().evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 10));
  await page.screenshot({ path: path.join(__dirname, ".tmp", "auswertung-2.png") });
  await page.evaluate(() => fmAnsichtSetzen("liste"));
  await page.screenshot({ path: path.join(__dirname, ".tmp", "auswertung-3.png") });
  await page.evaluate(() => { data.kuehe.anz = 40; data.kuehe.items[0].kg = 28; data.kuehe.items[1].kg = 16; data.kuehe.items[2].kg = 1.2; showTab("calc"); Object.keys(data).forEach(k => { if (data[k] && "collapsed" in data[k]) data[k].collapsed = k !== "kuehe"; }); buildCalc(); window.scrollTo(0, 0); });
  await page.screenshot({ path: path.join(__dirname, ".tmp", "auswertung-4.png") });
  await browser.close(); server.close();
  console.log("Bilder gespeichert");
})();
