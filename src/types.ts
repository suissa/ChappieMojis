/** Namespace semântico da chave. */
export type EmojiKind = "value" | "phrase" | "entity";

/** Uma entrada canônica da biblioteca. */
export interface EmojiEntry {
  /** Chave semântica única, no formato `<kind>.<nome>` (ex.: `value.money`). */
  key: string;
  /** O emoji canônico escolhido para representar a chave. */
  emoji: string;
  /** Codepoints Unicode, separados por espaço quando houver sequência. */
  codepoint: string;
  kind: EmojiKind;
  /** Sinônimos aceitos pela busca (pt-BR e en). */
  aliases: string[];
  description: string;
}

export interface EmojiLibraryFile {
  version: string;
  source: string;
  namespaces: Record<EmojiKind, string>;
  emojis: EmojiEntry[];
}

/** Resultado de busca com a pontuação e o motivo do casamento. */
export interface SearchHit {
  entry: EmojiEntry;
  score: number;
  matchedOn: "key" | "alias" | "shortKey" | "description";
}
