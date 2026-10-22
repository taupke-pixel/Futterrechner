// Bildschirmfoto: Restmischung Bullen mit zwei Mischungen im Handy-Format (tests/.tmp/restmischung-zwei.png)
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
  await page.evaluate(() => { einstellungenZu = { kategorien: false, restmischung: false }; localStorage.setItem("einstellungenZu", JSON.stringify(einstellungenZu)); });
  await page.evaluate(() => showTab("settings"));
  await page.locator("#restquellen-wahl label", { hasText: "Färsen" }).locator("input").click();
  await page.locator("#restquellen-wahl").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(__dirname, ".tmp", "restmischung-einstellung.png") });
  await page.evaluate(() => showTab("calc"));
  const feld = i => page.locator(".cat-restbullen + .cat-body input").nth(i);
  await feld(0).fill("300"); await feld(0).blur();
  await feld(1).fill("200"); await feld(1).blur();
  await feld(3).fill("10"); await feld(3).blur();
  await page.locator(".cat-restbullen").scrollIntoViewIfNeeded();
  await page.locator(".cat-restbullen").screenshot({ path: path.join(__dirname, ".tmp", "restmischung-kopf.png") });
  const box = await page.locator(".cat-restbullen").evaluate(e => e.parentElement.getBoundingClientRect().height);
  await page.locator(".cat-restbullen").evaluate(e => e.parentElement.scrollIntoView());
  await page.locator(".cat-restbullen").evaluate(e => e.parentElement.id = "rm-bereich");
  await page.locator("#rm-bereich").screenshot({ path: path.join(__dirname, ".tmp", "restmischung-zwei.png") });
  await browser.close(); server.close();
  console.log("Bilder gespeichert", box);
})();
