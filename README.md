# ChappieMojis

Biblioteca **local** de emojis canônicos indexados por **chave semântica**, com uma **API HTTP em TypeScript puro, sem nenhuma dependência de runtime**.

A curadoria segue o modelo de busca semântica do [emojidb.org](https://emojidb.org/): a *chave* é a consulta (`fatura`, `prazo`, `meta batida`) e o *emoji canônico* é o resultado de topo — um único emoji por conceito, para que o mesmo significado nunca apareça com dois símbolos diferentes no produto.

## Para o tipo da frase ou para o tipo do valor?

**Para os dois — em namespaces separados.** Misturar os dois é justamente o que torna um vocabulário de emojis inconsistente: `✅` como "campo booleano verdadeiro" e `✅` como "pedido aprovado" são coisas distintas e brigam entre si na interface. Por isso toda chave é prefixada:

| Namespace | Responde a | Onde aparece | Exemplo |
| --- | --- | --- | --- |
| `value.*` | **Tipo do valor** — que dado é este? | rótulo de campo, cabeçalho de coluna, formulário | `value.money` → 💰 |
| `phrase.*` | **Tipo da frase** — qual a intenção desta mensagem? | toast, log, e-mail, status de fluxo | `phrase.success` → ✅ |
| `entity.*` | **Tipo da entidade** — qual substantivo de domínio? | menu, breadcrumb, título de tela | `entity.invoice` → 💳 |

Regra prática: **o `value` acompanha o dado, o `phrase` acompanha o verbo, o `entity` acompanha o substantivo.**

## Instalação e execução

Requer apenas **Node.js >= 22**. Não há `npm install` — o projeto não tem dependências.

```bash
node --experimental-strip-types src/server.ts   # ou: npm run dev
# ChappieMojis API em http://127.0.0.1:3000

npm test        # 6 suítes, com node:test nativo
```

Para gerar JavaScript compilado (`npm run build`) são necessários `typescript` e `@types/node` **apenas como ferramentas de build** — nada disso entra no runtime.

Variáveis opcionais: `PORT` (padrão `3000`) e `HOST` (padrão `127.0.0.1`).

## API

### `GET /emoji/:key` — rota principal

Recebe o nome da chave que representa semanticamente o emoji. Aceita a chave completa (`value.money`), a chave curta (`money`) ou qualquer alias (`preco`, `valor`, `Preço`). A busca é **insensível a acentos, caixa e separadores**: `nao-informado`, `Não Informado` e `NAO_INFORMADO` resolvem para o mesmo registro.

```bash
curl http://127.0.0.1:3000/emoji/fatura
```

```json
{
  "key": "entity.invoice",
  "emoji": "💳",
  "codepoint": "U+1F4B3",
  "kind": "entity",
  "aliases": ["fatura", "cobranca", "pagamento", "nota"],
  "description": "Fatura / cobrança."
}
```

Chave desconhecida devolve `404` **com sugestões**, em vez de um erro seco:

```json
{ "error": "unknown_key", "key": "faturaa", "suggestions": ["entity.invoice"] }
```

### Demais rotas

| Rota | Descrição |
| --- | --- |
| `GET /search?q=&kind=&limit=` | Busca por chave, alias ou descrição. Ordena por especificidade: chave exata > chave curta > alias > descrição. `limit` é limitado a 50. |
| `GET /emojis?kind=value` | Catálogo completo, opcionalmente filtrado por namespace. |
| `GET /health` | Status, versão e total de entradas. |
| `GET /` | Descoberta: rotas e namespaces. |

`kind` aceita apenas `value`, `phrase` ou `entity` — qualquer outro valor devolve `400`. Métodos diferentes de `GET`/`HEAD` devolvem `405`.

### Uso como biblioteca

```ts
import { EmojiLibrary } from "./src/library.ts";

const emojis = EmojiLibrary.fromFile();

emojis.get("value.money")?.emoji;          // "💰"
emojis.emojiFor("cobranca");               // "💳"
emojis.emojiFor("chave-nova", "❔");        // "❔" (fallback)
emojis.search("estoque", 3, "entity");     // [{ entry, score, matchedOn }]

// rótulo de coluna em um relatório de vendas
`${emojis.emojiFor("value.money")} Ticket médio`;   // "💰 Ticket médio"
```

---

## Catálogo — 1 exemplo real por emoji

Todos os exemplos abaixo são de sistemas de **gestão comercial** e **gestão pessoal/financeira**.

### `value.*` — tipo do valor

| Chave | Emoji | Exemplo real |
| --- | :---: | --- |
| `value.money` | 💰 | Cabeçalho da coluna de total no relatório de vendas: `💰 Faturamento do mês: R$ 184.320,00`. |
| `value.currency` | 💱 | Campo de moeda no cadastro de um fornecedor importado: `💱 Moeda do contrato: USD (câmbio D-1)`. |
| `value.percent` | ％ | Regra de desconto no cadastro do produto: `％ Desconto máximo do vendedor: 12%`. |
| `value.number` | 🔢 | Quantidade no item do pedido de venda: `🔢 Qtd. 240 un.`. |
| `value.decimal` | 🧮 | Rodapé calculado do carrinho no PDV: `🧮 Subtotal 1.284,50 + frete 89,90`. |
| `value.text` | 🔤 | Campo curto no cadastro de cliente: `🔤 Nome fantasia`. |
| `value.longtext` | 📝 | Observação registrada na ficha do cliente: `📝 Prefere entrega após as 14h, portaria dos fundos`. |
| `value.boolean` | 🔘 | Chave de configuração da loja: `🔘 Permitir venda com estoque negativo`. |
| `value.date` | 📅 | Vencimento do boleto no contas a pagar: `📅 Vence em 10/03`. |
| `value.time` | ⏰ | Horário de corte da separação no e-commerce: `⏰ Pedidos até 16:00 saem no mesmo dia`. |
| `value.duration` | ⏱️ | SLA do chamado de suporte técnico: `⏱️ Tempo em aberto: 3h12`. |
| `value.deadline` | ⌛ | Alerta na proposta comercial: `⌛ Preço válido por mais 2 dias`. |
| `value.id` | 🆔 | Identificador do pedido na busca do atendimento: `🆔 PED-2026-018342`. |
| `value.barcode` | 🏷️ | Etiqueta impressa na gôndola: `🏷️ SKU 7891234567890 — Café torrado 500g`. |
| `value.email` | 📧 | Contato principal para envio da nota fiscal: `📧 financeiro@padariacentral.com.br`. |
| `value.phone` | 📞 | Telefone do cliente na tela de cobrança: `📞 (11) 98877-6655 — WhatsApp`. |
| `value.address` | 📍 | Endereço de entrega escolhido no checkout: `📍 Rua das Acácias, 210 — CEP 04567-000`. |
| `value.url` | 🔗 | Link do rastreio enviado ao comprador: `🔗 Acompanhe sua entrega`. |
| `value.file` | 📄 | Anexo do lançamento de despesa: `📄 nota-fiscal-almoco-cliente.pdf`. |
| `value.folder` | 📁 | Agrupamento de documentos do colaborador no RH: `📁 Admissão — Ana Ribeiro`. |
| `value.image` | 🖼️ | Foto do produto no catálogo do e-commerce: `🖼️ 4 imagens cadastradas`. |
| `value.password` | 🔑 | Credencial do certificado digital A1 no módulo fiscal: `🔑 Senha do certificado`. |
| `value.encrypted` | 🔒 | CPF mascarado na listagem de clientes por LGPD: `🔒 ***.456.789-**`. |
| `value.list` | 📋 | Itens do pedido de compra ao fornecedor: `📋 12 itens selecionados`. |
| `value.object` | 📦 | Payload do webhook de pedido no log de integração: `📦 order.created`. |
| `value.null` | ⬜ | Campo opcional em branco na ficha do cliente: `⬜ Inscrição estadual não informada`. |
| `value.range` | ↔️ | Filtro de período do relatório de caixa: `↔️ 01/03 até 31/03`. |
| `value.percentbar` | 📊 | Painel de vendas por canal: `📊 Loja física 62% · Marketplace 38%`. |
| `value.trend_up` | 📈 | Comparativo mensal no dashboard: `📈 Ticket médio +8,4% vs. fevereiro`. |
| `value.trend_down` | 📉 | Indicador de giro no relatório de estoque: `📉 Giro da categoria Bebidas −15%`. |
| `value.geo` | 🗺️ | Mapa de cobertura das rotas de entrega: `🗺️ 3 bairros fora da área atendida`. |
| `value.signature` | ✍️ | Aceite digital do orçamento pelo cliente: `✍️ Assinado em 04/03 às 11:27`. |

### `phrase.*` — tipo da frase

| Chave | Emoji | Exemplo real |
| --- | :---: | --- |
| `phrase.success` | ✅ | Toast após emitir a nota: `✅ NF-e 18.342 autorizada pela SEFAZ`. |
| `phrase.error` | ❌ | Retorno da operadora no checkout: `❌ Pagamento recusado — cartão sem limite`. |
| `phrase.warning` | ⚠️ | Aviso na tela de venda: `⚠️ Estoque abaixo do mínimo para 3 itens do pedido`. |
| `phrase.info` | ℹ️ | Nota no relatório mensal: `ℹ️ Valores já consideram devoluções do período`. |
| `phrase.question` | ❓ | Confirmação antes de faturar: `❓ Emitir a nota fiscal para este pedido agora?`. |
| `phrase.critical` | 🚨 | Alerta do financeiro: `🚨 Saldo em conta insuficiente para os boletos de amanhã`. |
| `phrase.blocked` | ⛔ | Bloqueio de crédito no PDV: `⛔ Cliente com 2 títulos vencidos — venda a prazo negada`. |
| `phrase.pending` | 🕗 | Status do pedido no marketplace: `🕗 Aguardando confirmação do pagamento`. |
| `phrase.progress` | 🔄 | Barra de importação do catálogo: `🔄 Sincronizando 1.240 produtos com o e-commerce`. |
| `phrase.todo` | ☑️ | Item da rotina pessoal de fim de mês: `☑️ Conferir extrato do cartão antes do vencimento`. |
| `phrase.tip` | 💡 | Sugestão do sistema no dashboard: `💡 3 clientes inativos há 90 dias — vale uma campanha`. |
| `phrase.reminder` | 🔔 | Lembrete pessoal agendado: `🔔 IPVA vence em 5 dias`. |
| `phrase.new` | 🆕 | Notificação no painel comercial: `🆕 Novo lead cadastrado pelo formulário do site`. |
| `phrase.updated` | ♻️ | Log de auditoria do produto: `♻️ Preço alterado de R$ 24,90 para R$ 26,50 por Marcos`. |
| `phrase.deleted` | 🗑️ | Confirmação no cadastro: `🗑️ Item removido do pedido antes do faturamento`. |
| `phrase.archived` | 🗄️ | Filtro da carteira de clientes: `🗄️ Contrato encerrado — mantido no histórico`. |
| `phrase.approved` | 👍 | Fluxo de alçada de compras: `👍 Pedido de compra aprovado pelo gestor da filial`. |
| `phrase.rejected` | 👎 | Mesma alçada, caminho negativo: `👎 Reembolso recusado — sem comprovante anexado`. |
| `phrase.celebrate` | 🎉 | Fechamento do mês no painel da equipe: `🎉 Meta de vendas batida com 4 dias de antecedência`. |
| `phrase.security` | 🛡️ | Evento de auditoria: `🛡️ Novo acesso ao módulo financeiro a partir de um dispositivo desconhecido`. |
| `phrase.debug` | 🐛 | Log técnico da integração: `🐛 Timeout na chamada ao gateway de pagamento (tentativa 2/3)`. |

### `entity.*` — tipo da entidade

| Chave | Emoji | Exemplo real |
| --- | :---: | --- |
| `entity.customer` | 🧑‍💼 | Menu do CRM: `🧑‍💼 Clientes (1.847 ativos)`. |
| `entity.supplier` | 🚚 | Tela de compras: `🚚 Fornecedor Distribuidora Vale — entrega em 5 dias úteis`. |
| `entity.employee` | 👷 | Escala do RH: `👷 Equipe do turno da tarde — 6 colaboradores`. |
| `entity.company` | 🏢 | Seletor de empresa no topo do sistema: `🏢 Matriz — CNPJ 12.345.678/0001-90`. |
| `entity.store` | 🏪 | Relatório por ponto de venda: `🏪 Loja Shopping Norte — R$ 42.180 no mês`. |
| `entity.product` | 🛍️ | Catálogo do e-commerce: `🛍️ Camiseta básica — 4 variações de tamanho`. |
| `entity.stock` | 🏬 | Inventário: `🏬 Depósito central — 312 SKUs conferidos`. |
| `entity.order` | 🧾 | Histórico de compras do cliente: `🧾 Pedido #18342 — 3 itens — R$ 289,70`. |
| `entity.invoice` | 💳 | Contas a receber: `💳 Fatura de março — vencimento 10/04`. |
| `entity.contract` | 📜 | Gestão de contratos: `📜 Contrato de manutenção — renovação automática em 12 meses`. |
| `entity.report` | 📑 | Central de relatórios: `📑 DRE gerencial do 1º trimestre`. |
| `entity.bank` | 🏦 | Módulo financeiro: `🏦 Conciliação bancária — 8 lançamentos sem correspondência`. |
| `entity.tax` | 🏛️ | Calendário fiscal: `🏛️ Apuração do Simples Nacional — entregar até o dia 20`. |
| `entity.budget` | 🪙 | Orçamento pessoal do mês: `🪙 Categoria Mercado — R$ 380 restantes de R$ 1.200`. |
| `entity.expense` | 💸 | Lançamento no fluxo de caixa: `💸 Despesa fixa: energia elétrica R$ 640,12`. |
| `entity.income` | 🤑 | Entrada no controle pessoal: `🤑 Recebimento de freela — R$ 2.500 em 05/03`. |
| `entity.goal` | 🎯 | Painel do time comercial: `🎯 Meta de março: R$ 200.000 — 78% atingido`. |
| `entity.project` | 📌 | Quadro de iniciativas internas: `📌 Migração do PDV para a nova versão`. |
| `entity.meeting` | 🤝 | Agenda do vendedor: `🤝 Visita ao cliente Padaria Central — 14h`. |
| `entity.health` | 🩺 | Agenda pessoal: `🩺 Consulta de rotina — levar exames de sangue`. |
| `entity.home` | 🏠 | Orçamento doméstico: `🏠 Aluguel + condomínio: R$ 2.180 (38% da renda)`. |
| `entity.travel` | ✈️ | Prestação de contas de viagem: `✈️ Viagem a Curitiba — 4 despesas a reembolsar`. |
| `entity.education` | 🎓 | Plano de desenvolvimento do colaborador: `🎓 Curso de gestão de estoque — 60% concluído`. |
| `entity.subscription` | 🔁 | Assinaturas recorrentes: `🔁 Plano do sistema de gestão — R$ 149/mês, renova dia 12`. |

## Reconciliação com o emojidb (scraper)

`scripts/scrape-emojidb.ts` refaz a curadoria contra a fonte: para cada chave da biblioteca ele consulta `https://emojidb.org/<slug>-emojis`, trata o **primeiro resultado como o emoji canônico** daquela consulta e compara com o que já está no JSON.

```bash
npm run scrape                    # relatório, não altera nada
npm run scrape -- --key=entity.invoice
npm run scrape -- --query="fluxo de caixa"   # consulta avulsa, fora da biblioteca
npm run scrape -- --json > relatorio.json
npm run scrape:write              # aplica as divergências no data/emojis.json
```

Cada consulta é classificada:

| Status | Significado |
| :---: | --- |
| `=` `match` | o topo do emojidb é o que já está na biblioteca |
| `~` `diff` | o topo diverge, mas o emoji atual aparece no top-N (o relatório mostra em que posição) |
| `!` `absent` | o emoji atual nem aparece no ranking — o caso que mais merece revisão manual |
| `?` `empty` | a consulta não devolveu emoji nenhum |
| `x` `error` | falha de rede ou página inexistente |

```
~ entity.stock            atual 🏬  -> emojidb 📦  (atual em #2)
    top: 📦 🏬 🗄️ 📥 🏭
    https://emojidb.org/stock-emojis

77 consultas: 61 iguais, 12 divergentes, 2 sem o atual no ranking, 0 vazias, 2 com erro.
```

`--write` só altera entradas `diff` e `absent`, atualizando `emoji` e `codepoint` — `empty` e `error` são incertezas, não decisões. **Revise o diff antes de commitar**: o topo do emojidb é um bom palpite, não um veredito; em alguns casos a escolha atual é deliberadamente melhor para o contexto de gestão comercial.

### Comportamento de rede

- **1,5 s entre requisições** por padrão (`--delay=<ms>`), em série. O emojidb é um site pequeno; não o martele.
- **Cache em disco** em `.cache/emojidb/` (ignorado pelo git): reexecuções não tocam a rede. Use `--no-cache` ou `--cache=<dir>` para mudar.
- **Retentativa com backoff exponencial** (1s, 2s, 4s) em erro de rede, `429` e `5xx`; `404` é definitivo e não insiste.
- Timeout de 15 s por requisição e `User-Agent` identificando o projeto.
- Uma falha isolada não derruba o lote: vira um resultado `error`. O processo só sai com código `1` se mais de um terço das consultas falhar — o sinal de execução não confiável para o CI.

### Conferindo os seletores contra uma página real

`--fixture` roda **só o parser** contra um HTML salvo em disco, sem tocar a rede. É o jeito mais rápido de validar (ou consertar) os seletores:

```bash
curl https://emojidb.org/chart-emojis > /tmp/chart.html
npm run scrape -- --fixture=/tmp/chart.html
```

```
5 emojis extraidos de /tmp/chart.html, em ordem:
   1. 📊  U+1F4CA
   2. 📈  U+1F4C8
   3. 📉  U+1F4C9
   4. 🗃️  U+1F5C3 U+FE0F
   5. 🧮  U+1F9EE

Canonico proposto: 📊
```

Sai com código `1` e um aviso se nada for extraído — o sinal de que o markup mudou. Aceita `--top=<n>` e `--json`.

### Se o HTML do emojidb mudar

O parser é tolerante de propósito: primeiro tenta os nós de resultado (`class="emoji"`) e, se nada casar, varre o documento inteiro já sem `<script>`, `<style>`, `<svg>` e `<head>`. Nos dois caminhos a ordem do documento é preservada, que é o que define o ranking. Se o layout mudar a ponto de quebrar, ajuste apenas as constantes `RESULT_NODE` e `NOISE_BLOCKS` no topo do arquivo — o resto do pipeline não depende do markup.

Os testes cobrem o parser com HTML sintético (sequências ZWJ, tons de pele, bandeiras, keycaps, entidades HTML, markup alterado) e o pipeline de ponta a ponta contra um servidor HTTP local, incluindo `404`, retentativa em `503` e cache. Nada disso exige acesso ao emojidb.

## Estrutura

```
data/emojis.json     # a biblioteca: chave semântica -> emoji canônico
src/types.ts         # tipos públicos
src/library.ts       # índice, normalização, resolução e busca
src/server.ts        # API HTTP (node:http)
test/library.test.ts # testes da biblioteca e da API
scripts/scrape-emojidb.ts  # reconciliação da curadoria contra o emojidb
test/scraper.test.ts # testes do scraper (parser + pipeline sobre HTTP local)
```

## Licença

MIT.
