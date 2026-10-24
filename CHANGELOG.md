# Changelog

## 1.2.0 — 2026-10-24
- Popup compacto: o clique no ícone abre um popup pequeno com o cartão "Esta aula" (qualidade e **Baixar esta aula**) e, em página de curso, o cartão "Curso inteiro" (**Baixar as N que faltam**).
- Detecção automática desde o carregamento: as abas HTTP(S) são observadas sem precisar clicar no ícone antes nem recarregar a página.
- Os downloads e a fila do curso rodam em segundo plano. Continuam com o popup ou o painel fechados, e reabrir qualquer um deles mostra o estado atual sem iniciar nada sozinho.
- Em página de curso, **Baixar esta aula** salva na pasta do curso e do módulo, com o nome numerado que a fila usaria, e marca a aula como baixada.
- Na fila do curso, arquivo que já existe na pasta conta como já baixado ("Já estava na pasta"), e não como falha.
- O painel completo continua disponível pela engrenagem do popup, com origem manual, nome do arquivo, conexões, seleção de aulas e captura do player.
- Depois de atualizar: aguarde os downloads ativos terminarem, feche o painel antigo e recarregue a extensão em `chrome://extensions`.

## 1.1.0 — 2026-10-24
- Novo visual com a identidade SirM: paleta roxa, fonte Outfit empacotada, ícones da extensão e etapas numeradas no painel.
- YouTube bloqueado na extensão e no auxiliar, conforme a política da Chrome Web Store (erro permanente `unsupported_site`).
- O auxiliar aceita o ID de desenvolvimento e o ID da Chrome Web Store (`store-extension-id.txt`).
- Aviso legal na lista de aulas, link de apoio pelo LivePix e ajuda de instalação quando o auxiliar não está conectado.
- Projeto publicado como código aberto, com CI, modelos de issue e PR e build para a Chrome Web Store.

## 1.0.8
- Nome SirM Downloader Videos. Os identificadores internos foram mantidos por compatibilidade.
- Até três tentativas para erros temporários, com nova captura da mídia. Cancelamentos e erros permanentes não são repetidos.
- Progresso da fila salvo localmente, sem links assinados, Referer ou cookies. Reabrir o painel não inicia downloads.
- Watchdog de transferência e de processamento. O sucesso exige um arquivo real dentro do destino.

## 1.0.7
- Módulos com nomes livres (ex.: "Comece por Aqui"), localizados pela estrutura da lista.

## 1.0.6
- Todos os módulos de uma categoria na mesma fila, com subpasta numerada por módulo.

## 1.0.5
- Pasta por categoria, preenchida a partir do título do site.

## 1.0.4
- Download de listas de aulas da Curseduca, uma por vez, por aba auxiliar sem som.

## 1.0.3
- Nome do arquivo escolhido antes de baixar.

## 1.0.2
- Correção da captura de players incorporados.
