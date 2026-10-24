# Política de privacidade — SirM Downloader Videos

Última atualização: 24/10/2026

O SirM Downloader Videos **não coleta, não vende e não envia dados pessoais** para o autor nem para terceiros. Não há servidor do projeto, conta, anúncios ou telemetria.

## O que a extensão acessa e por quê
- **Aba atual e players (`activeTab`, `scripting`)**: para encontrar elementos de vídeo na página que você abriu.
- **Requisições de rede (`webRequest`, acesso a sites HTTP/HTTPS)**: para detectar arquivos e playlists de vídeo (MP4, HLS, DASH) carregados pelo player, inclusive de CDNs. Só os endereços de mídia são lidos. Cookies e o cabeçalho Authorization não são copiados.
- **Armazenamento local (`storage`)**: guarda no seu navegador a lista de mídias da aba durante a sessão e o progresso da fila de aulas (endereços das páginas de aula, nomes, estados e qualidade). Links assinados de mídia, Referer, cookies e tokens não são gravados.
- **Auxiliar local (`nativeMessaging`)**: envia o endereço escolhido ao programa auxiliar instalado no seu computador, que faz o download com yt-dlp, FFmpeg e aria2 direto do site de origem.

## Dados compartilhados
Nenhum. As únicas conexões externas são as requisições ao site do vídeo, feitas pelo seu computador quando você pede um download, e, durante a instalação, os downloads das ferramentas nos repositórios oficiais delas.

## Controle
Limpe o histórico da fila pelo botão **Limpar histórico** ou removendo a extensão. Seus vídeos baixados nunca são apagados pela extensão.

## Contato
Abra uma issue em https://github.com/sirm-dev/sirm-downloader-videos/issues
