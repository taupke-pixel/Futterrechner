// Sorgt im Vergleichstest dafür, dass die App „freigeschaltet“ ist – je nach Fassung der index.html.
//  - "attrappe": alte Fassung ohne Cloud-Speicher → Firebase wird durch eine Attrappe ersetzt (keine echte Datenbank).
const fs = require("fs");
const path = require("path");

function erkenneModus(html) {
  return "attrappe";
}

function urlZusatz(modus) {
  return "";
}

async function vorbereiten(context, page, modus) {
  const attrappe = fs.readFileSync(path.join(__dirname, "firebase-attrappe.js"), "utf8");
  await context.route(/gstatic\.com\/firebasejs\/.*\.js/, route =>
    route.fulfill({ contentType: "text/javascript", body: route.request().url().includes("firebase-app.js") ? attrappe : "" }));
  await context.route(/emailjs-com/, route =>
    route.fulfill({ contentType: "text/javascript", body: "window.emailjs={init(){},send(){return Promise.resolve({})}};" }));
}

async function warteAufApp(page, modus) {
  await page.waitForFunction(() => document.querySelector("#calc .category") !== null && document.getElementById("backupFile"));
}

async function vorNeuladen(page, modus) {}

async function aufraeumen(modus) {}

module.exports = { erkenneModus, urlZusatz, vorbereiten, warteAufApp, vorNeuladen, aufraeumen };
