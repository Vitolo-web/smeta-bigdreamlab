"use strict";

// Минимальный XLSX (OOXML + ZIP без сжатия), полностью в браузере.
const SmetaExcel = (() => {
  const xml = (value) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const safe = (n) => Number.isFinite(n) ? n : 0;
  function zip(entries) {
    const encoder = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    const header = (size) => new Uint8Array(size);
    const crc32 = (data) => {
      let crc = 0xffffffff;
      for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
      return (crc ^ 0xffffffff) >>> 0;
    };
    for (const [name, text] of entries) {
      const filename = encoder.encode(name), data = encoder.encode(text), crc = crc32(data);
      const local = header(30), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true); lv.setUint16(12, 33, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, filename.length, true);
      chunks.push(local, filename, data);
      const cent = header(46), cv = new DataView(cent.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint16(14, 33, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, filename.length, true); cv.setUint32(42, offset, true);
      central.push(cent, filename); offset += local.length + filename.length + data.length;
    }
    const length = central.reduce((sum, chunk) => sum + chunk.length, 0);
    const end = header(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, length, true); ev.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  function create(data) {
    if (!data.rate || !Number.isFinite(data.rate.rate) || data.rate.rate <= 0) throw new Error("Для Excel необходим действующий курс.");
    const rows = [];
    const text = (ref, value, style = 0) => `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    const num = (ref, value, formula = "", style = 2) => `<c r="${ref}" s="${style}">${formula ? `<f>${xml(formula)}</f>` : ""}<v>${safe(value)}</v></c>`;
    const add = (n, cells) => rows.push(`<row r="${n}">${cells}</row>`);
    const pair = (n, title, value) => add(n, text(`A${n}`, title, 1) + text(`B${n}`, value));
    pair(1, "Смета", `№ ${data.number || "—"} от ${data.date}`);
    pair(2, "Дата создания", data.metadata[0]);
    pair(3, "Валюта расчёта", data.rate.code);
    pair(4, "Режим", data.rate.mode === "order" ? "Дата оформления заказа" : "Дата публикации сметы");
    pair(5, "Дата расчёта", data.rate.date);
    pair(6, "Дата действия курса", data.rate.effectiveDate);
    add(7, text("A7", "Курс KZT за 1 единицу валюты", 1) + num("B7", data.rate.rate, "", 3));
    pair(8, "Источник курса", data.rate.source);
    pair(9, "Получение курса", data.rate.manual ? "Ручной ввод — не проверен автоматически" : data.rate.imported ? "XML НБРК загружен пользователем" : data.rate.code === "KZT" ? "Базовая валюта" : "Официальный XML НБРК");
    pair(10, "Фиксация курса", data.rate.fixedAt || "Черновик");
    pair(11, "Примечание", data.metadata[data.metadata.length - 1]);
    pair(12, "От кого", data.sender); pair(13, "Для кого", data.recipient); pair(14, "Комментарий", data.comment);
    add(16, ["Наименование", "Тип", "Количество", "Единица", "Цена KZT", `Цена ${data.rate.code}`, "Сумма KZT", `Сумма ${data.rate.code}`].map((title, index) => text(`${String.fromCharCode(65 + index)}16`, title, 1)).join(""));
    let subtotal = 0;
    data.rows.forEach((position, index) => {
      const r = index + 17;
      const amount = round(safe(position.quantity * position.price));
      subtotal = round(subtotal + amount);
      add(r, text(`A${r}`, position.name) + text(`B${r}`, position.type) + num(`C${r}`, position.quantity, "", 3) + text(`D${r}`, position.unit) + num(`E${r}`, position.price) + num(`F${r}`, round(position.price / data.rate.rate), `ROUND(E${r}/$B$7,2)`) + num(`G${r}`, amount, `ROUND(C${r}*E${r},2)`) + num(`H${r}`, round(amount / data.rate.rate), `ROUND(G${r}/$B$7,2)`));
    });
    const start = 17 + data.rows.length;
    const summary = (r, label, amount, formula) => add(r, text(`A${r}`, label, 1) + num(`G${r}`, amount, formula) + num(`H${r}`, round(amount / data.rate.rate), `ROUND(G${r}/$B$7,2)`));
    summary(start, "Сумма до скидки", subtotal, data.rows.length ? `SUM(G17:G${start - 1})` : "0");
    add(start + 1, text(`A${start + 1}`, "Скидка, %", 1) + num(`B${start + 1}`, data.discount, "", 3));
    const discount = round(subtotal * data.discount / 100), discounted = round(subtotal - discount), vat = round(discounted * data.vat / 100), payable = round(discounted + vat);
    summary(start + 2, "Сумма скидки", discount, `ROUND(G${start}*B${start + 1}/100,2)`);
    summary(start + 3, "После скидки", discounted, `ROUND(G${start}-G${start + 2},2)`);
    add(start + 4, text(`A${start + 4}`, "НДС, %", 1) + num(`B${start + 4}`, data.vat, "", 3));
    summary(start + 5, "НДС", vat, `ROUND(G${start + 3}*B${start + 4}/100,2)`);
    summary(start + 6, "Итого к оплате", payable, `ROUND(G${start + 3}+G${start + 5},2)`);
    add(start + 7, text(`A${start + 7}`, "Эквивалент итога в KZT", 1) + num(`G${start + 7}`, payable, `G${start + 6}`));
    const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="16" topLeftCell="A17" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="35" customWidth="1"/><col min="2" max="2" width="45" customWidth="1"/><col min="3" max="4" width="14" customWidth="1"/><col min="5" max="8" width="22" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData><pageSetup paperSize="9" orientation="landscape"/></worksheet>`;
    return zip([
      ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ["_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ["xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Смета" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'],
      ["xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ["xl/styles.xml", '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf><xf fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
      ["xl/worksheets/sheet1.xml", sheet],
    ]);
  }
  return { create };
})();
