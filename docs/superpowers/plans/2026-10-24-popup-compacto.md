# Popup compacto — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a aba `dashboard.html` por um popup compacto (layout B) que já abre com o vídeo detectado, enquanto downloads e fila de curso rodam no service worker.

**Architecture:** Toda a lógica que hoje fica na página do painel vai para módulos do background:
- conexão nativa;
- tarefas de download;
- fila do curso;
- resolvedor de aulas.

Um roteador (`hub.mjs`) atende popup e painel por um port `sirm-ui` e transmite atualizações. O popup recebe um "view model" pronto, calculado por uma função pura (`view-model.mjs`). A captura de rede passa a observar todas as abas HTTP(S) desde o carregamento.

**Tech Stack:** Chrome MV3 (≥ 120), ES modules sem bundler, `node:test` + `node:assert/strict` com fakes de `chrome`, ESLint (`npm run lint`).

**Spec:** `docs/superpowers/specs/2026-10-24-popup-compacto-design.md`

## Global Constraints

- Manter a `key` do manifesto e o ID da extensão. `com.turbovideo.downloader` e `turbovideo-batch` continuam como identificadores internos.
- O auxiliar nativo (`native/`) e o protocolo dele não mudam.
- Nunca gravar em `storage.local` URL de mídia assinada, Referer, cookie, token ou stdout/stderr. Detecções ficam só em memória e em `storage.session`.
- Reabrir popup ou painel, ou reiniciar o service worker, nunca inicia download sozinho.
- Nunca recarregar a aba do usuário sem pedido explícito (o botão "Capturar player" do painel continua sendo o único caminho).
- No máximo 3 tarefas de download simultâneas no total. No máximo uma fila de curso por vez. No máximo 3 tentativas por aula (`runLesson`).
- O formato `sirmQueue:*` (`queueSnapshot`, `version:1`) continua compatível.
- Textos visíveis em pt-BR. Versão alvo `1.2.0` em `extension/manifest.json` e `package.json`.
- Testes de integração gravam só em `work/`. `npm run lint` e `npm test` precisam passar ao fim de cada task.
- Commits só se o usuário tiver autorizado nesta sessão (AGENTS.md). Sem autorização, o passo "Commit" vira "registrar arquivos tocados".

## Review Focus

1. **Aba carregada antes da instalação ou atualização da extensão** (sem estado de captura): o popup faz a varredura do DOM, e sem mídia mostra "Nenhum vídeo detectado ainda — dê play no vídeo". Teste na Task 5.
2. **Auxiliar cai no meio de um download:** a tarefa aparece como interrompida, com motivo, e a fila para sem retomar sozinha. Testes nas Tasks 3 e 4.
3. **Popup e painel abertos ao mesmo tempo, ou clique duplo em Baixar:** uma única tarefa por `(url, folder, module, filename, quality)` em andamento, e os dois clientes recebem o mesmo estado. Teste na Task 3.
4. **Service worker reinicia com fila registrada como `running`:** ela volta como `interrupted` e só continua com `resumeCourse`. Teste na Task 4.
5. **Muitas abas e muitas requisições:** só respostas que `mediaKind` reconhece viram candidatos, o mapa de referências fica limitado a 1000 e os candidatos a 150 por aba. Teste na Task 2.

---

### Task 1: Origem preferida compartilhada e resolvedor de aulas reutilizável

**Files:**
- Modify: `extension/media.mjs`, `extension/batch.mjs`
- Test: `tests/media.test.mjs`, `tests/batch.test.mjs`

**Interfaces:**
- Produces:
  - `preferredSource(items: Array<{url,kind?,referer?}>): {url,kind:'HLS'|'DASH'|'Vídeo',referer:string}|undefined` em `media.mjs`. É o `preferred` atual de `batch.mjs`, movido sem mudar o comportamento.
  - `createLessonResolver(chrome, capture, {timeoutMs=45000,pollMs=300}={}): {resolve(url:string): Promise<{url,kind,referer}>, stop(): void, close(): Promise<void>}` em `batch.mjs`. `resolve` rejeita com um `Error` que tem `{code, retryable}`, com as mesmas mensagens e códigos de hoje. `installBatch` passa a ser um wrapper fino de port sobre `createLessonResolver`.

- [ ] **Step 1:** Em `tests/media.test.mjs`, criar o teste `preferredSource prefers manifests with referer and ignores fragments`. Ele recebe `[{url:'https://a.test/v.mp4'},{url:'https://a.test/s.ts'},{url:'https://a.test/m.m3u8',referer:'https://p.test/'}]` e verifica com `assert.deepEqual` que o retorno é `{url:'https://a.test/m.m3u8',kind:'HLS',referer:'https://p.test/'}`, e que `preferredSource([])===undefined`.
- [ ] **Step 2:** Em `tests/batch.test.mjs`, criar o teste `createLessonResolver resolves without a port and close removes the owned tab`. Ele usa o mesmo `setup` de fakes, chama `createLessonResolver(chrome,capture,{timeoutMs:30,pollMs:2})` e `await r.resolve('https://course.test/a')` com `tabs.update` injetando `manifest`. Verifica que `source.url===manifest.url` e, depois de `await r.close()`, que `log` contém `['remove',80]`.
- [ ] **Step 3:** Rodar `npm test`. Esperado: os dois testes novos falham com "not a function" ou "does not provide an export".
- [ ] **Step 4:** Mover `preferred` para `media.mjs` como `preferredSource`. Extrair o corpo de `resolve`/`close`/`pause` de `installBatch` para `createLessonResolver`. `installBatch` cria um resolvedor por port e traduz as mensagens `resolve|stop|finish` como hoje.
- [ ] **Step 5:** Rodar `npm test` e `npm run lint`. Esperado: tudo passa, incluindo os 12 testes antigos de `batch.test.mjs`.
- [ ] **Step 6:** Commit `refactor: resolvedor de aulas e origem preferida reutilizáveis`.

### Task 2: Captura sempre ligada

**Files:**
- Modify: `extension/capture.mjs`
- Test: `tests/capture.test.mjs`

**Interfaces:**
- Consumes: nada novo.
- Produces: `installCapture(chrome)` continua retornando `{arm, read, release}` e ganha `sources(tabId): Promise<{url,generation,items}>`, um alias público de `read` para o hub. Não registra mais `chrome.action.onClicked`.

- [ ] **Step 1:** Trocar o teste `ignores unselected tabs…` por `watches every http tab from navigation and ignores non-http tabs`. O teste emite `tabs.onUpdated(20,{status:'loading'},{url:'https://site.test/v'})`, depois o par `onBeforeSendHeaders`/`onHeadersReceived` de `https://cdn.test/a.mp4` com `Content-Type: video/mp4`, e verifica 1 item em `sources(20)`. Repetir com `chrome://newtab` na aba 21 e verificar `items` vazio. Manter no mesmo teste a parte "rejects commands from regular webpages".
- [ ] **Step 2:** Criar o teste `non-media responses are never stored and candidates stay bounded`. Ele emite 200 respostas `text/html` (verifica 0 itens) e 200 respostas `.mp4` distintas (verifica `items.length===150`).
- [ ] **Step 3:** Ajustar os testes que usam `chrome.action.onClicked.emit` para usar `tabs.onUpdated` com `status:'loading'`. Rodar `npm test`. Esperado: os testes novos falham.
- [ ] **Step 4:** Em `tabs.onUpdated`, quando a URL for `http(s)` e não houver estado, criar `{url,generation:1,items:[]}` com `save`. Remover o listener `action.onClicked`. Os outros limites ficam como estão.
- [ ] **Step 5:** Rodar `npm test` e `npm run lint`. Esperado: tudo passa.
- [ ] **Step 6:** Commit `feat: captura observa abas desde o carregamento`.

### Task 3: Cliente nativo e gerenciador de downloads no background

**Files:**
- Create: `extension/native-client.mjs`, `extension/downloads.mjs`
- Test: `tests/downloads.test.mjs`

**Interfaces:**
- Produces:
  - `createNativeClient(chrome, {host='com.turbovideo.downloader'}={})` →
    - `ensureReady(): Promise<ReadyInfo>`, onde `ReadyInfo={folder,parallel,supportsFilename,supportsFolders,supportsModules}`. Faz `connectNative` + `hello` e espera `ready` por 10 s. Rejeita com `{code:'native_unavailable',retryable:false}`.
    - `send(msg): boolean`
    - `request(msg:{type:'probe',...}, {timeoutMs=90000}): Promise<reply>`, que casa a resposta por `id`.
    - `onMessage(fn)` e `onStatus(fn)`
    - `status(): {state:'idle'|'connecting'|'ready'|'missing'|'disconnected', info?:ReadyInfo, reason?:string}`
    - `hold(key)` / `release(key)`: o port fecha quando não há mais `hold` ativo.
  - `createDownloadManager({native, limit=3})` →
    - `start(req:{url,referer?,filename?,quality,connections?,folder?,module?,title}): {id, done: Promise<{type:'complete'|'error'|'cancelled',code?,retryable?,message?,file?}>}`
    - `cancel(id)`
    - `list(): Job[]`, onde `Job={id,title,status:'starting'|'downloading'|'processing'|'complete'|'error'|'cancelled'|'interrupted',percent:number|null,speed,eta,message,file}`. Não guarda URL.
    - `onChange(fn)`
    - `start` lança `{code:'limit'}` quando já há 3 ativas. Se já existir uma ativa com a mesma chave `url|folder|module|filename|quality`, devolve a existente.

- [ ] **Step 1:** Escrever `tests/downloads.test.mjs` com um fake de `chrome.runtime.connectNative` que devolve um port controlável (`onMessage`/`onDisconnect`/`postMessage`) e com estes testes:
  - `ensureReady connects once and reports ready info`: dois `ensureReady()` concorrentes geram 1 `connectNative` e 1 `hello`.
  - `missing host rejects with native_unavailable`: o fake lança, ou desconecta com `lastError`.
  - `progress, complete and job list never expose the media url`: `JSON.stringify(m.list())` não contém `https://cdn`.
  - `fourth concurrent start throws limit; duplicate start returns the same job`.
  - `native disconnect marks active jobs interrupted with native_disconnected and retryable true`.
  - `cancel sends cancel and resolves cancelled`.
  - `port closes when no hold remains and no job is active`.
- [ ] **Step 2:** Rodar `npm test`. Esperado: FAIL, porque os módulos não existem.
- [ ] **Step 3:** Implementar `native-client.mjs` portando `connect`/`ensureNativeReady`/`handle('ready')` de `dashboard.mjs`. O cliente faz `hold('job:'+id)` enquanto uma tarefa estiver ativa. Um port nativo aberto mantém o service worker vivo (Chrome ≥ 105).
- [ ] **Step 4:** Implementar `downloads.mjs` portando `startDownload` e o tratamento `progress|processing|complete|error|cancelled` de `dashboard.mjs`. Os textos de status são os mesmos de hoje. `percent` = `downloaded/total*100` ou `null`.
- [ ] **Step 5:** Rodar `npm test` e `npm run lint`. Esperado: tudo passa.
- [ ] **Step 6:** Commit `feat: downloads e conexão nativa no service worker`.

### Task 4: Fila de curso global no background

**Files:**
- Create: `extension/course-runner.mjs`
- Test: `tests/course-runner.test.mjs`

**Interfaces:**
- Consumes: `createLessonResolver` (Task 1), `createDownloadManager`/`createNativeClient` (Task 3), `readCoursePage`, `orderedLessons`, `runLesson`, `queueSnapshot`, `queueKey`.
- Produces: `createCourseRunner({chrome, downloads, native, makeResolver, storage=chrome.storage.local})` →
  - `inspect(tabId): Promise<CourseInfo|null>`, onde `CourseInfo={key,category,total,done,pending,currentLesson?:{url,filename,moduleFolder},blocked?:string}`. Usa `readCoursePage({expandModules:false})` e mescla com o snapshot salvo. `null` quando a página não é curso (nenhuma aula com `classId`).
  - `start(tabId, {quality, lessons?, folder?}): Promise<void>`. Usa `expandModules:true`. `lessons` e `folder` só são passados pelo painel. Recusa com `blocked` nos casos:
    - "Não identifiquei o nome da categoria no site. Revise no painel completo."
    - `incomplete`, com os avisos de `readCoursePage`
    - nomes duplicados
    - "Fila de outro curso em andamento."
    - total diferente do `inspect` anterior, com "A lista de aulas mudou. Confira e clique de novo."
  - `downloadCurrent(tabId, {quality}): Promise<{id}>`: baixa a aula da aba em `folder=category`, `module=moduleFolder`, `filename` numerado, e marca `done` no snapshot quando termina.
  - `stop()`, `resume()` e `state(): RunState`, onde `RunState={status:'idle'|'running'|'stopping'|'interrupted'|'finished',key?,title?,index?,total?,completed?,failed?,jobId?,message?}`.
  - `onChange(fn)`
  - `restore(): Promise<void>`: na inicialização, se `storage.local['sirmRun']` estiver `running`, grava e expõe `interrupted`. Não inicia nada.
  - `sirmRun` guarda só `{status,key,index,total,completed,failed,quality}`.

- [ ] **Step 1:** Escrever `tests/course-runner.test.mjs` com fakes de `scripting.executeScript` (devolve `{category,anchors,incomplete,warnings}`), de `storage.local` em memória, de `downloads` (devolve um `done` controlável) e de `makeResolver`. Testes:
  - `inspect returns null outside a course and counts done from snapshot`
  - `start downloads only pending lessons into category/module with numbered names`
  - `destination_exists marks the lesson done labelled "Já estava na pasta"`
  - `blocked reasons: missing category, incomplete, duplicate names, other course running, total changed`: cada caso sem nenhuma chamada a `downloads.start`.
  - `restore turns a running record into interrupted and never starts`: `downloads.start` com 0 chamadas.
  - `resume continues from the first pending lesson`
  - `native_unavailable stops the queue and keeps progress`
  - `downloadCurrent saves into the course folder and marks done`
  - `persisted sirmRun and sirmQueue never contain media urls or referer`
- [ ] **Step 2:** Rodar `npm test`. Esperado: FAIL, porque o módulo não existe.
- [ ] **Step 3:** Implementar portando o laço de `bulk-start` e `restore` de `batch-ui.mjs`. O laço chama `native.hold('course')` enquanto a fila estiver `running` e `release` no fim. O resolvedor é criado por execução e fechado no `finally`. A regra de `continueOnError` do painel é mantida quando ele passa essa opção. No popup ela é `false`.
- [ ] **Step 4:** Rodar `npm test` e `npm run lint`. Esperado: tudo passa.
- [ ] **Step 5:** Commit `feat: fila de curso global no service worker`.

### Task 5: View model do popup

**Files:**
- Create: `extension/view-model.mjs`
- Test: `tests/view-model.test.mjs`

**Interfaces:**
- Consumes: `preferredSource`, `blockedSite`, os formatos `Job`/`RunState`/`CourseInfo`/`native.status()`.
- Produces: `popupView({tab:{id,url,title}, sources:{items}, domSources:Array, course:CourseInfo|null, run:RunState, jobs:Job[], native}) → View`:
  - `View.mode`: `'install'|'unsupported'|'youtube'|'ready'`. `install` quando `native.state==='missing'`, `unsupported` quando a URL não é `http(s)`.
  - `View.host`
  - `View.lesson`: `{title, state:'empty'|'ready'|'busy'|'done'|'error', job?, message?}`. O estado é `empty` sem `preferredSource` e sem `course.currentLesson`, com a mensagem `Nenhum vídeo detectado ainda — dê play no vídeo`.
  - `View.course`: `null|{total,done,pending,state:'ready'|'running'|'blocked'|'otherRunning'|'interrupted'|'complete', message?, run?}`
  - `View.footer`: `{connected:boolean}`

- [ ] **Step 1:** Escrever estes testes, cada um com `assert.deepEqual` em campos-chave:
  - `install mode when native missing`
  - `unsupported for chrome:// tab`
  - `youtube notice for youtube.com`
  - `empty lesson with dê play message when no sources (tab opened before install)`
  - `ready lesson from dom sources only`
  - `busy lesson shows job percent`
  - `course card hidden when course is null`
  - `otherRunning when run.key differs from course.key`
  - `interrupted course offers resume`
  - `complete when pending is 0`
- [ ] **Step 2:** Rodar `npm test`. Esperado: FAIL.
- [ ] **Step 3:** Implementar como função pura, sem `chrome`. Os textos ficam como constantes exportadas no topo do arquivo.
- [ ] **Step 4:** Rodar `npm test` e `npm run lint`. Esperado: tudo passa.
- [ ] **Step 5:** Commit `feat: view model do popup`.

### Task 6: Hub de mensagens, background e manifesto

**Files:**
- Create: `extension/hub.mjs`
- Modify: `extension/background.mjs`, `extension/manifest.json`, `package.json`
- Test: `tests/hub.test.mjs`

**Interfaces:**
- Consumes: tudo das Tasks 1 a 5.
- Produces: `installHub(chrome, {capture, native, downloads, course, scanDom})`. Aceita só `runtime.onConnect` com `name==='sirm-ui'`, `sender.id===runtime.id` e `sender.url` dentro da extensão. Mensagens do cliente → resposta `{type:'reply', rid, ok, data|message}`:

  | Mensagem | O que faz |
  |---|---|
  | `{rid,type:'view',tabId}` | → `popupView(...)`. Chama `scanDom(tabId)` antes. |
  | `{rid,type:'downloadLesson',tabId,quality}` | `course.downloadCurrent` em página de curso, senão `downloads.start` com `preferredSource`. |
  | `{rid,type:'downloadCourse',tabId,quality,lessons?,folder?,continueOnError?}` | Inicia a fila do curso. |
  | `{rid,type:'download',url,referer?,filename?,quality,connections?}` | Download direto do painel. |
  | `{rid,type:'probe',url,referer?}` | Repassa o probe ao auxiliar. |
  | `{rid,type:'cancel',id}` | Cancela uma tarefa. |
  | `{rid,type:'stopCourse'}` | Para a fila. |
  | `{rid,type:'resumeCourse'}` | Retoma a fila interrompida. |
  | `{rid,type:'openFolder'}` | Abre a pasta de downloads. |
  | `{rid,type:'openPanel',tabId}` | `tabs.create({url:'dashboard.html?tab='+tabId})`. |
  | `{rid,type:'capture',tabId}` | Repassa a captura forçada do painel. |

  Em qualquer `onChange`/`onStatus` o hub envia `{type:'update'}` a todos os ports.
  `scanDom(tabId): Promise<Array<{url,kind,referer}>>` é a varredura `video/source/performance` que hoje está em `dashboard.mjs` (`scan`), movida para o hub.

- [ ] **Step 1:** Escrever estes testes:
  - `rejects ports from web pages or other names`
  - `view reply carries popupView and never the raw media url when no job`
  - `downloadLesson outside course starts one job with preferred source and referer`
  - `downloadLesson on course page delegates to course.downloadCurrent`
  - `changes broadcast update to every connected port`
  - `reopening (new port + view) never starts a download`: `downloads.start` com 0 chamadas.
- [ ] **Step 2:** Rodar `npm test`. Esperado: FAIL.
- [ ] **Step 3:** Implementar `hub.mjs`. Em `background.mjs`, a sequência é:
  1. `installCapture`
  2. `installBatch`, mantido enquanto o painel usar o port antigo (removido na Task 8)
  3. `createNativeClient`, `createDownloadManager` e `createCourseRunner({makeResolver:()=>createLessonResolver(chrome,capture)})`
  4. `await course.restore()`
  5. `installHub`
- [ ] **Step 4:** No manifesto, colocar `"action": {"default_popup": "popup.html", ...}` (os ícones e o título continuam) e `"version": "1.2.0"`. Em `package.json`, `"version": "1.2.0"`. A `key` não muda.
- [ ] **Step 5:** Rodar `npm test` e `npm run lint`. Esperado: tudo passa.
- [ ] **Step 6:** Commit `feat: hub do background e popup como ação`.

### Task 7: Popup (UI)

**Files:**
- Create: `extension/popup.html`, `extension/popup.mjs`, `extension/popup.css`
- `scripts/build.mjs` não muda: ele copia a pasta inteira (`list()` recursivo).

**Interfaces:**
- Consumes: o port `sirm-ui` e o `View` (Task 5).
- Produces: nenhuma API. A UI segue o mockup B (`.superpowers/brainstorm/*/content/popup-layouts.html`).

- [ ] **Step 1:** Criar `popup.html` com 340 px de largura. Usar a fonte e os tokens de `style.css` (importados ou duplicados em `popup.css`, sem o fundo gradiente de página inteira). Estrutura:
  - cabeçalho: logo `icons/icon-32.png`, "SirM Downloader", botão pasta (`aria-label="Abrir pasta"`) e botão engrenagem (`aria-label="Abrir painel completo"`);
  - `#host`;
  - `#lesson` (cartão);
  - `#course` (cartão, `hidden` por padrão);
  - `#install` (cartão, `hidden`);
  - rodapé com `#status` (`aria-live="polite"`).
- [ ] **Step 2:** `popup.mjs` faz o seguinte:
  - obtém a aba ativa (`tabs.query({active:true,currentWindow:true})`);
  - conecta `sirm-ui`;
  - pede `view` ao abrir, a cada `update` e a cada 1,5 s enquanto `lesson.state==='empty'`;
  - renderiza o `View`.

  Botões e mensagens que dispara:

  | Elemento | Mensagem |
  |---|---|
  | `↧ Baixar esta aula` | `downloadLesson` |
  | `↧ Baixar as Y que faltam` | `downloadCourse` |
  | `Cancelar` | `cancel` |
  | `Parar fila` | `stopCourse` |
  | `Retomar` | `resumeCourse` |
  | `Revisar no painel completo` / engrenagem | `openPanel` |

  O chip de qualidade é um `<select>` com as opções `best`/2160/1440/1080/720/480/`audio` e os rótulos "Melhor", "2160p" … "MP3". A escolha fica salva em `storage.local['sirmPopupQuality']`, que guarda só esse valor. Ao abrir, o foco vai para o botão principal habilitado. Nenhum envio de download acontece na inicialização.
- [ ] **Step 3:** Rodar `npm run lint`. Esperado: passa.
- [ ] **Step 4:** Verificação manual (registrar o resultado real): carregar a pasta `extension/` descompactada no Chrome. Depois:
  1. Abrir uma página com um `<video>` MP4 público de teste, dar play e clicar no ícone. O popup abre sem aba nova, com o vídeo detectado.
  2. Baixar e fechar o popup no meio. Reabrir e ver o progresso continuando.
  3. Abrir o popup em `chrome://extensions` e ver "Abra uma página com vídeo".

  Os downloads de teste vão para a pasta configurada. Usar uma pasta em `work/` se o auxiliar permitir. Se não houver ambiente para isso, registrar "não verificado manualmente".
- [ ] **Step 5:** Commit `feat: popup compacto estilo cartões`.

### Task 8: Painel completo como cliente fino

**Files:**
- Modify: `extension/dashboard.mjs`, `extension/batch-ui.mjs`, `extension/dashboard.html`, `extension/background.mjs`, `extension/batch.mjs`
- Test: `tests/batch.test.mjs`, só se `installBatch` for removido

**Interfaces:**
- Consumes: o port `sirm-ui` (Task 6) e `Job`/`RunState`.
- Produces: o painel sem `connectNative` e sem laço de fila próprio.

- [ ] **Step 1:** Em `dashboard.mjs`, trocar `connect`, `send`, `startDownload` e `handle` por chamadas ao hub:
  - `download`, `probe`, `cancel`, `openFolder` e `capture`;
  - o status do auxiliar vem de `view.footer` e de `native.status`, expostos no reply `view`;
  - os cartões de tarefa são renderizados a partir de `jobs`;
  - `scan` passa a usar o `view`.

  Remover o handler `beforeunload` e o aviso "Mantenha este painel aberto…". O novo texto do `#notice` é "Os downloads continuam mesmo se você fechar este painel."
- [ ] **Step 2:** Em `batch-ui.mjs`, a seleção, os nomes, a pasta e "Limpar histórico" continuam locais. "Baixar selecionadas" envia `downloadCourse` com `{lessons: selecionadas, folder, continueOnError}`, e "Parar fila" envia `stopCourse`. O status da fila vem do `RunState` em cada `update`. Remover `openConnection`, `resolveLesson` e o laço `runLesson`.
- [ ] **Step 3:** Remover `installBatch` de `background.mjs` e o wrapper de port em `batch.mjs`. Adaptar os testes de `batch.test.mjs` para `createLessonResolver`: mesmos cenários, chamando `resolve`/`stop`/`close` direto, e remover `rejects untrusted runtime ports`, que passa a ser coberto em `hub.test.mjs`.
- [ ] **Step 4:** Rodar `npm test` e `npm run lint`. Esperado: tudo passa.
- [ ] **Step 5:** Verificação manual: abrir o painel pela engrenagem, iniciar um download, fechar o painel e conferir no popup que o download continua. Registrar o resultado real.
- [ ] **Step 6:** Commit `refactor: painel completo usa o gerenciador do background`.

### Task 9: Documentação e fechamento da versão

**Files:**
- Modify: `CHANGELOG.md`, `README.md`, `LEIA-ME.md`, `store/LISTING.md` (se citar "painel em aba")

- [ ] **Step 1:** Em `CHANGELOG.md`, abrir a seção `1.2.0` com:
  - popup compacto;
  - detecção automática desde o carregamento;
  - downloads continuam com o popup ou o painel fechados;
  - "Baixar esta aula" salva na pasta do curso;
  - arquivo existente na fila conta como já baixado.
- [ ] **Step 2:** Em README e LEIA-ME, trocar o passo a passo "clique no ícone → painel em aba" pelo fluxo do popup e citar a engrenagem para o painel completo. Incluir o aviso de atualização: aguardar downloads ativos, fechar o painel antigo e recarregar a extensão.
- [ ] **Step 3:** Rodar `npm run check`. Esperado: lint e testes passam.
- [ ] **Step 4:** Commit `docs: popup compacto 1.2.0`.
