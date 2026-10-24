# SirM Downloader Videos para Windows

Extensão Manifest V3 para Chrome/Brave com auxiliar local. Sem assinatura, conta, anúncios ou limite artificial de velocidade.

## Instalar

1. Extraia o ZIP para uma pasta. Execute **Instalar.cmd** (não precisa de administrador).
2. O instalador mostra e abre a pasta **extension**, que fica ao lado de **Instalar.cmd** na pasta extraída. O caminho exato também é salvo em **PASTA-DA-EXTENSAO.txt**.
3. Instale a extensão pela Chrome Web Store, quando publicada, **ou** abra `chrome://extensions` ou `brave://extensions`, ative **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione essa pasta **extension**. Quem instala pela loja precisa só do auxiliar deste ZIP.
4. Fixe o ícone SirM Downloader Videos no menu de extensões.

Requer Windows 10/11 x64. O instalador usa PowerShell 7 quando disponível ou o PowerShell que já acompanha o Windows. Reutiliza Node.js 22+ e FFmpeg existentes; baixa as ferramentas ausentes e yt-dlp/aria2 por HTTPS, verificando SHA-256. O auxiliar fica em **Instalado**, dentro da pasta extraída. Mantenha essa pasta no lugar; se a mover, execute **Instalar.cmd** novamente e recarregue a extensão pelo caminho novo.

## Baixar

1. Abra a página do vídeo e clique no ícone SirM Downloader Videos. Um painel será aberto em outra aba.
2. Para arquivos ou sites públicos compatíveis, use **Analisar endereço da página**. Para aulas com player incorporado ou `blob:`, salve suas anotações e clique em **Capturar player (recarrega a aba)**; volte à aula, dê play e retorne ao painel. Playlists HLS/DASH aparecem e são selecionadas automaticamente quando detectadas. A observação continua após recarregar. **Buscar na aba** também examina os players já carregados.
3. Escolha a origem e preencha **Nome do arquivo**, por exemplo **Aula 01 - Follow up**. A extensão correta (`.mp4`, `.mkv`, `.mp3` etc.) é adicionada automaticamente. Se já houver um arquivo com esse nome, o download pede outro nome para preservar o anterior. Deixe em branco para usar o nome original. Escolha a qualidade máxima e as conexões e clique em **Baixar vídeo**.
4. **Mantenha o painel aberto.** Fechá-lo interrompe suas tarefas. Use **Cancelar** para parar o processo e seus subprocessos.
5. Os arquivos ficam em `%USERPROFILE%\Downloads\TurboVideo`. Use **Abrir pasta**.

O padrão é 8 conexões; 16 pode melhorar ou piorar conforme o servidor. HTTP usa aria2; HLS/DASH compatíveis usam fragmentos paralelos do yt-dlp. O servidor precisa aceitar intervalos para que um arquivo direto aproveite várias conexões. Não há promessa de velocidade mínima ou de download de todos os sites.

Vídeos com áudio separado são unidos em MKV, preservando codecs e qualidade; arquivos já completos mantêm sua extensão original. “Somente áudio” extrai MP3 com FFmpeg. Você pode escolher limites até 4K ou a melhor qualidade disponível, inclusive superior a 4K. Qualidades inexistentes podem produzir erro; tente “Melhor disponível”.

Arquivos parciais compatíveis podem ser retomados ao repetir a mesma origem, qualidade e nome. O progresso da lista de aulas é salvo localmente; ao reabrir o painel, revise a fila e clique em **Baixar selecionadas** para continuar. Recarregar ou reabrir não inicia downloads automaticamente. Uma fonte assinada nova pode impedir a reutilização de um parcial anterior. Para nomes personalizados, arquivos temporários ficam na pasta do auxiliar, separados por origem. Downloads concluídos não são sobrescritos. Transmissões ao vivo continuam até cancelar; não há gravação desde o início garantida, e o cancelamento pode deixar um arquivo parcial sem finalização.

## Baixar uma lista de aulas

Na página da categoria do Curseduca, deixe a lista de aulas expandida e abra o SirM Downloader Videos. No painel:

1. Abra um módulo no site com as aulas visíveis e clique em **Encontrar aulas desta categoria**. A busca usa a estrutura desse bloco para localizar módulos irmãos com qualquer nome, como **Comece por Aqui**, além dos módulos numerados. Abre os módulos identificados e guarda as aulas de cada um, mesmo quando apenas um pode ficar aberto. Confira o total de módulos e aulas encontrados; todos vêm selecionados.
2. **Pasta da categoria** recebe o título identificado na página do site. Revise se corresponde à categoria desejada. Se o título não for identificado, preencha antes de começar. Desmarque o que não quer e ajuste os nomes dos vídeos; o padrão mantém os temas das aulas, numerados na ordem da lista.
3. Escolha a qualidade e as conexões nos controles acima e clique em **Baixar selecionadas**.
4. Mantenha o painel aberto. Uma aba auxiliar sem som captura cada aula, e a fila baixa uma por vez em `Downloads/TurboVideo/Nome da categoria`. Quando há módulos, cria uma subpasta numerada por módulo e reinicia a numeração das aulas em cada um. **Parar fila** cancela a tarefa atual e fecha a aba auxiliar. Ao mudar de categoria, clique em **Encontrar aulas desta categoria** novamente para atualizar a pasta e a lista.

Se um módulo identificado não puder ser lido, a fila fica bloqueada e o painel informa qual falta. Expanda esse módulo no site e busque novamente. Módulos fora do DOM, paginação e outros layouts podem exigir abrir a lista no site; revise a contagem encontrada. A busca limita os cliques aos cabeçalhos identificados pela estrutura de aulas, distinguindo listas planas e menus de opções. Não baixa PDFs ou arquivos extras. O suporte de links continua específico ao Curseduca; não há compatibilidade universal com outros sites.

Para erros temporários identificados pelo auxiliar, a fila faz até **três tentativas**, capturando novamente a mídia entre tentativas. Cancelamentos solicitados pelo usuário não são repetidos. A opção **Continuar as outras aulas se uma falhar** vem marcada; ao desmarcar, a fila pausa se uma aula continuar falhando. Uma nova execução pula as aulas marcadas como salvas. Ao reabrir o painel, confira a confirmação de progresso salvo e clique em **Baixar selecionadas** para continuar; a restauração não inicia downloads sozinha. **Limpar histórico** remove o progresso da fila quando ela está parada, sem apagar vídeos. Arquivos existentes continuam protegidos: ajuste o nome se houver colisão. É necessário já estar conectado ao curso e ter acesso às aulas. Esta opção procura vídeos nos links de aula da lista do Curseduca; não inclui automaticamente PDFs ou outros materiais.

## Limites reais

- YouTube não é suportado, conforme a política da Chrome Web Store.
- Use somente com conteúdo que você tem direito de baixar, conforme os termos da plataforma e do autor.
- Vídeos protegidos por DRM não são descriptografados.
- Links `blob:` são referências internas; a extensão procura o manifesto ou arquivo HTTP subjacente, quando visível. Não grava a tela.
- Não lê cookies, senhas ou tokens de autenticação do navegador. Algumas páginas privadas, anti-bot e links que exigem cabeçalhos especiais podem falhar. Links assinados que a própria página expõe podem funcionar enquanto válidos.
- Use a origem de página para sites com áudio/vídeo separados. URLs individuais detectadas podem conter apenas uma faixa.
- Não altera limites do servidor, bloqueios geográficos, autenticação ou a velocidade contratada.
- Páginas internas do navegador e lojas de extensões não permitem essa detecção.

## Privacidade e permissões

`activeTab` e `scripting` permitem examinar a aba selecionada e players; `webRequest` e acesso HTTP/HTTPS permitem detectar mídia, inclusive de CDNs; `storage` mantém candidatos das abas selecionadas durante a sessão e o progresso local da fila (URLs das páginas de aula, nomes, estados e qualidade); `nativeMessaging` conecta exclusivamente o auxiliar registrado para este ID de extensão. O histórico persistente da fila não grava URLs assinadas de mídia nem Referer. Os endereços de aula são salvos sem parâmetros extras, preservando apenas `classId` quando necessário. O cabeçalho HTTP Referer da requisição original de mídia é preservado para servidores que o exigem. Cookie e Authorization não são copiados, armazenados ou enviados ao auxiliar. Não há servidor HTTP local aberto nem envio para serviço analítico. URLs selecionadas são enviadas ao yt-dlp e aos servidores de origem para executar o download. Endereços podem conter parâmetros de acesso: evite compartilhar capturas da lista.

As ferramentas usam os serviços originais de vídeo. Toda análise/download depende do suporte atual do yt-dlp. Para atualizar o yt-dlp, feche os painéis e execute **Instalar.cmd** novamente. A instalação mantém aria2 1.37.0 com hash fixado do catálogo Microsoft winget.

## Atualizar

**Aguarde os downloads ativos terminarem antes de fechar painéis ou recarregar a extensão.** Extraia o ZIP novo no lugar do anterior e execute **Instalar.cmd**. Depois, **recarregue a extensão em `chrome://extensions` ou `brave://extensions`** e abra um painel novo. Não apague nem mova os arquivos de Downloads para atualizar. O histórico de versões está no [CHANGELOG](CHANGELOG.md).

## Diagnóstico e remoção

“Auxiliar desconectado”: feche os painéis, execute Instalar.cmd e reabra pelo ícone. O ID mostrado pelo navegador deve estar em `extension-id.txt` (instalação sem compactação) ou em `store-extension-id.txt` (Chrome Web Store). Depois de mudar o ID, execute Instalar.cmd novamente. Não remova a propriedade `key` do manifest: ela mantém esse ID estável. A mudança de nome preserva os identificadores internos da extensão e do auxiliar.

“O site recusou o acesso”: atualize a página e tente uma origem de mídia detectada. O pacote não contorna autenticação nem DRM. As mensagens refletem os sinais disponíveis no auxiliar; não comprovam a causa exata de uma falha externa.

Execute **Desinstalar.cmd**, remova a extensão no navegador e, se desejar, apague a pasta **Instalado** deste pacote. Seus vídeos em Downloads são preservados. A pasta padrão continua sendo `%USERPROFILE%\Downloads\TurboVideo`, inclusive após a mudança de nome.

## Desenvolvimento e fontes

Sem dependências de execução npm para o código próprio. `npm ci` instala somente ferramentas de desenvolvimento; `npm run check` executa lint e testes. Integração: `node --test tests/integration.test.mjs` usa as ferramentas instaladas e um servidor de mídia local. O teste de navegador fica no relatório de verificação do pacote.

Fontes: [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest), [yt-dlp](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org/download.html), [aria2](https://github.com/aria2/aria2), [hash aria2 no winget](https://github.com/microsoft/winget-pkgs/blob/master/manifests/a/aria2/aria2/1.37.0/aria2.aria2.installer.yaml).

O código próprio é disponibilizado sob licença MIT, em LICENSE. As ferramentas baixadas possuem suas próprias licenças, disponíveis nos projetos acima; seus binários não estão incluídos no ZIP de código.
