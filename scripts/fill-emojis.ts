/**
 * Preenche o campo `emoji` de `data/canonical_labels.json` com os primeiros
 * resultados do emojidb para cada rótulo canônico.
 *
 * Para cada label faz um GET em
 *   https://emojidb.org/{label}-emojis?utm_source=user_search
 * e lê o texto dos elementos em
 *   body > main > div.emoji-list > div > div.emoji
 * guardando os 5 primeiros, na ordem da página, para escolha manual depois.
 *
 * Uso:
 *   node --experimental-strip-types scripts/fill-emojis.ts --dry-run
 *   node --experimental-strip-types scripts/fill-emojis.ts            # grava no JSON
 *   node --experimental-strip-types scripts/fill-emojis.ts --resume   # só o que falta
 *   node --experimental-strip-types scripts/fill-emojis.ts --label=order_placed
 *   node --experimental-strip-types scripts/fill-emojis.ts --fixture=pagina.html
 *
 * Flags: --top=<n> --delay=<ms> --limit=<n> --cache=<dir> --no-cache --json --base=<url>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPage, withCache, type Fetcher } from "./scrape-emojidb.ts";
import { queryPath, textOf } from "./html-select.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DATA_PATH = join(ROOT, "data", "canonical_labels.json");
const DEFAULT_CACHE = join(ROOT, ".cache", "emojidb");

/** Caminho exato dos resultados na página do emojidb. */
export const RESULT_SELECTOR = "body > main > div.emoji-list > div > div.emoji";

/** Seletor de reserva, caso a página mude os níveis de aninhamento. */
const FALLBACK_SELECTOR = "div.emoji-list > div > div.emoji";

export const DEFAULT_TOP = 5;
export const DEFAULT_DELAY_MS = 1_500;

export interface LabelEntry {
  description: string;
  modules: string[];
  synonyms: string[];
  emoji: string[];
}

export interface LabelsFile {
  version: string;
  description: string;
  emoji_source: string;
  modules: string[];
  labels: Record<string, LabelEntry>;
}

/** Um cluster de emoji completo (ZWJ, tom de pele, bandeira, keycap). */
const EMOJI_CLUSTER =
  /\p{RI}\p{RI}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*/u;

/** `order_placed` -> `https://emojidb.org/order-placed-emojis?utm_source=user_search` */
export function urlForLabel(label: string, base = "https://emojidb.org"): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error(`label invalido: ${JSON.stringify(label)}`);
  return `${base}/${slug}-emojis?utm_source=user_search`;
}

/**
 * Lê os emojis da grade de resultados, na ordem da página.
 *
 * Cada célula costuma conter só o emoji; quando vem acompanhada de texto
 * (rótulo acessível, contador), fica apenas o primeiro cluster de emoji.
 * Células sem emoji nenhum são descartadas.
 */
export function extractFromPage(html: string, top = DEFAULT_TOP): string[] {
  let cells = queryPath(html, RESULT_SELECTOR);
  if (cells.length === 0) cells = queryPath(html, FALLBACK_SELECTOR);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const cell of cells) {
    const text = textOf(cell);
    const emoji = EMOJI_CLUSTER.exec(text)?.[0];
    if (!emoji || seen.has(emoji)) continue;
    seen.add(emoji);
    out.push(emoji);
    if (out.length >= top) break;
  }
  return out;
}

export interface FillResult {
  label: string;
  url: string;
  emoji: string[];
  status: "ok" | "empty" | "error";
  error?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fillLabel(
  label: string,
  fetcher: Fetcher,
  { top = DEFAULT_TOP, base = "https://emojidb.org" } = {},
): Promise<FillResult> {
  let url = "";
  try {
    url = urlForLabel(label, base);
    const emoji = extractFromPage(await fetcher(url), top);
    return { label, url, emoji, status: emoji.length > 0 ? "ok" : "empty" };
  } catch (err) {
    return { label, url, emoji: [], status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fillAll(
  labels: readonly string[],
  fetcher: Fetcher,
  { top = DEFAULT_TOP, delayMs = DEFAULT_DELAY_MS, base = "https://emojidb.org", onResult = (_: FillResult) => {} } = {},
): Promise<FillResult[]> {
  const results: FillResult[] = [];
  for (const [i, label] of labels.entries()) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const result = await fillLabel(label, fetcher, { top, base });
    onResult(result);
    results.push(result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: readonly string[]) {
  const flag = (n: string) => argv.includes(`--${n}`);
  const value = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null;
  const num = (n: string, fallback: number | null): number | null => {
    const raw = value(n);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${n} invalido: ${raw}`);
    return parsed;
  };
  return {
    dryRun: flag("dry-run"),
    resume: flag("resume"),
    json: flag("json"),
    cache: flag("no-cache") ? null : value("cache") ?? DEFAULT_CACHE,
    top: num("top", DEFAULT_TOP)!,
    delayMs: num("delay", DEFAULT_DELAY_MS)!,
    limit: num("limit", null),
    label: value("label"),
    fixture: value("fixture"),
    // Origem alternativa (espelho ou servidor local), útil para validar o
    // seletor de ponta a ponta sem depender do emojidb.
    base: value("base") ?? "https://emojidb.org",
  };
}

async function main(argv: readonly string[]): Promise<number> {
  const opts = parseArgs(argv);

  // `--fixture` exercita só o seletor contra um HTML salvo, sem rede.
  if (opts.fixture) {
    const emoji = extractFromPage(readFileSync(opts.fixture, "utf8"), opts.top);
    if (opts.json) process.stdout.write(`${JSON.stringify(emoji)}\n`);
    else if (emoji.length === 0) {
      console.log(`Nenhum emoji extraido de ${opts.fixture}.`);
      console.log(`O seletor "${RESULT_SELECTOR}" nao casou. Confira a estrutura da pagina.`);
    } else {
      console.log(`${emoji.length} emojis: ${emoji.join(" ")}`);
    }
    return emoji.length === 0 ? 1 : 0;
  }

  const file = JSON.parse(readFileSync(DATA_PATH, "utf8")) as LabelsFile;
  let labels = Object.keys(file.labels);

  if (opts.label) {
    if (!file.labels[opts.label]) throw new Error(`label desconhecido: ${opts.label}`);
    labels = [opts.label];
  }
  if (opts.resume) labels = labels.filter((l) => (file.labels[l]?.emoji.length ?? 0) === 0);
  if (opts.limit !== null) labels = labels.slice(0, opts.limit);

  if (labels.length === 0) {
    console.error("Nada a preencher.");
    return 0;
  }

  let fetcher: Fetcher = (url) => fetchPage(url);
  if (opts.cache) fetcher = withCache(fetcher, opts.cache);

  let done = 0;
  const results = await fillAll(labels, fetcher, {
    top: opts.top,
    delayMs: opts.delayMs,
    base: opts.base,
    onResult: (r) => {
      done++;
      if (!opts.json) {
        const shown = r.emoji.length > 0 ? r.emoji.join(" ") : `(${r.status})`;
        process.stderr.write(`[${done}/${labels.length}] ${r.label.padEnd(30)} ${shown}\n`);
      }
    },
  });

  if (opts.json) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);

  const ok = results.filter((r) => r.status === "ok");
  if (!opts.dryRun && ok.length > 0) {
    for (const r of ok) file.labels[r.label]!.emoji = r.emoji;
    writeFileSync(DATA_PATH, `${JSON.stringify(file, null, 2)}\n`);
    console.error(`\n${ok.length} labels preenchidos em ${DATA_PATH}.`);
  }

  const failed = results.length - ok.length;
  if (failed > 0) {
    console.error(`${failed} sem resultado:`);
    for (const r of results.filter((x) => x.status !== "ok")) {
      console.error(`  ${r.label}: ${r.status}${r.error ? ` — ${r.error}` : ""} (${r.url})`);
    }
  }
  // Falha o processo se mais de um terço das consultas não trouxe emoji:
  // sinal de seletor quebrado ou bloqueio, não de rótulos exóticos.
  return failed > results.length / 3 ? 1 : 0;
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("fill-emojis.ts") || entry.endsWith("fill-emojis.js")) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`erro: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
