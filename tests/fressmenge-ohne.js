// Test Paket Fressmengen, Punkte 9/10/14: Gruppen ohne Reste – Standard-Fressmengen je Tierklasse, Startwert-Frage,
// Menge im Rechner übernehmen, Abladen nach Bedarf, „Anders abgeladen?“ (Nur heute / Ab jetzt so), Lernfrage, „Wie gerechnet?“.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/fressmenge-ohne.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5083;

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 6).join("\n   ")); }
  };
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  await context.route(/api\.open-meteo\.com|firestore\.googleapis\.com\/v1\/projects\/herdenmanager/, r => r.fulfill({ status: 404, body: "{}" }));
  const page = await context.newPage();
  const meldungen = [];
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await zugang.vorbereiten(context, page, "emulator");
  const nah = (a, b, tol, was) => assert(Math.abs(a - b) <= tol, `${was}: ${a} statt ${b}`);
  const bullenKarte = () => page.locator("#calc .category", { has: page.locator(".cat-header.cat-restbullen") });

  try {
    await page.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
    await zugang.warteAufApp(page, "emulator");
    await page.evaluate(() => {
      const gr = (art, alter, anzahl, extra) => ({ art, geschlecht: art === "bulle" ? "m" : "w", rasseCode: "1", altersklasse: alter, tragend: false, tageBisKalbung: null, anzahl, ...(extra || {}) });
      fmStall = { geholt: new Date().toISOString(), eintraege: {
        scheune: { id: "scheune", name: "Scheune", typ: "stall", stall: null, anzahl: 6, gruppen: [gr("bulle", "390–419", 4), gr("bulle", "600–629", 2)] },
        diele: { id: "diele", name: "Diele", typ: "stall", stall: null, anzahl: 6, gruppen: [gr("trocken", "1500–1529", 3, { tragend: true, tageBisKalbung: "10–19" }), gr("trocken", "1400–1429", 2, { tragend: true, tageBisKalbung: "40–49" }), gr("faerse", "690–719", 1, { tragend: true, tageBisKalbung: "190–199" })] }
      } };
      fmCfg.kopplung = "X.Y"; fmCfg.gruppen = [{ id: "gb", name: "Bullen", karte: "restbullen", art: "ohne", staelle: ["scheune", "diele"], auswerten: true }];
      fmCfg.milchpreisMlp = "x"; fmSpeichern();
    });

    await pruefe("Bedarf je Stall aus Standard-Fressmengen: Scheune 53 kg TM, Diele 69 kg TM (Klassen nach Art, Alter, Tage bis Kalbung)", async () => {
      const b = await page.evaluate(() => fmGruppeBedarf(fmCfg.gruppen[0]).staelle.map(x => [x.p.id, x.b.tm, x.b.teile.map(t => t.k + ":" + t.anzahl).join(",")]));
      assert.deepStrictEqual(b, [["scheune", 53, "bulle3:4,bulle4:2"], ["diele", 69, "trockenNah:3,trocken:2,faerse:1"]]);
    });

    await pruefe("Startwert: EINMAL „Wie viel kg lädst du hier heute ungefähr ab?“ → 300 kg → Lernfaktor so, dass die Rechnung passt", async () => {
      await page.evaluate(() => showTab("fressmenge"));
      assert((await page.textContent("#fm-frage")).includes("Bullen: Wie viel kg lädst du hier heute ungefähr ab?"));
      assert((await page.textContent('.fm-ohne[data-gruppe="gb"]')).includes("wartet auf deine Schätzung"));
      await page.fill("#fm-startwert", "300");
      await page.click("#fm-frage >> text=Speichern");
      assert.strictEqual(await page.locator("#fm-frage").count(), 0);
      nah(await page.evaluate(() => fmLern(fmCfg.gruppen[0]).faktor), 300 / 122, 1e-9, "Faktor");
      assert((await page.textContent('.fm-ohne[data-gruppe="gb"] .fm-menge')).includes("heute 300 kg"));
    });

    await pruefe("„Wie gerechnet?“ nur beim Antippen: Tierklassen je Stall, Bedarf × gelernter Faktor", async () => {
      await page.click('.fm-ohne[data-gruppe="gb"] >> text=Wie gerechnet?');
      const t = await page.textContent('.fm-ohne[data-gruppe="gb"]');
      assert(t.includes("4 × Mastbulle 12–18 Monate = 34,0 kg TM") && t.includes("3 × Trockensteher, unter 21 Tage bis Kalbung = 33,0 kg TM"), t);
      assert(t.includes("Bedarf zusammen 122,0 kg TM × Faktor 2,46 (gelernt) = 300 kg Mischung"), t);
    });

    await pruefe("Rechner: Restmischung zeigt „Aus den Ställen: 300 kg“ → übernehmen setzt das Zielgewicht; Abladen nach Bedarf (53 : 69)", async () => {
      await page.evaluate(() => { data.restbullen.collapsed = false; data.restbullen.ziel = 0; showTab("calc"); buildCalc(); });
      const z = await bullenKarte().locator(".fm-hm-zeile").textContent();
      assert(z.includes("Aus den Ställen (12 Tiere): 300 kg"), z);
      await bullenKarte().locator(".fm-hm-zeile button", { hasText: "übernehmen" }).click();
      assert.strictEqual(await page.evaluate(() => data.restbullen.ziel), 300);
      const ab = await bullenKarte().locator(".fm-abladen").innerText();
      // Scheune 300 × 53/122 = 130,3 kg → danach bleiben 169,7 kg (Diele)
      assert(ab.includes("▼ Scheune abladen bis 170 kg (130 kg)") && ab.includes("→ Rest: Diele 170 kg"), ab);
    });

    await pruefe("„Anders abgeladen?“ an der Zeile: 150 kg in der Scheune, „Ab jetzt so“ → Faktor neu, Rest heute auf die Diele verteilt", async () => {
      await bullenKarte().locator(".fm-abladen-zeile", { hasText: "Scheune" }).click();
      assert((await page.textContent("#fm-anders")).includes("Gerechnet: 130 kg"));
      await page.fill("#fm-anders-kg", "150");
      await page.click("#fm-anders >> text=Ab jetzt so");
      nah(await page.evaluate(() => fmLern(fmCfg.gruppen[0]).faktor), 300 / 122 * 150 / (300 * 53 / 122), 1e-9, "Faktor neu");
      const ab = await bullenKarte().locator(".fm-abladen").innerText();
      assert(ab.includes("Scheune abladen bis 150 kg (150 kg) ✎") && ab.includes("→ Rest: Diele 150 kg"), ab);
      // neue Menge: 122 kg TM × Faktor = 345 kg
      assert((await bullenKarte().locator(".fm-hm-zeile").textContent()).includes("345 kg"));
    });

    await pruefe("„Nur heute“ lernt nichts; drei Korrekturen in dieselbe Richtung → Lernfrage „meist 10 % mehr“; „Ja“ passt an, „Nein“ fragt 28 Tage nicht", async () => {
      const f0 = await page.evaluate(() => fmLern(fmCfg.gruppen[0]).faktor);
      await page.evaluate(() => { const t = fmTage[fmIso(new Date())]; delete t.abladen; fmTageMerken(); buildCalc(); });
      await bullenKarte().locator(".fm-abladen-zeile", { hasText: "Diele" }).click();
      await page.fill("#fm-anders-kg", "200");
      await page.click("#fm-anders >> text=Nur heute");
      assert.strictEqual(await page.evaluate(() => fmLern(fmCfg.gruppen[0]).faktor), f0);
      await page.evaluate(() => { const tag = n => { const d = new Date(); d.setDate(d.getDate() - n); return fmIso(d); };
        fmCfg.lern.gb.seit = tag(10);
        fmCfg.korrekturen = [{ gid: "gb", stall: "scheune", datum: tag(3), verh: 1.08 }, { gid: "gb", stall: "scheune", datum: tag(2), verh: 1.1 }, { gid: "gb", stall: "scheune", datum: tag(1), verh: 1.12 }];
        delete fmCfg.lernfragen; fmSpeichern(); showTab("fressmenge"); });
      assert((await page.textContent("#fm-frage")).includes("Du lädst in Scheune meist 10 % mehr."));
      await page.click("#fm-frage >> text=Ja");
      nah(await page.evaluate(() => fmLern(fmCfg.gruppen[0]).faktor), f0 * 1.1, 1e-9, "Faktor nach Ja");
      await page.evaluate(() => { const tag = n => { const d = new Date(); d.setDate(d.getDate() - n); return fmIso(d); };
        fmCfg.lern.gb.seit = tag(10); fmCfg.lernfragen = { gb: { datum: tag(20), antwort: "nein" } }; fmSpeichern(); });
      assert.strictEqual(await page.evaluate(() => !!fmLernFrage()), false, "nach „Nein“ vor 20 Tagen wieder gefragt");
    });

    await pruefe("Erweitert: Standard-Fressmenge ändern (Mastbulle 12–18 Monate 8,5 → 9,0) ändert den Bedarf; Fleckvieh-Code nutzt die Fleckvieh-Spalte", async () => {
      await page.evaluate(() => { fmStandardSetzen("bulle3", { value: "9,0" }); });
      assert.strictEqual(await page.evaluate(() => fmStallBedarf(fmPlatz("scheune")).tm), 55);
      await page.evaluate(() => { fmPlatz("diele").gruppen[2].rasseCode = "21"; fmCfg.fvCodes = "21"; fmSpeichern(); });
      assert.strictEqual(await page.evaluate(() => fmStallBedarf(fmPlatz("diele")).tm), 69.5);
      assert((await page.textContent("#fressmenge")).includes("Standard-Fressmengen"));
    });

    await pruefe("Testversion: echte Daten unverändert (nur Gerät); Hauptschalter AUS → keine Ergänzung im Rechner", async () => {
      await page.evaluate(() => { fmCfg.an = false; showTab("calc"); buildCalc(); });
      assert.strictEqual(await page.locator(".fm-hm-zeile, .fm-abladen").count(), 0);
      await page.evaluate(() => { fmCfg.an = true; fmSpeichern(); });
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(x => x.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nOHNE-RESTE-TEST ROT (${fehler} Fehler)` : "\nOHNE-RESTE-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
