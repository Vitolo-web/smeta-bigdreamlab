"use strict";

const items = document.querySelector("#items");
const template = document.querySelector("#item-template");
const totalOutput = document.querySelector("#total");
const rowStatus = document.querySelector("#row-status");
const discountRate = document.querySelector("#discount-rate");
const vatRate = document.querySelector("#vat-rate");
const currency = document.querySelector("#currency");
const draftKey = "smeta-draft-v1";
const draftFieldIds = ["sender", "recipient", "estimate-number", "estimate-date", "discount-rate", "vat-rate", "currency", "comment"];
let draftReady = false;
let copyTimer;
const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function readNumber(value) {
  const normalized = value.trim().replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return 0;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return moneyFormatter.format(safeValue === 0 ? 0 : safeValue).replace(/[\u00a0\u202f]/g, " ") + " " + currency.value;
}

function roundAmount(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function showSummaryAmount(outputId, rowId, amount) {
  document.querySelector(outputId).textContent = formatMoney(amount);
  document.querySelector(rowId).hidden = amount === 0;
}

function recalculate() {
  document.querySelector("#price-heading").textContent = `Цена, ${currency.value}`;
  updateRowLabels();
  let total = 0;
  for (const row of items.rows) {
    const quantity = readNumber(row.querySelector(".item-quantity").value);
    const price = readNumber(row.querySelector(".item-price").value);
    const product = quantity * price;
    // Считаем в целых единицах валюты: итог совпадает с видимыми суммами строк.
    const amount = roundAmount(product);
    row.querySelector(".item-total").textContent = formatMoney(amount);
    const nextTotal = total + amount;
    if (Number.isFinite(nextTotal)) total = nextTotal;
  }
  const discount = roundAmount(total * (readNumber(discountRate.value) / 100));
  const discounted = roundAmount(total - discount);
  const vat = roundAmount(discounted * (readNumber(vatRate.value) / 100));
  document.querySelector("#subtotal").textContent = formatMoney(total);
  showSummaryAmount("#discount-amount", "#discount-row", discount);
  showSummaryAmount("#discounted-amount", "#discounted-row", discounted);
  showSummaryAmount("#vat-amount", "#vat-row", vat);
  totalOutput.textContent = formatMoney(roundAmount(discounted + vat));
  if (draftReady) saveDraft();
}

function updateRowLabels() {
  Array.from(items.rows).forEach((row, index) => {
    row.querySelector(".item-price").closest("td").dataset.label = `Цена, ${currency.value}`;
    row.querySelector(".remove-button").setAttribute("aria-label", `Удалить позицию ${index + 1}`);
    row.querySelectorAll("input, select").forEach((field) => {
      const label = field.closest("td").dataset.label;
      field.setAttribute("aria-label", `${label}, позиция ${index + 1}`);
    });
  });
}

function addItem(focus = true) {
  const fragment = template.content.cloneNode(true);
  const row = fragment.querySelector("tr");
  items.append(fragment);
  recalculate();
  if (focus) {
    row.querySelector(".item-name").focus();
    rowStatus.textContent = `Добавлена позиция ${items.rows.length}`;
  }
  return row;
}

document.querySelector("#add-item").addEventListener("click", () => addItem());
items.addEventListener("input", recalculate);
discountRate.addEventListener("input", recalculate);
vatRate.addEventListener("input", recalculate);
currency.addEventListener("change", recalculate);
items.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-button");
  if (!button) return;
  const row = button.closest("tr");
  const adjacentRow = row.nextElementSibling || row.previousElementSibling;
  row.remove();
  if (items.rows.length === 0) {
    addItem();
  } else {
    updateRowLabels();
    recalculate();
    adjacentRow.querySelector(".item-name").focus();
  }
  rowStatus.textContent = "Позиция удалена";
});

items.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing || event.repeat) return;
  // У кнопки удаления и списка единиц сохраняем стандартное управление клавиатурой.
  if (!event.target.matches("input") || event.target.closest("tr") !== items.lastElementChild) return;
  event.preventDefault();
  addItem();
});

const today = new Date();
document.querySelector("#estimate-date").value = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0"),
].join("-");

addItem(false);

function preparePrint() {
  recalculate();
  const number = document.querySelector("#estimate-number").value.trim() || "—";
  const date = document.querySelector("#estimate-date").value;
  const formattedDate = date ? date.split("-").reverse().join(".") : "—";
  document.querySelector("#print-title").textContent = `Смета № ${number} от ${formattedDate}`;

  // Текстовые копии позволяют печатать длинные значения целиком, без обрезки полей.
  document.querySelectorAll(".print-value").forEach((element) => element.remove());
  document.querySelectorAll(".details-grid input, #items input, #items select, #comment").forEach((field) => {
    const value = document.createElement("span");
    value.className = "print-value";
    value.textContent = field.type === "date" ? formattedDate : field.value;
    field.insertAdjacentElement("afterend", value);
  });
}

window.addEventListener("beforeprint", preparePrint);
document.querySelector("#save-pdf").addEventListener("click", () => {
  preparePrint();
  window.print();
});

function saveDraft() {
  if (!draftReady) return;
  const fields = Object.fromEntries(draftFieldIds.map((id) => [id, document.getElementById(id).value]));
  const positions = Array.from(items.rows, (row) => ({
    name: row.querySelector(".item-name").value,
    quantity: row.querySelector(".item-quantity").value,
    unit: row.querySelector(".item-unit").value,
    price: row.querySelector(".item-price").value,
  }));
  try {
    localStorage.setItem(draftKey, JSON.stringify({ version: 1, fields, positions }));
    document.querySelector("#storage-status").textContent = "";
  } catch {
    document.querySelector("#storage-status").textContent = "Не удалось сохранить черновик в этом браузере. Не закрывайте страницу, пока не сохраните смету в PDF или не скопируете текст.";
  }
}

function restoreDraft() {
  try {
    const saved = localStorage.getItem(draftKey);
    if (!saved) return;
    const draft = JSON.parse(saved);
    const valid = draft?.version === 1 && draft.fields &&
      draftFieldIds.every((id) => typeof draft.fields[id] === "string") &&
      ["₸", "₽", "$", "€"].includes(draft.fields.currency) &&
      Array.isArray(draft.positions) && draft.positions.length > 0 &&
      draft.positions.every((position) => position &&
        ["name", "quantity", "unit", "price"].every((key) => typeof position[key] === "string") &&
        ["шт", "час", "услуга"].includes(position.unit));
    if (!valid) throw new Error("Invalid draft");
    draftFieldIds.forEach((id) => { document.getElementById(id).value = draft.fields[id]; });
    items.replaceChildren();
    draft.positions.forEach((position) => {
      const row = addItem(false);
      row.querySelector(".item-name").value = position.name;
      row.querySelector(".item-quantity").value = position.quantity;
      row.querySelector(".item-unit").value = position.unit;
      row.querySelector(".item-price").value = position.price;
    });
    recalculate();
  } catch {
    document.querySelector("#storage-status").textContent = "Не удалось восстановить черновик. Можно продолжить работу с новой сметой.";
  }
}

function nextEstimateNumber(value) {
  const number = value.trim();
  const match = number.match(/^(.*?)(\d+)$/);
  return match ? match[1] + String(BigInt(match[2]) + 1n).padStart(match[2].length, "0") : number + "1";
}

document.querySelector("#new-estimate").addEventListener("click", () => {
  if (!window.confirm("Создать новую смету? Текущий черновик будет очищен.")) return;
  const nextNumber = nextEstimateNumber(document.querySelector("#estimate-number").value);
  draftReady = false;
  draftFieldIds.forEach((id) => { document.getElementById(id).value = ""; });
  document.querySelector("#estimate-number").value = nextNumber;
  const now = new Date();
  document.querySelector("#estimate-date").value = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  discountRate.value = "0";
  vatRate.value = "0";
  currency.value = "₸";
  items.replaceChildren();
  addItem();
  clearTimeout(copyTimer);
  document.querySelector("#copy-status").textContent = "";
  document.querySelector("#manual-copy").hidden = true;
  document.querySelector("#share-text").value = "";
  draftReady = true;
  saveDraft();
});

function buildShareText() {
  recalculate();
  const number = document.querySelector("#estimate-number").value.trim() || "—";
  const date = document.querySelector("#estimate-date").value;
  const lines = [`Смета № ${number} от ${date ? date.split("-").reverse().join(".") : "—"}`];
  for (const [id, label] of [["sender", "От кого"], ["recipient", "Для кого"]]) {
    const value = document.getElementById(id).value.trim();
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push("");
  for (const row of items.rows) {
    const name = row.querySelector(".item-name").value.trim() || "Без названия";
    const quantity = readNumber(row.querySelector(".item-quantity").value).toLocaleString("ru-RU", { maximumFractionDigits: 20 }).replace(/[\u00a0\u202f]/g, " ");
    const unit = row.querySelector(".item-unit").value;
    const price = formatMoney(readNumber(row.querySelector(".item-price").value));
    lines.push(`• ${name} — ${quantity} ${unit} × ${price} = ${row.querySelector(".item-total").textContent}`);
  }
  lines.push("", `Сумма: ${document.querySelector("#subtotal").textContent}`);
  for (const [rowId, outputId, label] of [
    ["discount-row", "discount-amount", "Скидка"],
    ["discounted-row", "discounted-amount", "Сумма со скидкой"],
    ["vat-row", "vat-amount", "НДС"],
  ]) {
    if (!document.getElementById(rowId).hidden) lines.push(`${label}: ${document.getElementById(outputId).textContent}`);
  }
  lines.push(`Итого к оплате: ${totalOutput.textContent}`);
  const comment = document.querySelector("#comment").value.trim();
  if (comment) lines.push("", `Комментарий: ${comment}`);
  return lines.join("\n");
}

document.querySelector("#copy-whatsapp").addEventListener("click", async () => {
  const text = buildShareText();
  const status = document.querySelector("#copy-status");
  clearTimeout(copyTimer);
  status.textContent = "";
  document.querySelector("#manual-copy").hidden = true;
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Скопировано ✓";
    copyTimer = setTimeout(() => { status.textContent = ""; }, 2000);
  } catch {
    document.querySelector("#manual-copy").hidden = false;
    const field = document.querySelector("#share-text");
    field.value = text;
    field.focus();
    field.select();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("input, select, textarea") && event.target.id !== "share-text") saveDraft();
});
document.addEventListener("change", (event) => {
  if (event.target.matches("input, select, textarea") && event.target.id !== "share-text") saveDraft();
});

restoreDraft();
draftReady = true;
