# PaCT — Plataforma de Acompanhamento entre Clientes e Terapeuta

A PaCT0.2 é uma aplicação web desenvolvida para o projeto final do curso de TPSI da ATEC. Apoia o trabalho de uma terapeuta independente, desde o pedido de marcação até ao acompanhamento da consulta e ao registo dos pagamentos.

## Funcionalidades

- **Visitante** — Consulta os serviços e a disponibilidade, pede uma consulta e pode inscrever-se em grupos ou retiros.
- **Cliente** — Gere o perfil, acompanha as marcações e consulta a informação partilhada nas suas consultas.
- **Gestão** — Trata pedidos e fichas de clientes, gere a agenda, regista pagamentos, crédito, packs e despesas.
- **Integrações e segurança** — Confirmação de email, acesso com Passkeys, integração com Google Calendar e auditoria de segurança.

## Tecnologias

- Interface em React e JavaScript, compilada com Vite e preparada para instalação como PWA.
- API em C# com ASP.NET Core (.NET 10) e base de dados MySQL.
- IndexedDB para os metadados públicos da PWA e a recuperação cifrada dos formulários dos gestores, até 8 horas desde a última edição.

## Executar localmente

1. Instala o SDK .NET indicado em [global.json](global.json), Node.js 22.12 ou posterior com npm e MySQL.
2. Abre [PaCT0.2.slnx](PaCT0.2.slnx) no Visual Studio. No projeto `PaCT.Api`, abre **Gerir Segredos do Utilizador** e configura `ConnectionStrings:PaCT0.2Db` para uma base `pact0.2_db` com o esquema da aplicação já preparado.
3. Define `PaCT.Api` como projeto de arranque, seleciona o perfil **https** e carrega em **F5**. O arranque compila a interface e abre a aplicação em `https://localhost:7161`.

Para usar o envio de emails, configura `Email:Smtp` nos Segredos do Utilizador. Para verificar o arranque, consulta `/health/live` e `/health/ready`. O segundo endpoint verifica também a ligação ao MySQL.
