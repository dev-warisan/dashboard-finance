// Run from the repository root with: osascript -l JavaScript tests/run-tests.js
ObjC.import("Foundation");

const currentDirectory = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const htmlPath = currentDirectory + "/index-6.html";
const html = $.NSString.stringWithContentsOfFileEncodingError(
  htmlPath,
  $.NSUTF8StringEncoding,
  null
);

if (!html) throw new Error("Could not read index-6.html from the repository root.");

const match = html.js.match(/<script>\s*([\s\S]*?)<\/script>/);
if (!match) throw new Error("Could not find the inline application script.");

const browserStubs = `
globalThis.__elements = {};
function __makeElement() {
  return {
    value: "",
    innerHTML: "",
    textContent: "",
    disabled: false,
    dataset: {},
    selectedOptions: [],
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild() {},
    remove() {},
    click() {},
    getContext() { return {}; }
  };
}
globalThis.document = {
  querySelector(selector) {
    if (!__elements[selector]) __elements[selector] = __makeElement();
    return __elements[selector];
  },
  querySelectorAll() { return []; },
  createElement() { return __makeElement(); },
  addEventListener() {},
  head: __makeElement()
};
globalThis.window = { scrollTo() {}, Chart: null };
globalThis.localStorage = {
  values: {},
  getItem(key) { return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null; },
  setItem(key, value) { this.values[key] = String(value); },
  removeItem(key) { delete this.values[key]; }
};
globalThis.setTimeout = function() {};
globalThis.confirm = function() { return true; };
globalThis.location = { reload() {} };
`;

eval(
  browserStubs +
    match[1] +
    `
globalThis.__warisanTestApi = {
  get db() { return DB; },
  set db(value) { DB = value; },
  get elements() { return __elements; },
  element: selector => $(selector),
  saveSale,
  deleteSale,
  saveMutasi,
  deleteMutasi,
  runRekon,
  setRekon,
  loadDB,
  renderLaporan,
  jwtIsActive,
  saveProduct,
  deleteProduct
};
`
);

const app = globalThis.__warisanTestApi;
const elements = app.elements;
const storage = globalThis.localStorage;
const checks = [];
const element = selector => app.element(selector);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

function test(name, fn) {
  try {
    fn();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error.message });
  }
}

function reset(db) {
  app.db = db;
  storage.values = {};
  Object.keys(elements).forEach(key => {
    const element = elements[key];
    element.value = "";
    element.innerHTML = "";
    element.textContent = "";
    element.disabled = false;
    element.dataset = {};
    element.selectedOptions = [];
  });
  globalThis.confirm = function() { return true; };
}

function savedDB() {
  return JSON.parse(storage.getItem("warisan_db_v1"));
}

test("saving a sale decrements stock, records the sale, and persists both changes", function() {
  const product = { id: "p1", nama: "Kopi", kategori: "Minuman", harga: 12000, stok: 5 };
  reset({ gerai: ["Gerai 1"], produk: [product], sales: [], mutasi: [], rekon: [] });
  element("#fSaleProduk").value = "Kopi";
  element("#fSaleProduk").selectedOptions = [{ dataset: { harga: "12000" } }];
  element("#fSaleQty").value = "2";
  element("#fSaleDate").value = "2026-10-05";
  element("#fSaleGerai").value = "Gerai 1";
  element("#fSaleMetode").value = "QRIS";

  app.saveSale();

  equal(product.stok, 3, "remaining stock");
  equal(app.db.sales.length, 1, "sale count");
  equal(app.db.sales[0].qty * app.db.sales[0].harga, 24000, "sale total");
  equal(savedDB().produk[0].stok, 3, "persisted remaining stock");
  equal(savedDB().sales[0].produk, "Kopi", "persisted sale product");
});

test("rejecting an over-stock sale leaves stock and sales unchanged", function() {
  const product = { id: "p1", nama: "Kopi", kategori: "Minuman", harga: 12000, stok: 1 };
  const sales = [];
  reset({ gerai: ["Gerai 1"], produk: [product], sales, mutasi: [], rekon: [] });
  element("#fSaleProduk").value = "Kopi";
  element("#fSaleProduk").selectedOptions = [{ dataset: { harga: "12000" } }];
  element("#fSaleQty").value = "2";

  app.saveSale();

  equal(product.stok, 1, "stock after rejected sale");
  equal(sales.length, 0, "sales after rejected sale");
  equal(storage.getItem("warisan_db_v1"), null, "saved data after rejected sale");
});

test("saving a bank mutation trims its description and applies outgoing sign", function() {
  reset({ gerai: [], produk: [], sales: [], mutasi: [], rekon: [] });
  element("#fMutKet").value = "  Biaya admin  ";
  element("#fMutNominal").value = "1500";
  element("#fMutJenis").value = "keluar";
  element("#fMutBank").value = "BCA";

  app.saveMutasi();

  equal(app.db.mutasi.length, 1, "mutation count");
  equal(app.db.mutasi[0].ket, "Biaya admin", "trimmed description");
  equal(app.db.mutasi[0].nominal, -1500, "outgoing amount");
  equal(savedDB().mutasi[0].nominal, -1500, "persisted outgoing amount");
});

test("invalid bank mutations do not modify or persist data", function() {
  const mutations = [];
  reset({ gerai: [], produk: [], sales: [], mutasi: mutations, rekon: [] });
  element("#fMutKet").value = "   ";
  element("#fMutNominal").value = "0";

  app.saveMutasi();

  equal(mutations.length, 0, "mutation count");
  equal(storage.getItem("warisan_db_v1"), null, "saved data");
});

test("JWT activation requires a finite numeric expiry that has not passed", function() {
  const now = 1_800_000_000_000;
  assert(app.jwtIsActive({ exp: now / 1000 + 60 }, now), "future expiry should be accepted");
  assert(app.jwtIsActive({ exp: now / 1000 }, now), "expiry at the current instant should be accepted");
  assert(!app.jwtIsActive({ exp: now / 1000 - 1 }, now), "past expiry should be rejected");
  assert(!app.jwtIsActive({}, now), "missing expiry should be rejected");
  assert(!app.jwtIsActive({ exp: "1800000060" }, now), "string expiry should be rejected");
  assert(!app.jwtIsActive({ exp: Infinity }, now), "non-finite expiry should be rejected");
});

test("automatic reconciliation matches only pending items to exact transfer totals", function() {
  const pendingMatch = { id: "r1", nominal: 24000, status: "pending" };
  const pendingMiss = { id: "r2", nominal: 25000, status: "pending" };
  const alreadyMatched = { id: "r3", nominal: 24000, status: "cocok" };
  reset({
    gerai: [],
    produk: [],
    sales: [
      { id: "s1", qty: 2, harga: 12000, metode: "Transfer" },
      { id: "s2", qty: 1, harga: 25000, metode: "QRIS" }
    ],
    mutasi: [],
    rekon: [pendingMatch, pendingMiss, alreadyMatched]
  });

  app.runRekon();

  equal(pendingMatch.status, "cocok", "exact transfer match");
  equal(pendingMiss.status, "pending", "non-transfer amount remains pending");
  equal(alreadyMatched.status, "cocok", "existing match remains unchanged");
  equal(savedDB().rekon[0].status, "cocok", "persisted reconciliation");
});

test("manual reconciliation updates and persists the requested status", function() {
  const item = { id: "r1", status: "pending", nominal: 4000 };
  reset({ gerai: [], produk: [], sales: [], mutasi: [], rekon: [item] });

  app.setRekon("r1", "selisih");

  equal(item.status, "selisih", "updated status");
  equal(savedDB().rekon[0].status, "selisih", "persisted status");
});

test("reports include both date boundaries and calculate totals from the filtered sales", function() {
  reset({
    gerai: [],
    produk: [],
    sales: [
      { id: "s1", tanggal: "2026-10-01", gerai: "Gerai 1", produk: "Teh", qty: 2, harga: 10000, metode: "Tunai" },
      { id: "s2", tanggal: "2026-10-03", gerai: "Gerai 2", produk: "Kopi", qty: 1, harga: 15000, metode: "Transfer" },
      { id: "s3", tanggal: "2026-10-04", gerai: "Gerai 1", produk: "Roti", qty: 1, harga: 30000, metode: "QRIS" }
    ],
    mutasi: [],
    rekon: []
  });
  element("#repFrom").value = "2026-10-01";
  element("#repTo").value = "2026-10-03";

  app.renderLaporan();

  assert(element("#reportStats").innerHTML.includes("Rp 35.000"), "report total should include both boundary dates");
  assert(element("#reportStats").innerHTML.includes("<h3>2</h3>"), "report should count only the filtered sales");
  assert(element("#reportStats").innerHTML.includes("Gerai 1"), "report should select the highest-grossing included store");
  equal(app.db.sales.length, 3, "source sales remain intact");
});

test("loading malformed saved data recovers with and persists seeded data", function() {
  reset({ gerai: [], produk: [], sales: [], mutasi: [], rekon: [] });
  storage.setItem("warisan_db_v1", "{invalid json");

  app.loadDB();

  equal(app.db.gerai.length, 4, "seeded store count");
  equal(app.db.produk.length, 8, "seeded product count");
  equal(savedDB().sales.length, 6, "persisted seeded sales");
  equal(savedDB().mutasi.length, 6, "persisted seeded mutations");
});

test("creating and editing products writes validated fields", function() {
  const product = { id: "p1", nama: "Kopi", kategori: "Minuman", harga: 10000, stok: 4 };
  reset({ gerai: [], produk: [product], sales: [], mutasi: [], rekon: [] });
  element("#fProdNama").value = "  Kopi Susu ";
  element("#fProdKat").value = "Minuman";
  element("#fProdHarga").value = "15000";
  element("#fProdStok").value = "8";

  app.saveProduct("p1");

  equal(product.nama, "Kopi Susu", "updated product name");
  equal(product.harga, 15000, "updated product price");
  equal(savedDB().produk[0].stok, 8, "persisted product stock");

  element("#fProdNama").value = "Teh";
  element("#fProdKat").value = "Minuman";
  element("#fProdHarga").value = "5000";
  element("#fProdStok").value = "12";
  app.saveProduct();

  equal(app.db.produk.length, 2, "product count after creating a product");
  equal(savedDB().produk[1].nama, "Teh", "persisted new product");
});

test("invalid product details do not create or persist a product", function() {
  const products = [];
  reset({ gerai: [], produk: products, sales: [], mutasi: [], rekon: [] });
  element("#fProdNama").value = "Teh";
  element("#fProdHarga").value = "0";
  element("#fProdStok").value = "3";

  app.saveProduct();

  equal(products.length, 0, "product count");
  equal(storage.getItem("warisan_db_v1"), null, "saved data");
});

test("delete operations respect confirmation before mutating data", function() {
  const sale = { id: "s1", qty: 1, harga: 1000, tanggal: "2026-10-05", gerai: "Gerai 1", produk: "Teh", metode: "Tunai" };
  const mutation = { id: "m1", tanggal: "2026-10-05", waktu: "10:00", bank: "BCA", ket: "Setoran", nominal: 1000 };
  const product = { id: "p1", nama: "Teh", kategori: "Minuman", harga: 1000, stok: 2 };
  reset({ gerai: [], produk: [product], sales: [sale], mutasi: [mutation], rekon: [] });
  globalThis.confirm = function() { return false; };

  app.deleteSale("s1");
  app.deleteMutasi("m1");
  app.deleteProduct("p1");

  equal(app.db.sales.length, 1, "sales after cancellation");
  equal(app.db.mutasi.length, 1, "mutations after cancellation");
  equal(app.db.produk.length, 1, "products after cancellation");

  globalThis.confirm = function() { return true; };
  app.deleteSale("s1");
  app.deleteMutasi("m1");
  app.deleteProduct("p1");

  equal(app.db.sales.length, 0, "sales after confirmation");
  equal(app.db.mutasi.length, 0, "mutations after confirmation");
  equal(app.db.produk.length, 0, "products after confirmation");
  equal(savedDB().produk.length, 0, "persisted product deletion");
});

const failed = checks.filter(check => !check.passed);
if (failed.length) {
  throw new Error(
    checks
      .map(check => (check.passed ? "PASS " : "FAIL ") + check.name + (check.error ? " — " + check.error : ""))
      .join("\n")
  );
}

JSON.stringify({ passed: checks.length, failed: failed.length, tests: checks.map(check => check.name) });
