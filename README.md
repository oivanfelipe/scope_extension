# S.C.O.P.E. · Análise prévia de SEO (extensão Chrome)

Extensão interna da **V4 Company · Carvalho & Co.** Com um clique, o time vê uma **análise prévia estrutural** do site que está aberto, seguindo a metodologia S.C.O.P.E.: nota de 1 a 5 por checagem, score por dimensão, prioridade por sprint e exportação para a proposta.

Pensada para reunião com cliente/prospect e para a análise prévia antes de montar uma proposta.

## Instalar (distribuição manual)

1. Baixe o `.zip` da extensão (`dist/scope-extension-vX.Y.Z.zip`, gerado por `npm run pack`) e **descompacte** numa pasta fixa.
2. No Chrome, abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta descompactada.
4. Fixe o ícone **S** na barra do Chrome.

Para atualizar: substitua os arquivos da pasta pela nova versão e clique em **recarregar** (↻) no card da extensão. Requer Chrome 116 ou superior.

## Usar

1. Abra a página que quer analisar (home, categoria, produto, artigo…).
2. Clique no ícone **S**: o painel lateral abre e a análise roda sozinha (5–15 s). Mantenha a aba ativa.
3. **Resumo:** score geral, itens por sprint, score por dimensão e principais prioridades.
4. **Achados:** todas as checagens com evidência, recomendação e cálculo Q × I × D. Filtre por dimensão ou sprint. Dá para ajustar a **nota manual** de qualquer item (a prioridade e o score recalculam).
5. **Exportar:** copiar o resumo (Markdown), baixar `.md` ou `.csv` (colunas pensadas para a planilha de acompanhamento do playbook).

Ao trocar de aba ou navegar, aparece um aviso para reanalisar. Se o tipo de página detectado estiver errado (home, categoria, produto, artigo, institucional), corrija no seletor: algumas checagens dependem dele.

## Como a nota é calculada

- **Escala exibida (igual aos relatórios):** 1 Crítico · 2 Ruim · 3 Regular · 4 Bom · 5 Excelente.
- **Prioridade (playbook):** `Qualidade × Impacto × Dependência`, máx. 125, com Qualidade = 6 − nota. Impacto e Dependência são fixos por checagem (definidos em `lib/checks.js`). Cortes: 80–125 Sprint 1 · 40–79 Sprint 2 · 15–39 Sprint 3 · < 15 Sprint 4. Nota 5 fica fora das sprints.
- **Score por dimensão:** média simples das notas avaliadas (itens "não aplicável" não entram). **Score geral:** média das dimensões avaliadas. Rótulos: < 1,5 Crítico · < 2,5 Ruim · < 3,5 Regular · < 4,5 Bom · ≥ 4,5 Excelente.

## O que a v1 analisa

| Dim. | Checagens |
| --- | --- |
| **S · Técnico** | Status HTTP · indexabilidade (meta robots / X-Robots-Tag) · canonical · HTTPS e conteúdo misto · versões do domínio (http/https, www) · robots.txt · sitemap.xml (inclui páginas de obrigado/erro/formulário no sitemap) · amostra de links internos quebrados/redirecionados |
| **C · Conteúdo & Arquitetura** | Title · meta description · H1 · hierarquia de headings · estrutura da URL · links internos · breadcrumbs · alt das imagens · volume de conteúdo · idioma/hreflang/Open Graph |
| **O · Orgânico & Keywords** | _Não avaliada na v1_ (exige Search Console / Semrush) |
| **P · Performance & UX** | Mobile-first · TTFB, LCP e CLS (medição local) · peso da página · imagens · scripts de terceiros e CSS bloqueante · renderização (HTML bruto × renderizado) · compressão e protocolo |
| **E · Entidades & Semântica** | Dados estruturados · schema por tipo de página · coerência schema × preço visível · Organization · páginas institucionais/E-E-A-T · autoria e datas · estrutura para respostas diretas · rastreadores de IA e `llms.txt` · dados locais (NAP) |

## Limites conhecidos

- **Análise de uma página + domínio**, não rastreamento do site inteiro (páginas órfãs, crawl depth e canibalização continuam no Screaming Frog).
- **Performance** é medida no navegador de quem analisa (TTFB, LCP, CLS) e serve de indicativo; o dado oficial de campo (CrUX/PageSpeed) e o INP entram na etapa 2.
- **Certificado SSL:** a extensão só sabe que o navegador abriu a página sem alerta; validade e nota SSL Labs não são lidas.
- **HSTS** do navegador pode antecipar o redirecionamento http → https e esconder o http da checagem de versões do domínio.
- Sites com proteção anti-bot podem responder 403 às consultas automáticas; nesses casos a checagem vira "não aplicável" em vez de nota.
- Páginas internas do Chrome (`chrome://`), Chrome Web Store e abas novas não podem ser analisadas.
- Nada sai do navegador: não há servidor, conta nem envio de dados a terceiros. A extensão só consulta o próprio site analisado (`robots.txt`, `sitemap.xml`, `llms.txt`, variações do domínio e uma amostra de links internos). Por isso pede a permissão de acesso a todos os sites.

## Desenvolvimento

```bash
npm install        # só para os testes (jsdom)
npm test           # robots, escala/prioridade, checagens com fixtures
npm run pack       # gera dist/scope-extension-vX.Y.Z.zip
```

Estrutura: `lib/collector.js` (lê a página renderizada) · `lib/network.js` (robots, sitemap, variações, links) · `lib/checks.js` (checagens e regras de nota) · `lib/scoring.js` (Q×I×D, sprints, médias) · `lib/report.js` (Markdown/CSV) · `sidepanel/` (interface).

Para **adicionar uma checagem**, inclua um objeto no array da dimensão em `lib/checks.js` com `id`, `dim`, `name`, `impact`, `dependency` e `run(ctx)` que devolva `ok(nota, evidência, recomendação)` ou `NA(motivo)`, e cubra com um teste em `tests/checks.test.js`.

## Próximas etapas sugeridas

PageSpeed/CrUX · Search Console · Semrush (dimensão O e Matriz T/P/R) · mini-crawl pelo sitemap · histórico por domínio.
