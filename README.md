# Minerva Foods Claims — demonstração

> **DADOS FICTÍCIOS — SEM RESULTADOS REAIS DA EMPRESA.** Os fornecedores, analistas, ordens, valores e metas dos exemplos e testes são sintéticos. Este repositório apresenta as funcionalidades e o visual de um painel de claims e recebimentos.

## Abrir a demonstração

**[Abrir demonstração online](https://juhcorrea.github.io/minerva-foods-claims/)**

Abre diretamente no navegador, sem instalar Python ou baixar o projeto. A demonstração usa somente os exemplos fictícios incluídos no código, com importação de planilhas desativada. Não oferece acesso a bases ou contas reais.

## Rodar no próprio computador — opcional

Requer Python 3 para servir a interface. Na pasta deste projeto:

```bash
python3 -m http.server 8080 --directory dist --bind 127.0.0.1
```

**Somente depois de executar o comando acima e mantê-lo aberto**, acesse `http://127.0.0.1:8080` no mesmo computador e clique em **Explorar demonstração**. Esse endereço é local: clicar nele sem iniciar o servidor resulta em conexão recusada. Não é o link público do painel.

Os exemplos são gerados no navegador, com fornecedores e referências fictícios. A demonstração local não se conecta a bases, contas ou relatórios de produção.

## Funcionalidades

O painel tem seis áreas:

- **Visão geral:** indicadores, recebimentos mensais por ano, países, setores, motivos e causadores.
- **Fornecedores:** comparativo de todos os anos, com recebido por origem do claim, saldo aberto e vencido.
- **Correção de base:** cenário original e correções propostas, com rastreabilidade por ordem.
- **Controle de recebimento:** parcelas, acordos, analistas, metas ilustrativas e reunião de resultados.
- **Controle de claim:** SLAs, situações operacionais e registros da BD, com pesquisa, filtros e detalhes.
- **FUP Suprimentos:** carteira aberta de todos os anos; seleção de fornecedor à esquerda e detalhe por motivo na mesma tela, com subtotais e controles para expandir ou recolher todos os motivos.

Filtros pesquisáveis com múltipla seleção, ordenação, ajuste de colunas, modo noturno, tamanho de fonte e modo de apresentação estão disponíveis. Vários valores do mesmo campo são combinados por OU; campos diferentes, por E. A ordenação inicial prioriza os maiores valores, preservando a ordenação escolhida pelo usuário. Bases, tabelas e filtros têm controles próprios de recolher e expandir. No comparativo de correções, os critérios ficam recolhidos e continuam disponíveis na impressão. Visões salvas pessoais reutilizam os filtros aplicados neste navegador e recalculam as bases atuais; não guardam planilhas, resultados ou credenciais. As exportações incluem Excel, PDF e PowerPoint, além do PDF das regras de cálculo.

O backend de referência também oferece:

- Backend de referência com aprovação de acesso e perfis de consulta, atualização e administração.
- Controles de importação, publicação e acesso dentro do perfil, preservando as permissões de cada pessoa. A troca de abas mantém a navegação disponível e mostra os valores somente quando o período solicitado estiver pronto.
- Exclusão de solicitações pendentes, rejeitadas ou revogadas pela administração, com confirmação. Acessos aprovados precisam ser revogados antes da exclusão.

## Critérios demonstrados

O recebido usa o status Pago, a data de compensação e o valor recebido em USD. Cada linha de pagamento é contada uma vez. A base de claims complementa o vínculo, mas uma referência sem detalhamento não exclui um pagamento confirmado. O total comparável respeita os anos selecionados para o claim e para o pagamento; recebimentos de claims de outros anos aparecem separadamente.

A perda do comparativo é `Reclamado − (Recebido comparável + Em negociação)`. O saldo de parcelas em aberto é apurado separadamente; um acordo concluído não significa que todas as parcelas foram pagas. O exemplo de metas usa **USD 300.000 para 100%** e **USD 450.000 para 150%**, ambos fictícios.

A visão geral e os controles iniciam no ano vigente disponível. Fornecedores consolida todos os anos das bases; FUP considera a carteira aberta de qualquer ano. Os filtros de operação e fornecedor continuam aplicáveis. O FUP usa somente negociações procedentes: pendências contendo **FUP SUPRIMENTOS** ficam fora dos totais e das listas, e o **Jurídico aparece apenas como valor agregado**. Seu total geral é Negociações + Jurídico. Os filtros locais afetam a tabela e sua exportação; os cards mantêm o recorte global identificado.

No detalhe do FUP, os motivos são agrupados e ordenados pelo maior subtotal; os claims de cada motivo começam pelo maior valor. Dias em aberto usam a data atual de São Paulo e a abertura registrada na BD; datas ausentes ou futuras ficam para conferência. O Excel traz uma visão de reunião com grupos recolhíveis por fornecedor e motivo, a base do recorte e os critérios. SGR é contado uma vez no total, mesmo quando aparece em mais de um fornecedor; as contagens dos grupos não são necessariamente somáveis.

## Build e testes

Requer Node.js 22 ou superior. As bibliotecas do navegador estão em `dist/vendor/`.

```bash
node build.mjs
node --test tests/*.test.cjs tests/*.test.mjs tests/access-security.mjs
```

O build gera `build/server/index.js`. Os testes distribuídos usam dados sintéticos; as planilhas, os relatórios e os testes baseados em dados operacionais não são incluídos.

Para gerar somente a demonstração estática, execute `node scripts/build-demo.mjs`. A saída fica em `build/demo/`, com caminhos relativos para publicação em uma subpasta. A branch `gh-pages` recebe apenas esses arquivos; nenhum backend, conta, configuração privada ou planilha operacional faz parte dela. Em Settings → Pages, a origem é **Deploy from a branch → gh-pages → /(root)**.

Os testes de navegador requerem Playwright/Chromium. A pasta `tests/openxml-validator/` permite verificar apresentações geradas usando o Microsoft Open XML SDK. As licenças de terceiros permanecem junto às bibliotecas.

## Histórico de versões

As [notas de 10/11/2026](docs/RELEASE-2026-11-10.md) explicam o escopo de conferência de Seguro, a fila de correções, os formatos monetários e a republicação necessária para a projeção compartilhada v2.

Cada atualização da cópia pública é registrada no [histórico de commits](https://github.com/juhcorrea/minerva-foods-claims/commits/main/). A branch `gh-pages` conserva o histórico da demonstração publicada. Esses históricos contêm somente código e exemplos sanitizados; o histórico operacional privado não é importado.

## Configuração independente

`.openai/hosting.json` contém apenas um modelo sem identificador de produção. Para uma instalação própria, configure um projeto e armazenamento privados novos. O código do backend utiliza os identificadores genéricos `owner` e `developer`; os nomes e contatos são definidos no ambiente da instalação. Os e-mails `example.invalid` usados nos testes são fictícios.

`ADMIN_LINK_HASHES` recebe dois registros com identificador, nome, contato opcional e hash SHA-256 de cada token administrativo. `OWNER_ADMIN_LINK_HASH` e `DEVELOPER_ADMIN_LINK_HASH` permitem hashes adicionais opcionais. Não versionar valores reais dessas variáveis. A autorização depende de tokens e aprovação no servidor; informar um nome ou e-mail não concede acesso.

Esta cópia não deve ser implantada diretamente sobre uma instalação existente: seus identificadores são genéricos e nenhum estado de acesso ou configuração de produção está incluído. O GitHub Pages publica apenas a demonstração estática; não atualiza o painel operacional protegido.

## Privacidade

Manter o projeto público exclusivamente demonstrativo. Não incluir nomes ou e-mails pessoais, contas reais, URLs pessoais, dados financeiros reais, arquivos de clientes, segredos, links administrativos ou material interno. Atualizações devem preservar esta separação e o aviso de dados fictícios.

## Migração privada — backend de referência

Instalações com backend podem disponibilizar **Controlar acessos → Baixar backup privado** para administradores. O ZIP reúne o código da publicação, as bases publicadas, as marcações de correção e os cadastros/perfis com auditoria, com checksums e instruções de restauração. O download exige autenticação administrativa e não altera os registros. Credenciais, tokens, hashes de ativação, sessões e histórico Git ficam fora do pacote.

A restauração usa um novo projeto e armazenamento vazio, com credenciais novas e nova aprovação dos navegadores. O utilitário `migration/restore-data.mjs` valida o pacote offline e recusa sobrescrever um destino existente. Bases preservadas em JSON não substituem os XLSX originais com fórmulas e formatação.

A demonstração pública não possui backend nem dados ou contas reais e não oferece esse download. Este repositório contém somente o código e testes fictícios da funcionalidade; backups operacionais nunca devem ser adicionados ao GitHub ou aos assets públicos.
