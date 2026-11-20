"use strict";

// Автономные проверки без зависимостей. Курсы ниже — только тестовые фикстуры.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");
const { createServer, officialXML } = require("./server.js");
let checks = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); checks++; };

// Небольшой DOM для проверки логики, не замена визуальной проверке в браузере.
class XMLNode {
  constructor(text) { this.text = text; this.textContent = text.replace(/<[^>]*>/g, ""); }
  querySelectorAll(selector) {
    const tags = selector.split(" > ");
    let nodes = [this];
    for (const tag of tags) {
      nodes = nodes.flatMap((node) => Array.from(node.text.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "g")), (match) => new XMLNode(match[1])));
    }
    return nodes;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const DOMParser = class { parseFromString(text) { return new XMLNode(text); } };
function fixture(date = "20.11.2026", nominal = 1) {
  return `<rates><date>${date}</date>${["USD", "EUR", "RUB"].map((code) => `<item><title>${code}</title><description>${(code === "USD" ? 500 : code === "EUR" ? 550 : 5) * nominal}</description><quant>${nominal}</quant></item>`).join("")}</rates>`;
}

async function app(saved, fetchImpl, officeSettings) {
  const nodes = new Map();
  function field(value = "") {
    return { value, textContent: "", hidden: false, disabled: false, readOnly: false, dataset: {}, listeners: {}, files: [], selectedOptions: [{ textContent: "Компьютер" }],
      addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
      async emit(name) { for (const fn of this.listeners[name] || []) await fn({ target: this }); },
      setAttribute() {}, focus() {}, select() {}, matches() { return false; }, click() {},
      insertAdjacentElement(position, value) { this.printValue = value; },
    };
  }
  const get = (selector) => { if (!nodes.has(selector)) nodes.set(selector, field()); return nodes.get(selector); };
  const row = () => {
    const fields = {};
    for (const key of ["name", "quantity", "price", "unit", "type", "total", "converted-price"]) {
      const input = field(key === "unit" ? "шт" : key === "type" ? "other" : "");
      input.matches = (selector) => selector === `.item-${key}`;
      input.closest = () => ({ dataset: { label: key } });
      fields[`.item-${key}`] = input;
    }
    fields[".remove-button"] = field();
    return { querySelector: (selector) => fields[selector], querySelectorAll: () => Object.entries(fields).filter(([key]) => ![".item-total", ".remove-button", ".item-converted-price"].includes(key)).map(([, value]) => value) };
  };
  const items = get("#items"); items.rows = [];
  items.append = (fragment) => items.rows.push(fragment.querySelector("tr"));
  items.replaceChildren = () => { items.rows = []; };
  get("#item-template").content = { cloneNode() { const r = row(); return { querySelector: () => r }; } };
  get("#currency").value = "₸"; get("#discount-rate").value = "0"; get("#vat-rate").value = "0"; get("#rate-mode").value = "publication";
  const document = { querySelector: get, getElementById: (id) => get("#" + id), addEventListener() {}, createElement: () => field(), querySelectorAll: (selector) => selector === ".print-value" ? [] : [...items.rows.flatMap((r) => r.querySelectorAll()), get("#comment")] };
  const storage = new Map();
  if (saved) storage.set("smeta-draft-v1", saved);
  if (officeSettings) storage.set("smeta-office-promotion-v1", officeSettings);
  let calls = 0;
  const context = vm.createContext({ document, DOMParser, Blob, TextEncoder, URL, AbortController, location: { protocol: "http:", hostname: "127.0.0.1" }, setTimeout, clearTimeout, window: { addEventListener() {}, confirm: () => true, print() {} }, navigator: {}, localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => { storage.set(key, value); } }, fetch: async (...args) => { calls++; return fetchImpl ? fetchImpl(...args) : { ok: true, text: async () => fixture() }; } });
  for (const filename of ["currency.js", "excel.js", "script.js"]) vm.runInContext(await fs.readFile(path.join(__dirname, filename), "utf8"), context);
  const run = (code) => vm.runInContext(code, context);
  // Дату фиксируем в тестах, чтобы результаты не зависели от дня запуска.
  get("#publication-date").value = "2026-11-20"; get("#order-date").value = "2026-11-20";
  return { get, items, run, calls: () => calls, saved: () => storage.get("smeta-draft-v1"), settings: () => storage.get("smeta-office-promotion-v1"), async change(id, value) { get("#" + id).value = value; await get("#" + id).emit("change"); await run("SmetaFX.load()"); }, setRows(data) { items.rows = data.map((entry) => { const r = row(); for (const [key, value] of Object.entries(entry)) r.querySelector(`.item-${key}`).value = String(value); return r; }); run("recalculate()"); } };
}

async function main() {
  const a = await app();
  for (const [quantity, expected] of [[0, "0,00 ₸"], [1, "500 000,00 ₸"], [9, "4 500 000,00 ₸"], [10, "4 050 000,00 ₸"], [29, "11 745 000,00 ₸"], [30, "10 800 000,00 ₸"]]) {
    a.setRows([{ type: "computer", quantity }]); equal(a.get("#total").textContent, expected);
  }
  a.setRows([{ name: "ПК", type: "computer", quantity: 6 }, { name: "Ноутбук", type: "laptop", quantity: 4 }]);
  equal(a.get("#equipment-count").textContent, "10");
  await a.change("currency", "$");
  equal(a.get("#total").textContent, "8 100,00 $");
  equal(a.get("#total-kzt").textContent, "4 050 000,00 ₸");
  equal(a.items.rows[0].querySelector(".item-price").value, "450 000,00");
  equal(a.items.rows[0].querySelector(".item-converted-price").textContent, "900,00 $");
  equal(a.get("#discount-amount").textContent, "900,00 $");
  equal(a.get("#amount-words").hidden, true);
  const normalized = a.run(`SmetaFX.parseXML(${JSON.stringify(fixture("19.11.2026", 100))}, 'USD', '2026-11-20', 'test')`);
  equal(normalized.rate, 500); equal(normalized.effectiveDate, "2026-11-19");
  assert.throws(() => a.run(`SmetaFX.parseXML(${JSON.stringify(fixture("21.11.2026"))}, 'USD', '2026-11-20', 'test')`)); checks++;
  assert.throws(() => a.run(`SmetaFX.parseXML('<rates><date>20.11.2026</date><item><title>USD</title><description>0</description><quant>1</quant></item></rates>', 'USD', '2026-11-20', 'test')`)); checks++;
  const beforeFix = a.calls(); equal(await a.run("SmetaFX.fix()"), true); equal(a.calls(), beforeFix + 1);
  const afterFix = a.calls(); await a.run("SmetaFX.load(true)"); equal(a.calls(), afterFix);
  equal(a.run("SmetaFX.current().fixed"), true);
  a.run("preparePrint()"); equal(a.items.rows[0].querySelector(".item-price").printValue.textContent, "900,00 $");
  equal(a.run("buildShareText()").includes("8 100,00 $"), true);
  const saved = a.saved();
  const b = await app(saved); equal(b.get("#total").textContent, "8 100,00 $"); equal(b.calls(), 0);
  await a.change("currency", "€"); equal(a.get("#total").textContent, "7 363,64 €");
  await a.change("currency", "₽"); equal(a.get("#total").textContent, "810 000,00 ₽");
  await a.change("currency", "₸"); equal(a.get("#total").textContent, "4 050 000,00 ₸");
  await b.change("rate-mode", "order"); equal(b.run("SmetaFX.current().fixed"), false);
  equal(await b.run("SmetaFX.fix()"), true); equal(b.run("SmetaFX.current().mode"), "order");
  const failed = await app(null, async () => { throw new Error("test: offline"); });
  failed.setRows([{ type: "computer", quantity: 10 }]); await failed.change("currency", "$");
  equal(failed.get("#total").textContent, "—"); equal(failed.get("#total-kzt").textContent, "4 050 000,00 ₸");
  equal(await failed.run("SmetaFX.fix()"), false);
  failed.get("#manual-rate").value = "500"; failed.get("#manual-rate-date").value = "2026-11-20";
  await failed.get("#apply-manual-rate").emit("click"); equal(failed.get("#total").textContent, "8 100,00 $");
  equal(failed.run("SmetaFX.current().manual"), true); equal(await failed.run("SmetaFX.fix()"), true);
  equal(failed.run("buildShareText()").includes("вручную"), true);
  failed.get("#manual-rate").value = "600";
  await failed.get("#apply-manual-rate").emit("click"); equal(failed.run("SmetaFX.current().rate"), 500);
  const imported = await app(null, async () => { throw new Error("test: offline"); });
  imported.setRows([{ type: "laptop", quantity: 10 }]); await imported.change("currency", "$");
  imported.get("#rate-file").files = [{ size: 500, text: async () => fixture() }];
  await imported.get("#rate-file").emit("change"); equal(imported.run("SmetaFX.current().imported"), true);
  const beforeImportFix = imported.calls(); equal(await imported.run("SmetaFX.fix()"), true); equal(imported.calls(), beforeImportFix);
  // Если выбранная дата не содержит курса, используется предыдущий официальный набор.
  const weekend = await app(null, async (url) => ({ ok: true, text: async () => url.endsWith("2026-11-20") ? "<rates><date>20.11.2026</date></rates>" : fixture("19.11.2026") }));
  weekend.setRows([{ type: "computer", quantity: 10 }]); await weekend.change("currency", "$");
  equal(weekend.run("SmetaFX.current().effectiveDate"), "2026-11-19"); equal(weekend.get("#total").textContent, "8 100,00 $");
  // Проверяем восстановление ручной цены и ручной скидки для прочих позиций.
  const plain = await app(); plain.setRows([{ type: "other", quantity: 2, price: "15 000" }, { type: "other", quantity: 1, price: "8000" }]);
  plain.get("#discount-rate").value = "10"; plain.get("#vat-rate").value = "10"; plain.run("recalculate()"); equal(plain.get("#total").textContent, "37 620,00 ₸");
  await plain.change("currency", "$"); equal(plain.get("#total").textContent, "75,24 $"); equal(plain.items.rows[0].querySelector(".item-price").value, "15 000");
  // XLSX создаётся в памяти; XML извлекается и проверяется отдельной проверкой ZIP.
  const blob = b.run(`SmetaExcel.create({rows:[{name:'=HYPERLINK("test") & <ПК>',type:'Компьютер',quantity:10,unit:'шт',price:450000}],rate:SmetaFX.current(),metadata:SmetaFX.describe(),number:'001',date:'2026-11-20',sender:'Тест',recipient:'Тест',comment:'',discount:10,vat:0})`);
  const bytes = Buffer.from(await blob.arrayBuffer()), entries = new Map();
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const begin = offset + 30 + nameLength + extraLength;
    entries.set(bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"), bytes.subarray(begin, begin + size).toString("utf8"));
    offset = begin + size;
  }
  equal(entries.size, 6);
  const sheet = entries.get("xl/worksheets/sheet1.xml");
  equal(sheet.includes('<c r="B7" s="3"><v>500</v></c>'), true);
  equal(sheet.includes('<f>ROUND(E17/$B$7,2)</f>'), true);
  equal(sheet.includes('<c r="H24" s="2"><f>ROUND(G24/$B$7,2)</f><v>8100</v></c>'), true);
  equal(sheet.includes('<c r="A17" t="inlineStr"'), true);
  const promo = await app();
  equal(promo.get("#office-promotion-enabled").checked, true);
  equal(promo.get("#office-promotion-version").value, "2024");
  promo.setRows([{ type: "computer", quantity: 19 }]);
  equal(promo.get("#office-gift").hidden, true);
  equal(promo.run("buildShareText()").includes("Microsoft Office"), false);
  promo.setRows([{ type: "computer", quantity: 12 }, { type: "laptop", quantity: 8 }]);
  equal(promo.get("#office-gift").hidden, false);
  equal(promo.get("#office-gift-description").textContent.includes("лицензионный Microsoft Office 2024 с установкой"), true);
  equal(promo.get("#total").textContent, "8 100 000,00 ₸");
  equal(promo.run("buildShareText()").includes("Подарок: Бесплатный лицензионный Microsoft Office 2024"), true);
  promo.run("preparePrint()"); equal(promo.get("#office-gift").hidden, false);
  const giftBlob = promo.run(`SmetaExcel.create({rows:[{name:'ПК',type:'Компьютер',quantity:20,unit:'шт',price:450000}],gift:getOfficeGift(),rate:SmetaFX.current(),metadata:SmetaFX.describe(),number:'001',date:'2026-11-20',sender:'',recipient:'',comment:'',discount:10,vat:0})`);
  const giftXml = Buffer.from(await giftBlob.arrayBuffer()).toString("utf8");
  equal(giftXml.includes("лицензионный Microsoft Office 2024 с установкой"), true);
  equal(giftXml.includes('<v>8100000</v>'), true);
  await promo.change("office-promotion-version", "2021");
  equal(promo.run("getOfficeGift()").includes("Office 2021"), true);
  const restoredPromo = await app(promo.saved(), undefined, promo.settings());
  equal(restoredPromo.get("#office-promotion-version").value, "2021");
  equal(restoredPromo.get("#office-gift").hidden, false);
  promo.get("#office-promotion-enabled").checked = false;
  await promo.get("#office-promotion-enabled").emit("change");
  equal(promo.get("#office-gift").hidden, true);
  equal(promo.get("#office-promotion-version").disabled, true);
  equal(promo.run("buildShareText()").includes("Microsoft Office"), false);
  equal(promo.get("#total").textContent, "8 100 000,00 ₸");
  const disabledPromo = await app(promo.saved(), undefined, promo.settings());
  equal(disabledPromo.get("#office-promotion-enabled").checked, false);
  await disabledPromo.get("#new-estimate").emit("click");
  equal(disabledPromo.get("#office-promotion-enabled").checked, false);
  equal(disabledPromo.get("#office-promotion-version").value, "2021");
  equal(disabledPromo.get("#office-gift").hidden, true);
  restoredPromo.setRows([{ type: "computer", quantity: 19 }, { type: "other", quantity: 100 }, { type: "laptop", quantity: 100, unit: "час" }]);
  equal(restoredPromo.get("#office-gift").hidden, true);
  restoredPromo.setRows([{ type: "computer", quantity: "abc" }, { type: "laptop", quantity: "" }]);
  equal(restoredPromo.get("#office-gift").hidden, true);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    equal((await fetch(base + "/")).status, 200);
    equal((await fetch(base + "/api/rates?date=2026-02-30")).status, 400);
    equal((await fetch(base + "/api/rates?date=2026-11-20&url=https://example.com")).status, 400);
    equal((await fetch(base + "/AGENTS.md")).status, 404);
    equal((await fetch(base + "/", { headers: { Origin: "https://example.com" } })).status, 403);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  if (process.argv.includes("--live")) {
    const xml = (await officialXML("2026-11-20")).toString("utf8");
    const parsed = a.run(`SmetaFX.parseXML(${JSON.stringify(xml)}, 'USD', '2026-11-20', 'https://nationalbank.kz/rss/get_rates.cfm?fdate=20.11.2026')`);
    assert.ok(parsed.rate > 0); checks++;
    console.log(`НБРК: USD ${parsed.rate} KZT, дата ${parsed.effectiveDate}`);
    const liveServer = createServer();
    await new Promise((resolve) => liveServer.listen(0, "127.0.0.1", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${liveServer.address().port}/api/rates?date=2026-11-20`);
      equal(response.status, 200);
      const xml = await response.text();
      const value = a.run(`SmetaFX.parseXML(${JSON.stringify(xml)}, 'EUR', '2026-11-20', 'https://nationalbank.kz/rss/get_rates.cfm?fdate=20.11.2026')`);
      assert.ok(value.rate > 0); checks++;
    } finally { await new Promise((resolve) => liveServer.close(resolve)); }
  }
  console.log(`Пройдено ${checks} проверок. DOM эмулируется; визуальное отображение отдельно не проверяется этими тестами.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
