// Test Paket Fressmengen, Schritt 3: Futtergruppen mit Stallzahlen aus dem Herdenmanager (nur lesen, Kopplungscode).
// Der Herdenmanager wird im Test nachgebildet (Antwort wie die Firestore-REST-Schnittstelle), nie das echte Projekt.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/fressmenge-gruppen.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5075;
const CODE = "BETRIEB123.schluessel456";

// Stallzahlen wie vom Herdenmanager (FUTTERRECHNER-SCHNITTSTELLE.md)
function platz(id, name, typ, anzahl, stall, laktierend, extra) {
  const gruppen = [];
  if (laktierend) gruppen.push({ art: "laktierend", geschlecht: "w", rasseCode: null, altersklasse: "1000–", tragend: false, tageBisKalbung: null, anzahl: laktierend });
  if (anzahl - (laktierend || 0) > 0) gruppen.push({ art: "trocken", geschlecht: "w", rasseCode: null, altersklasse: "1000–", tragend: true, tageBisKalbung: "10–19", anzahl: anzahl - (laktierend || 0) });
  return { id, name, stall: stall || null, typ, stand: "2026-11-13T14:00:00Z", anzahl, gruppen, ...(extra || {}) };
}
function stallzahlen(aenderung) {
  const e = {
    s1: platz("s1", "Stall 1", "stall", 37, null, 35),
    s2: platz("s2", "Stall 2", "stall", 47, null, 47),
    stroh: platz("stroh", "Strohstall", "stall", 7, null, 2),
    diele: platz("diele", "Diele", "stall", 10),
    scheune: platz("scheune", "Scheune", "stall", 16),
    "b-links": platz("b-links", "Links", "bucht", 9, "scheune"),
    "b-rechts": platz("b-rechts", "Rechts", "bucht", 7, "scheune"),
    iglus: platz("iglus", "Iglus", "stall", 3),
    "iglu:1": platz("iglu:1", "Iglu 1", "bucht", 1, "iglus"),
    alt: platz("alt", "Alter Stall", "stall", 0, null, 0, { entfernt: true })
  };
  if (aenderung) aenderung(e);
  return { bid: "BETRIEB123", stand: "2026-11-13T14:41:00Z", eintraege: e };
}
// in Firestore-REST-Form umwandeln
function rest(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(rest) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, w]) => [k, rest(w)])) } };
}

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 5).join("\n   ")); }
  };
  // nachgebildeter Herdenmanager
  let hm = { status: 200, daten: stallzahlen() };
  const anfragen = [];
  const neueSeite = async () => {
    const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
    await context.route(/firestore\.googleapis\.com\/v1\/projects\/herdenmanager/, route => {
      anfragen.push(route.request().url());
      if (hm.status !== 200) return route.fulfill({ status: hm.status, contentType: "application/json", body: JSON.stringify({ error: { code: hm.status } }) });
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "x", fields: rest(hm.daten).mapValue.fields }) });
    });
    const page = await context.newPage();
    page.meldungen = [];
    page.on("dialog", d => { page.meldungen.push(d.message()); d.accept(d.type() === "prompt" ? page.antwort || "" : undefined); });
    page.on("pageerror", e => page.meldungen.push("SEITENFEHLER: " + e.message + " @ " + String(e.stack).split(String.fromCharCode(10)).slice(1, 4).join(" < ")));
    await zugang.vorbereiten(context, page, "emulator");
    return page;
  };
  const tab = p => p.evaluate(() => { const t = document.getElementById("fm-tab"); return { sichtbar: t.style.display !== "none", orange: t.classList.contains("tab-orange") }; });
  const block = (p, k) => p.locator(`.fm-gruppe[data-karte="${k}"]`);
  const kopf = (p, k) => block(p, k).locator(".fm-gruppe-kopf").innerText();
  const oeffnen = async (p, k) => { if (await block(p, k).evaluate(e => e.classList.contains("fm-gruppe-zu"))) await block(p, k).locator(".fm-gruppe-kopf").click(); };

  try {
    await pruefe("Normale App (Schalter AUS): kein Lesen aus dem Herdenmanager, kein Reiter", async () => {
      const A = await neueSeite();
      await A.goto(`http://localhost:${PORT}/?emulator=1`);
      await zugang.warteAufApp(A, "emulator");
      await A.evaluate(() => { fmCfg.kopplung = "X.Y"; fmStallzahlenHolen(true); });
      await A.waitForTimeout(500);
      assert.strictEqual(anfragen.length, 0);
      assert.strictEqual((await tab(A)).sichtbar, false);
      await A.context().close();
    });

    const T = await neueSeite();
    await pruefe("Testversion: Reiter „Fressmenge“ zeigt „Herdenmanager – noch nicht verbunden“, ohne Code keine Anfrage", async () => {
      await T.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
      await zugang.warteAufApp(T, "emulator");
      await T.click("#fm-tab");
      assert((await T.textContent("#fm-hm-stand")).includes("Noch nicht verbunden"));
      assert.strictEqual(anfragen.length, 0);
    });

    await pruefe("Falscher Kopplungscode wird erklärt; richtiger Code holt die Stallzahlen (nur lesen, Projekt herdenmanager-test, Bereich test/)", async () => {
      await T.fill("#fm-kopplung", "nur-ein-teil");
      await T.click("#fressmenge >> text=Verbinden");
      assert(T.meldungen.some(m => m.includes("zwei Teile mit einem Punkt")));
      await T.fill("#fm-kopplung", CODE);
      await T.click("#fressmenge >> text=Verbinden");
      await T.waitForFunction(() => (document.getElementById("fm-hm-stand")||{textContent:""}).textContent.includes("Ställe"), null, { timeout: 8000 }).catch(async e => { throw new Error("Reiter zeigt: " + (await T.evaluate(() => document.getElementById("fressmenge").innerText.slice(0, 600)))); });
      const basis = "/projects/herdenmanager-test/databases/(default)/documents/test/BETRIEB123/schluessel456/";
      assert(anfragen.some(u => u.includes(basis + "stallzahlen?key=")), anfragen.join(" | "));
      assert(anfragen.some(u => u.includes(basis + "mlpStall?key=")), "MLP nicht gelesen: " + anfragen.join(" | "));
      assert((await T.textContent("#fm-hm-stand")).includes("6 Ställe"), await T.textContent("#fm-hm-stand"));
      assert.strictEqual(await T.evaluate(() => JSON.parse(localStorage.getItem("fressmenge")).kopplung), CODE);
    });

    await pruefe("Nicht zugeordnet: alle Ställe mit Tierzahl, Buchten eingerückt, Iglus extra, gelöschte Ställe fehlen; Reiter orange", async () => {
      const t = await T.textContent("#fm-nicht-zugeordnet");
      for (const s of ["Stall 1 · 37 Tiere", "Stall 2 · 47 Tiere", "Strohstall · 7 Tiere", "Diele · 10 Tiere", "Scheune · 16 Tiere", "Links · 9 Tiere", "Rechts · 7 Tiere", "Iglus · 3 Tiere – eigene Mischung von Hand"]) assert(t.includes(s), s + " fehlt: " + t);
      assert(!t.includes("Alter Stall"));
      assert.strictEqual((await tab(T)).orange, true);
    });

    await pruefe("Futtergruppen = je Mischung eine Zeile; Kühe: Stall 1 + Strohstall → 44 Tiere, mit Restauswertung (automatisch)", async () => {
      await oeffnen(T, "kuehe");
      await block(T, "kuehe").locator("select.fm-dazu").selectOption("s1");
      await block(T, "kuehe").locator("select.fm-dazu").selectOption("stroh");
      const t = await kopf(T, "kuehe");
      assert(t.includes("Kühe") && t.includes("Stall 1, Strohstall · 44 Tiere"), t);
      assert((await block(T, "kuehe").textContent()).includes("mit Restauswertung"));
      assert.deepStrictEqual(await T.evaluate(() => fmCfg.gruppen.map(g => [g.karte, g.art, g.name])), [["kuehe", "rest", "Kühe"]]);
      assert(!(await T.textContent("#fm-nicht-zugeordnet")).includes("Stall 1 ·"));
      assert.strictEqual(await T.locator("text=+ Neue Futtergruppe").count(), 0, "kein Anlegen von Hand mehr nötig");
    });

    await pruefe("Jeder Stall höchstens einmal; ganzer Stall ersetzt seine Buchten; Färsen = ohne Reste (automatisch)", async () => {
      await oeffnen(T, "faersen");
      const optionen = await block(T, "faersen").locator("select.fm-dazu option").allTextContents();
      assert(!optionen.some(o => o.startsWith("Stall 1") || o.startsWith("Strohstall")), optionen.join("|"));
      await block(T, "faersen").locator("select.fm-dazu").selectOption("b-links");
      await block(T, "faersen").locator("select.fm-dazu").selectOption("scheune");
      assert.deepStrictEqual(await T.evaluate(() => fmCfg.gruppen.find(g => g.karte === "faersen").staelle), ["scheune"]);
      assert.strictEqual(await T.evaluate(() => fmCfg.gruppen.find(g => g.karte === "faersen").art), "ohne");
      assert((await block(T, "faersen").textContent()).includes("ohne Reste"));
      assert((await kopf(T, "faersen")).includes("Scheune · 16 Tiere"));
    });

    await pruefe("✕ entfernt einen Stall wieder (zurück zu „Nicht zugeordnet“); zuklappen zeigt nur Mischung, Ställe, Tiere", async () => {
      await block(T, "kuehe").locator(".fm-stall", { hasText: "Strohstall" }).locator("button[title=entfernen]").click();
      assert((await T.textContent("#fm-nicht-zugeordnet")).includes("Strohstall · 7 Tiere"));
      assert((await kopf(T, "kuehe")).includes("Stall 1 · 37 Tiere"));
      await block(T, "kuehe").locator(".fm-gruppe-kopf").click();
      assert.strictEqual(await block(T, "kuehe").locator("select").count(), 0);
      const zu = (await block(T, "kuehe").innerText()).replace(/\s+/g, " ");
      assert(zu.includes("Kühe · Stall 1 · 37 Tiere") && zu.includes("▶"), zu);
    });

    await pruefe("Rest „nicht füttern“ / zugeordnet → Reiter nicht mehr orange", async () => {
      for (const id of ["s2", "stroh", "diele"]) await T.locator(`.fm-frei[data-platz="${id}"] input`).check();
      // Färsen (ohne Reste) haben ihre Startwert-Frage schon beantwortet – sonst färbt die offene Frage den Reiter
      await T.evaluate(() => { (fmCfg.lern = fmCfg.lern || {})[fmCfg.gruppen.find(g => g.karte === "faersen").id] = { faktor: 2.5, seit: fmIso(new Date()) }; fmSpeichern(); });
      assert.strictEqual((await tab(T)).orange, false, await T.textContent("#fm-nicht-zugeordnet"));
    });

    await pruefe("Neuer Stall im Herdenmanager → erscheint unter „Nicht zugeordnet“, Reiter wieder orange; Kuh umgestallt → Summe ändert sich", async () => {
      hm.daten = stallzahlen(e => { e.neu = platz("neu", "Neuer Stall", "stall", 4); e.s1.anzahl = 38; e.s1.gruppen[0].anzahl = 36; });
      await T.evaluate(() => fmStallzahlenHolen(true));
      await T.waitForFunction(() => document.getElementById("fm-nicht-zugeordnet").textContent.includes("Neuer Stall"));
      assert.strictEqual((await tab(T)).orange, true);
      assert((await kopf(T, "kuehe")).includes("Stall 1 · 38 Tiere"));
    });

    await pruefe("Rechner: Tierzahl aus dem Herdenmanager (+ Rest-Zuschlag), grüne Abladen-Zeilen; antippen → Reihenfolge ändern", async () => {
      await oeffnen(T, "kuehe");
      await block(T, "kuehe").locator("select.fm-dazu").selectOption("s2");
      await T.evaluate(() => { data.kuehe.anz = 80; data.kuehe.items.forEach((it, i) => it.kg = i === 0 ? 40 : 0); data.kuehe.collapsed = false; showTab("calc"); buildCalc(); });
      const karte = T.locator("#calc .category", { has: T.locator(".cat-header.cat-kuehe") });
      const zeile = await karte.locator(".fm-hm-zeile").textContent();
      // alle Tiere der Ställe zählen (auch Trockensteher): 38 + 47; + 4 % Rest-Zuschlag: 85 × 1,04 = 88,4
      assert(zeile.includes("Herdenmanager: 85 Tiere + 4 % Rest") && !zeile.includes("laktierend"), zeile);
      await karte.locator(".fm-hm-zeile button", { hasText: "übernehmen" }).click();
      assert.strictEqual(await T.evaluate(() => data.kuehe.anz), 88.4);
      const ab = await karte.locator(".fm-abladen").innerText();
      // 88,4 × 40 kg = 3536 kg; Stall 1: 38/85 → 1581 kg, danach bleiben 1955 kg (= Stall 2)
      assert(ab.includes("▼ Stall 1 abladen bis 1955 kg (1581 kg)") && ab.includes("→ Rest: Stall 2 1955 kg"), ab);
      await karte.locator(".fm-abladen-zeile").first().click();
      assert((await T.textContent("#fm-anders")).includes("Reihenfolge beim Abladen"));
      assert(await T.locator('#fm-anders .fm-abladen-stall[data-platz="s1"] .fm-hoch').isDisabled());
      await T.click('#fm-anders .fm-abladen-stall[data-platz="s2"] .fm-hoch');
      assert((await T.locator("#fm-anders .fm-abladen-stall").first().textContent()).includes("1. Stall 2"));
      const ab2 = await karte.locator(".fm-abladen").innerText();
      assert(ab2.includes("▼ Stall 2 abladen bis 1581 kg (1955 kg)") && ab2.includes("→ Rest: Stall 1 1581 kg"), ab2);
      await T.click("#fm-anders >> text=Schließen");
      assert.strictEqual(await T.locator("#fm-anders").count(), 0);
      assert.strictEqual(await T.locator("#calc .category", { has: T.locator(".cat-header.cat-faersen") }).locator(".fm-hm-zeile").count() <= 1, true);
    });

    await pruefe("Rechner: Rechnung der Karte unverändert (Gesamt wie ohne Ergänzung), bei AUS keine Ergänzung", async () => {
      const mit = await T.evaluate(() => document.getElementById("total-kuehe").dataset.val);
      await T.evaluate(() => { fmCfg.an = false; buildCalc(); });
      assert.strictEqual(await T.evaluate(() => document.getElementById("total-kuehe").dataset.val), mit);
      assert.strictEqual(await T.locator(".fm-hm-zeile, .fm-abladen").count(), 0);
      await T.evaluate(() => { fmCfg.an = true; buildCalc(); showTab("fressmenge"); });
    });

    await pruefe("Herdenmanager nicht erreichbar / Code passt nicht → Meldung, die zuletzt geholten Zahlen bleiben", async () => {
      hm.status = 404;
      await T.evaluate(() => fmStallzahlenHolen(true));
      await T.waitForFunction(() => document.getElementById("fm-hm-stand").textContent.includes("passt nicht"));
      assert((await kopf(T, "kuehe")).includes("85 Tiere"));
      hm.status = 200;
    });

    await pruefe("Nach dem Neuladen ist alles noch da (im Gerät gemerkt)", async () => {
      await T.reload(); await zugang.warteAufApp(T, "emulator", true);
      await T.click("#fm-tab");
      await T.waitForFunction(() => document.querySelector('.fm-gruppe[data-karte="kuehe"]'));
      assert((await kopf(T, "kuehe")).includes("85 Tiere"));
    });

    await pruefe("Hauptschalter AUS: Reiter weg, kein Lesen mehr; Gruppen bleiben gespeichert", async () => {
      await T.evaluate(() => fmHauptschalter(false));
      const vorher = anfragen.length;
      await T.evaluate(() => fmStallzahlenHolen(true));
      await T.waitForTimeout(500);
      assert.strictEqual(anfragen.length, vorher);
      assert.strictEqual((await tab(T)).sichtbar, false);
      assert.strictEqual(await T.evaluate(() => fmCfg.gruppen.length), 2);
    });

    await pruefe("Futtergruppen ändern nichts an den Daten des Betriebs (Rationen, Einstellungen)", async () => {
      const roh = await T.evaluate(() => JSON.stringify({ data, globalCfg }));
      assert(!roh.includes("BETRIEB123") && !roh.includes("Strohstall"));
    });

    await pruefe("Fall Fritz 18.11.: Scheune Kälber (Links 0, Rechts 7 → Restmischung) und leerer Stall Kälber sind nicht mehr „offen“; Stall zeigt „alle in Buchten zugeordnet“", async () => {
      const r = await T.evaluate(() => {
        fmCfg.an = true;
        fmStall.eintraege.sk = { id: "sk", name: "Scheune kälber", typ: "stall", stall: null, anzahl: 7, gruppen: [] };
        fmStall.eintraege["sk:l"] = { id: "sk:l", name: "Links", typ: "bucht", stall: "sk", anzahl: 0, gruppen: [] };
        fmStall.eintraege["sk:r"] = { id: "sk:r", name: "Rechts", typ: "bucht", stall: "sk", anzahl: 7, gruppen: [] };
        fmStall.eintraege.kl = { id: "kl", name: "Kälber", typ: "stall", stall: null, anzahl: 0, gruppen: [] };
        fmStall.eintraege.vs = { id: "vs", name: "Voll", typ: "stall", stall: null, anzahl: 5, gruppen: [] };
        fmStall.eintraege["vs:a"] = { id: "vs:a", name: "A", typ: "bucht", stall: "vs", anzahl: 3, gruppen: [] };
        const g = fmGruppeZuKarte("restbullen") || (fmCfg.gruppen.push({ id: "g_rb", karte: "restbullen", staelle: [] }), fmCfg.gruppen[fmCfg.gruppen.length - 1]);
        g.staelle = [...(g.staelle || []), "sk:r", "vs:a"];
        fmEinrichtungZu = false; showTab("fressmenge"); fmBauen();
        const offen = fmOffenePlaetze().map(p => p.id);
        const txt = id => document.querySelector('.fm-frei[data-platz="' + id + '"]').textContent.replace(/s+/g, " ");
        return { offen, sk: txt("sk"), vs: txt("vs"), skOrange: document.querySelector('.fm-frei[data-platz="sk"]').style.color, klOrange: document.querySelector('.fm-frei[data-platz="kl"]').style.color };
      });
      assert(!r.offen.includes("sk") && !r.offen.includes("kl"), JSON.stringify(r.offen));
      assert(r.offen.includes("vs"), "Stall mit 2 Tieren außerhalb der Bucht bleibt offen");
      assert(r.sk.includes("Scheune kälber · 7 Tiere (alle in Buchten zugeordnet)"), r.sk);
      assert(r.vs.includes("(davon 2 noch offen)"), r.vs);
      assert.strictEqual(r.skOrange, ""); assert.strictEqual(r.klOrange, "");
    });

    await pruefe("Keine Seitenfehler", async () => {
      const sf = T.meldungen.filter(m => m.startsWith("SEITENFEHLER")); if (sf.length) throw new Error(sf.slice(0, 3).join(" || "));
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nGRUPPEN-TEST ROT (${fehler} Fehler)` : "\nGRUPPEN-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
