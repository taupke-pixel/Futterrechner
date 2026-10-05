// Verwaltungs-PIN eines Betriebs zurücksetzen (wenn der Betriebsleiter sie vergessen hat).
// Danach legt der Betrieb in der App eine neue fest (Einstellungen → Betrieb → „Verwaltungs-PIN festlegen“).
//
//   node werkzeuge/verwaltungs-pin-zuruecksetzen.js --projekt futterrechner-test-stall                → Betriebe auflisten
//   node werkzeuge/verwaltungs-pin-zuruecksetzen.js --projekt futterrechner-test-stall --betrieb <ID> → zurücksetzen
//
// Echtes Projekt "futterrechner" nur mit --echt-freigegeben (nur nach ausdrücklicher Freigabe von Fritz).
const path = require("path");
const ft = path.join(process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib");
const { getAccessToken, getGlobalDefaultAccount } = require(path.join(ft, "auth"));

const arg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const P = arg("--projekt");
const betrieb = arg("--betrieb");
if (!P) { console.log("Bitte --projekt angeben"); process.exit(1); }
if (P === "futterrechner" && !process.argv.includes("--echt-freigegeben")) {
  console.log("ABBRUCH: Das echte Projekt braucht die ausdrückliche Freigabe von Fritz (--echt-freigegeben).");
  process.exit(1);
}
const BASE = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;

(async () => {
  const tok = await getAccessToken(getGlobalDefaultAccount().tokens.refresh_token, []);
  const h = { Authorization: "Bearer " + tok.access_token, "Content-Type": "application/json" };
  if (!betrieb) {
    const r = await (await fetch(`${BASE}/betriebe?pageSize=300`, { headers: h })).json();
    (r.documents || []).forEach(d => console.log(" ", d.name.split("/").pop(), "|", d.fields.name && d.fields.name.stringValue,
      "| PIN gesetzt:", !!(d.fields.verwaltungsPinGesetzt && d.fields.verwaltungsPinGesetzt.booleanValue)));
    return;
  }
  const pfad = p => `projects/${P}/databases/(default)/documents/${p}`;
  const writes = [
    { delete: pfad(`betriebe/${betrieb}/geheim/verwaltung`) },
    { update: { name: pfad(`betriebe/${betrieb}`), fields: { verwaltungsPinGesetzt: { booleanValue: false } } },
      updateMask: { fieldPaths: ["verwaltungsPinGesetzt"] }, currentDocument: { exists: true } }
  ];
  const r = await fetch(`${BASE.replace("/documents", "")}/documents:commit`, { method: "POST", headers: h, body: JSON.stringify({ writes }) });
  if (!r.ok) throw new Error(await r.text());
  console.log(`Fertig: Verwaltungs-PIN von Betrieb ${betrieb} zurückgesetzt.`);
})().catch(e => { console.error("FEHLER:", e.message); process.exit(1); });
