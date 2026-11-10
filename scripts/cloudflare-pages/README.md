# Pacote privado para Cloudflare Pages

Este empacotador prepara uma alternativa de hospedagem. Não cria conta, projeto, bucket, política Access ou credencial, não publica e não altera a instalação Sites.

Na raiz do projeto, execute `node scripts/build-cloudflare-pages.mjs`. A saída de publicação é exclusivamente `build/cloudflare-pages/`, contendo:

- `_worker.js`: engine, API, dependências locais e assets compilados; preserva a autorização do painel.
- `_routes.json`: todas as rotas passam pelo Worker (`include: ["/*"]`, nenhuma exclusão).
- `404.html`: mensagem neutra, sem dados nem código do painel, caso somente o servidor de arquivos estáticos responda.

Não envie a raiz do projeto, `dist/`, `worker/`, `work/`, bases, exports, `.git`, `.openai` ou arquivos de ambiente. O script lê a mesma lista explícita de assets de `build.mjs`, sem varrer diretórios. A saída recusa arquivos adicionais e links simbólicos.

Os assets operacionais não existem como arquivos estáticos separados. URLs diretas de JavaScript, CSS e página principal continuam sujeitas à autorização existente em `worker/entry.js`. O ZIP de fontes para restauração permanece embutido somente no Worker e é entregue pela API privada às administradoras; não é um asset público. O pacote não contém dados R2, sessões ou variáveis de ambiente. Antes do build final, confira se os arquivos novos estão versionados: a rotina existente de backup usa a lista de arquivos rastreados pelo Git.

## Configuração do destino

`wrangler.example.json` contém apenas nomes fictícios e habilita `CF_CLIENT_ANALYSIS=1`. Adapte uma cópia privada para o projeto autorizado. Para R2, mantenha o binding `BUCKET`, com bucket privado e sem acesso público `r2.dev` ou domínio público. Como alternativa, use o binding D1 `DB` e inicialize a tabela de `worker/d1-schema.sql`; o entry fornece o mesmo armazenamento privado ao backend. Se ambos existirem, o R2 permanece prioritário. Produção e preview devem usar armazenamentos distintos; nunca conecte uma prévia à base operacional por conveniência.

Configure credenciais e valores de autenticação no ambiente privado do destino, sem inseri-los neste exemplo ou em assets. O exemplo seleciona `AUTH_MODE=cloudflare-access`, com valores incompletos que devem falhar fechados. Preencha `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` e `ALLOWED_EMAIL_DOMAIN` na configuração privada e guarde `CF_ACCESS_ADMIN_IDENTITIES` como variável secreta do destino (JSON de identificadores e e-mails administrativos autorizados). Nenhum e-mail real pertence ao exemplo versionado.

A política Access e o provedor de código por e-mail são uma etapa separada. Este build não concede acesso por domínio de e-mail e não substitui a aprovação interna do painel. Ele incorpora os módulos de autenticação presentes no código de origem no momento do build; imports locais novos são resolvidos recursivamente, sem baixar dependências. Mantenha a configuração Access e o bucket também isolados no ambiente de preview.

Depois de conferir conta, projeto, bindings, política e autorização de publicação, o envio deve apontar somente para o diretório isolado, por exemplo `wrangler pages deploy build/cloudflare-pages --project-name <projeto-autorizado> --config <configuracao-privada>`. O diretório apontado por `pages_build_output_dir` é relativo ao arquivo de configuração: ajuste-o se mover a cópia. Prefira o comportamento **Fail closed** em Pages para falhas de Functions. Nenhum comando de publicação é executado pelo empacotador.

## Processamento no navegador

Com `CF_CLIENT_ANALYSIS=1`, o servidor autentica, autoriza e entrega partes projetadas das bases. O mesmo motor financeiro executa em `analysis-worker.js`, separado da interface. Os arquivos completos, resultados e cursores ficam somente na memória da sessão; não são gravados em IndexedDB ou localStorage. Troca de revisão, cancelamento, saída ou perda de acesso encerram o Worker. A reutilização de resultados continua conferindo revisão da publicação, acompanhamento e data de envelhecimento no servidor.

A publicação administrativa envia partes de até 64 KiB, no máximo 64 linhas por parte, informa as quantidades completas e só confirma depois de receber todos os comprovantes. O backend preserva as versões originais para backup administrativo, entrega apenas colunas utilizadas aos leitores e conserva as posições de linhas/colunas. O cliente valida SHA-256, origem e sequência antes de analisar. O backup ZIP também é montado em um Worker do navegador: não executa cálculo nem compactação pesada no servidor.

Uma manutenção opcional de admin/editor remove partes antigas em lotes pequenos, com limite de 100 chamadas por sessão da página e cancelamento na saída. Falhas nessa manutenção não impedem acesso ou publicação. Assets compilados usam decodificação nativa ou laço simples e cache de bytes limitado a 8 MiB; a aprovação é verificada antes de cada resposta privada, mesmo com cache quente. `HEAD` não decodifica os assets.

O modo foi preparado para evitar o cálculo financeiro dentro do limite de CPU do Workers Free. A paridade é testada localmente; somente a telemetria real do destino confirma CPU e limites de armazenamento/requisições. Este build não ativa plano pago. Sites continua usando o caminho existente quando a opção de processamento no navegador está ausente.

## Verificação

### Atualização da projeção das bases

A projeção v2 inclui a coluna Q da BD (`Área negociação`, índice 16), necessária para distinguir os claims fora de Seguro. Depois de atualizar o código de uma instalação existente, importe e publique novamente **BD e Controle** pelo fluxo administrativo. O código exige uma nova publicação completa: não reutilize partes nem conclua uploads iniciados na versão anterior.

Enquanto a publicação armazenada estiver na projeção anterior, as consultas de análise retornam `REPORT_PROJECTION_OUTDATED`, com orientação para republicar as duas bases. Isso também impede reutilizar um resultado antigo do cache. O backup administrativo das bases originais permanece disponível. A nova publicação recebe `projectionVersion: 2`; confirme esse estado e a leitura do painel antes de considerar a atualização operacional concluída. A demonstração pública não usa essas APIs nem contém bases a migrar.

Execute `node --test tests/cloudflare-pages-artifact.test.mjs tests/client-analysis.test.mjs tests/entry-asset-access.test.mjs tests/d1-store.test.mjs`. Os testes conferem inventário, roteamento, proteção de arquivos privados e da API, paridade financeira, integridade, cancelamento, armazenamento e preservação dos arquivos Sites. O script informa SHA-256 do Worker, quantidade de assets, tamanho bruto e gzip. O backup exige `sourceCommit` válido: faça o build final a partir do commit limpo, depois de versionar os arquivos novos; `sourceCommit: null` identifica um pacote de desenvolvimento cujo download de restauração será recusado.

A documentação oficial consultada em 10/11/2026 indica limite de 64 MiB descomprimidos e nenhum limite gzip; o valor comprimido é informado para diagnóstico. O tempo de inicialização e o uso de CPU dependem do runtime e precisam ser verificados no destino.

Após um deploy autorizado, confirme a URL `pages.dev`, autenticação Access, aprovação interna, APIs privadas, atualização de bases, correções e backup como administradora. Verifique também sessão anônima, usuário pendente/revogado, URL direta de asset, `HEAD`, preview e política de falha. Um build local aprovado não comprova publicação ou proteção remota.

Referências oficiais: [Advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/), [roteamento e fail closed](https://developers.cloudflare.com/pages/functions/routing/), [binding R2](https://developers.cloudflare.com/pages/functions/bindings/), [configuração Pages](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [limites Workers](https://developers.cloudflare.com/workers/platform/limits/).
