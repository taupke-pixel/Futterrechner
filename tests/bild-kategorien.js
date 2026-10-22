// Bildschirmfotos: Kategorien ein/aus (Einstellungen + Start) im Handy-Format (tests/.tmp/kategorien-*.png)
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
  // Kühe umbenennen wie Fritz es macht (Stift anklicken, neuen Namen eintippen)
  await page.click("#edit-kuehe");
  await page.keyboard.press("Control+A"); await page.keyboard.type("Milchkühe");
  await page.locator("#settings input").first().evaluate(() => document.activeElement.blur());
  for (const n of ["Restmischung Bullen", "Kälber"]) await page.locator("#kategorien-wahl label", { hasText: n }).locator("input").click();
  await page.locator("#kategorien-wahl").evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 160));
  await page.screenshot({ path: path.join(__dirname, ".tmp", "kategorien-einstellung.png") });
  await page.evaluate(() => { showTab("calc"); data.kuehe.collapsed = data.faersen.collapsed = data.bullen.collapsed = data.restbullen.collapsed = true; buildCalc(); window.scrollTo(0, 0); });
  await page.screenshot({ path: path.join(__dirname, ".tmp", "kategorien-start.png"), fullPage: true });
  await browser.close(); server.close();
  console.log("Bilder gespeichert");
})();
