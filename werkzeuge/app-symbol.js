// Erzeugt die App-Symbole (PNG) für alle Bildschirmgrößen. Einmalig: node werkzeuge/app-symbol.js
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(__dirname, "..", "tests", "node_modules", "playwright"));

const GROESSEN = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const ZIEL = path.join(__dirname, "..", "android", "app", "src", "main", "res");

(async () => {
  const browser = await chromium.launch();
  for (const [name, px] of Object.entries(GROESSEN)) {
    const page = await browser.newPage({ viewport: { width: px, height: px } });
    await page.setContent(`<html><body style="margin:0">
      <div style="width:${px}px;height:${px}px;border-radius:${px * 0.22}px;background:#2f3b45;display:flex;align-items:center;justify-content:center;
        font-size:${px * 0.62}px;line-height:1">🐄</div></body></html>`);
    const ordner = path.join(ZIEL, "mipmap-" + name);
    fs.mkdirSync(ordner, { recursive: true });
    await page.screenshot({ path: path.join(ordner, "ic_launcher.png"), omitBackground: true });
    await page.close();
  }
  await browser.close();
  console.log("Symbole erzeugt");
})();
