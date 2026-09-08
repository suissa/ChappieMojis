import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EmojiEntry, EmojiKind, EmojiLibraryFile, SearchHit } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_PATH = join(HERE, "..", "data", "emojis.json");

/**
 * Normaliza um termo de busca: minúsculas, sem acentos e com separadores
 * (`_`, espaço, `/`) reduzidos a `-`. Assim `Não Informado`, `nao_informado`
 * e `nao-informado` resolvem para a mesma chave.
 */
export function normalize(term: string): string {
  return term
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_/]+/g, "-")
    .replace(/-{2,}/g, "-");
}

export class EmojiLibrary {
  readonly version: string;
  readonly source: string;
  readonly namespaces: Record<EmojiKind, string>;
  readonly entries: readonly EmojiEntry[];

  /** chave normalizada -> entrada (chave completa, chave curta e aliases) */
  private readonly index = new Map<string, EmojiEntry>();

  constructor(file: EmojiLibraryFile) {
    this.version = file.version;
    this.source = file.source;
    this.namespaces = file.namespaces;
    this.entries = Object.freeze([...file.emojis]);

    for (const entry of this.entries) {
      this.register(entry.key, entry);
      // chave curta: `money` resolve para `value.money`, desde que não colida.
      const short = entry.key.split(".").slice(1).join(".");
      this.register(short, entry);
      for (const alias of entry.aliases) this.register(alias, entry);
    }
  }

  static fromFile(path: string = DEFAULT_DATA_PATH): EmojiLibrary {
    return new EmojiLibrary(JSON.parse(readFileSync(path, "utf8")) as EmojiLibraryFile);
  }

  /** Registra sem sobrescrever: a primeira chave a reivindicar um termo vence. */
  private register(term: string, entry: EmojiEntry): void {
    const normalized = normalize(term);
    if (normalized && !this.index.has(normalized)) this.index.set(normalized, entry);
  }

  /** Resolve uma chave/alias para a entrada canônica, ou `undefined`. */
  get(term: string): EmojiEntry | undefined {
    return this.index.get(normalize(term));
  }

  /** Atalho: só o emoji, com um fallback para chaves desconhecidas. */
  emojiFor(term: string, fallback = "•"): string {
    return this.get(term)?.emoji ?? fallback;
  }

  /**
   * Busca por prefixo/substring, ordenada por especificidade:
   * chave exata > chave curta > alias > descrição.
   */
  search(term: string, limit = 10, kind?: EmojiKind): SearchHit[] {
    const q = normalize(term);
    if (!q) return [];
    const hits: SearchHit[] = [];

    for (const entry of this.entries) {
      if (kind && entry.kind !== kind) continue;
      const key = normalize(entry.key);
      const short = normalize(entry.key.split(".").slice(1).join("."));
      let hit: SearchHit | undefined;

      if (key === q) hit = { entry, score: 100, matchedOn: "key" };
      else if (short === q) hit = { entry, score: 90, matchedOn: "shortKey" };
      else if (entry.aliases.some((a) => normalize(a) === q)) hit = { entry, score: 80, matchedOn: "alias" };
      else if (key.includes(q)) hit = { entry, score: 60, matchedOn: "key" };
      else if (entry.aliases.some((a) => normalize(a).includes(q))) hit = { entry, score: 50, matchedOn: "alias" };
      else if (normalize(entry.description).includes(q)) hit = { entry, score: 20, matchedOn: "description" };

      if (hit) hits.push(hit);
    }

    return hits
      .sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key))
      .slice(0, limit);
  }

  list(kind?: EmojiKind): readonly EmojiEntry[] {
    return kind ? this.entries.filter((e) => e.kind === kind) : this.entries;
  }
}
