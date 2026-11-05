# Guildas da Alvorada

[Español](README.md) · [English](README.en.md) · [Português](README.pt.md) · [日本語](README.ja.md) · [العربية](README.ar.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

Um RTS de fantasia **open source**, jogável no navegador, com aldeões com
nome, guildas, construção, recursos, muralhas, combate e ordens em espanhol.

O escopo atual são batalhas e escaramuças contra a IA, com economia,
construção e combate em mapas descobertos. Não inclui campanhas.

![Gremios del Alba](assets/hero.png)

## Jogar localmente

Requisitos: **Node.js 24 ou posterior** e um navegador moderno. Não há dependências
npm para instalar.

```sh
git clone https://github.com/Oruga420/gremios-del-alba.git
cd gremios-del-alba
npm start
```

Abra **http://127.0.0.1:4173**. No Windows você também pode usar `PLAY.cmd`.
O servidor foi projetado para uso local e escuta em loopback.

## O que inclui

- Dez mapas completamente descobertos e quatro guildas originais.
- Coleta, transporte e depósito; os aldeões procuram recursos acessíveis
  quando o atual se esgota e mantêm a carga se faltar um depósito.
- Construção, reparo, muralhas e portões.
- Formações em linha, caixa e escalonada, com destinos individuais e rotas
  compartilhadas. A escolha se mantém ao mover o grupo.
- Pontos de encontro em recursos e hortas: os novos trabalhadores começam
  a coletar ao sair do edifício.
- Recrutamento, tecnologias, eras, comércio e limite de 1.000 habitantes por cidade.
- Cavaleiros, arqueiros, assassinos, magos, curandeiros e outros papéis; animações de
  combate, sangue e corpos.
- Salvar/carregar em JSON, seleção por arraste, grupos e minimapa.
- Parser de ordens em espanhol e ferramentas de página WebMCP.
- Agente de voz opcional com conta e credenciais do próprio usuário.

Selecione unidades arrastando; clique com o botão direito para dar uma ordem. Use os
cartões inferiores para construir ou treinar e a barra de espaço para pausar.
A ajuda do jogo contém mais controles. Com várias unidades selecionadas,
use os botões **Linha**, **Caixa** e **Escalonada** para reagrupá-las. Selecione
um produtor e clique com o botão direito em um recurso para enviar para lá seus novos
trabalhadores. O painel de seleção mostra a carga deles e se estão coletando,
depositando ou esperando um recurso ou depósito acessível.

Repetir uma ordem de coleta sobre o mesmo recurso mantém a tarefa,
a rota e a carga. Durante um avanço ofensivo, as unidades retomam seu destino
se não conseguirem alcançar um inimigo detectado automaticamente. Um ataque
explícito mantém o alvo que você escolheu.

## Voz e WebMCP

As ordens escritas e o jogo funcionam sem API keys. O reconhecimento de voz
do navegador depende da compatibilidade e das permissões dele. Exemplos de ordens:
**«construa uma casa»**, **«aldeões, colete madeira»**, **«forme em linha»**,
**«formação escalonada»**, **«mova os arqueiros em caixa para minha base»** e
**«ponto de encontro do Salão da Guilda para a floresta»**. Os destinos são resolvidos
com base no mundo atual. As ordens são executadas na hora, sem confirmação
nem necessidade de coordenadas; **«Pare»** detém as unidades.

Para o agente conversacional, crie seu próprio Agent privado na ElevenLabs e
copie `.env.example` para `.env`. Defina `ELEVENLABS_API_KEY` e
`ELEVENLABS_AGENT_ID`; depois reinicie o servidor. A chave permanece no
servidor. O uso do provedor é opcional e pode ter custo na sua conta.
`npm run voice:definition` exporta localmente uma definição com as ferramentas
do jogo; selecione sua voz e seu modelo no provedor ou pelas opções
do exemplo. Nenhum agente é criado e nenhuma chamada é feita ao instalar o jogo.

O reconhecimento offline é opcional e requer Python, Vosk, FFmpeg e um
modelo de espanhol. Configure `GUILD_PYTHON_PATH`, `GUILD_FFMPEG_PATH` e
`GUILD_VOSK_MODEL_PATH`. Não estão incluídos modelos nem gravações.

`PLAY-WEBMCP.cmd` inicia um Chrome compatível com a flag WebMCP e um perfil
local dedicado. O jogo informa a capacidade realmente disponível. Esse perfil
tem seu próprio salvamento: use exportar/importar JSON para transferir uma partida.

## Desenvolvimento e testes

```sh
npm test
npm run check
npm run build
```

`dist/` contém o cliente estático gerado. O servidor local inclui as
rotas de voz e reconhecimento offline; na Vercel, `api/guild.mjs` serve as
rotas do Sota sem depender de um computador ligado. O inventário de
ferramentas está em `docs/voice/clickables.json`; o contrato do motor está
em `docs/engine-interface.md`.

### Deploy na Vercel

Importe este repositório com Node 24 e mantenha `vercel.json`. O cliente é
compilado em `dist/`; as rotas `/api/*` são executadas como uma função Node sem
dependências adicionais. As partidas são salvas no seu navegador ou exportadas
para JSON. O reconhecimento offline do Vosk fica disponível na versão local;
no link público da Vercel, use a Voz do navegador ou escreva ordens.

Ative **Vercel Authentication → Standard Protection** no projeto. O
domínio de produção permite jogar sem fazer login. Os endereços únicos
de deploy permanecem privados: o Sota pessoal só emite autorizações a partir
do host protegido que a Vercel fornece em `VERCEL_URL`. A voz do navegador e
as ordens escritas estão disponíveis no jogo público. Defina como variáveis de
produção criptografadas `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`,
`GUILD_PUBLIC_ORIGIN` (a origem HTTPS exata), `GUILD_SESSION_SECRET` (aleatória,
com no mínimo 32 caracteres) e `GUILD_DEPLOYMENT_PROTECTION=vercel-auth`.
Não inclua os valores delas no GitHub. O indicador declara a proteção configurada;
não substitui o controle de acesso da Vercel. Não desative a proteção dos
endereços únicos se habilitar o agente pago. O domínio público nunca
emite autorizações da ElevenLabs, mesmo que tenha uma sessão e um CSRF válidos.

A sessão e o CSRF usam um cookie assinado, HttpOnly, Secure e SameSite. Os
limites de emissão e de chamadas simultâneas são por instância da função;
não equivalem a uma cota global nem a um limite de faturamento. Mantenha protegido
o acesso privado e configure os limites de uso no seu provedor. A chamada do
cliente termina após cinco minutos ou depois de 90 segundos de inatividade.

Há dois benchmarks opcionais de 120 segundos cada. Execute-os
separadamente para não misturar a carga deles:

```sh
npm run benchmark
node scripts/benchmark-formations.mjs
```

O primeiro mantém o cenário de combate e economia com 1.000 habitantes
por cidade; o segundo exercita as três formações com economia ativa.
Os relatórios locais gerados descrevem o cenário, as medições e seus
limites; não são incluídos resultados privados nem se presume o desempenho
em outro computador.

Os testes de navegador exigem instalar o Playwright e seu navegador
separadamente; não são uma dependência para jogar. Há regressões Python do harness e
um runner em `scripts/run-browser-acceptance.py`.

## Estado do projeto

É um protótipo em desenvolvimento. A separação local durante o movimento é
aproximada e permite sobreposições; continuam pendentes a interpolação visual
e melhorias do comportamento em situações densas. O desempenho com cargas
grandes depende do cenário e do hardware. O harness completo de navegador
apresentou problemas de encerramento do Chrome/Playwright; uma verificação parcial
não equivale a um E2E completo.

Movimento, formações e coleta são implementações próprias. A
pesquisa de referência com REA continua parcial: não recuperou os
algoritmos exatos de navegação, formação ou coleta de Age of Empires.
Não se afirma equivalência com o motor dele.

Este repositório contém código próprio e recursos gerados. Não contém um
motor comercial recuperado, arquivos de Age of Empires, dados de contas,
histórico privado de desenvolvimento nem chaves compartilhadas.

## Licenças e contribuições

**Código e documentação próprios: MIT. Arte incluída: CC BY 4.0**, com atribuição.
O software de terceiros mantém suas licenças. Consulte `LICENSE`,
`assets/LICENSE.md` e `THIRD_PARTY_NOTICES.md`.

Você pode usar, modificar e redistribuir o projeto respeitando essas licenças.
Issues e pull requests são bem-vindos. Para mudanças no motor, inclua um
teste reproduzível e evite apresentar medições parciais como aceitação completa.
