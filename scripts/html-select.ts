/**
 * Seletor mínimo de HTML, só o suficiente para percorrer um caminho de
 * elementos como `body > main > div.emoji-list > div > div.emoji`.
 *
 * Não é um parser de HTML completo e nem tenta ser: opera sobre a marcação
 * bem-formada que o emojidb serve, contando profundidade de tags para
 * distinguir filhos diretos de descendentes.
 */

/** Elementos sem tag de fechamento, que não abrem nível de profundidade. */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Blocos cujo conteúdo não é marcação e precisa ser pulado inteiro. */
const RAW_TEXT = /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

export interface Element {
  tag: string;
  attrs: string;
  /** HTML interno, sem as tags de abertura e fechamento. */
  inner: string;
}

/** Remove `<script>`, `<style>` e comentários, preservando os offsets do resto. */
export function stripRawText(html: string): string {
  return html.replace(RAW_TEXT, (m) => " ".repeat(m.length)).replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
}

/** `class="a b"` -> `["a","b"]`, aceitando aspas simples ou nenhuma. */
export function classList(attrs: string): string[] {
  const m = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const raw = m?.[1] ?? m?.[2] ?? m?.[3] ?? "";
  return raw.split(/\s+/).filter(Boolean);
}

/**
 * Filhos diretos de um trecho de HTML, na ordem do documento.
 * Descendentes mais profundos são ignorados — é o que dá sentido ao `>`
 * do seletor.
 */
export function children(html: string): Element[] {
  const out: Element[] = [];
  const stack: { tag: string; attrs: string; innerStart: number }[] = [];
  TAG.lastIndex = 0;

  for (let m = TAG.exec(html); m !== null; m = TAG.exec(html)) {
    const [full, closing, rawTag = "", attrs = "", selfClosing] = m;
    const tag = rawTag.toLowerCase();
    if (VOID_TAGS.has(tag) || selfClosing === "/") continue;

    if (closing === "/") {
      // Fecha o elemento correspondente mais recente, tolerando tags orfãs.
      const depth = stack.findLastIndex((e) => e.tag === tag);
      if (depth === -1) continue;
      const open = stack[depth]!;
      if (depth === 0) out.push({ tag: open.tag, attrs: open.attrs, inner: html.slice(open.innerStart, m.index) });
      stack.length = depth;
    } else {
      stack.push({ tag, attrs, innerStart: m.index + full.length });
    }
  }
  return out;
}

/** Um passo do caminho: nome da tag e, opcionalmente, uma classe exigida. */
export interface Step {
  tag: string;
  className?: string;
}

/** `"div.emoji-list"` -> `{ tag: "div", className: "emoji-list" }` */
export function parseStep(step: string): Step {
  const [tag = "", className] = step.split(".");
  if (!tag) throw new Error(`passo invalido no seletor: ${JSON.stringify(step)}`);
  return className ? { tag: tag.toLowerCase(), className } : { tag: tag.toLowerCase() };
}

/** `"body > main > div.emoji-list > div > div.emoji"` -> passos. */
export function parseSelector(selector: string): Step[] {
  const steps = selector.split(">").map((s) => s.trim()).filter(Boolean).map(parseStep);
  if (steps.length === 0) throw new Error(`seletor vazio: ${JSON.stringify(selector)}`);
  return steps;
}

function matches(el: Element, step: Step): boolean {
  if (el.tag !== step.tag) return false;
  return step.className === undefined || classList(el.attrs).includes(step.className);
}

/**
 * Percorre um caminho de filhos diretos e devolve todos os elementos que
 * casam com o último passo.
 *
 * O primeiro passo é procurado em qualquer profundidade — o `<body>` costuma
 * estar embrulhado em `<html>`, e alguns servidores omitem tags implícitas.
 */
export function queryPath(html: string, selector: string): Element[] {
  const steps = parseSelector(selector);
  const [first, ...rest] = steps as [Step, ...Step[]];

  let level = findAnywhere(stripRawText(html), first);
  for (const step of rest) {
    level = level.flatMap((el) => children(el.inner).filter((c) => matches(c, step)));
    if (level.length === 0) return [];
  }
  return level;
}

/** Procura o primeiro passo em qualquer profundidade, sem exigir ancestrais. */
function findAnywhere(html: string, step: Step): Element[] {
  const found: Element[] = [];
  const visit = (fragment: string) => {
    for (const el of children(fragment)) {
      if (matches(el, step)) found.push(el);
      else visit(el.inner);
    }
  };
  visit(html);
  return found;
}

/** Texto de um elemento, sem tags e com entidades HTML resolvidas. */
export function textOf(el: Element): string {
  return el.inner
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
