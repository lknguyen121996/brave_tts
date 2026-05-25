const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8765;
const PAGE = path.join(__dirname, "page.html");

http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(PAGE));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Test page: http://127.0.0.1:${PORT}/`);
});
