# Diagnóstico Rápido · V4 (extensão Chrome)

Extensão interna para **reunião de venda**. Com um clique mostra, em linguagem simples, se o site, o Instagram ou os anúncios do cliente estão bons ou ruins: um número grande em destaque e um checklist de ✅ / ⚠️ / ❌. O módulo é escolhido pelo endereço da aba aberta. Não substitui o S.C.O.P.E. (análise técnica de SEO, na raiz do repositório); aqui o objetivo é convencer, não detalhar.

## Instalar

1. Rode `npm run pack` nesta pasta (gera `dist/diagnostico-rapido-vX.Y.Z.zip`), ou use a própria pasta.
2. Em `chrome://extensions`, ative o **Modo do desenvolvedor** e clique em **Carregar sem compactação**.
3. Fixe o ícone **D**. Requer Chrome 116 ou superior.

## Como usar

1. Abra o site do cliente e clique no ícone **D**. A análise roda sozinha.
2. **Tela grande** abre o resultado numa aba, com letra maior, para projetar ou compartilhar a tela.
3. **Medir velocidade de novo** recarrega a página sem cache e analisa outra vez.
4. **Baixar .md** ou **Copiar resumo** para a proposta ou para o WhatsApp.
5. O resultado de cada análise fica salvo por site, só neste navegador (`chrome.storage.local`), com a comparação com a análise anterior.

## Como cada resultado é apresentado

- **Número em destaque** (velocidade, engajamento ou anúncios ativos) com um parágrafo **"Na prática"** que explica a consequência em palavras simples.
- **Onde está perdendo clientes:** os 3 pontos de maior impacto, ruins antes dos de atenção e, em cada faixa, por peso.
- **Cada item ruim ou em atenção** mostra três linhas: **o que encontramos**, **o que isso causa** e **como resolver**. Os itens bons ficam recolhidos em "Ver o que está bom"; os que não puderam ser verificados ficam em "Não verificado".
- Os textos de "o que isso causa" e "como resolver" são fixos por item (`lib/checks.js`, `lib/instagram.js`, `lib/adlibrary.js`), em linguagem condicional ("tende a", "pode"), porque a extensão enxerga a página, não o faturamento do cliente. O `.md` traz as mesmas três linhas.

## Tipo de site

A extensão identifica o tipo do site (plataforma de loja, schema de produto, carrinho, preços e botões de compra) e **ajusta os itens**; o vendedor pode corrigir no seletor **Tipo de site**.

| Tipo | O que muda |
| --- | --- |
| **Loja virtual** | Não cobra formulário de contato nem telefone clicável. Avalia busca de produtos, carrinho e condições de compra (frete, parcelamento, pagamento, troca). |
| **Serviços e captação de contatos** (padrão) | Cobra formulário de contato e telefone clicável. |
| **Conteúdo e institucional** | Sem os itens de contato; os demais valem. |

## Velocidade: Google PageSpeed

O tempo em destaque vem do **Google PageSpeed Insights (celular, rede 4G simulada)**, o mesmo número que o cliente vê ao testar o site no Google. A API é gratuita, mas **sem chave a cota compartilhada costuma estourar**; crie uma chave gratuita (Google Cloud, ativando a "PageSpeed Insights API") e coloque-a em **Configurações** ou em `lib/config.local.js`:

```js
export const PSI_KEY = '<chave do Google PageSpeed>';
```

Sem a chave, a extensão usa a medição **neste computador** (em geral mais rápida que o PageSpeed), avisa na tela e deixa **"não verificados"** os itens que dependem do Google (travamento ao carregar e peso da página), sem contá-los na nota. Quando o peso é alto mas o site abre rápido, o item é só "atenção", para não contradizer o tempo.

## O que é verificado no site (4 áreas)

| Área | Itens |
| --- | --- |
| **Velocidade** | tempo até o conteúdo principal aparecer (LCP) · resposta do servidor · travamento ao carregar (TBT) · peso da página |
| **Estrutura do site** | HTTPS · título · descrição · H1 · alt das imagens · celular · bloqueio ao Google (noindex e robots.txt) · sitemap · schema |
| **Rastreamento** | Google Analytics 4 · Google Tag Manager · Pixel do Meta · tag do Google Ads |
| **Conversão** | botão de ação na primeira tela · WhatsApp · provas de clientes · formulário e telefone clicável (serviços) · busca, carrinho e condições de compra (loja) |

Limites do tempo principal: até 2,5 s é bom, até 4 s é atenção, acima disso é ruim. Cada área e o geral recebem Bom (≥ 75%), Atenção (≥ 50%) ou Ruim.

## Instagram e Biblioteca de Anúncios (módulos em teste)

Abra o perfil (`instagram.com/nome`) ou a Biblioteca de Anúncios da Meta do anunciante e clique em **D**.

| Módulo | Número em destaque | Itens |
| --- | --- | --- |
| **Instagram** | taxa de engajamento `(curtidas + comentários) / seguidores` | reação aos posts · comentários · frequência semanal · último post · Reels · link na bio |
| **Anúncios Meta** | anúncios ativos lidos | anunciando agora · volume · mensagens diferentes · vídeo · anúncios antigos no ar · renovação · destino (site, WhatsApp) |

- **Instagram:** precisa estar logado. A fonte principal é a **API interna do perfil** do Instagram, que traz, de uma vez e com números exatos, seguidores, bio, link na bio e os 12 posts mais recentes (curtidas, comentários, data e legenda; fixados ficam de fora). Os posts vêm do **feed do perfil** (2 páginas de 12, com data, curtidas, comentários e legenda), que dá a amostra para a frequência; se ele falhar, a lista da API do perfil completa as datas. Se nenhuma API responder, a extensão lê a página e abre cada post em segundo plano. A tela informa a fonte e quantos posts vieram com data; se a frequência não puder ser calculada, o item explica quantos posts tinham data. **Link na bio** tem três estados: só aparece "não tem" quando a API respondeu e nada indica um link; sem a API, vira "não foi possível confirmar". A referência de engajamento é aproximada e depende do porte do perfil. Curtidas ocultas pelo perfil entram como "só comentários".
- **Anúncios:** lê só os anúncios já carregados na tela; role a página antes de analisar. A Biblioteca não mostra gasto nem resultado, então a análise é de presença, criativos e estratégia.
- Os dois dependem da estrutura das páginas, que o Instagram e a Meta podem mudar sem aviso, por isso aparecem como **módulo em teste**. Se um item vier "não verificado" ou errado, avise com a URL analisada para ajustar a leitura.

## Análise com IA

A análise com IA **roda sozinha na primeira análise** (dá para desligar em Configurações) e o botão **Gerar de novo** refaz. Ela escreve, em linguagem simples: o diagnóstico em uma frase, os 3 pontos mais importantes (dos dados medidos), uma **leitura do conteúdo marcada como opinião da IA**, o que o cliente já faz bem e um próximo passo. O texto entra no `.md`.

- **Leitura do conteúdo** (opção marcada por padrão, que o vendedor pode desligar): a IA recebe também os textos públicos observados. No site, o título, os subtítulos, os botões e o início do texto. No Instagram, a bio e as legendas dos posts recentes. Nos anúncios, o texto dos anúncios ativos. Se não houver texto de verdade para ler (por exemplo, legendas vazias), a leitura não é pedida. Sem a opção, a IA recebe só o resultado do checklist. Nunca recebe dados de login nem de navegação, e a IA não vê imagens nem vídeos.
- **Provedor:** Groq (padrão, modelo `openai/gpt-oss-120b`) ou xAI (Grok), por API compatível com OpenAI. Em **Configurações** dá para usar a chave própria, e **Listar modelos** mostra os disponíveis (os provedores aposentam modelos; o padrão foi conferido na lista do Groq).
- **Chave da equipe:** o pacote distribuído pode levar a chave num arquivo `lib/config.local.js`, que **não vai para o GitHub** (está no `.gitignore`). Sem chave própria, a extensão usa essa. Formato do arquivo:

```js
export const DEFAULT_AI = { provider: 'groq', apiKey: '<chave>', model: '' };
```

  A chave fica legível para quem tiver a pasta da extensão: não circule o `.zip` fora do time e troque a chave se ele vazar. Chaves digitadas em "Configurações" ficam em `chrome.storage.local`, sem criptografia.

## Limites conhecidos

- Sem a chave do PageSpeed, a velocidade é medida no navegador de quem analisa e serve só como indicativo.
- Rastreamento é **detecção na página aberta**: tags que só carregam após consentimento de cookies, ou dentro do GTM sem aparecer na rede, podem não ser vistas (nesses casos o item vira "Atenção", não "Ruim").
- Os itens de conversão são heurísticas sobre o que aparece na página (texto e elementos); confira na tela antes de afirmar ao cliente.
- No site, analisa só a página aberta e o domínio (robots.txt e sitemap). Nada sai do navegador, exceto o que é enviado à IA quando o vendedor pede a análise.
- `chrome://`, Chrome Web Store e abas novas não podem ser analisados.

## Desenvolvimento

```bash
npm test        # checagens, limites de velocidade, robots.txt e relatório
npm run pack
```

Para **adicionar um item**, inclua um objeto em `CHECKS` (`lib/checks.js`) com `id`, `group`, `name` (texto quando está bom), `weight` (1 a 10, usado na ordem de "onde está perdendo clientes"), `problem` (título quando está ruim), `cost` (o que isso causa), `fix` (como resolver) e `run(dados, rede)` devolvendo `ok/warn/bad/na`. O teste acusa se faltar algum campo. A coleta na página fica em `lib/collector.js` (função autocontida, roda na aba).

Próximas etapas previstas: Google Ads Transparency e LinkedIn Ad Library.
