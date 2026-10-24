# Popup compacto — design

Data: 24/10/2026 · Status: revisada pelo builder, aguardando aprovação · Versão alvo: 1.2.0

## Intenção

Hoje, clicar no ícone abre `dashboard.html` em uma aba nova, com 9 botões e um fluxo de
quatro etapas: buscar, capturar, analisar e baixar. Para quem só quer baixar a aula que está
assistindo, isso é demais. O pedido é que o clique abra um **popup pequeno embaixo do ícone**,
como o do AdBlock, que **já chegue com tudo detectado** e tenha **poucos botões**.

O sucesso é abrir o popup e clicar **um** botão para baixar a aula da aba, ou **um** botão para
baixar o que falta do curso, sem recarregar a página e sem trocar de aba.

## Decisões do usuário

- Layout **B, "cartões no estilo AdBlock"** (mockup em
  `.superpowers/brainstorm/*/content/popup-layouts.html`, fora do git).
- A extensão **observa as abas HTTP(S) desde o carregamento**, para que o popup já abra com o
  vídeo detectado. Não é mais preciso clicar antes nem recarregar.
- O usuário não contestou as suposições da descrição: qualidade máxima automática, "Curso
  inteiro" baixa tudo o que falta sem lista de checkboxes, e o painel completo continua
  acessível pela engrenagem.
- **Numa página de curso, "Baixar esta aula" salva na pasta do curso**
  (`Categoria/Módulo/NN - Título`, com a mesma pasta e o mesmo nome que a fila usaria) e marca a
  aula como baixada no snapshot `sirmQueue:*`. Assim, "Baixar as Y que faltam" pula essa aula.
  Para isso, o popup lê o curso antes de habilitar esse botão. Fora de página de curso, o
  download é avulso, na pasta raiz, como hoje.

## Objetivos

1. `action.default_popup` = `popup.html`, com cerca de 340 px de largura e o visual roxo do
   SirM (tokens de `style.css`).
2. Cabeçalho: logo, "SirM Downloader", ícone de pasta (abre a pasta de downloads) e ícone de
   engrenagem (abre o painel completo atual em aba, para a aba de origem).
3. Hostname da aba em destaque.
4. **Cartão "Esta aula"**: título da aba ou da mídia, chip de qualidade (padrão "Melhor", com
   2160/1440/1080/720/480/MP3 em um menu) e o botão principal **"↧ Baixar esta aula"**.
   Durante o download, o botão dá lugar à barra de progresso (percentual, velocidade, tempo
   restante) e a um "Cancelar" discreto. No fim aparece "Salvo ✓" ou o motivo da falha.
5. **Cartão "Curso inteiro"**: só aparece quando `readCoursePage` encontra uma lista de aulas na
   aba. Mostra "N aulas · X já baixadas · Y faltando" e o botão secundário **"↧ Baixar as Y que
   faltam"**. Durante a fila, mostra "Aula k de Y", a barra da aula atual e "Parar fila".
6. Rodapé: status do auxiliar ("● Auxiliar conectado" ou "desconectado") e "Abrir pasta".
7. **Fechar o popup não interrompe nada.** Downloads avulsos e a fila do curso rodam em segundo
   plano. Ao reabrir, o popup mostra o estado atual.
8. Sem auxiliar instalado, o conteúdo vira um único cartão "Instale o auxiliar local" com o link
   do GitHub Releases e a instrução de executar `Instalar.cmd`.
9. Estados vazios claros: "Nenhum vídeo detectado ainda — dê play no vídeo" (com a lista
   atualizando sozinha enquanto o popup estiver aberto), página não HTTP, YouTube (aviso atual
   da política), vídeo com DRM.

## Fora do escopo

- Reescrever o painel completo. Ele continua com todas as funções atuais (origem manual, nome
  de arquivo, conexões, pasta da categoria, seleção individual de aulas, captura forçada) e é a
  saída para casos difíceis.
- Mudar o auxiliar nativo (`native/`) ou o protocolo dele.
- Suporte a novos sites ou formatos.

## O que não pode acontecer

- Reabrir o popup iniciar download sozinho.
- Gravar links de mídia assinados, Referer, cookies ou tokens em `storage.local`. Detecções ficam
  só em memória ou em `storage.session`, como hoje.
- Perder download em andamento por fechar o popup ou o painel.
- Recarregar a aba do usuário sem ele pedir.
- Mexer, limpar ou renomear downloads existentes. O ID da extensão e a `key` do manifesto se
  mantêm.

## Restrições técnicas

- **Hoje a conexão nativa vive na página do painel** (`dashboard.mjs`: `connectNative`, `jobs`,
  `startDownload`), e a fila do curso também (`batch-ui.mjs` + `queue.mjs`). Um popup morre
  quando perde o foco, então esse estado precisa ir para o contexto da extensão. A recomendação
  é mover para o service worker: em Chrome ≥ 105 um port de `connectNative` aberto mantém o
  service worker vivo, e o manifesto já exige 120. Se isso se mostrar instável em teste, o plano
  B é um offscreen document. **Escolha do builder, com justificativa no plano.**
- Popup e painel viram **clientes finos** de um único gerenciador de downloads em background. Os
  dois mostram o mesmo estado, e o painel também deixa de exigir "mantenha esta aba aberta".
- **Captura sempre ligada**: em `capture.mjs`, as abas passam a ser observadas sem depender de
  `action.onClicked`. Os limites atuais continuam (mapa de referências com teto de 1000, reset a
  cada navegação, limpeza em `tabs.onRemoved`, `storage.session`). Os custos de memória e CPU
  precisam continuar baixos com muitas abas: guardar candidatos só quando `mediaKind` reconhece
  mídia.
- Escolha automática da origem: a mesma preferência de hoje (HLS/DASH > arquivo de vídeo > URL
  da página para o yt-dlp), somando a varredura do DOM (`video/source` e `performance`
  resources) feita quando o popup abre.
- Limite atual de 3 tarefas simultâneas, retentativas com limite (`runLesson`, 3 tentativas),
  distinção entre cancelado, permanente e temporário: tudo mantido.
- Fila persistente do curso: o formato `sirmQueue:*` (`queueSnapshot`) continua compatível, para
  quem tem fila salva retomar.
- Pasta do curso: o nome lido da categoria (como o painel faz hoje, sem edição no popup).
- Textos em pt-BR. `npm run lint`, `npm test` e `npm run check` passam. Testes de integração
  gravam só em `work/`.

## Decisões tomadas pelo Claude (revisar)

Saíram da revisão do builder. O usuário pode reverter qualquer uma.

- **Uma fila de curso por vez, global.** O limite de 3 tarefas simultâneas vale para tudo
  junto (avulsos e fila). No curso B, enquanto a fila do curso A roda, o cartão "Curso inteiro"
  mostra "Fila de outro curso em andamento" com o botão desabilitado e um link para ver o
  progresso.
- **`destination_exists` na fila conta como "já baixada"** (`done`, com o rótulo "Já estava na
  pasta"). Não é tratado como falha. A contagem "X já baixadas" vem do snapshot `sirmQueue:*`,
  então pode subestimar até a primeira fila rodar, e isso é aceitável.
- **A fila precisa de intervenção** (categoria não identificada, `incomplete`, nomes
  duplicados): o popup não inicia. Mostra o motivo em uma linha e o botão "Revisar no painel
  completo", que abre o painel para a aba. Se, ao iniciar, o N for diferente do que o cartão
  mostrava, o cartão se atualiza e pede um novo clique.
- **Sem `probe` automático ao abrir o popup.** O título vem da aba e o chip oferece a lista
  fixa de qualidades ("Melhor" escolhe a maior disponível). DRM aparece como motivo da falha
  depois do clique, com o mesmo texto de hoje.
- **Sem retomada automática depois de um reinício do service worker ou do navegador.** Fila ou
  download interrompido aparece como "Interrompido — Retomar", e só continua com um clique
  (coerente com "reabrir nunca inicia download sozinho").
- Conexão nativa aberta sob demanda e fechada quando não há tarefas. A qualidade do chip vale
  também para a fila do curso.

## Deixado para o builder

- Estrutura de módulos do gerenciador em background e o protocolo de mensagens entre
  popup/painel e background (port ou `runtime.sendMessage` + broadcast).
- Como o popup descobre se a aba é um curso sem custo perceptível (rodar `readCoursePage` sem
  `expandModules` ao abrir e expandir só ao iniciar a fila).
- Detalhes visuais finos, acessibilidade (foco no botão principal, `aria-live` no progresso).
- Atualizar `README.md`/`LEIA-ME.md`, screenshots da store e `CHANGELOG.md`.
- Lembrete pós-atualização ao usuário: aguardar downloads ativos, fechar o painel antigo e
  recarregar a extensão.
