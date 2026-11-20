"use strict";

// Запуск: node server.js. Только localhost; без сторонних зависимостей.
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs/promises");
const path = require("node:path");
const files = { "/": ["index.html", "text/html"], "/index.html": ["index.html", "text/html"], "/styles.css": ["styles.css", "text/css"], "/script.js": ["script.js", "text/javascript"], "/currency.js": ["currency.js", "text/javascript"], "/excel.js": ["excel.js", "text/javascript"] };

function officialXML(date) {
  const formatted = date.split("-").reverse().join(".");
  return new Promise((resolve, reject) => {
    const request = https.get(`https://nationalbank.kz/rss/get_rates.cfm?fdate=${formatted}`, { headers: { Accept: "application/xml, text/xml", "User-Agent": "Smeta-local/1.0" }, family: 4, minVersion: "TLSv1.2", maxVersion: "TLSv1.2", timeout: 12000 }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`НБРК: HTTP ${response.statusCode}`)); return; }
      let size = 0;
      const chunks = [];
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1000000) { response.destroy(new Error("Слишком большой ответ НБРК")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("НБРК не ответил вовремя")));
    request.on("error", reject);
  });
}

function createServer() {
  return http.createServer(async (request, response) => {
    const send = (code, type, body) => { response.writeHead(code, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }); response.end(body); };
    try {
      if (!/^((127\.0\.0\.1|localhost)(:\d+)?)$/.test(request.headers.host || "")) return send(403, "text/plain", "Разрешён только локальный адрес");
      const origin = request.headers.origin;
      if (origin && ![`http://127.0.0.1:${request.socket.localPort}`, `http://localhost:${request.socket.localPort}`].includes(origin)) return send(403, "text/plain", "Запрос с другого сайта запрещён");
      if (request.method !== "GET") return send(405, "text/plain", "Разрешён только GET");
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/api/rates") {
        const date = url.searchParams.get("date") || "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || [...url.searchParams.keys()].some((key) => key !== "date")) return send(400, "text/plain", "Нужна корректная дата YYYY-MM-DD");
        try { return send(200, "application/xml", await officialXML(date)); }
        catch (error) { console.warn(`Запрос НБРК: ${error.code || error.message}`); return send(502, "text/plain", "Не удалось получить официальный курс НБРК. Повторите запрос или загрузите XML."); }
      }
      const file = files[url.pathname];
      if (!file) return send(404, "text/plain", "Не найдено");
      send(200, file[1], await fs.readFile(path.join(__dirname, file[0])));
    } catch { send(500, "text/plain", "Ошибка локального сервера"); }
  });
}

if (require.main === module) {
  createServer().listen(8787, "127.0.0.1", () => console.log("Смета: http://127.0.0.1:8787 — остановка: Ctrl+C"))
    .on("error", (error) => { console.error(`Не удалось запустить сервер: ${error.message}`); process.exitCode = 1; });
}
module.exports = { createServer, officialXML };
