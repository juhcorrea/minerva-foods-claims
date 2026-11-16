# Atualização da demonstração — 16/11/2026

## Gestor e organograma (16/11/2026)

Meu Perfil permite selecionar um gestor entre as pessoas com acesso aprovado ou informar um gestor externo. O vínculo usa um identificador estável e não altera permissões. Perfis anteriores continuam válidos; clientes antigos não apagam um gestor já informado.

Na instalação hospedada, a administração pode consultar o organograma pelo perfil. A visão preserva pessoas sem gestor cadastrado e sinaliza relações sem correspondência ou ciclos. O diretório compartilha somente nome, cargo, setor e unidade; e-mail, matrícula e foto continuam fora dessa consulta.

A demonstração pública continua usando dados fictícios e não exibe o organograma administrativo nem conecta a contas de produção.

### Nota técnica

As relações de gestor são validadas contra a lista atual de acessos aprovados. O servidor rejeita autogestão, gestor indisponível e ciclos detectados nesse momento. Como cada perfil possui sua própria revisão, alterações cruzadas simultâneas não constituem uma transação única e podem formar um ciclo; a interface sinaliza essa inconsistência sem ocultar pessoas. O vínculo organizacional nunca concede autorização.
