import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { children, classList, parseSelector, queryPath, stripRawText, textOf } from "../scripts/html-select.ts";
import {
  extractFromPage,
  fillAll,
  fillLabel,
  urlForLabel,
  RESULT_SELECTOR,
  type LabelsFile,
} from "../scripts/fill-emojis.ts";
import { fetchPage, type Fetcher } from "../scripts/scrape-emojidb.ts";

/** Reproduz a estrutura da página do emojidb: main > .emoji-list > div > .emoji */
function page(emojis: string[], { rows = 1 } = {}): string {
  const cells = emojis.map((e) => `<div class="emoji copy" title="copiar">${e}</div>`);
  const groups = rows === 1 ? [cells.join("")] : cells.map((c) => c);
  return `<!doctype html><html><head><title>x</title>
<script>var ui = "\u{1F480}";</script></head>
<body><header><div class="emoji">⚙️</div></header>
<main><h1>emojis</h1>
  <div class="emoji-list">${groups.map((g) => `<div class="row">${g}</div>`).join("\n")}</div>
</main>
<footer><div class="emoji">💀</div></footer></body></html>`;
}

// --- seletor ---------------------------------------------------------------

test("classList aceita aspas duplas, simples e sem aspas", () => {
  assert.deepEqual(classList('class="a b"'), ["a", "b"]);
  assert.deepEqual(classList("class='a  b'"), ["a", "b"]);
  assert.deepEqual(classList("class=a"), ["a"]);
  assert.deepEqual(classList('id="x"'), []);
});

test("children devolve apenas filhos diretos", () => {
  const els = children('<div id="a"><span>1</span></div><p>2</p>');
  assert.deepEqual(els.map((e) => e.tag), ["div", "p"]);
  assert.equal(els[0]!.inner, "<span>1</span>");
});

test("children ignora tags vazias e auto-fechadas", () => {
  const els = children('<div>a<br><img src="x">b</div><hr>');
  assert.deepEqual(els.map((e) => e.tag), ["div"]);
});

test("stripRawText neutraliza script, style e comentarios preservando tamanho", () => {
  const html = '<div>a</div><script>var x="💀"</script><!-- 💀 -->';
  const clean = stripRawText(html);
  assert.equal(clean.length, html.length);
  assert.ok(!clean.includes("💀"));
});

test("parseSelector quebra o caminho em passos com tag e classe", () => {
  assert.deepEqual(parseSelector("body > main > div.emoji-list > div > div.emoji"), [
    { tag: "body" },
    { tag: "main" },
    { tag: "div", className: "emoji-list" },
    { tag: "div" },
    { tag: "div", className: "emoji" },
  ]);
  assert.throws(() => parseSelector("  "), /seletor vazio/);
});

test("queryPath respeita o caminho de filhos diretos", () => {
  const html = page(["📊", "📈"]);
  assert.deepEqual(queryPath(html, RESULT_SELECTOR).map(textOf), ["📊", "📈"]);
  // um caminho que não existe não casa nada
  assert.deepEqual(queryPath(html, "body > main > div.emoji-list > div.emoji"), []);
});

test("queryPath nao pega .emoji fora do caminho (header, footer, script)", () => {
  const found = queryPath(page(["📊"]), RESULT_SELECTOR).map(textOf);
  assert.deepEqual(found, ["📊"]);
  assert.ok(!found.includes("⚙️"));
  assert.ok(!found.includes("💀"));
});

// --- extração --------------------------------------------------------------

test("extractFromPage pega os 5 primeiros na ordem da pagina", () => {
  const html = page(["📊", "📈", "📉", "🧮", "🗃️", "📋", "💹"]);
  assert.deepEqual(extractFromPage(html), ["📊", "📈", "📉", "🧮", "🗃️"]);
  assert.deepEqual(extractFromPage(html, 2), ["📊", "📈"]);
});

test("extractFromPage atravessa varias linhas da grade", () => {
  assert.deepEqual(extractFromPage(page(["📊", "📈", "📉"], { rows: 3 })), ["📊", "📈", "📉"]);
});

test("extractFromPage preserva ZWJ, tom de pele, bandeira e keycap", () => {
  assert.deepEqual(extractFromPage(page(["🧑‍💼", "👍🏽", "🇧🇷", "1️⃣"])), ["🧑‍💼", "👍🏽", "🇧🇷", "1️⃣"]);
});

test("extractFromPage isola o emoji quando a celula tem texto junto", () => {
  const html = `<body><main><div class="emoji-list"><div>
    <div class="emoji">📊<span class="sr-only">grafico</span></div>
    <div class="emoji">copiar 📈</div>
    <div class="emoji">sem emoji</div>
  </div></div></main></body>`;
  assert.deepEqual(extractFromPage(html), ["📊", "📈"]);
});

test("extractFromPage remove duplicatas e devolve vazio sem grade", () => {
  assert.deepEqual(extractFromPage(page(["📊", "📊", "📈"])), ["📊", "📈"]);
  assert.deepEqual(extractFromPage("<body><main><p>nada</p></main></body>"), []);
});

test("extractFromPage cai para o seletor de reserva se o caminho mudar", () => {
  const semMain = `<body><section><div class="emoji-list"><div><div class="emoji">📊</div></div></div></section></body>`;
  assert.deepEqual(extractFromPage(semMain), ["📊"]);
});

test("extractFromPage decodifica entidades HTML", () => {
  const html = `<body><main><div class="emoji-list"><div><div class="emoji">&#x1F4CA;</div></div></div></main></body>`;
  assert.deepEqual(extractFromPage(html), ["📊"]);
});

// --- URL -------------------------------------------------------------------

test("urlForLabel monta a URL do emojidb com o utm", () => {
  assert.equal(urlForLabel("money"), "https://emojidb.org/money-emojis?utm_source=user_search");
  assert.equal(urlForLabel("order_placed"), "https://emojidb.org/order-placed-emojis?utm_source=user_search");
  assert.throws(() => urlForLabel("___"), /label invalido/);
});

// --- pipeline --------------------------------------------------------------

test("fillLabel classifica ok, empty e error", async () => {
  const fetcher: Fetcher = async (url) => {
    if (url.includes("order-placed")) return page(["🛒", "🧾", "📦"]);
    if (url.includes("vazio")) return "<body><main></main></body>";
    throw new Error("ECONNRESET");
  };
  const ok = await fillLabel("order_placed", fetcher);
  assert.equal(ok.status, "ok");
  assert.deepEqual(ok.emoji, ["🛒", "🧾", "📦"]);

  assert.equal((await fillLabel("vazio", fetcher)).status, "empty");

  const err = await fillLabel("outro", fetcher);
  assert.equal(err.status, "error");
  assert.match(err.error!, /ECONNRESET/);
});

test("fillAll de ponta a ponta sobre HTTP, com a URL e o seletor reais", async () => {
  const recebidas: string[] = [];
  const server: Server = createServer((req, res) => {
    recebidas.push(req.url ?? "");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page(["🛒", "🧾", "📦", "✅", "💳", "🔔"]));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;

  const results = await fillAll(["order_placed", "payment_failed"], (u) => fetchPage(u), { delayMs: 0, base });

  assert.deepEqual(results.map((r) => r.status), ["ok", "ok"]);
  assert.deepEqual(results[0]!.emoji, ["🛒", "🧾", "📦", "✅", "💳"], "deve guardar os 5 primeiros");
  assert.deepEqual(recebidas, [
    "/order-placed-emojis?utm_source=user_search",
    "/payment-failed-emojis?utm_source=user_search",
  ]);

  await new Promise<void>((r) => server.close(() => r()));
});

// --- integridade do catálogo ----------------------------------------------

test("canonical_labels.json esta integro e pronto para o preenchimento", () => {
  const file = JSON.parse(
    readFileSync(new URL("../data/canonical_labels.json", import.meta.url), "utf8"),
  ) as LabelsFile;

  const modulos = new Set(file.modules);
  const labels = Object.entries(file.labels);
  assert.ok(labels.length > 200, `esperado catalogo amplo, veio ${labels.length}`);

  const sinonimos = new Map<string, string>();
  for (const [label, entry] of labels) {
    assert.match(label, /^[a-z][a-z0-9_]*$/, `label fora do padrao: ${label}`);
    assert.doesNotThrow(() => urlForLabel(label), `label sem URL valida: ${label}`);
    assert.ok(entry.description.trim().length > 10, `descricao curta em ${label}`);
    assert.ok(entry.modules.length > 0, `sem modulos em ${label}`);
    for (const m of entry.modules) assert.ok(modulos.has(m), `modulo desconhecido em ${label}: ${m}`);
    assert.ok(entry.synonyms.length >= 2, `poucos sinonimos em ${label}`);
    assert.ok(Array.isArray(entry.emoji), `emoji deve ser lista em ${label}`);
    for (const s of entry.synonyms) {
      const anterior = sinonimos.get(s);
      assert.equal(anterior, undefined, `sinonimo "${s}" repetido entre ${anterior} e ${label}`);
      sinonimos.set(s, label);
    }
  }

  // todos os módulos declarados são efetivamente usados
  const usados = new Set(labels.flatMap(([, e]) => e.modules));
  assert.deepEqual([...modulos].filter((m) => !usados.has(m)), [], "modulo declarado e nao usado");
});
