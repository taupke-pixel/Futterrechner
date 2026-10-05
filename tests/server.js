// Kleiner Webserver nur für Tests: liefert einen Ordner unter http://localhost:<port>/ aus.
const http = require("http");
const fs = require("fs");
const path = require("path");

const TYPEN = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".apk": "application/vnd.android.package-archive"
};

function starteServer(wurzel, port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const datei = path.join(wurzel, p);
    if (!datei.startsWith(path.resolve(wurzel))) { res.writeHead(403); return res.end(); }
    fs.readFile(datei, (err, inhalt) => {
      if (err) { res.writeHead(404); return res.end("nicht gefunden"); }
      res.writeHead(200, { "Content-Type": TYPEN[path.extname(datei)] || "application/octet-stream" });
      res.end(inhalt);
    });
  });
  return new Promise(ok => server.listen(port, "127.0.0.1", () => ok(server)));
}

module.exports = { starteServer };

if (require.main === module) {
  const wurzel = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const port = Number(process.argv[3] || 5050);
  starteServer(wurzel, port).then(() => console.log(`Server: http://localhost:${port}/  (Ordner ${wurzel})`));
}
