// Einmalige Einrichtung des Betreibers (Fritz) – ersetzt die Freigabe für die allererste Anfrage,
// weil es vorher noch niemanden gibt, der freigeben könnte.
//
//   node werkzeuge/betreiber-einrichten.js --projekt futterrechner-test-stall            → zeigt offene Anfragen
//   node werkzeuge/betreiber-einrichten.js --projekt futterrechner-test-stall --anfrage <ID>
//        → gibt die Anfrage frei (neuer Betrieb + Gerät) und trägt diesen Betrieb als Betreiber ein
//
// Das echte Projekt "futterrechner" geht NUR mit zusätzlich --echt-freigegeben (nur nach ausdrücklicher Freigabe von Fritz).
// Nutzt die Anmeldung der Firebase-Kommandozeile (firebase login).
const path = require("path");
const crypto = require("crypto");
const ft = path.join(process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib");
const { getAccessToken, getGlobalDefaultAccount } = require(path.join(ft, "auth"));

const arg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const P = arg("--projekt");
const anfrageId = arg("--anfrage");
if (!P) { console.log("Bitte --projekt angeben"); process.exit(1); }
if (P === "futterrechner" && !process.argv.includes("--echt-freigegeben")) {
  console.log("ABBRUCH: Das echte Projekt braucht die ausdrückliche Freigabe von Fritz (--echt-freigegeben).");
  process.exit(1);
}
const BASE = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;

(async () => {
  const tok = await getAccessToken(getGlobalDefaultAccount().tokens.refresh_token, []);
  const h = { Authorization: "Bearer " + tok.access_token, "Content-Type": "application/json" };
  const wert = f => f && (f.stringValue ?? f.timestampValue ?? f.integerValue ?? "");

  if (!anfrageId) {
    const r = await (await fetch(`${BASE}/anfragen?pageSize=300`, { headers: h })).json();
    const offen = (r.documents || []).filter(d => wert(d.fields.status) === "offen" && d.fields.uid);
    console.log(offen.length ? "Offene Anfragen (neues System):" : "Keine offenen Anfragen (neues System).");
    offen.forEach(d => console.log(" ", d.name.split("/").pop(), "|", wert(d.fields.vorname), wert(d.fields.nachname), "|",
      wert(d.fields.betriebsname), "|", wert(d.fields.zeitpunkt)));
    return;
  }

  const a = (await (await fetch(`${BASE}/anfragen/${anfrageId}`, { headers: h })).json()).fields;
  if (!a || wert(a.status) !== "offen") throw new Error("Anfrage nicht gefunden oder nicht offen");
  const uid = wert(a.uid);
  const betriebId = crypto.randomBytes(10).toString("base64url");
  const pfad = p => `projects/${P}/databases/(default)/documents/${p}`;
  const writes = [
    { update: { name: pfad(`betriebe/${betriebId}`), fields: { name: a.betriebsname, anfrageId: { stringValue: anfrageId } } },
      updateTransforms: [{ fieldPath: "angelegt", setToServerValue: "REQUEST_TIME" }], currentDocument: { exists: false } },
    { update: { name: pfad(`betriebe/${betriebId}/geraete/${uid}`), fields: { name: { stringValue: "Gerät von " + wert(a.vorname) }, anfrageId: { stringValue: anfrageId } } },
      updateTransforms: [{ fieldPath: "seit", setToServerValue: "REQUEST_TIME" }], currentDocument: { exists: false } },
    { update: { name: pfad(`geraetezuordnung/${uid}`), fields: { betriebId: { stringValue: betriebId } } }, currentDocument: { exists: false } },
    { update: { name: pfad(`anfragen/${anfrageId}`), fields: { status: { stringValue: "erlaubt" }, betriebId: { stringValue: betriebId } } },
      updateMask: { fieldPaths: ["status", "betriebId"] }, updateTransforms: [{ fieldPath: "entschieden", setToServerValue: "REQUEST_TIME" }] },
    { update: { name: pfad("system/betreiber"), fields: { betriebId: { stringValue: betriebId } } } }
  ];
  const r = await fetch(`${BASE.replace("/documents", "")}/documents:commit`, { method: "POST", headers: h, body: JSON.stringify({ writes }) });
  const t = await r.text();
  if (!r.ok) throw new Error(t);
  console.log(`Fertig: Betrieb "${wert(a.betriebsname)}" (${betriebId}) angelegt, Gerät ${uid} eingetragen, als Betreiber gesetzt.`);
})().catch(e => { console.error("FEHLER:", e.message); process.exit(1); });
