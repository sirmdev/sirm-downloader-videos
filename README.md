<p align="center"><img src="extension/icons/icon-128.png" width="96" height="96" alt="Logo SirM"></p>
<h1 align="center">SirM Downloader Videos</h1>
<p align="center"><b>Do player para a sua pasta, na melhor qualidade.</b><br>Extensão gratuita e de código aberto para Chrome e Brave no Windows.</p>
<p align="center">
  <a href="https://github.com/sirm-dev/sirm-downloader-videos/releases/latest"><b>Baixar o instalador</b></a> ·
  <a href="LEIA-ME.md">Guia de uso</a> ·
  <a href="CONTRIBUTING.md">Como contribuir</a> ·
  <a href="https://livepix.gg/sirm"><b>♥ Apoiar no LivePix</b></a>
</p>

<p align="center"><img src="store/screenshots/store-1-painel.png" width="760" alt="Painel do SirM Downloader Videos"></p>

## O que faz

- Detecta vídeos em arquivo, **HLS** e **DASH** compatíveis, inclusive em players incorporados.
- Você escolhe o nome do arquivo, a qualidade máxima (até 4K ou só o áudio em MP3) e quantas conexões paralelas usar.
- Retoma downloads parciais, une áudio e vídeo separados em MKV sem perda e não impõe limite artificial de velocidade.
- Baixa listas de aulas da **Curseduca** organizadas por categoria e módulo, com até três tentativas automáticas para erros temporários.
- Tudo roda no seu computador: sem conta, anúncios, telemetria ou leitura de cookies.

> **Não suportado:** YouTube (por política da Chrome Web Store), vídeos com DRM e páginas que exigem cookies de autenticação.
> Use somente com conteúdo que você tem direito de baixar, conforme os termos de cada plataforma e autor.

## Instalação

A extensão conversa com um **auxiliar local** (yt-dlp, FFmpeg e aria2). Ele faz o download de verdade e é instalado à parte, sem precisar de administrador.

1. Baixe o ZIP mais recente em [Releases](https://github.com/sirm-dev/sirm-downloader-videos/releases/latest), extraia e execute **Instalar.cmd**.
2. Instale a extensão pela Chrome Web Store (quando publicada) **ou** carregue a pasta `extension` em `chrome://extensions` → *Modo do desenvolvedor* → *Carregar sem compactação*.
3. Na página do vídeo, clique no ícone do **SirM Downloader Videos**.

O instalador baixa as ferramentas por HTTPS e confere o SHA-256 de cada uma. Os vídeos vão para `Downloads\TurboVideo` (nome mantido por compatibilidade). Detalhes, limites e remoção estão no [LEIA-ME](LEIA-ME.md).

## Apoie o projeto

O SirM Downloader Videos é e continuará gratuito. Se ele te poupa tempo, apoie o desenvolvimento pelo **[LivePix](https://livepix.gg/sirm)**. Toda ajuda mantém o projeto vivo.

## Contribuindo

Ideias, bugs e melhorias são bem-vindos:

- **Encontrou um problema ou tem uma ideia?** Abra uma [issue](https://github.com/sirm-dev/sirm-downloader-videos/issues/new/choose).
- **Quer mexer no código?** Faça um fork, crie uma branch e abra um pull request. Toda mudança é revisada antes de entrar. Veja o [CONTRIBUTING](CONTRIBUTING.md).

```powershell
npm ci
npm run check   # lint + testes
```

| Pasta | Conteúdo |
|---|---|
| `extension/` | Painel, captura de mídia e fila (Manifest V3) |
| `native/` | Auxiliar local: protocolo Native Messaging e execução das ferramentas |
| `tests/` | Testes unitários e de integração (a integração exige as ferramentas instaladas) |
| `scripts/` | Lint, builds da loja e do release, geração de ícones |
| `store/` | Textos e imagens da página na Chrome Web Store |

## Privacidade

Nenhum dado sai do seu computador, a não ser as requisições ao próprio site do vídeo. A política completa está em [PRIVACY.md](PRIVACY.md).

## Licença

Código sob [licença MIT](LICENSE). O nome e o logo **SirM** são marcas do autor e não fazem parte da licença MIT. yt-dlp, FFmpeg e aria2 têm licenças próprias e não vêm embutidos no código. A fonte Outfit é distribuída sob a [SIL OFL 1.1](extension/fonts/OFL.txt).
