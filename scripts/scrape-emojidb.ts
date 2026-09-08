/**
 * Scraper do emojidb.org para reconciliar `data/emojis.json`.
 *
 * O emojidb é um buscador semântico: uma consulta como "fatura" devolve uma
 * grade de emojis ordenada por relevância. Este script trata o primeiro
 * resultado como o *emoji canônico* daquela consulta e compara com o que já
 * está na biblioteca, apontando divergências.
 *
 * Não altera nada por padrão: só escreve no JSON com `--write`.
 *
 * Uso:
 *   node --experimental-strip-types scripts/scrape-emojidb.ts            # relatório
 *   node --experimental-strip-types scripts/scrape-emojidb.ts --write    # aplica divergências
 *   node --experimental-strip-types scripts/scrape-emojidb.ts --key=entity.invoice
 *   node --experimental-strip-types scripts/scrape-emojidb.ts --query="fluxo de caixa"
 *
 *   node --experimental-strip-types scripts/scrape-emojidb.ts --fixture=pagina.html
 *
 * Flags: --delay=<ms> --limit=<n> --top=<n> --cache=<dir> --no-cache --json --write
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EmojiEntry, EmojiLibraryFile } from "../src/types.ts";
import { normalize } from "../src/library.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DATA_PATH = join(ROOT, "data", "emojis.json");
const DEFAULT_CACHE = join(ROOT, ".cache", "emojidb");

export const BASE_URL = "https://emojidb.org";

/** Intervalo mínimo entre requisições. O emojidb é um site pequeno: não martele. */
export const DEFAULT_DELAY_MS = 1_500;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_RETRIES = 3;

const USER_AGENT =
  "ChappieMojis/1.0 (+https://github.com/suissa/ChappieMojis) curadoria de emojis canonicos";

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

/**
 * Converte um termo em slug de URL do emojidb: minúsculas, sem acentos,
 * separado por hífen, com o sufixo `-emojis` que o site usa.
 *
 * `"Fluxo de Caixa"` -> `https://emojidb.org/fluxo-de-caixa-emojis`
 */
export function buildQueryUrl(term: string, base = BASE_URL): string {
  const slug = normalize(term).replace(/[^a-z0-9-]/g, "");
  if (!slug) throw new Error(`termo vazio apos normalizacao: ${JSON.stringify(term)}`);
  return `${base}/${slug}-emojis`;
}

/**
 * Consulta usada para uma entrada da biblioteca: o nome da chave sem o
 * namespace, com `_` virando espaço (`value.trend_up` -> `trend up`).
 * Um alias explícito em `scrapeQuery` tem precedência.
 */
export function queryForEntry(entry: EmojiEntry & { scrapeQuery?: string }): string {
  if (entry.scrapeQuery) return entry.scrapeQuery;
  return entry.key.split(".").slice(1).join(".").replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Um cluster de emoji completo: par de indicadores regionais (bandeiras),
 * keycap (`1️⃣`), ou pictográfico com modificadores de tom de pele,
 * seletores de variação e sequências ZWJ (`🧑‍💼`).
 */
const EMOJI_CLUSTER =
  /\p{RI}\p{RI}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*/gu;

/**
 * Blocos que nunca contêm resultados, só ruído (ícones de UI, JSON-LD,
 * emojis citados em comentários de script).
 */
const NOISE_BLOCKS = /<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * Contêiner da grade de resultados. O emojidb renderiza cada resultado como
 * um nó com `class="emoji"`; o fallback varre a página inteira caso o site
 * mude o markup — por isso a extração é tolerante e não depende de um seletor
 * único. Se o layout mudar, ajuste apenas estas duas expressões.
 */
const RESULT_NODE = /<[a-z]+[^>]*\bclass="[^"]*\bemoji\b[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/gi;

/** Remove entidades HTML numéricas e as nomeadas mais comuns. */
export function decodeEntities(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Extrai os emojis de uma página de resultados, na ordem em que aparecem e
 * sem repetições — o primeiro item é o candidato a canônico.
 *
 * Estratégia em dois passos: primeiro tenta os nós de resultado (`class="emoji"`);
 * se o markup mudar e nada casar, varre o documento inteiro já sem os blocos
 * de ruído. Nos dois casos a ordem do documento é preservada.
 */
export function extractEmojis(html: string, top = 10): string[] {
  const clean = html.replace(NOISE_BLOCKS, " ");

  const nodes = [...clean.matchAll(RESULT_NODE)].map((m) => m[1] ?? "");
  const haystack = nodes.length > 0 ? nodes.join("\n") : clean.replace(/<[^>]+>/g, " ");

  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of decodeEntities(haystack).matchAll(EMOJI_CLUSTER)) {
    const emoji = match[0];
    // Dígitos soltos só valem como keycap; o regex já garante isso, mas
    // sequências degeneradas (só seletor de variação) são descartadas aqui.
    if (!emoji || /^[︎️\s]+$/u.test(emoji)) continue;
    if (seen.has(emoji)) continue;
    seen.add(emoji);
    out.push(emoji);
    if (out.length >= top) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------

export type Fetcher = (url: string) => Promise<string>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Busca uma página com timeout e retentativa em erro transitório
 * (rede, 429, 5xx), com backoff exponencial. 404 é definitivo: significa que
 * o emojidb não tem página para aquela consulta.
 */
export async function fetchPage(
  url: string,
  { retries = DEFAULT_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      });
      if (res.status === 404) throw new HttpError(url, 404, "pagina inexistente no emojidb");
      if (res.status === 429 || res.status >= 500) {
        throw new TransientError(`HTTP ${res.status} em ${url}`);
      }
      if (!res.ok) throw new HttpError(url, res.status, res.statusText);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (err instanceof HttpError) throw err; // definitivo, não insiste
      if (attempt === retries) break;
      await sleep(2 ** attempt * 500); // 1s, 2s, 4s...
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`falha ao buscar ${url} apos ${retries} tentativas: ${String(lastError)}`);
}

export class HttpError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number, message: string) {
    super(`HTTP ${status} em ${url}: ${message}`);
    this.name = "HttpError";
    this.url = url;
    this.status = status;
  }
}
class TransientError extends Error {
  name = "TransientError";
}

/** Envolve um `Fetcher` com cache em disco, para reexecutar sem tocar a rede. */
export function withCache(fetcher: Fetcher, dir: string): Fetcher {
  mkdirSync(dir, { recursive: true });
  return async (url: string) => {
    const file = join(dir, `${encodeURIComponent(url)}.html`);
    if (existsSync(file)) return readFileSync(file, "utf8");
    const html = await fetcher(url);
    writeFileSync(file, html);
    return html;
  };
}

// ---------------------------------------------------------------------------
// Reconciliação
// ---------------------------------------------------------------------------

export interface ScrapeResult {
  key: string;
  query: string;
  url: string;
  /** Emoji atualmente na biblioteca. */
  current: string;
  /** Primeiro resultado do emojidb, ou `null` se a consulta não retornou nada. */
  canonical: string | null;
  /** Top-N do emojidb, para decidir manualmente. */
  candidates: string[];
  status: "match" | "diff" | "absent" | "empty" | "error";
  /** Posição do emoji atual no ranking do emojidb (1-based), se aparecer. */
  currentRank: number | null;
  error?: string;
}

/**
 * Roda uma consulta e classifica o resultado:
 * - `match`   o topo do emojidb é o que já está na biblioteca;
 * - `diff`    o topo diverge, mas o atual aparece no top-N (`currentRank`);
 * - `absent`  o atual nem aparece no top-N — o caso que mais merece revisão;
 * - `empty`   a consulta não devolveu emoji nenhum;
 * - `error`   falha de rede ou página inexistente.
 */
export async function scrapeEntry(
  entry: EmojiEntry,
  fetcher: Fetcher,
  { top = 10, base = BASE_URL } = {},
): Promise<ScrapeResult> {
  const query = queryForEntry(entry);
  let url: string;
  try {
    url = buildQueryUrl(query, base);
  } catch (err) {
    return blank(entry, query, "", "error", String(err));
  }

  try {
    const candidates = extractEmojis(await fetcher(url), top);
    const canonical = candidates[0] ?? null;
    const rank = candidates.indexOf(entry.emoji);
    const currentRank = rank === -1 ? null : rank + 1;

    if (candidates.length === 0) return blank(entry, query, url, "empty");
    const status = canonical === entry.emoji ? "match" : currentRank === null ? "absent" : "diff";
    return { key: entry.key, query, url, current: entry.emoji, canonical, candidates, status, currentRank };
  } catch (err) {
    return blank(entry, query, url, "error", err instanceof Error ? err.message : String(err));
  }
}

function blank(
  entry: EmojiEntry,
  query: string,
  url: string,
  status: ScrapeResult["status"],
  error?: string,
): ScrapeResult {
  return {
    key: entry.key,
    query,
    url,
    current: entry.emoji,
    canonical: null,
    candidates: [],
    status,
    currentRank: null,
    ...(error ? { error } : {}),
  };
}

/** Percorre as entradas em série, respeitando o intervalo entre requisições. */
export async function scrapeAll(
  entries: readonly EmojiEntry[],
  fetcher: Fetcher,
  { delayMs = DEFAULT_DELAY_MS, top = 10, base = BASE_URL, onResult = (_: ScrapeResult) => {} } = {},
): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];
  for (const [i, entry] of entries.entries()) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const result = await scrapeEntry(entry, fetcher, { top, base });
    onResult(result);
    results.push(result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

const ICON: Record<ScrapeResult["status"], string> = {
  match: "=",
  diff: "~",
  absent: "!",
  empty: "?",
  error: "x",
};

export function formatReport(results: readonly ScrapeResult[]): string {
  const lines: string[] = [];
  const tally: Record<string, number> = { match: 0, diff: 0, absent: 0, empty: 0, error: 0 };

  for (const r of results) {
    tally[r.status] = (tally[r.status] ?? 0) + 1;
    if (r.status === "match") continue; // o relatório mostra só o que precisa de decisão
    const head = `${ICON[r.status]} ${r.key.padEnd(22)} atual ${r.current}`;
    if (r.status === "error") lines.push(`${head}  -> erro: ${r.error}`);
    else if (r.status === "empty") lines.push(`${head}  -> sem resultados em ${r.url}`);
    else {
      const rank = r.currentRank ? `atual em #${r.currentRank}` : "atual fora do top";
      lines.push(`${head}  -> emojidb ${r.canonical}  (${rank})\n    top: ${r.candidates.join(" ")}\n    ${r.url}`);
    }
  }

  const total = results.length;
  const summary =
    `\n${total} consultas: ${tally.match} iguais, ${tally.diff} divergentes, ` +
    `${tally.absent} sem o atual no ranking, ${tally.empty} vazias, ${tally.error} com erro.`;

  return (lines.length ? lines.join("\n") : "Nenhuma divergencia.") + summary;
}

/**
 * Aplica as divergências no arquivo da biblioteca, trocando `emoji` e
 * `codepoint` pelo topo do emojidb. Só mexe em `diff`/`absent`: `empty` e
 * `error` são incertezas, não decisões.
 */
export function applyResults(file: EmojiLibraryFile, results: readonly ScrapeResult[]): number {
  const byKey = new Map(results.map((r) => [r.key, r]));
  let changed = 0;
  for (const entry of file.emojis) {
    const r = byKey.get(entry.key);
    if (!r?.canonical) continue;
    if (r.status !== "diff" && r.status !== "absent") continue;
    entry.emoji = r.canonical;
    entry.codepoint = toCodepoints(r.canonical);
    changed++;
  }
  return changed;
}

/** `"🧑‍💼"` -> `"U+1F9D1 U+200D U+1F4BC"`, no formato usado no JSON. */
export function toCodepoints(emoji: string): string {
  return [...emoji]
    .map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`)
    .join(" ");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
  write: boolean;
  json: boolean;
  cache: string | null;
  delayMs: number;
  limit: number | null;
  top: number;
  key: string | null;
  query: string | null;
  fixture: string | null;
}

export function parseArgs(argv: readonly string[]): Options {
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const num = (name: string, fallback: number | null): number | null => {
    const raw = value(name);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} invalido: ${raw}`);
    return n;
  };

  return {
    write: flag("write"),
    json: flag("json"),
    cache: flag("no-cache") ? null : value("cache") ?? DEFAULT_CACHE,
    delayMs: num("delay", DEFAULT_DELAY_MS)!,
    limit: num("limit", null),
    top: num("top", 10)!,
    key: value("key"),
    query: value("query"),
    fixture: value("fixture"),
  };
}

async function main(argv: readonly string[]): Promise<number> {
  const opts = parseArgs(argv);
  const file = JSON.parse(readFileSync(DATA_PATH, "utf8")) as EmojiLibraryFile;

  // `--fixture` roda só o parser contra um HTML salvo em disco, sem rede.
  // Serve para conferir os seletores depois de uma mudança no site:
  //   curl https://emojidb.org/chart-emojis > /tmp/chart.html
  //   npm run scrape -- --fixture=/tmp/chart.html
  if (opts.fixture) {
    const emojis = extractEmojis(readFileSync(opts.fixture, "utf8"), opts.top);
    if (opts.json) process.stdout.write(`${JSON.stringify(emojis)}\n`);
    else if (emojis.length === 0) {
      console.log(`Nenhum emoji extraido de ${opts.fixture}.`);
      console.log("Os seletores RESULT_NODE/NOISE_BLOCKS provavelmente precisam de ajuste.");
    } else {
      console.log(`${emojis.length} emojis extraidos de ${opts.fixture}, em ordem:`);
      console.log(emojis.map((e, i) => `  ${String(i + 1).padStart(2)}. ${e}  ${toCodepoints(e)}`).join("\n"));
      console.log(`\nCanonico proposto: ${emojis[0]}`);
    }
    return emojis.length === 0 ? 1 : 0;
  }

  // `--query` faz uma consulta avulsa, sem precisar existir na biblioteca.
  let entries: EmojiEntry[] = opts.query
    ? [{ key: `ad-hoc.${normalize(opts.query)}`, emoji: "", codepoint: "", kind: "value", aliases: [], description: opts.query }]
    : file.emojis;

  if (opts.key) {
    entries = entries.filter((e) => normalize(e.key) === normalize(opts.key!));
    if (entries.length === 0) throw new Error(`chave desconhecida: ${opts.key}`);
  }
  if (opts.limit !== null) entries = entries.slice(0, opts.limit);

  let fetcher: Fetcher = (url) => fetchPage(url);
  if (opts.cache) fetcher = withCache(fetcher, opts.cache);

  const total = entries.length;
  const results = await scrapeAll(entries, fetcher, {
    delayMs: opts.delayMs,
    top: opts.top,
    onResult: (r) => {
      if (!opts.json) process.stderr.write(`  ${ICON[r.status]} ${r.key}\r`);
    },
  });

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    process.stderr.write(`${" ".repeat(60)}\r`);
    console.log(formatReport(results));
  }

  if (opts.write && !opts.query) {
    const changed = applyResults(file, results);
    if (changed > 0) {
      writeFileSync(DATA_PATH, `${JSON.stringify(file, null, 2)}\n`);
      console.error(`\n${changed} entradas atualizadas em ${DATA_PATH}. Revise o diff antes de commitar.`);
    } else {
      console.error("\nNada a atualizar.");
    }
  }

  const failures = results.filter((r) => r.status === "error").length;
  // Código de saída != 0 quando houve erro de rede em mais de um terço das
  // consultas: sinaliza execução não confiável para o CI.
  return failures > total / 3 ? 1 : 0;
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("scrape-emojidb.ts") || entry.endsWith("scrape-emojidb.js")) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`erro: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
