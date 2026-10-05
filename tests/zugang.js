// Sorgt im Vergleichstest dafür, dass die App „freigeschaltet“ ist – je nach Fassung der index.html.
//  - "attrappe": alte Fassung ohne Cloud-Speicher → Firebase wird durch eine Attrappe ersetzt (keine echte Datenbank).
//  - "emulator": neue Fassung mit Betrieben → läuft gegen den Firebase-Emulator auf diesem PC (nie gegen ein echtes Projekt).
//                Der Test legt einen Betrieb an und trägt das Test-Gerät dort ein (mit Admin-Rechten des Emulators).
const fs = require("fs");
const path = require("path");

const PROJEKT = "demo-futterrechner";
const FS_URL = `http://127.0.0.1:8080/v1/projects/${PROJEKT}/databases/(default)/documents`;

function erkenneModus(html) {
  return html.includes("firebase-auth.js") ? "emulator" : "attrappe";
}

function urlZusatz(modus) {
  return modus === "emulator" ? "?emulator=1" : "";
}

async function vorbereiten(context, page, modus) {
  // E-Mails werden im Test nie verschickt
  await context.route(/emailjs-com/, route =>
    route.fulfill({ contentType: "text/javascript", body: "window.__mails=[];window.emailjs={init(){},send(s,t,p){window.__mails.push(p);return Promise.resolve({})}};" }));
  if (modus === "attrappe") {
    const attrappe = fs.readFileSync(path.join(__dirname, "firebase-attrappe.js"), "utf8");
    await context.route(/gstatic\.com\/firebasejs\/.*\.js/, route =>
      route.fulfill({ contentType: "text/javascript", body: route.request().url().includes("firebase-app.js") ? attrappe : "" }));
  }
}

// ---- Emulator-Hilfen (Admin-Zugriff nur im Emulator: "Bearer owner") ----
function feldwert(v) {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (v === null) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(feldwert) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, w]) => [k, feldwert(w)])) } };
}

async function adminSchreiben(dokPfad, daten) {
  const r = await fetch(`${FS_URL}/${dokPfad}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ fields: feldwert(daten).mapValue.fields })
  });
  if (!r.ok) throw new Error(`Emulator-Schreiben ${dokPfad}: ${r.status} ${await r.text()}`);
}

async function warteAufUid(page) {
  await page.waitForFunction(() => typeof geraeteUid !== "undefined" && geraeteUid, null, { timeout: 30000 });
  return page.evaluate(() => geraeteUid);
}

// Gerät in einen Betrieb eintragen (wie es später die Freigabe bzw. PIN/QR macht)
async function geraetEintragen(betriebId, uid, name) {
  await adminSchreiben(`betriebe/${betriebId}/geraete/${uid}`, { name });
  await adminSchreiben(`geraetezuordnung/${uid}`, { betriebId });
}

let zaehler = 0;
const zustand = new WeakMap();

async function warteAufApp(page, modus, schonEingetragen) {
  if (modus === "emulator" && !zustand.has(page) && !schonEingetragen) {
    // Erster Aufruf: Gerät ist noch in keinem Betrieb → Betrieb anlegen, Gerät eintragen, neu laden
    const uid = await warteAufUid(page);
    await page.waitForFunction(() => document.getElementById("accessBlock").style.display === "flex", null, { timeout: 30000 });
    const betriebId = `test-${Date.now()}-${zaehler++}`;
    await adminSchreiben(`betriebe/${betriebId}`, { name: "Testbetrieb " + betriebId });
    await geraetEintragen(betriebId, uid, "Testgerät 1");
    zustand.set(page, { betriebId, uid });
    await page.reload();
  }
  await page.waitForFunction(() => document.querySelector("#calc .category") !== null && document.getElementById("backupFile"), null, { timeout: 30000 });
}

async function vorNeuladen(page, modus) {
  if (modus !== "emulator") return;
  // Alles in die Cloud schreiben, dann den lokalen Zwischenspeicher der Futterdaten löschen:
  // nach dem Neuladen müssen die Daten aus Firestore kommen.
  await page.evaluate(async () => {
    await cloudSyncFertig();
    ["futter", "gCfg", "history", "lager", "lieferungen"].forEach(k => localStorage.removeItem(k));
  });
}

// Zweites Gerät im selben Betrieb: muss genau dieselben Daten sehen
async function zweitesGeraet(browser, ersteSeite, url, sz, modus, schnappschuss) {
  if (modus !== "emulator") return null;
  const { betriebId } = zustand.get(ersteSeite);
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  const page = await context.newPage();
  page.on("dialog", d => d.accept());
  await page.clock.setFixedTime(new Date(sz.heute));
  await vorbereiten(context, page, modus);
  await page.goto(url);
  const uid = await warteAufUid(page);
  await page.waitForFunction(() => document.getElementById("accessBlock").style.display === "flex", null, { timeout: 30000 });
  await geraetEintragen(betriebId, uid, "Testgerät 2");
  zustand.set(page, { betriebId, uid });
  await page.reload();
  await warteAufApp(page, modus);
  await page.waitForTimeout(300);
  const s = await schnappschuss(page);
  await context.close();
  return s;
}

async function aufraeumen(modus) {}

// Verwaltungs-PIN eines Betriebs direkt setzen (wie „PIN festlegen“ in der App)
async function verwaltungsPinSetzen(betriebId, pin) {
  const crypto = require("crypto");
  const sha = s => crypto.createHash("sha256").update(s).digest("hex");
  await adminSchreiben(`betriebe/${betriebId}/geheim/verwaltung`, { pruefwert: sha(sha("futterrechner:" + betriebId + ":" + pin)) });
  await fetch(`${FS_URL}/betriebe/${betriebId}?updateMask.fieldPaths=verwaltungsPinGesetzt`, {
    method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { verwaltungsPinGesetzt: { booleanValue: true } } })
  });
}

module.exports = {
  verwaltungsPinSetzen,
  erkenneModus, urlZusatz, vorbereiten, warteAufApp, vorNeuladen, zweitesGeraet, aufraeumen,
  geraetEintragenOeffentlich: geraetEintragen, adminSchreiben
};
