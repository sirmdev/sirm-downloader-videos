# Textos da Chrome Web Store

Cole estes textos no painel do desenvolvedor (Chrome Web Store → item → *Ficha da loja* e *Práticas de privacidade*).

## Ficha da loja

**Nome:** SirM Downloader Videos

**Resumo** (vem do manifesto, máx. 132 caracteres):
> Baixe vídeos compatíveis (MP4, HLS, DASH) no seu computador, com escolha de qualidade. Requer o auxiliar local gratuito.

**Categoria:** Ferramentas (Tools) · **Idioma:** Português (Brasil)

**Descrição:**

```
SirM Downloader Videos leva o vídeo do player para a sua pasta, na melhor qualidade disponível. É gratuito, de código aberto e sem anúncios.

O QUE FAZ
• Detecta vídeos em arquivo (MP4, WebM), HLS e DASH, inclusive em players incorporados.
• Escolha de nome do arquivo, qualidade máxima (até 4K ou só o áudio em MP3) e conexões paralelas.
• Retomada de downloads parciais e união de áudio e vídeo separados em MKV, sem perda de qualidade.
• Listas de aulas da Curseduca organizadas por categoria e módulo, com tentativas automáticas para erros temporários.

COMO FUNCIONA
A extensão conversa com um auxiliar local gratuito (yt-dlp, FFmpeg e aria2), que faz o download direto no seu computador. Instale o auxiliar uma vez pelo GitHub:
https://github.com/sirm-dev/sirm-downloader-videos/releases/latest

PRIVACIDADE
Tudo roda localmente. Sem conta, telemetria ou leitura de cookies. Links assinados, cookies e tokens não são gravados.

LIMITES
• YouTube não é suportado.
• Vídeos com DRM e páginas que exigem cookies de autenticação não são compatíveis.
• Use somente com conteúdo que você tem direito de baixar, conforme os termos de cada plataforma e autor.

CÓDIGO ABERTO
Sugestões, problemas e contribuições: https://github.com/sirm-dev/sirm-downloader-videos
Apoie o projeto: https://livepix.gg/sirm
```

**Imagens:**
- Ícone 128×128: `extension/icons/icon-128.png`
- Capturas de tela 1280×800: `store/screenshots/store-1-painel.png`, `store-2-lista-aulas.png`, `store-4-downloads.png`, `store-3-auxiliar.png`
- Bloco promocional pequeno 440×280: `store/promo-440x280.png`
- Bloco promocional marquee 1400×560: `store/marquee-1400x560.png`

**Site oficial:** https://github.com/sirm-dev/sirm-downloader-videos
**URL de suporte:** https://github.com/sirm-dev/sirm-downloader-videos/issues

## Práticas de privacidade

**Finalidade única:**
> Detectar vídeos compatíveis na aba atual e enviá-los ao auxiliar local instalado pelo usuário, que faz o download para uma pasta do computador.

**Justificativa das permissões:**

| Permissão | Justificativa |
|---|---|
| `activeTab` | Ler a aba em que o usuário clicou no ícone para encontrar o player de vídeo. |
| `scripting` | Procurar elementos `<video>` em todos os frames da aba e ler a lista de aulas quando o usuário pede. |
| `storage` | Guardar localmente as mídias detectadas na sessão e o progresso da fila de aulas. Nada é enviado para fora. |
| `webRequest` | Detectar, pelo tipo de resposta, as playlists HLS/DASH e arquivos de vídeo carregados pelo player. Nenhuma requisição é bloqueada ou alterada. |
| `nativeMessaging` | Enviar o endereço escolhido ao auxiliar local (`com.turbovideo.downloader`), que executa o download. |
| Acesso a sites (`http://*/*`, `https://*/*`) | Os players e CDNs de vídeo ficam em domínios variados e imprevisíveis. A detecção precisa observar as respostas de mídia de qualquer site que o usuário abrir. |

**Código remoto:** Não. Todo o JavaScript está no pacote.

**Uso de dados:** Marque que a extensão **não coleta** nenhuma das categorias de dados. Marque as três declarações (não vende dados, não usa para fins não relacionados, não usa para crédito).

**Política de privacidade:** https://github.com/sirm-dev/sirm-downloader-videos/blob/main/PRIVACY.md

## Distribuição
- **Visibilidade:** Pública · **Preço:** Gratuito · **Regiões:** Todas
