# S.C.O.P.E. · Análise de página (extensão Chrome)

Extensão interna da **V4 Company · Carvalho & Co.** Com um clique, o time vê uma análise rápida do site aberto no Chrome: o que está bom, o que tem problema e o que fazer, em notas de 1 a 5. Serve para reunião com cliente/prospect e para a análise prévia antes de montar uma proposta.

## Instalar (distribuição manual)

1. Baixe o `.zip` (`dist/scope-extension-vX.Y.Z.zip`, gerado por `npm run pack`) e **descompacte** numa pasta fixa.
2. No Chrome, abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta descompactada.
4. Fixe o ícone **S** na barra do Chrome.

Para atualizar: substitua os arquivos da pasta pela nova versão e clique em **recarregar** (↻) no card da extensão. Requer Chrome 116 ou superior.

## Como ler o resultado

A análise sempre separa dois **níveis**:

- **Site** — vale para o domínio inteiro, seja qual for a página aberta: versões do domínio (http/https, www), robots.txt, sitemap, tratamento de 404 e acesso de rastreadores de IA.
- **Página** — vale só para a URL aberta: indexabilidade, canonical, title, H1, links, imagens, schema, performance local e os itens específicos do tipo de página.

Cada item tem **nota de 1 a 5** (1 Crítico · 2 Ruim · 3 Regular · 4 Bom · 5 Excelente), **o que encontramos** e **o que fazer**. A lista vem do pior para o melhor. Situação: nota 1–2 = com problema · 3 = atenção · 4–5 = ok. A nota de cada nível é a média simples dos itens avaliados (itens "não verificado" não entram).

### Tipos de página

A extensão detecta o tipo da página (por schema, URL e sinais da página) e mostra um bloco de itens específicos no topo do nível página. Se detectar errado, corrija no seletor **Tipo de página**.

| Tipo | Itens específicos |
| --- | --- |
| **Produto** | Schema Product completo · coerência schema × preço visível · oferta e conversão (preço, botão de compra, disponibilidade) · avaliações · galeria de imagens · descrição e especificações · frete, prazo, troca e garantia · categoria e relacionados |
| **Serviço** | Schema de serviço · chamadas para ação (CTA) · formulário de contato/orçamento · prova social · estrutura da oferta (o que inclui, como funciona, para quem, benefícios, FAQ) · credenciais e autoridade · transparência de investimento · área de atuação |
| Home, categoria, artigo, institucional | Itens gerais; home avalia Organization/WebSite, artigo avalia autoria e datas, categoria avalia CollectionPage |

### Itens gerais

- **Técnico e rastreamento:** status HTTP · indexabilidade · canonical · HTTPS e conteúdo misto · versões do domínio · robots.txt · sitemap (inclui páginas de obrigado/erro/formulário no sitemap) · 404 · amostra de links internos quebrados.
- **Conteúdo e estrutura:** title · meta description · H1 · headings · URL · links internos · breadcrumbs · alt · volume de conteúdo · idioma/hreflang/Open Graph.
- **Dados estruturados e IA:** schema · Organization · páginas institucionais (E-E-A-T) · estrutura para respostas diretas · rastreadores de IA e `llms.txt` · dados locais (NAP).
- **Performance (medição local):** mobile · TTFB, LCP e CLS · peso · imagens · scripts de terceiros · renderização (HTML bruto × renderizado) · compressão.

## Exportar

Aba **Exportar**: copiar o resumo (Markdown), baixar `.md` ou `.csv` (uma linha por item, com nível, tema, nota, o que encontramos e o que fazer).

## Limites conhecidos

- **Uma página + domínio**, não rastreamento do site inteiro (páginas órfãs, crawl depth e canibalização continuam no Screaming Frog).
- **Performance** é medida no navegador de quem analisa e serve de indicativo; PageSpeed/CrUX, INP, Search Console e Semrush ficam para uma próxima etapa.
- **Certificado SSL:** a extensão só sabe que o navegador abriu a página sem alerta; validade e nota SSL Labs não são lidas.
- **HSTS** do navegador pode antecipar o redirecionamento http → https e esconder o http da checagem de versões.
- Texto de frete, avaliações etc. dentro de abas ou acordeões fechados pode não ser lido; confira antes de concluir.
- Sites com proteção anti-bot podem responder 403 às consultas automáticas; o item vira "não verificado".
- `chrome://`, Chrome Web Store e abas novas não podem ser analisados.
- Nada sai do navegador: não há servidor, conta nem envio de dados a terceiros. A extensão só consulta o próprio site analisado (`robots.txt`, `sitemap.xml`, `llms.txt`, variações do domínio, uma URL inexistente para o teste de 404 e uma amostra de links internos). Por isso pede acesso a todos os sites.

## Desenvolvimento

```bash
npm install        # só para os testes (jsdom)
npm test           # robots, notas, checagens com fixtures de produto e serviço
npm run pack       # gera dist/scope-extension-vX.Y.Z.zip
```

Estrutura: `lib/collector.js` (lê a página renderizada) · `lib/network.js` (robots, sitemap, variações, 404, links) · `lib/checks.js` (checagens, nível, tema e tipos de página) · `lib/scoring.js` (notas e médias) · `lib/report.js` (Markdown/CSV) · `sidepanel/` (interface).

Para **adicionar uma checagem**, inclua um objeto no array do tema em `lib/checks.js` (`id`, `dim`, `name`, `impact` — só ordena empates —, `dependency`, `types` opcional para limitar a tipos de página, e `run(ctx)` devolvendo `ok(nota, evidência, recomendação)` ou `NA(motivo)`). Itens de nível site entram em `SITE_LEVEL`. Cubra com um teste em `tests/checks.test.js`.
