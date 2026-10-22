# Diagnóstico Rápido · V4 (extensão Chrome)

Extensão interna para **reunião de venda**. Com um clique mostra, em linguagem simples, se o site, o Instagram ou os anúncios do cliente estão bons ou ruins: um número grande em destaque e um checklist de ✅ / ⚠️ / ❌. O módulo é escolhido pelo endereço da aba aberta. Não substitui o S.C.O.P.E. (análise técnica de SEO, na raiz do repositório); aqui o objetivo é convencer, não detalhar.

## Instalar

1. Rode `npm run pack` nesta pasta (gera `dist/diagnostico-rapido-vX.Y.Z.zip`), ou use a própria pasta.
2. Em `chrome://extensions`, ative o **Modo do desenvolvedor** e clique em **Carregar sem compactação**.
3. Fixe o ícone **D**. Requer Chrome 116 ou superior.

## Como usar

1. Abra o site do cliente e clique no ícone **D**. A análise roda sozinha.
2. **Tela grande** abre o resultado numa aba, com letra maior, para projetar ou compartilhar a tela.
3. **Medir velocidade de novo** recarrega a página sem cache e mede outra vez (medição mais fiel).
4. **Baixar .md** ou **Copiar resumo** para a proposta ou para o WhatsApp.
5. O resultado de cada análise fica salvo por site, só neste navegador (`chrome.storage.local`), com a comparação com a análise anterior.

## O que é verificado (21 itens, 4 áreas)

| Área | Itens |
| --- | --- |
| **Velocidade** | tempo até o conteúdo principal aparecer (LCP) · resposta do servidor · quantidade de arquivos |
| **Estrutura do site** | HTTPS · título · descrição · H1 · alt das imagens · celular · bloqueio ao Google (noindex e robots.txt) · sitemap · schema |
| **Rastreamento** | Google Analytics 4 · Google Tag Manager · Pixel do Meta · tag do Google Ads |
| **Conversão** | botão de ação na primeira tela · WhatsApp · formulário · telefone clicável · provas de clientes |

Limites do tempo principal: até 2,5 s é bom, até 4 s é atenção, acima disso é ruim. Cada área e o geral recebem Bom (≥ 75%), Atenção (≥ 50%) ou Ruim.

## Instagram e Biblioteca de Anúncios (módulos em teste)

Abra o perfil (`instagram.com/nome`) ou a Biblioteca de Anúncios da Meta do anunciante e clique em **D**.

| Módulo | Número em destaque | Itens |
| --- | --- | --- |
| **Instagram** | taxa de engajamento `(curtidas + comentários) / seguidores` | reação aos posts · comentários · frequência semanal · último post · Reels · link na bio |
| **Anúncios Meta** | anúncios ativos lidos | anunciando agora · volume · mensagens diferentes · vídeo · anúncios antigos no ar · renovação · destino (site, WhatsApp) |

- **Instagram:** precisa estar logado. A extensão lê os 12 posts mais recentes do perfil (ignora os fixados) abrindo cada um em segundo plano, com pausa entre eles; seguidores, curtidas, comentários e datas vêm da página. A referência de engajamento é aproximada e depende do porte do perfil. Curtidas ocultas pelo perfil entram como "só comentários".
- **Anúncios:** lê só os anúncios já carregados na tela; role a página antes de analisar. A Biblioteca não mostra gasto nem resultado, então a análise é de presença, criativos e estratégia.
- Os dois dependem da estrutura das páginas, que o Instagram e a Meta podem mudar sem aviso, por isso aparecem como **módulo em teste**. Se um item vier "não verificado" ou errado, avise com a URL analisada para ajustar a leitura.

## Resumo com IA (opcional)

Em **Configurar IA**, escolha **Groq** ou **xAI (Grok)**, cole a chave da API e salve (o botão **Listar modelos** mostra os disponíveis; o padrão pode precisar de ajuste se o provedor aposentar o modelo). O botão **Gerar resumo com IA** escreve, em linguagem simples, os 3 pontos mais importantes, o que o cliente já faz bem e um próximo passo para a conversa; o texto entra no `.md`.

- A chave fica em `chrome.storage.local` (sem criptografia): use uma chave por pessoa.
- Só o resultado do checklist (nomes e achados dos itens) é enviado ao provedor; nunca o conteúdo da página.

## Limites conhecidos

- A velocidade é medida no navegador de quem analisa; é indicativo, não laudo.
- Rastreamento é **detecção na página aberta**: tags que só carregam após consentimento de cookies, ou dentro do GTM sem aparecer na rede, podem não ser vistas (nesses casos o item vira "Atenção", não "Ruim").
- Os itens de conversão são heurísticas sobre o que aparece na página (texto e elementos); confira na tela antes de afirmar ao cliente.
- No site, analisa só a página aberta e o domínio (robots.txt e sitemap). Nada sai do navegador, exceto o resumo opcional enviado à IA.
- `chrome://`, Chrome Web Store e abas novas não podem ser analisados.

## Desenvolvimento

```bash
npm test        # checagens, limites de velocidade, robots.txt e relatório
npm run pack
```

Para **adicionar um item**, inclua um objeto em `CHECKS` (`lib/checks.js`) com `id`, `group`, `name`, `why` e `run(dados, rede)` devolvendo `ok/warn/bad/na`. A coleta na página fica em `lib/collector.js` (função autocontida, roda na aba).

Próximas etapas previstas: Google Ads Transparency e LinkedIn Ad Library.
