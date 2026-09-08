import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyResults,
  buildQueryUrl,
  decodeEntities,
  extractEmojis,
  fetchPage,
  formatReport,
  HttpError,
  parseArgs,
  queryForEntry,
  scrapeAll,
  scrapeEntry,
  toCodepoints,
  withCache,
  type Fetcher,
} from "../scripts/scrape-emojidb.ts";
import type { EmojiEntry, EmojiLibraryFile } from "../src/types.ts";

const entry = (key: string, emoji: string): EmojiEntry => ({
  key,
  emoji,
  codepoint: toCodepoints(emoji),
  kind: "entity",
  aliases: [],
  description: "",
});

/** Página no formato que o emojidb serve: grade de nós `class="emoji"`. */
function page(emojis: string[]): string {
  return `<!doctype html><html><head><title>x</title>
    <script>var icon = "\u{1F480}";</script>
    <style>.emoji{font-size:2em}</style></head>
    <body><header>⚙️ Menu</header>
    <div class="emoji-list">
      ${emojis.map((e) => `<div class="emoji copy" data-x="1">${e}</div>`).join("\n")}
    </div></body></html>`;
}

test("buildQueryUrl normaliza acentos e espacos", () => {
  assert.equal(buildQueryUrl("Fluxo de Caixa"), "https://emojidb.org/fluxo-de-caixa-emojis");
  assert.equal(buildQueryUrl("fatura"), "https://emojidb.org/fatura-emojis");
  assert.throws(() => buildQueryUrl("   "), /termo vazio/);
});

test("queryForEntry deriva a consulta da chave curta", () => {
  assert.equal(queryForEntry(entry("value.trend_up", "📈")), "trend up");
  assert.equal(queryForEntry(entry("entity.invoice", "💳")), "invoice");
});

test("extractEmojis pega os resultados em ordem, sem ruido de script/style/header", () => {
  const html = page(["💳", "🧾", "💰"]);
  assert.deepEqual(extractEmojis(html), ["💳", "🧾", "💰"]);
  assert.ok(!extractEmojis(html).includes("💀")); // veio de <script>
  assert.ok(!extractEmojis(html).includes("⚙️")); // veio do <header>, fora da grade
});

test("extractEmojis preserva sequencias ZWJ, tons de pele, bandeiras e keycaps", () => {
  assert.deepEqual(extractEmojis(page(["🧑‍💼", "👍🏽", "🇧🇷", "1️⃣"])), ["🧑‍💼", "👍🏽", "🇧🇷", "1️⃣"]);
});

test("extractEmojis remove duplicatas e respeita o top", () => {
  assert.deepEqual(extractEmojis(page(["💳", "💳", "🧾", "💰"])), ["💳", "🧾", "💰"]);
  assert.deepEqual(extractEmojis(page(["💳", "🧾", "💰"]), 2), ["💳", "🧾"]);
});

test("extractEmojis cai para varredura da pagina se o markup mudar", () => {
  const semClasse = `<body><ul><li><span>💳</span></li><li><span>🧾</span></li></ul></body>`;
  assert.deepEqual(extractEmojis(semClasse), ["💳", "🧾"]);
});

test("extractEmojis decodifica entidades HTML", () => {
  assert.deepEqual(extractEmojis(`<div class="emoji">&#x1F4B3;</div>`), ["💳"]);
  assert.equal(decodeEntities("&amp;&#39;"), "&'");
});

test("extractEmojis devolve vazio para pagina sem emoji", () => {
  assert.deepEqual(extractEmojis("<body><p>nada aqui</p></body>"), []);
});

test("toCodepoints formata sequencias", () => {
  assert.equal(toCodepoints("💳"), "U+1F4B3");
  assert.equal(toCodepoints("🧑‍💼"), "U+1F9D1 U+200D U+1F4BC");
});

test("parseArgs le flags e valores", () => {
  const o = parseArgs(["--write", "--delay=0", "--limit=5", "--key=entity.invoice", "--no-cache"]);
  assert.equal(o.write, true);
  assert.equal(o.delayMs, 0);
  assert.equal(o.limit, 5);
  assert.equal(o.key, "entity.invoice");
  assert.equal(o.cache, null);
  assert.equal(parseArgs([]).write, false);
  assert.throws(() => parseArgs(["--delay=abc"]), /--delay invalido/);
});

test("scrapeEntry classifica match, diff, absent e empty", async () => {
  const fetcher: Fetcher = async (url) => {
    if (url.includes("invoice")) return page(["💳", "🧾"]);
    if (url.includes("stock")) return page(["📦", "🏬"]); // atual 🏬 aparece em #2
    if (url.includes("goal")) return page(["🥅", "⚽"]); // atual 🎯 fora do ranking
    return page([]);
  };

  const match = await scrapeEntry(entry("entity.invoice", "💳"), fetcher);
  assert.equal(match.status, "match");
  assert.equal(match.currentRank, 1);

  const diff = await scrapeEntry(entry("entity.stock", "🏬"), fetcher);
  assert.equal(diff.status, "diff");
  assert.equal(diff.canonical, "📦");
  assert.equal(diff.currentRank, 2);

  const absent = await scrapeEntry(entry("entity.goal", "🎯"), fetcher);
  assert.equal(absent.status, "absent");
  assert.equal(absent.currentRank, null);

  const empty = await scrapeEntry(entry("entity.other", "🔧"), fetcher);
  assert.equal(empty.status, "empty");
  assert.equal(empty.canonical, null);
});

test("scrapeEntry captura erro de rede sem interromper o lote", async () => {
  const boom: Fetcher = async () => {
    throw new Error("ECONNRESET");
  };
  const results = await scrapeAll([entry("entity.invoice", "💳"), entry("entity.stock", "🏬")], boom, {
    delayMs: 0,
  });
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.status === "error"));
  assert.match(results[0]!.error!, /ECONNRESET/);
});

test("applyResults so altera diff e absent, e atualiza o codepoint", () => {
  const file: EmojiLibraryFile = {
    version: "1.0.0",
    source: "",
    namespaces: { value: "", phrase: "", entity: "" },
    emojis: [entry("entity.invoice", "💳"), entry("entity.stock", "🏬"), entry("entity.goal", "🎯")],
  };
  const changed = applyResults(file, [
    { key: "entity.invoice", query: "", url: "", current: "💳", canonical: "💳", candidates: [], status: "match", currentRank: 1 },
    { key: "entity.stock", query: "", url: "", current: "🏬", canonical: "🧑‍💼", candidates: [], status: "diff", currentRank: 2 },
    { key: "entity.goal", query: "", url: "", current: "🎯", canonical: null, candidates: [], status: "error", currentRank: null },
  ]);
  assert.equal(changed, 1);
  assert.equal(file.emojis[0]!.emoji, "💳");
  assert.equal(file.emojis[1]!.emoji, "🧑‍💼");
  assert.equal(file.emojis[1]!.codepoint, "U+1F9D1 U+200D U+1F4BC");
  assert.equal(file.emojis[2]!.emoji, "🎯"); // erro nao vira decisao
});

test("formatReport omite os iguais e resume o lote", () => {
  const out = formatReport([
    { key: "entity.invoice", query: "", url: "", current: "💳", canonical: "💳", candidates: [], status: "match", currentRank: 1 },
    { key: "entity.stock", query: "", url: "u", current: "🏬", canonical: "📦", candidates: ["📦", "🏬"], status: "diff", currentRank: 2 },
  ]);
  assert.ok(!out.includes("entity.invoice"));
  assert.ok(out.includes("entity.stock"));
  assert.match(out, /1 iguais, 1 divergentes/);
});

// --- integração real sobre HTTP -------------------------------------------

async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

test("fetchPage: sucesso, 404 definitivo e retentativa em 503", async () => {
  let hits503 = 0;
  const server = createServer((req, res) => {
    if (req.url === "/ok-emojis") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(page(["💳", "🧾"]));
    }
    if (req.url === "/flaky-emojis") {
      if (++hits503 === 1) {
        res.writeHead(503);
        return res.end("indisponivel");
      }
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(page(["💰"]));
    }
    res.writeHead(404);
    res.end("nao encontrado");
  });
  const base = await listen(server);

  assert.deepEqual(extractEmojis(await fetchPage(`${base}/ok-emojis`)), ["💳", "🧾"]);

  await assert.rejects(() => fetchPage(`${base}/sumiu-emojis`), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal((err as HttpError).status, 404);
    return true;
  });

  assert.deepEqual(extractEmojis(await fetchPage(`${base}/flaky-emojis`)), ["💰"]);
  assert.equal(hits503, 2, "deve ter repetido a requisicao uma vez");

  await new Promise<void>((r) => server.close(() => r()));
});

test("scrapeAll de ponta a ponta sobre HTTP, com cache em disco", async () => {
  let requests = 0;
  const catalogo: Record<string, string[]> = {
    "/invoice-emojis": ["💳", "🧾"],
    "/stock-emojis": ["📦", "🏬"],
  };
  const server = createServer((req, res) => {
    requests++;
    const hit = catalogo[req.url ?? ""];
    if (!hit) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page(hit));
  });
  const base = await listen(server);

  const dir = mkdtempSync(join(tmpdir(), "chappiemojis-cache-"));
  const fetcher = withCache((url) => fetchPage(url), dir);
  const entries = [entry("entity.invoice", "💳"), entry("entity.stock", "🏬")];

  const first = await scrapeAll(entries, fetcher, { delayMs: 0, base });
  assert.deepEqual(first.map((r) => r.status), ["match", "diff"]);
  assert.equal(first[1]!.canonical, "📦");
  assert.equal(requests, 2);

  // segunda passada sai inteira do cache
  const second = await scrapeAll(entries, fetcher, { delayMs: 0, base });
  assert.deepEqual(second.map((r) => r.canonical), first.map((r) => r.canonical));
  assert.equal(requests, 2, "o cache deve evitar novas requisicoes");

  await new Promise<void>((r) => server.close(() => r()));
});

test("a biblioteca real e um alvo valido para o scraper", () => {
  const file = JSON.parse(readFileSync(new URL("../data/emojis.json", import.meta.url), "utf8")) as EmojiLibraryFile;
  for (const e of file.emojis) {
    assert.doesNotThrow(() => buildQueryUrl(queryForEntry(e)), `consulta invalida para ${e.key}`);
    assert.equal(toCodepoints(e.emoji), e.codepoint, `codepoint divergente em ${e.key}`);
  }
});
