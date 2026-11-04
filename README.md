# Minerva Foods Claims — demonstração

> **DADOS FICTÍCIOS — SEM RESULTADOS REAIS DA EMPRESA.** Os fornecedores, analistas, ordens, valores e metas dos exemplos e testes são sintéticos. Este repositório apresenta as funcionalidades e o visual de um painel de claims e recebimentos.

## Abrir a demonstração

**[Abrir demonstração online](https://juhcorrea.github.io/minerva-foods-claims/)** — disponível após a ativação do GitHub Pages no repositório.

Abre diretamente no navegador, sem instalar Python ou baixar o projeto. A demonstração usa somente os exemplos fictícios incluídos no código, com importação de planilhas desativada. Não oferece acesso a bases ou contas reais.

## Rodar no próprio computador — opcional

Requer Python 3 para servir a interface. Na pasta deste projeto:

```bash
python3 -m http.server 8080 --directory dist --bind 127.0.0.1
```

**Somente depois de executar o comando acima e mantê-lo aberto**, acesse `http://127.0.0.1:8080` no mesmo computador e clique em **Explorar demonstração**. Esse endereço é local: clicar nele sem iniciar o servidor resulta em conexão recusada. Não é o link público do painel.

Os exemplos são gerados no navegador, com fornecedores e referências fictícios. A demonstração local não se conecta a bases, contas ou relatórios de produção.

## Funcionalidades

- Comparativo por fornecedor, com recebido por ano de origem do claim.
- Controle das parcelas pagas, vencidas, no prazo e sem previsão.
- Comparação entre base original e correções propostas, agrupadas por ordem.
- Recebimentos por analista e acompanhamento de metas ilustrativas.
- Reunião de resultados e apresentação do painel, com exportação para Excel, PDF e PowerPoint.
- Filtros, pesquisa, ordenação, ajuste de colunas, modo noturno e tamanho de fonte.
- Backend de referência com aprovação de acesso e perfis de consulta, atualização e administração.

## Critérios demonstrados

O recebido usa o status Pago, a data de compensação e o valor recebido em USD. Cada linha de pagamento é contada uma vez. A base de claims complementa o vínculo, mas uma referência sem detalhamento não exclui um pagamento confirmado. O total comparável respeita os anos selecionados para o claim e para o pagamento; recebimentos de claims de outros anos aparecem separadamente.

A perda do comparativo é `Reclamado − (Recebido + Em negociação)`. O saldo de parcelas em aberto é apurado separadamente; um acordo concluído não significa que todas as parcelas foram pagas. O exemplo de metas usa **USD 300.000 para 100%** e **USD 450.000 para 150%**, ambos fictícios.

## Build e testes

Requer Node.js 20 ou superior. As bibliotecas do navegador estão em `dist/vendor/`.

```bash
node build.mjs
node --test tests/*.test.cjs tests/*.test.mjs tests/access-security.mjs
```

O build gera `build/server/index.js`. Os testes distribuídos usam dados sintéticos; as planilhas, os relatórios e os testes baseados em dados operacionais não são incluídos.

Para gerar somente a demonstração estática, execute `node scripts/build-demo.mjs`. A saída fica em `build/demo/`, com caminhos relativos para publicação em uma subpasta. A branch `gh-pages` recebe apenas esses arquivos; nenhum backend, conta, configuração privada ou planilha operacional faz parte dela. Em Settings → Pages, a origem é **Deploy from a branch → gh-pages → /(root)**.

Os testes de navegador requerem Playwright/Chromium. A pasta `tests/openxml-validator/` permite verificar apresentações geradas usando o Microsoft Open XML SDK. As licenças de terceiros permanecem junto às bibliotecas.

## Configuração independente

`.openai/hosting.json` contém apenas um modelo sem identificador de produção. Para uma instalação própria, configure um projeto e armazenamento privados novos. O código do backend utiliza os identificadores genéricos `owner` e `developer`; os nomes e contatos são definidos no ambiente da instalação. Os e-mails `example.invalid` usados nos testes são fictícios.

`ADMIN_LINK_HASHES` recebe dois registros com identificador, nome, contato opcional e hash SHA-256 de cada token administrativo. `OWNER_ADMIN_LINK_HASH` e `DEVELOPER_ADMIN_LINK_HASH` permitem hashes adicionais opcionais. Não versionar valores reais dessas variáveis. A autorização depende de tokens e aprovação no servidor; informar um nome ou e-mail não concede acesso.

Esta cópia não deve ser implantada diretamente sobre uma instalação existente: seus identificadores são genéricos e nenhum estado de acesso ou configuração de produção está incluído. O GitHub Pages publica apenas a demonstração estática; não atualiza o painel operacional protegido.

## Privacidade

Manter o projeto público exclusivamente demonstrativo. Não incluir nomes ou e-mails pessoais, contas reais, URLs pessoais, dados financeiros reais, arquivos de clientes, segredos, links administrativos ou material interno. Atualizações devem preservar esta separação e o aviso de dados fictícios.
