"use strict";

const items = document.querySelector("#items");
const template = document.querySelector("#item-template");
const totalOutput = document.querySelector("#total");
const rowStatus = document.querySelector("#row-status");
const discountRate = document.querySelector("#discount-rate");
const vatRate = document.querySelector("#vat-rate");
const currency = document.querySelector("#currency");
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
