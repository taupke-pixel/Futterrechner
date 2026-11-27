// Selbstcheck ohne Browser: findet Fehlerarten, die man beim Bedienen erst spät merkt (27.11.2026)
// - zwei Funktionen mit gleichem Namen (die zweite ersetzt still die erste)
// - Knöpfe/Felder, die eine Funktion aufrufen, die es nicht gibt
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const fehler = [];
const namen = [...html.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map(m => m[1]);
const zaehl = {}; namen.forEach(n => zaehl[n] = (zaehl[n] || 0) + 1);
Object.entries(zaehl).filter(([, n]) => n > 1).forEach(([f, n]) => fehler.push(`Funktion „${f}“ gibt es ${n}×`));
const bekannt = new Set([...namen, ...[...html.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g)].map(m => m[1]),
  ...[...html.matchAll(/^\s*([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?function/gm)].map(m => m[1])]);
const eingebaut = new Set(["if", "alert", "confirm", "prompt", "event", "this", "return", "setTimeout", "document", "window", "location", "navigator", "localStorage", "Math", "JSON", "String", "Number", "parseFloat", "parseInt", "isNaN", "num", "for", "while", "switch", "typeof", "new", "Object", "Array", "Date"]);
for (const m of html.matchAll(/\son(?:click|change|input|blur|focus|keyup|keydown|submit)="([^"]*)"/g)) {
  for (const a of m[1].replace(/'[^']*'/g, "''").matchAll(/(?:^|[;\s(!&|?:])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
    const n = a[1];
    if (!eingebaut.has(n) && !bekannt.has(n)) fehler.push(`Aufruf „${n}(…)“ ohne passende Funktion`);
  }
}
const einmal = [...new Set(fehler)];
if (einmal.length) { einmal.forEach(f => console.log("✘ " + f)); console.log(`SELBSTCHECK ROT (${einmal.length})`); process.exit(1); }
console.log(`✔ ${namen.length} Funktionen, keine doppelt; alle Aufrufe in Knöpfen/Feldern vorhanden`);
console.log("SELBSTCHECK GRÜN");
