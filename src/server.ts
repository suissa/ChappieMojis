import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { EmojiLibrary } from "./library.ts";
import type { EmojiKind } from "./types.ts";

const KINDS: readonly EmojiKind[] = ["value", "phrase", "entity"];

function isKind(v: string | null): v is EmojiKind {
  return v !== null && (KINDS as readonly string[]).includes(v);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "public, max-age=300",
  });
  res.end(payload);
}

export function createEmojiServer(library: EmojiLibrary = EmojiLibrary.fromFile()) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { error: "method_not_allowed", allowed: ["GET", "HEAD"] });
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const segments = url.pathname.split("/").filter(Boolean);
    const kindParam = url.searchParams.get("kind");
    if (kindParam !== null && !isKind(kindParam)) {
      return send(res, 400, { error: "invalid_kind", expected: KINDS, received: kindParam });
    }
    const kind = isKind(kindParam) ? kindParam : undefined;

    // GET /health
    if (segments.length === 1 && segments[0] === "health") {
      return send(res, 200, { status: "ok", version: library.version, total: library.entries.length });
    }

    // GET /emojis?kind=value  -> catálogo completo
    if (segments.length === 1 && segments[0] === "emojis") {
      const items = library.list(kind);
      return send(res, 200, { total: items.length, kind: kind ?? "all", items });
    }

    // GET /search?q=fatura&kind=entity&limit=5
    if (segments.length === 1 && segments[0] === "search") {
      const q = url.searchParams.get("q") ?? "";
      if (!q.trim()) return send(res, 400, { error: "missing_query", hint: "use ?q=<termo>" });
      const rawLimit = Number(url.searchParams.get("limit") ?? 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 10;
      const results = library.search(q, limit, kind);
      return send(res, 200, { query: q, kind: kind ?? "all", total: results.length, results });
    }

    // GET /emoji/:key  -> rota principal: chave semântica -> emoji canônico
    if (segments.length === 2 && segments[0] === "emoji") {
      const key = decodeURIComponent(segments[1]);
      const entry = library.get(key);
      if (entry) return send(res, 200, entry);
      const suggestions = library.search(key, 5).map((h) => h.entry.key);
      return send(res, 404, { error: "unknown_key", key, suggestions });
    }

    // GET /  -> descoberta
    if (segments.length === 0) {
      return send(res, 200, {
        name: "ChappieMojis",
        version: library.version,
        source: library.source,
        namespaces: library.namespaces,
        routes: {
          "GET /emoji/:key": "Emoji canônico de uma chave semântica ou alias.",
          "GET /search?q=&kind=&limit=": "Busca por chave, alias ou descrição.",
          "GET /emojis?kind=": "Catálogo completo.",
          "GET /health": "Status do serviço.",
        },
      });
    }

    return send(res, 404, { error: "not_found", path: url.pathname });
  });
}

// Sobe o servidor apenas quando este arquivo e o ponto de entrada,
// para que os testes possam importar `createEmojiServer` sem abrir uma porta.
const entry = process.argv[1] ?? "";
if (entry.endsWith("server.ts") || entry.endsWith("server.js")) {
  const PORT = Number(process.env.PORT ?? 3000);
  const HOST = process.env.HOST ?? "127.0.0.1";
  createEmojiServer().listen(PORT, HOST, () => {
    console.log(`ChappieMojis API em http://${HOST}:${PORT}`);
  });
}
