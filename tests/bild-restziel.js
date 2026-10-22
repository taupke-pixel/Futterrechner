// Bildschirmfotos: „Restmischung ist für …“ (Einstellungen + Rechner) im Handy-Format (tests/.tmp/restziel-*.png)
const path = require("path");
const { chromium, devices } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

(async () => {
  const server = await starteServer(path.join(__dirname, ".."), 5064);
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"], locale: "de-DE", timezoneId: "Europe/Berlin" });
  const page = await context.newPage();
  page.on("dialog", d => d.accept());
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto("http://localhost:5064/?emulator=1");
  await zugang.warteAufApp(page, "emulator");
  await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(szenarien[0].backup)) });
  await page.waitForFunction(() => historyData.length > 10);
  // die neuen Einstellungs-Bereiche sind zugeklappt (Standard) – für diesen Test aufklappen (bleibt auf dem Gerät gemerkt)
  // zuerst zugeklappt fotografieren (Standard), dann aufklappen wie mit dem Finger
  await page.evaluate(() => showTab("settings"));
  await page.locator("#kategorien-wahl").evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 200));
  await page.screenshot({ path: path.join(__dirname, ".tmp", "klappen-zu.png") });
  await page.click("#kategorien-wahl .history-header");
  await page.click("#restquellen-wahl .history-header");
  await page.evaluate(() => showTab("settings"));
  await page.selectOption("#restziel-wahl", "kuehe");
  await page.evaluate(() => showTab("settings"));
  await page.locator("#edit-restbullen").evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 120));
  await page.screenshot({ path: path.join(__dirname, ".tmp", "restziel-einstellung.png") });
  await page.evaluate(() => showTab("calc"));
  const feld = i => page.locator(".cat-restbullen + .cat-body input").nth(i);
  await feld(0).fill("300"); await feld(0).blur();
  await feld(2).fill("50"); await feld(2).blur();
  await page.locator(".cat-restbullen").evaluate(e => { e.parentElement.id = "rm-bereich"; e.parentElement.scrollIntoView(); });
  await page.locator("#rm-bereich").screenshot({ path: path.join(__dirname, ".tmp", "restziel-kuehe.png") });
  await browser.close(); server.close();
  console.log("Bilder gespeichert");
})();
