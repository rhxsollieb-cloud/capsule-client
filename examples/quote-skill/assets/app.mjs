const form = document.getElementById("quote-form");
const quantity = document.getElementById("quantity");
const price = document.getElementById("unit-price");
const amount = document.getElementById("amount");
const status = document.getElementById("status");
const save = document.getElementById("save");
const notice = document.getElementById("notice");
const message = document.getElementById("message");
const reload = document.getElementById("reload");
const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" });
let base;
let remote;
let saving = false;
let polling = false;
let error = "";
let connectionError = "";

function draft() {
  if (!/^\d+$/.test(quantity.value) || !/^\d+(?:\.\d{1,2})?$/.test(price.value)) return null;
  const count = Number(quantity.value);
  const cents = Math.round(Number(price.value) * 100);
  if (!Number.isSafeInteger(count) || count > 1000000 || !Number.isSafeInteger(cents) || cents > 1000000000) return null;
  return { quantity: count, unitPrice: (cents / 100).toFixed(2) };
}

function dirty() {
  const value = draft();
  return Boolean(base && (!value || value.quantity !== base.quantity || value.unitPrice !== base.unitPrice));
}

function render() {
  const value = draft();
  amount.textContent = value ? currency.format(value.quantity * Number(value.unitPrice)) : "—";
  save.hidden = !dirty() && !saving;
  save.disabled = saving || !value;
  status.textContent = saving ? "保存中…" : dirty() ? "未保存" : base ? "已保存" : "正在连接…";
  status.className = dirty() ? "dirty" : "";
  status.title = base ? `版本 ${base.version} · ${new Date(base.updatedAt).toLocaleString("zh-CN")}` : "";
  message.textContent = error || connectionError || (remote ? "其他位置已保存新报价，当前输入已保留。" : "");
  notice.hidden = !message.textContent;
  reload.hidden = !remote || saving;
}

function accept(value, keepInput = false) {
  base = value;
  if (!keepInput) { quantity.value = String(value.quantity); price.value = value.unitPrice; }
  if (remote?.version <= value.version) remote = undefined;
  quantity.disabled = false;
  price.disabled = false;
  render();
}

async function request(options) {
  const response = await fetch("./api/state", { cache: "no-store", ...options });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || "报价读取失败"), { status: response.status });
  return value;
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const value = await request();
    connectionError = "";
    if (!base || value.version > base.version) {
      if (!dirty() && !saving) { error = ""; accept(value); }
      else { remote = value; render(); }
    }
    render();
  } catch (cause) { connectionError = cause.message; render(); }
  finally { polling = false; }
}

quantity.addEventListener("input", () => { error = ""; render(); });
price.addEventListener("input", () => { error = ""; render(); });
reload.addEventListener("click", () => {
  if (!remote || saving) return;
  error = "";
  accept(remote);
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const sent = draft();
  if (!base || saving || !sent || !dirty()) return;
  const before = { quantity: quantity.value, price: price.value };
  saving = true;
  error = "";
  render();
  try {
    const value = await request({
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sent, version: base.version }),
    });
    const changed = quantity.value !== before.quantity || price.value !== before.price;
    accept(value, changed);
  } catch (cause) {
    error = cause.message;
    if (cause.status === 409) await poll();
  } finally { saving = false; render(); }
});

await poll();
setInterval(poll, 1000);
