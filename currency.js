"use strict";

// Содержимое сметы не передаётся серверу: запрашивается только дата XML НБРК.
const SmetaFX = (() => {
  const codes = { "₸": "KZT", "$": "USD", "€": "EUR", "₽": "RUB" };
  const $ = (id) => document.getElementById(id);
  let records = {};
  let createdDate = today();
  let onChange = () => {};
  let initialized = false;
  let pending = null;
  let generation = 0;
  let lastAttempt = "";
  let status = "";

  function today() {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Qyzylorda", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type) => parts.find((entry) => entry.type === type).value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  }
  function displayDate(value) { return validDate(value) ? value.split("-").reverse().join(".") : "—"; }
  function xmlDate(value) {
    const match = String(value).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : "";
    return validDate(iso) ? iso : "";
  }
  function number(value) {
    const normalized = String(value).trim().replace(/\s/g, "").replace(",", ".");
    return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) && Number.isFinite(Number(normalized)) ? Number(normalized) : 0;
  }
  function selection() {
    const mode = $("rate-mode").value;
    const date = $(mode === "order" ? "order-date" : "publication-date").value;
    const code = codes[$("currency").value];
    return { mode, date, code, key: `${mode}|${code}|${date}` };
  }
  function sourceFor(date) { return `https://nationalbank.kz/rss/get_rates.cfm?fdate=${displayDate(date)}`; }
  function current() {
    const selected = selection();
    if (selected.code === "KZT") return { ...selected, rate: 1, effectiveDate: selected.date, source: "Базовая валюта KZT — конвертация не требуется", manual: false, fixed: !!records[selected.key]?.fixed, fixedAt: records[selected.key]?.fixedAt || "" };
    return records[selected.key] || null;
  }
  function rate() { return current()?.rate || null; }
  function parseXML(xmlText, code, targetDate, source) {
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("НБРК вернул некорректный XML.");
    const entries = Array.from(xml.querySelectorAll("item")).filter((item) => item.querySelector("title")?.textContent.trim() === code);
    if (entries.length !== 1) throw new Error(`Курс ${code} отсутствует или неоднозначен в XML НБРК.`);
    const item = entries[0];
    const quote = number(item.querySelector("description")?.textContent);
    const nominal = number(item.querySelector("quant")?.textContent);
    const effectiveDate = xmlDate(item.querySelector("pubDate")?.textContent || xml.querySelector("rates > date")?.textContent || xml.querySelector("channel > pubDate")?.textContent);
    const normalized = quote / nominal;
    if (!quote || !nominal || !Number.isFinite(normalized) || normalized <= 0 || !effectiveDate || effectiveDate > targetDate) throw new Error("В XML нет действующего на выбранную дату курса или номинала.");
    return { rate: normalized, effectiveDate, source, manual: false };
  }
  function paint() {
    const selected = selection();
    const record = current();
    $("created-date").textContent = displayDate(createdDate);
    $("rate-currency").textContent = selected.code;
    $("rate-target").textContent = `${selected.mode === "order" ? "Заказ" : "Публикация"}: ${displayDate(selected.date)}`;
    $("rate-date").textContent = record ? displayDate(record.effectiveDate) : "—";
    $("rate-value").textContent = record ? record.rate.toLocaleString("ru-RU", { maximumFractionDigits: 12 }).replace(/[\u00a0\u202f]/g, " ") : "—";
    $("rate-source").textContent = record?.source || "Курс не получен";
    $("rate-state").textContent = (record?.fixed ? `Зафиксирован ${new Date(record.fixedAt).toLocaleString("ru-RU", { timeZone: "Asia/Qyzylorda" })}${record.manual ? " · ручной ввод" : ""}` : record?.manual ? "Ручной ввод — не подтверждён автоматической загрузкой" : selected.code === "KZT" ? "Конвертация не требуется" : "Черновик — курс ещё не зафиксирован") + (record?.imported ? " · XML загружен пользователем" : "");
    $("rate-note").textContent = selected.code === "KZT" ? "Расчёт выполнен в базовой валюте KZT." : !record ? "Конвертация недоступна до получения курса." : record.manual ? "Пересчёт выполнен по курсу, введённому вручную. Автоматическая проверка по данным НБРК не выполнена." : "Пересчёт выполнен по официальному курсу Национального Банка РК на указанную дату";
    $("rate-status").textContent = status;
    $("publication-date").disabled = selected.mode !== "publication" || !!record?.fixed;
    $("order-date").disabled = selected.mode !== "order" || !!record?.fixed;
    $("refresh-rate").disabled = !!record?.fixed || selected.code === "KZT" || !!pending;
    $("fix-rate").disabled = !!record?.fixed || !!pending;
    $("fix-rate").textContent = selected.mode === "order" ? "Подтвердить заказ и зафиксировать курс" : "Опубликовать и зафиксировать курс";
    $("apply-manual-rate").disabled = !!record?.fixed || selected.code === "KZT";
    $("rate-file").disabled = !!record?.fixed || selected.code === "KZT";
    $("official-rate-link").href = validDate(selected.date) ? sourceFor(selected.date) : "https://nationalbank.kz/rss/rates_all.xml";
  }
  function notify() { paint(); onChange(); }
  async function fetchXML(date) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const local = location.protocol === "http:" && ["127.0.0.1", "localhost"].includes(location.hostname);
      const url = local ? `/api/rates?date=${encodeURIComponent(date)}` : sourceFor(date);
      const response = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
      if (!response.ok) throw new Error(`Источник вернул HTTP ${response.status}.`);
      const xml = await response.text();
      if (xml.length > 1000000) throw new Error("XML превышает допустимый размер.");
      return xml;
    } finally { clearTimeout(timer); }
  }
  async function load(force = false) {
    const selected = selection();
    if (!validDate(selected.date)) { status = "Укажите корректную дату курса."; paint(); return false; }
    if (current()?.fixed || selected.code === "KZT") { paint(); return true; }
    if (pending?.key === selected.key) return pending.promise;
    if (!force && current()) return true;
    if (!force && lastAttempt === selected.key) return false;
    lastAttempt = selected.key;
    const token = ++generation;
    status = "Получение официального курса НБРК…";
    const promise = (async () => {
      try {
        // Сервис обычно возвращает действующий курс и для выходных.
        // Если набор пуст, ищем последний опубликованный курс за предыдущие дни.
        let result;
        for (let offset = 0; offset <= 31; offset++) {
          const day = new Date(selected.date + "T12:00:00Z");
          day.setUTCDate(day.getUTCDate() - offset);
          const date = day.toISOString().slice(0, 10);
          const text = await fetchXML(date);
          const xml = new DOMParser().parseFromString(text, "application/xml");
          if (xml.querySelector("parsererror")) throw new Error("Источник вернул некорректный XML.");
          if (!xml.querySelector("rates") && !xml.querySelector("rss")) throw new Error("Источник вернул страницу вместо XML курсов.");
          if (!xml.querySelector("item")) continue;
          result = parseXML(text, selected.code, selected.date, sourceFor(date));
          break;
        }
        if (!result) throw new Error("Действующий курс не найден за предыдущие 31 день.");
        if (token !== generation || selection().key !== selected.key) return false;
        records[selected.key] = { ...selected, ...result, fixed: false, fixedAt: "" };
        status = "Официальный курс получен. До фиксации его можно обновить повторным запросом.";
        return true;
      } catch (error) {
        if (token === generation && selection().key === selected.key) status = `Автоматическое обновление недоступно. ${error.name === "AbortError" ? "Время ожидания истекло." : error.message} Запустите приложение через локальный сервер, повторите запрос, загрузите XML НБРК или введите курс вручную.${current() ? " Сохранённый курс пока сохранён в расчёте." : " Итог в иностранной валюте пока не рассчитан."}`;
        return false;
      } finally {
        if (pending?.token === token) pending = null;
        if (token === generation) notify();
      }
    })();
    pending = { key: selected.key, token, promise };
    paint();
    return promise;
  }
  function changed() {
    generation++;
    pending = null;
    status = "";
    $("manual-rate").value = "";
    $("manual-rate-date").value = selection().date;
    notify();
    void load();
  }
  async function fix() {
    if (current()?.fixed) return true;
    // При подтверждении заказа запрашиваем курс заново; ручной курс явно сохраняет свою пометку.
    const ok = current()?.manual || current()?.imported ? true : await load(true);
    if (!ok || !current()) return false;
    const selected = selection();
    records[selected.key] = { ...current(), ...selected, fixed: true, fixedAt: new Date().toISOString() };
    status = "Курс зафиксирован в этом браузере. Автоматическое обновление для этой валюты и даты отключено.";
    notify();
    return true;
  }
  function getState() { return { createdDate, mode: $("rate-mode").value, publicationDate: $("publication-date").value, orderDate: $("order-date").value, records }; }
  function restore(state) {
    records = {};
    createdDate = validDate(state?.createdDate) ? state.createdDate : today();
    $("rate-mode").value = state?.mode === "order" ? "order" : "publication";
    $("publication-date").value = validDate(state?.publicationDate) ? state.publicationDate : $("estimate-date").value || today();
    $("order-date").value = validDate(state?.orderDate) ? state.orderDate : today();
    for (const [key, value] of Object.entries(state?.records || {})) {
      if (!value || !["publication", "order"].includes(value.mode) || !["KZT", "USD", "EUR", "RUB"].includes(value.code) || !validDate(value.date) || !validDate(value.effectiveDate) || value.effectiveDate > value.date || !Number.isFinite(value.rate) || value.rate <= 0 || typeof value.manual !== "boolean" || typeof value.fixed !== "boolean" || typeof value.source !== "string" || (value.fixed && !Number.isFinite(Date.parse(value.fixedAt))) || key !== `${value.mode}|${value.code}|${value.date}`) continue;
      if (!value.manual && value.code !== "KZT" && !/^https:\/\/nationalbank\.kz\/rss\/get_rates\.cfm\?fdate=\d{2}\.\d{2}\.\d{4}$/.test(value.source)) continue;
      records[key] = value;
    }
    generation++; pending = null; lastAttempt = ""; status = "";
  }
  function init(callback) {
    onChange = callback;
    initialized = true;
    for (const id of ["currency", "rate-mode", "publication-date", "order-date"]) $(id).addEventListener("change", changed);
    $("refresh-rate").addEventListener("click", () => void load(true));
    $("fix-rate").addEventListener("click", () => void fix());
    $("apply-manual-rate").addEventListener("click", () => {
      const selected = selection();
      const value = number($("manual-rate").value);
      const effectiveDate = $("manual-rate-date").value;
      if (current()?.fixed || selected.code === "KZT") return;
      if (!value || !validDate(effectiveDate) || !validDate(selected.date) || effectiveDate > selected.date) { status = "Введите положительный курс и дату действия не позже даты расчёта."; paint(); return; }
      generation++; pending = null;
      records[selected.key] = { ...selected, rate: value, effectiveDate, source: "Ручной ввод пользователем — автоматическая проверка НБРК не выполнена", manual: true, fixed: false, fixedAt: "" };
      status = "Применён ручной курс. Эта пометка будет сохранена в смете и экспорте.";
      notify();
    });
    $("rate-file").addEventListener("change", async (event) => {
      const selected = selection();
      const file = event.target.files[0];
      if (!file || current()?.fixed || selected.code === "KZT") return;
      try {
        if (file.size > 1000000) throw new Error("Файл XML слишком большой.");
        const result = parseXML(await file.text(), selected.code, selected.date, sourceFor(selected.date));
        if (selection().key !== selected.key || current()?.fixed) return;
        generation++; pending = null;
        records[selected.key] = { ...selected, ...result, source: sourceFor(result.effectiveDate), imported: true, fixed: false, fixedAt: "" };
        status = "XML загружен пользователем. Убедитесь, что файл сохранён с сайта НБРК.";
        notify();
      } catch (error) { status = error.message; paint(); }
      event.target.value = "";
    });
    $("manual-rate-date").value = selection().date;
    paint();
    void load();
  }
  function describe() {
    const selected = selection();
    const record = current();
    return [ `Дата создания сметы: ${displayDate(createdDate)}`, `Валюта расчёта: ${selected.code}`, $("rate-target").textContent, `Дата курса: ${record ? displayDate(record.effectiveDate) : "—"}`, `Курс KZT за 1 ${selected.code}: ${record?.rate ?? "—"}`, `Источник: ${record?.source || "—"}`, $("rate-state").textContent, $("rate-note").textContent ];
  }
  return { init, rate, current, selection, getState, restore, today, displayDate, parseXML, describe, fix, load, update() { if (initialized) { paint(); void load(); } }, reset() { restore(null); if (initialized) changed(); } };
})();
