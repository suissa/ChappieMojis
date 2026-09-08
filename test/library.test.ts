import assert from "node:assert/strict";
import test from "node:test";
import { EmojiLibrary, normalize } from "../src/library.ts";
import { createEmojiServer } from "../src/server.ts";

const lib = EmojiLibrary.fromFile();

test("normaliza acentos, caixa e separadores", () => {
  assert.equal(normalize("Não Informado"), "nao-informado");
  assert.equal(normalize("VALUE_MONEY"), "value-money");
});

test("resolve por chave completa, chave curta e alias", () => {
  assert.equal(lib.get("value.money")?.emoji, "💰");
  assert.equal(lib.get("invoice")?.emoji, "💳");
  assert.equal(lib.get("cobranca")?.emoji, "💳");
  assert.equal(lib.get("nao existe"), undefined);
});

test("emojiFor usa fallback", () => {
  assert.equal(lib.emojiFor("phrase.error"), "❌");
  assert.equal(lib.emojiFor("chave-inexistente", "❔"), "❔");
});

test("busca prioriza casamento exato e respeita kind", () => {
  const [top] = lib.search("estoque");
  assert.equal(top?.entry.key, "entity.stock");
  assert.equal(top?.matchedOn, "alias");
  assert.ok(lib.search("data", 10, "value").every((h) => h.entry.kind === "value"));
});

test("catálogo íntegro: chaves e aliases únicos, kind válido", () => {
  const seen = new Set<string>();
  for (const e of lib.entries) {
    assert.match(e.key, /^(value|phrase|entity)\.[a-z_]+$/, e.key);
    for (const term of [e.key, ...e.aliases]) {
      const n = normalize(term);
      assert.ok(!seen.has(n), `termo duplicado: ${n}`);
      seen.add(n);
    }
    assert.ok(e.emoji.length > 0 && e.description.length > 0);
  }
});

test("API responde nas rotas principais", async () => {
  const server = createEmojiServer(lib);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;

  const hit = await fetch(`${base}/emoji/fatura`);
  assert.equal(hit.status, 200);
  assert.equal((await hit.json()).emoji, "💳");

  const miss = await fetch(`${base}/emoji/faturaaa`);
  assert.equal(miss.status, 404);
  assert.equal((await miss.json()).error, "unknown_key");

  const search = await fetch(`${base}/search?q=meta&kind=entity`);
  assert.equal((await search.json()).results[0].entry.key, "entity.goal");

  const bad = await fetch(`${base}/search?q=`);
  assert.equal(bad.status, 400);

  const post = await fetch(`${base}/emoji/fatura`, { method: "POST" });
  assert.equal(post.status, 405);

  await new Promise<void>((r) => server.close(() => r()));
});
