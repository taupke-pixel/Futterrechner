// Bildschirmfotos: Einstellungen › Module (Hauptschalter, Unterschalter, Erweitert) in der Testversion, Handy-Format (tests/.tmp/module-*.png)
const path = require("path");
const { chromium, devices } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

(async () => {
  const server = await starteServer(path.join(__dirname, ".."), 5074);
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"], locale: "de-DE", timezoneId: "Europe/Berlin" });
  const page = await context.newPage();
  page.on("dialog", d => d.accept());
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto("http://localhost:5074/?emulator=1&testversion=1");
  await zugang.warteAufApp(page, "emulator");
  const ziel = sel => page.locator(sel).evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 10));
  await page.evaluate(() => showTab("settings"));
  await ziel("#module-box"); await page.evaluate(() => window.scrollBy(0, -200));
  await page.screenshot({ path: path.join(__dirname, ".tmp", "module-schalter.png") });
  await page.evaluate(() => { showTab("fressmenge"); window.scrollTo(0, 0); });
  await page.screenshot({ path: path.join(__dirname, ".tmp", "module-reiter.png") });
  await page.evaluate(() => { fmErweitertZu = false; fmBauen(); });
  await ziel("#fm-erweitert");
  await page.screenshot({ path: path.join(__dirname, ".tmp", "module-erweitert.png") });
  await browser.close(); server.close();
  console.log("Bilder gespeichert");
})();
