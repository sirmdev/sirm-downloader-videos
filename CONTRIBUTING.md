# Como contribuir

Obrigado por querer ajudar o SirM Downloader Videos! O fluxo é o padrão do GitHub:

1. **Issue primeiro.** Para bugs, use o modelo "Problema". Para ideias, use "Ideia". Combine a abordagem antes de mudanças grandes.
2. **Fork e branch.** Faça um fork, crie uma branch (`feat/minha-ideia` ou `fix/descricao`) e trabalhe nela.
3. **Teste.** Rode `npm ci` e `npm run check` (lint + testes). Inclua um teste para cada correção ou recurso novo.
4. **Pull request.** Descreva o que mudou e como você testou. O mantenedor revisa, pode pedir ajustes e decide se a mudança entra. O CI precisa estar verde.

## Regras do projeto
- **Sem YouTube, sem contornar DRM, autenticação ou bloqueios de automação.** PRs nessa direção não são aceitos.
- **Privacidade:** não persistir links assinados, Referer, cookies, tokens, senhas nem stdout/stderr brutos.
- **Falhas visíveis:** distinguir cancelamento, erro permanente e erro temporário. Tentativas automáticas são limitadas e renovam a captura.
- **Nunca iniciar download sozinho** ao reabrir o painel.
- **Compatibilidade:** não mudar a `key` do manifesto, `com.turbovideo.downloader`, `turbovideo-batch` nem a pasta `Downloads/TurboVideo`. São identificadores internos que mantêm instalações existentes funcionando.
- Testes de integração gravam somente em `work/`. Nunca baixe na pasta real de Downloads durante testes.
- Textos da interface em português do Brasil.

## Ambiente
- Node.js 22+ e Windows 10/11 para o auxiliar.
- `npm run build:store` gera o zip da Chrome Web Store. `npm run release` gera o zip do instalador.
- Hook de pré-commit opcional: `git config core.hooksPath .githooks`.

Ao contribuir, você concorda em licenciar sua contribuição sob a licença MIT do projeto e em seguir o [Código de Conduta](CODE_OF_CONDUCT.md).
