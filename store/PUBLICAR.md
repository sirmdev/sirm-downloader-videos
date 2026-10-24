# Publicar na Chrome Web Store — passo a passo

Estas etapas precisam ser feitas por você na sua conta Google.

## 1. Conta de desenvolvedor (uma vez)
1. Acesse https://chrome.google.com/webstore/devconsole e entre com a conta Google que vai publicar.
2. Aceite o contrato e pague a **taxa única de US$ 5**.
3. Preencha o nome do editor (ex.: **SirM**) e confirme o e-mail de contato.

## 2. Gerar o pacote
```powershell
npm run build:store
```
Gera `dist/sirm-downloader-videos-store-<versão>.zip`, sem a chave `key` do manifesto (a loja recusa esse campo e atribui um ID próprio).

## 3. Enviar
1. No painel, clique em **Novo item** e envie o zip.
2. Em **Ficha da loja** e **Práticas de privacidade**, cole os textos de [LISTING.md](LISTING.md) e envie as imagens indicadas lá.
3. Em **Distribuição**, deixe *Pública* e *Gratuita*.
4. Clique em **Enviar para análise**. A revisão costuma levar de alguns dias a algumas semanas. Extensões com `nativeMessaging` e acesso a todos os sites passam por análise mais detalhada.

## 4. Depois da aprovação: ligar o ID da loja ao auxiliar
A loja dá à extensão um **ID diferente** do usado na instalação sem compactação. O auxiliar só aceita IDs conhecidos:

1. Copie o ID que aparece no painel da loja (32 letras de `a` a `p`).
2. Grave-o em `store-extension-id.txt` na raiz do projeto, faça commit e publique um release novo (`npm run release` e anexe o zip ao release do GitHub).
3. Quem já tem o auxiliar instalado executa **Instalar.cmd** de novo, ou roda `install.ps1 -StoreExtensionId <ID>`.

Os dois IDs funcionam ao mesmo tempo: a versão sem compactação continua ligada ao auxiliar.

## Se a loja recusar
- **"Facilita download do YouTube"**: o bloqueio já existe (`blockedSite` em `extension/media.mjs` e `native/core.mjs`). Responda citando-o.
- **Permissões amplas**: use as justificativas de LISTING.md e explique que players de vídeo usam CDNs em domínios variados.
- **Propriedade intelectual**: destaque o aviso de uso legal no painel e na descrição, e que não há remoção de DRM nem leitura de cookies.

## Atualizações futuras
Aumente `version` em `extension/manifest.json` e em `package.json`, rode `npm run build:store` e envie o zip novo em **Pacote → Enviar nova versão**.
