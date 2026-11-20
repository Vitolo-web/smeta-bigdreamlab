"use strict";

const items = document.querySelector("#items");
const template = document.querySelector("#item-template");
const totalOutput = document.querySelector("#total");
const amountWords = document.querySelector("#amount-words");
const rowStatus = document.querySelector("#row-status");
const discountRate = document.querySelector("#discount-rate");
const vatRate = document.querySelector("#vat-rate");
const currency = document.querySelector("#currency");
const draftKey = "smeta-draft-v1";
const draftFieldIds = ["sender", "recipient", "estimate-number", "estimate-date", "discount-rate", "vat-rate", "currency", "comment"];
let draftReady = false;
let copyTimer;
let automaticDiscountActive = false;
let manualDiscountRate = "0";
const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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
  if (!Number.isFinite(value)) return 0;
  const [coefficient, exponent = "0"] = String(value).split("e");
  const shifted = Number(`${coefficient}e${Number(exponent) + 2}`);
  if (!Number.isFinite(shifted)) return 0;
  return Math.round(shifted) / 100;
}

function amountInWords(amount) {
  if (Number.isFinite(amount) && !Number.isInteger(amount)) {
    const rounded = roundAmount(amount);
    const whole = Math.trunc(Math.abs(rounded));
    if (Math.abs(rounded) > 999999999 || rounded === 0) return "";
    const tiyn = Math.round((Math.abs(rounded) - whole) * 100);
    const text = whole ? amountInWords(whole) : "Ноль тенге";
    return `${rounded < 0 ? "Минус " + text.toLowerCase() : text} ${String(tiyn).padStart(2, "0")} тиын`;
  }
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 999999999) return "";
  const ones = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
  const groups = [
    { divisor: 1000000, forms: ["миллион", "миллиона", "миллионов"] },
    { divisor: 1000, forms: ["тысяча", "тысячи", "тысяч"], feminine: true },
    { divisor: 1 },
  ];
  const words = amount < 0 ? ["минус"] : [];
  for (const { divisor, forms, feminine } of groups) {
    const group = Math.floor(Math.abs(amount) / divisor) % 1000;
    if (group === 0) continue;
    words.push(hundreds[Math.floor(group / 100)]);
    const remainder = group % 100;
    const lastDigit = group % 10;
    if (remainder >= 10 && remainder <= 19) {
      words.push(teens[remainder - 10]);
    } else {
      words.push(tens[Math.floor(remainder / 10)]);
      words.push(feminine && lastDigit === 1 ? "одна" : feminine && lastDigit === 2 ? "две" : ones[lastDigit]);
    }
    if (forms) {
      const form = remainder >= 11 && remainder <= 14 ? 2 : lastDigit === 1 ? 0 : lastDigit >= 2 && lastDigit <= 4 ? 1 : 2;
      words.push(forms[form]);
    }
  }
  words.push("тенге");
  const text = words.filter(Boolean).join(" ");
  return text[0].toUpperCase() + text.slice(1);
}

function showSummaryAmount(outputId, rowId, amount) {
  document.querySelector(outputId).textContent = formatMoney(amount);
  document.querySelector(rowId).hidden = amount === 0;
}

function recalculate() {
  document.querySelector("#price-heading").textContent = `Цена, ${currency.value}`;
  updateRowLabels();
  let total = 0;
  let equipmentCount = 0;
  let hasEquipment = false;
  for (const row of items.rows) {
    const type = row.querySelector(".item-type").value;
    if ((type === "computer" || type === "laptop") && row.querySelector(".item-unit").value === "шт") {
      hasEquipment = true;
      const quantity = readNumber(row.querySelector(".item-quantity").value);
      const nextCount = equipmentCount + Math.max(0, quantity);
      if (Number.isFinite(nextCount)) equipmentCount = nextCount;
    }
  }
  const automaticPricing = hasEquipment && currency.value === "₸";
  const equipmentPrice = equipmentCount >= 10 ? 450000 : 500000;
  for (const row of items.rows) {
    const type = row.querySelector(".item-type").value;
    const priceField = row.querySelector(".item-price");
    const useEquipmentPrice = automaticPricing && (type === "computer" || type === "laptop") && row.querySelector(".item-unit").value === "шт";
    priceField.readOnly = useEquipmentPrice;
    if (useEquipmentPrice) {
      if (priceField.dataset.manualPrice === undefined) priceField.dataset.manualPrice = priceField.value;
      priceField.value = moneyFormatter.format(equipmentPrice).replace(/[\u00a0\u202f]/g, " ");
    } else if (priceField.dataset.manualPrice !== undefined) {
      priceField.value = priceField.dataset.manualPrice;
      delete priceField.dataset.manualPrice;
    }
    const quantity = readNumber(row.querySelector(".item-quantity").value);
    const price = roundAmount(readNumber(priceField.value));
    const product = quantity * price;
    // Округляем каждую строку до двух знаков, чтобы итог совпадал с видимыми суммами.
    const amount = roundAmount(product);
    row.querySelector(".item-total").textContent = formatMoney(amount);
    const nextTotal = roundAmount(total + amount);
    if (Number.isFinite(nextTotal)) total = nextTotal;
  }
  if (!automaticDiscountActive) manualDiscountRate = discountRate.value;
  automaticDiscountActive = automaticPricing;
  discountRate.readOnly = automaticPricing;
  discountRate.value = automaticPricing ? String(equipmentCount >= 30 ? 20 : equipmentCount >= 10 ? 10 : 0) : manualDiscountRate;
  document.querySelector("#equipment-count").textContent = equipmentCount.toLocaleString("ru-RU");
  document.querySelector("#equipment-pricing-row").hidden = !automaticPricing;
  document.querySelector("#equipment-pricing").textContent = automaticPricing ? `${equipmentCount >= 10 ? "Оптовая" : "Розничная"}: ${formatMoney(equipmentPrice)}/шт.` : "";
  document.querySelector("#discount-percent").textContent = String(readNumber(discountRate.value));
  const discount = roundAmount(total * (readNumber(discountRate.value) / 100));
  const discounted = roundAmount(total - discount);
  const vat = roundAmount(discounted * (readNumber(vatRate.value) / 100));
  document.querySelector("#subtotal").textContent = formatMoney(total);
  showSummaryAmount("#discount-amount", "#discount-row", discount);
  document.querySelector("#discount-row").hidden = false;
  showSummaryAmount("#discounted-amount", "#discounted-row", discounted);
  showSummaryAmount("#vat-amount", "#vat-row", vat);
  const payable = roundAmount(discounted + vat);
  totalOutput.textContent = formatMoney(payable);
  const words = currency.value === "₸" ? amountInWords(payable) : "";
  amountWords.hidden = !words;
  amountWords.textContent = words ? `Сумма прописью: ${words}` : "";
  if (draftReady) saveDraft();
}

function updateRowLabels() {
  Array.from(items.rows).forEach((row, index) => {
    row.querySelector(".item-price").closest("td").dataset.label = `Цена, ${currency.value}`;
    row.querySelector(".remove-button").setAttribute("aria-label", `Удалить позицию ${index + 1}`);
    row.querySelectorAll("input, select").forEach((field) => {
      const label = field.matches(".item-type") ? "Тип оборудования" : field.closest("td").dataset.label;
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
items.addEventListener("change", recalculate);
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
    value.textContent = field.type === "date" ? formattedDate : field.matches(".item-price") ? formatMoney(readNumber(field.value)) : field.matches(".item-type") ? field.selectedOptions[0].textContent : field.value;
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
  if (automaticDiscountActive) fields["discount-rate"] = manualDiscountRate;
  const positions = Array.from(items.rows, (row) => ({
    name: row.querySelector(".item-name").value,
    quantity: row.querySelector(".item-quantity").value,
    unit: row.querySelector(".item-unit").value,
    price: row.querySelector(".item-price").value,
    manualPrice: row.querySelector(".item-price").dataset.manualPrice,
    type: row.querySelector(".item-type").value,
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
        ["шт", "час", "услуга"].includes(position.unit) &&
        (position.manualPrice === undefined || typeof position.manualPrice === "string") &&
        (position.type === undefined || ["other", "computer", "laptop"].includes(position.type)));
    if (!valid) throw new Error("Invalid draft");
    draftFieldIds.forEach((id) => { document.getElementById(id).value = draft.fields[id]; });
    items.replaceChildren();
    draft.positions.forEach((position) => {
      const row = addItem(false);
      row.querySelector(".item-name").value = position.name;
      row.querySelector(".item-quantity").value = position.quantity;
      row.querySelector(".item-unit").value = position.unit;
      row.querySelector(".item-price").value = position.price;
      if (position.manualPrice !== undefined) row.querySelector(".item-price").dataset.manualPrice = position.manualPrice;
      row.querySelector(".item-type").value = position.type || "other";
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
  manualDiscountRate = "0";
  automaticDiscountActive = false;
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
  lines.push("", `Компьютеры и ноутбуки: ${document.querySelector("#equipment-count").textContent} шт.`, `Сумма до скидки: ${document.querySelector("#subtotal").textContent}`);
  if (!document.querySelector("#equipment-pricing-row").hidden) lines.push(`Цена техники: ${document.querySelector("#equipment-pricing").textContent}`);
  for (const [rowId, outputId, label] of [
    ["discount-row", "discount-amount", `Скидка (${readNumber(discountRate.value)}%)`],
    ["discounted-row", "discounted-amount", "Сумма со скидкой"],
    ["vat-row", "vat-amount", "НДС"],
  ]) {
    if (!document.getElementById(rowId).hidden) lines.push(`${label}: ${document.getElementById(outputId).textContent}`);
  }
  lines.push(`Итого к оплате: ${totalOutput.textContent}`);
  if (!amountWords.hidden) lines.push(amountWords.textContent);
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
