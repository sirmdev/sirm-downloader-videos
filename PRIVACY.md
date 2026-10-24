# Política de privacidade — SirM Downloader Videos

Última atualização: 24/10/2026

O SirM Downloader Videos **não coleta, não vende e não envia dados pessoais** para o autor nem para terceiros. Não há servidor do projeto, conta, anúncios ou telemetria.

## O que a extensão acessa e por quê
- **Aba atual e players (`activeTab`, `scripting`)**: para encontrar elementos de vídeo na página que você abriu.
- **Requisições de rede (`webRequest`, acesso a sites HTTP/HTTPS)**: para detectar arquivos e playlists de vídeo (MP4, HLS, DASH) carregados pelo player, inclusive de CDNs. A partir da 1.2.0, toda aba HTTP(S) é observada desde o carregamento, para o popup já abrir com o vídeo detectado. São lidos os endereços de mídia e o Referer da requisição de mídia. Cookies e o cabeçalho Authorization não são copiados. Abas já abertas antes de instalar ou atualizar a extensão só passam a ser observadas depois da próxima navegação ou recarga.
- **Armazenamento (`storage`)**: o endereço da página e as mídias detectadas em cada aba ficam só em memória e em `storage.session`, enquanto durar a sessão do navegador (saem ao fechar a aba ou navegar para outra página). Eles não são enviados a lugar nenhum e nunca são gravados em `storage.local`; só o endereço que você escolher baixar vai para o auxiliar local. Em `storage.local` fica apenas o progresso da fila de aulas (endereços das páginas de aula, nomes, estados e qualidade); links assinados de mídia, Referer, cookies e tokens não são gravados ali.
- **Auxiliar local (`nativeMessaging`)**: envia o endereço escolhido ao programa auxiliar instalado no seu computador, que faz o download com yt-dlp, FFmpeg e aria2 direto do site de origem.

## Dados compartilhados
Nenhum. As únicas conexões externas são as requisições ao site do vídeo, feitas pelo seu computador quando você pede um download, e, durante a instalação, os downloads das ferramentas nos repositórios oficiais delas.

## Controle
Limpe o histórico da fila pelo botão **Limpar histórico** ou removendo a extensão. Seus vídeos baixados nunca são apagados pela extensão.

## Contato
Abra uma issue em https://github.com/sirmdev/sirm-downloader-videos/issues
