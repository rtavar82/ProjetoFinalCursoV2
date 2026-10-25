# PaCT 0.2

Reconstrução por incrementos, sem importar contas, pessoas, dados ou configurações de negócio da base antiga.

## Estrutura

- src/PaCT.Api — API .NET 10, segurança e MySQL.
- src/PaCT.Web — frontend React/JavaScript, Vite e CSS.
- tests/PaCT.Api.Tests — testes isolados, sem base real ou emails reais.
- docs — regras e relatórios de entrega.

Abrir PaCT0.2.slnx no Visual Studio. O projeto de arranque é PaCT.Api, perfil **https**.
F5 compila o frontend e abre **https://localhost:7161/**. O diagnóstico da API é **/api/status**.
A pasta wwwroot da API é gerada a partir de src/PaCT.Web/dist; nunca editar ou guardar ficheiros privados aí.

## Entregue agora

**Início do visitante e apresentação da Denise (23/10/2026):** página inicial pública e biografia no template Sálvia, com textos/imagens conferidos e leitura pública do catálogo, sem exigir sessão para preços. Ligações para Agenda/acesso, seleção de serviço e janela informativa de pagamento. Sem editor de conteúdos, importação da base antiga ou novos módulos decorativos. Política anual dos packs alinhada no catálogo/cálculo; transporte externo do aviso por email continua pendente. Ver [entrega e testes](docs/IMPLEMENTACAO_INICIO_VISITANTE.md).

**Agenda do cliente (23/10/2026, edição33):** calendário e filtros publicados, horários livres sem escolha prévia de serviço, grupos/retiros publicados, pedido com revisão no servidor e envio explícito, quatro separadores de marcações, saldo/dívida e consultas fechadas Por ver/Histórico. Pedido recuperável em rascunho cifrado, sem reenvio automático; avisos com leitura independente. Frontend ligado à API e persistência MySQL existente; nenhum dado fictício importado. Inclui testes automáticos e SQL com rollback, não homologação num telefone físico ou entrega de comunicações externas. Ver [entrega, testes e limites](docs/IMPLEMENTACAO_AGENDA_CLIENTE.md).

**Mensagens de acompanhamento (23/10/2026, edição32):** cliente titular e terapeuta enviam texto na consulta Realizada; só a terapeuta encerra/reabre a conversa. Inclui mensagens cifradas, leitura explícita própria, avisos internos e rascunhos cifrados recuperáveis em A minha conta, com repetição expressa da mesma operação após falha. Duas tabelas adicionadas com backup verificado e dados preservados. Não inclui ainda email/push externos COM-19 ou homologação num telefone físico. Ver [contratos, testes e limites](docs/IMPLEMENTACAO_MENSAGENS_ACOMPANHAMENTO.md).

**Frontend Sálvia (22/10/2026):** layout comum, páginas/componentes React e CSS Modules com a paleta aprovada, Georgia/Segoe UI, cartões arredondados, resumos com destaque esquerdo e blocos de horário. Navegação inferior no telemóvel/tablet e lateral no computador, sem o limite de440px da maquete. Mantidas as áreas/dados/autorização existentes,60000ms dos alertas, atualização após ação confirmada e proteção da edição. Não são importados os dados/módulos fictícios das referências. Corrigida a regressão de navegação: sem abortar pedidos por trocar de separador, com partilha das leituras pendentes e dependências carregadas apenas quando necessárias. Ver [integração Sálvia e testes](docs/IMPLEMENTACAO_VISUAL_SALVIA.md), [infraestrutura de cartões](docs/IMPLEMENTACAO_FRONTEND_CARTOES.md) e [regras FE-001–028](docs/negocio/24_FRONTEND_MOBILE_E_RASCUNHOS.md). Homologação física Android continua pendente; não inclui arrastar cartões nem autosave de todos os formulários.

**Google e alteração de palavra-passe (22/10/2026):** cliente e ambos os gestores encontram os dois percursos em Meu perfil → A minha conta. Associar Google exige a palavra-passe da própria conta; depois, Entrar com Google mantém a Passkey aplicável. Alterar palavra-passe envia email para escolher/confirmar uma senha nova; após guardar, os acessos anteriores são revogados e é exigida entrada com email e nova palavra-passe. Não cria contas por coincidência do email Google. Ver [entrega, configuração OAuth e testes](docs/IMPLEMENTACAO_GOOGLE_E_ALTERACAO_PASSWORD.md).

**Gestão de acesso de clientes (22/10/2026):** os dois gestores encontram Clientes → Abrir ficha → Acesso e segurança. Alterar email envia confirmação para o novo endereço; após o cliente confirmar, mantém a palavra-passe e as Passkeys. Repor Passkeys é uma ação separada sobre esse cliente, revogando os acessos anteriores e permitindo nova ativação opcional. A instalação já recebeu a tabela de auditoria com backup verificado. Ver [entrega](docs/IMPLEMENTACAO_GESTAO_ACESSO_CLIENTES.md) e [regras PES-A01–06](docs/negocio/02_PESSOAS_CONTAS_E_REGISTO.md).

**Passkeys, fase1 (21/10/2026):** A minha conta permite registar e testar WebAuthn/Passkeys. Após ativação, a conta passa a entrar por Passkey e recusa TOTP. Conforme aprovação do proprietário, eliminar o TOTP só depois de validar a entrada real das contas protegidas; o percurso inicial legado abaixo é temporário até à fase2. Ver [regras de Passkeys](docs/negocio/25_WEBAUTHN_PASSKEYS_E_MIGRACAO.md) e [entrega/operação](docs/IMPLEMENTACAO_PASSKEYS.md).

O ciclo individual está consolidado em [22 — regras v3.0](docs/negocio/22_CONSOLIDACAO_FINANCEIRA_V3.md) e na [matriz de combinações](docs/negocio/23_MATRIZ_COMBINACOES_V3.md), com prioridade das decisões financeiras mais recentes. API, frontend e base incluem páginas4/4/3, correções excecionais com saldo negativo global, avisos independentes e estados Paga/Sem dívida preservados. O cliente mantém pagamento integral de consulta própria com crédito suficiente. [Entrega e limites](docs/IMPLEMENTACAO_CICLO_CONSULTAS.md).

Registo inicial do gestor técnico, convite da gestora-terapeuta pelo frontend, registo pessoal da destinatária, confirmação de email, Google Authenticator, códigos de recuperação, entrada e saída.
Sem contas predefinidas, escolha pública de papéis ou criação de um segundo gestor técnico.
Área Clientes para ambos os gestores: pesquisa, ficha manual sem conta, edição e revisão de coincidências, sem bloco de notas privadas no formulário. Nome e apelido obrigatórios em todos os registos de pessoas e não apagáveis numa edição. Cliente autónomo fornece também email, nascimento, género e localidade no primeiro formulário; depois confirma email e define palavra-passe. Google Authenticator opcional para clientes. Nascimento obrigatório na gravação pelo cliente, opcional no preenchimento pelo gestor; restante incompletude não bloqueia ações.

Recuperação pública de palavra-passe esquecida e alteração autónoma dos contactos de entrada são incrementos seguintes. Alteração da própria palavra-passe a partir da sessão, Google associado, alteração de email por um gestor e reposição de Passkeys de clientes estão entregues. Consultas e crédito têm operações neste incremento; compras e packs ainda não. A associação de fichas entrega seleção de dados pessoais e preservação dos originais; não transfere automaticamente consultas ou movimentos financeiros.

As dezassete tabelas usadas são **people**, **accounts**, **security_emails**, **therapist_invitations**, **client_notes**, **client_reviews**, **consultation_services**, **availability_windows**, **consultations**, **credit_entries**, **consultation_notices**, **consultation_commands**, **balance_notices**, **push_subscriptions**, **account_passkeys**, **account_security_actions** e **account_external_logins**. A remoção do bloco visual de notas não apaga a tabela nem os seus dados; a interface atual usa client_reviews para propostas/decisões de coincidência. Registo do cliente reutiliza contas, pessoas e a fila de email, sem outra tabela de registo. Código, identificadores, contratos técnicos e valores técnicos em inglês; interface em português de Portugal.

## Primeiro teste, no PC

A instalação local já foi preparada. Não é necessário voltar a criar a base.
No terminal privado do Visual Studio, a partir da raiz da solução, obter o código de instalação:

~~~powershell
dotnet run --project src/PaCT.Api/PaCT.Api.csproj --no-build --no-restore --no-launch-profile -- --environment Development --show-installation-code
~~~

O código só é apresentado num terminal não redirecionado e antes de existir gestor técnico. Não o enviar para um chat, guardar no Git ou colocar num ficheiro público.
É um código de autorização inicial, não a palavra-passe da conta.

Depois:

1. Iniciar a API com F5, perfil https.
2. Preencher o código, nomes, localidade, nome público, email e palavra-passe/confirmar.
3. Abrir o email no PC e confirmar explicitamente o endereço. A abertura do link, por si só, não confirma.
4. Continuar a configuração, ler o QR no Google Authenticator e introduzir o código.
5. Guardar os oito códigos de recuperação num local seguro separado do dispositivo.
6. Entrar na gestão. A entrada é Clientes. O técnico encontra o convite da gestora-terapeuta em A minha conta.

Um registo incompleto é retomado pela entrada com email/palavra-passe, não pela criação de outra conta.
Reconhecer este dispositivo está desmarcado por defeito e vale 30 dias. Continua a exigir palavra-passe ao iniciar sessão. É possível esquecer o navegador; expiração ou revogação voltam a exigir 2FA.
Os códigos TOTP e de recuperação só são aceites uma vez. Recuperação revoga sessões e confiança anteriores.

## Convidar a gestora-terapeuta — pelo frontend

1. Iniciar com F5 e entrar como gestor técnico.
2. Em **A minha conta → Gestora-terapeuta**, indicar o email da destinatária e carregar em **Enviar convite**. Não pode pertencer a uma conta já existente.
3. Consultar o estado na mesma área. A aceitação pelo servidor de email não garante a entrega na caixa de entrada.
4. A destinatária abre o convite no PC de desenvolvimento, preferencialmente numa janela privada para não substituir a sessão técnica. Carrega em **Ver convite e continuar** e preenche os próprios dados e palavra-passe. O email do convite não é editável.
5. Depois de criar a conta, recebe uma confirmação de email separada. Confirma explicitamente o endereço e ativa o Google Authenticator, guardando os códigos de recuperação.
6. O técnico pode carregar em **Atualizar estado** para acompanhar o registo. Só a sessão técnica tem o formulário de convites.

O convite é pessoal, válido 24 horas e de uso único; abrir o link não cria uma conta. Reenviar/substituir exige confirmação e invalida o convite anterior; também é possível cancelá-lo. Um registo já iniciado é retomado pela destinatária com a sua palavra-passe, não recriado por outro convite. A instalação admite uma única conta permanente de cada gestor.

Localhost só funciona no PC anfitrião. Acesso pelo telefone/alojamento público não fazem parte deste incremento.

A interface é mobile-first e a PWA/Service Worker/IndexedDB já fazem parte da compilação. Rascunhos privados cifrados do fecho individual usam IndexedDB separado, com recuperação após autenticação online; não existe cache de APIs privadas nem fila automática de comandos. A instalação no telefone real continua a exigir HTTPS confiável da nova PaCT0.2; não usar localhost no Android nem confundir a API antiga com esta instalação. Ver [regras atuais do frontend e rascunhos](docs/negocio/24_FRONTEND_MOBILE_E_RASCUNHOS.md) e [implementação dos rascunhos](docs/IMPLEMENTACAO_RASCUNHOS_PRIVADOS.md).

## Clientes — testar com dados novos

1. Com F5, entrar num dos gestores e abrir Clientes. A lista exclui as pessoas das contas de gestão.
2. Criar ficha: nome, apelido, localidade e pelo menos email ou telefone. Não cria conta, palavra-passe ou email de convite.
3. Pesquisar por nome (mínimo três caracteres), email completo ou algarismos do telefone; Ver todas as fichas remove o filtro. Oito fichas por página.
4. Abrir ficha, editar dados e guardar; o gestor pode guardar sem nascimento. Não existe bloco de notas privadas no formulário.
5. Para registo autónomo, usar janela privada e escolher Criar conta de cliente. Preencher nome, apelido, email, telefone/indicativo, nascimento, género e localidade; os restantes dados são opcionais. Confirmar explicitamente no link e só depois definir palavra-passe; nenhuma entrada normal antes destes dois passos.
6. Na ficha própria, nascimento é obrigatório para o cliente guardar; género/localidade continuam a definir completude. Opcionais incluem filhos, morada/código postal e as cinco situações pessoais aprovadas.
7. Conta do cliente: A minha conta permite ativar Google Authenticator opcional. Uma vez ativo, palavra-passe sozinha já não chega, salvo confiança válida no navegador.
8. Coincidência de email/telefone/nome público gera uma ocorrência comum em Clientes. Gestor rejeita sem alterar valores atuais, ou confirma identidade e escolhe os campos da ficha existente a associar; os originais permanecem. Não duplica dinheiro nem publica notas privadas. Email já usado por conta ativa não permite outra conta.

Cliente autenticado vê apenas a própria ficha e propostas/decisões. Se o email coincidir com uma ficha sem conta de acesso, o novo registo cria uma pessoa e conta isoladas: confirmar email e definir palavra-passe permite usar a conta, marcada Identidade por verificar, sem dados da candidata. O gestor pode associar campos selecionados ou manter fichas separadas; nenhuma decisão recria a conta ou une credenciais. Se o email já estiver reservado por uma conta, não é criada outra: só se pode consultar a resposta genérica da própria proposta com prova limitada, em memória, válida 24h e sem candidatos. Registo ainda sem palavra-passe pode ser retomado por novo pedido de email; não duplica contas e invalida links anteriores.

O alerta de ocorrências é comum aos dois gestores e aparece abaixo do cabeçalho, acima do título, em todas as páginas autenticadas. O botão abre Clientes → Ocorrências para rever. O cartão mostra os dados recebidos no pedido, incluindo nomes, nascimento, género e localidade, e permite abrir a ficha atual e as candidatas para comparação só de leitura. Fechar a comparação conserva as escolhas, sem aprovar identidade ou dar acesso à nova conta. Reenvio anónimo de confirmação não substitui os dados pessoais já guardados numa conta pendente.

O email de entrada aparece só para leitura na edição comum da ficha. Para o alterar, os gestores usam Acesso e segurança → Alterar email de acesso; a ativação exige confirmação no novo endereço. A reposição de Passkeys é uma ação separada nesse mesmo local.

## Configuração privada

O UserSecretsId foi preservado. No projeto da API, usar **Gerir Segredos do Utilizador**.

- ConnectionStrings:PaCT0.2Db — apenas a base autorizada pact0.2_db nesta instalação de desenvolvimento.
- Email:Smtp:Host, Port, UserName, Password, FromEmail e FromName — envio SMTP com TLS obrigatório.
- Application:WebUrl e Application:PublicUrl — HTTPS da instalação; localmente https://localhost:7161.
- Authentication:Google:ClientId e Authentication:Google:ClientSecret — cliente OAuth Aplicação Web. No mesmo cliente Google Cloud, autorizar exatamente https://localhost:7161/signin-google em URIs de redirecionamento autorizados. Configurar apenas Origens JavaScript não substitui essa autorização. Não incluir o segredo no repositório, frontend ou chat.

A preparação aditiva --prepare-account-login já foi aplicada a esta instalação com backup cifrado verificado: nova account_external_logins, accounts.password_sign_in_required e tipos de auditoria de segurança. Não repetir instalação/reset para corrigir redirect_uri_mismatch; corrigir o callback autorizado no cliente Google usado pela API.

Não partilhar o secrets.json. Não existe uma confirmação falsa de email nem um modo de desenvolvimento que dispense o 2FA dos gestores.
O envio fica numa fila persistente cifrada. Submitted significa aceitação pelo SMTP, não garantia de entrega; falha/resultado incerto exigem novo pedido explícito, sem repetição automática do mesmo envio.

## Preparar uma instalação vazia

Operação explícita, fora do arranque normal:

~~~powershell
dotnet run --project src/PaCT.Api/PaCT.Api.csproj --no-build --no-restore --no-launch-profile -- --environment Development --prepare-installation
~~~

Cria as três tabelas da fundação numa base totalmente vazia e acrescenta os convites e o incremento de Clientes. A transição das duas tabelas portuguesas da fundação só é aceite quando ambas estão vazias e a estrutura corresponde à esperada: guarda e confere a estrutura anterior, renomeia tabelas/colunas e acrescenta a segurança, sem apagar tabelas ou importar registos.
DDL MySQL não tem rollback global; falha parcial não é resolvida com eliminação automática.
Repetir sobre a estrutura inglesa válida apenas confere a instalação. Não gera novas chaves sobre registos existentes se as originais estiverem em falta.

Para uma instalação já preparada com três tabelas, existe a atualização explícita `--prepare-therapist-invitations`, com as mesmas opções do comando anterior. Nesta instalação já foi aplicada. Cria apenas a quarta tabela, depois de guardar e conferir uma cópia cifrada do esquema e registos em `security/data-backups`, fora do projeto. Não é executada pelo frontend nem pelo arranque normal; o convite dos utilizadores não exige comandos.

O incremento `--prepare-clients` prepara os campos de perfil, a criação posterior da palavra-passe, o código postal cifrado e as duas tabelas de Clientes. Nesta instalação já foi aplicado, com backup cifrado verificado e igualdade dos valores anteriores antes/depois. A validação contextual exige os obrigatórios de cada registo, sem inventar dados em contas anteriores incompletas. Repetir confere a estrutura de seis tabelas; não recria nem apaga dados. Preparação DDL não é executada no arranque normal e falha parcial exige revisão, sem eliminação automática.

## Chaves e distribuição

Para preparar a gestão de acesso depois de preparar Clientes e Passkeys, usar explicitamente --prepare-client-access com as opções de ambiente dos comandos anteriores. Acrescenta apenas a tabela de auditoria, com backup cifrado verificado e preservação dos dados. Nesta instalação já foi aplicado. Os gestores fazem as operações correntes pelo frontend, sem comandos de instalação.

Cada comprador terá base, configuração, domínio HTTPS, Installation:Id e chaves próprios, usando o mesmo código.
Neste incremento, a execução exige Windows: chaves externas em LocalAppData/PaCT/installations/<id>/security, protegidas com DPAPI do utilizador Windows.
Development usa um identificador local fixo; produção exige Installation:Id como GUID único. Não copiar o identificador de desenvolvimento, códigos, chaves ou base de outro comprador.
Não apagar chaves antigas nem mover a instalação para outra máquina sem plano de recuperação.
A homologação de restauro de dados/chaves/perfil Windows, outro provedor de chaves e parametrização de bases de produção ainda não foram entregues. O código atual não é uma declaração de alojamento de produção pronto.

## Verificação

~~~powershell
dotnet restore PaCT0.2.slnx --locked-mode
dotnet build PaCT0.2.slnx --no-restore
dotnet test --solution PaCT0.2.slnx --no-build --no-restore
npm --prefix src/PaCT.Web run lint
dotnet list PaCT0.2.slnx package --vulnerable --include-transitive
npm --prefix src/PaCT.Web audit
~~~

Os testes normais não ligam ao MySQL nem ao SMTP. Para repetir os diagnósticos explícitos desta instalação de desenvolvimento, depois de já existir uma conta:

~~~powershell
$env:PACT_TEST_MYSQL_READONLY = '1'
$env:PACT_TEST_SMTP_CONNECT = '1'
try {
    dotnet test --solution PaCT0.2.slnx --no-build --no-restore
} finally {
    Remove-Item Env:PACT_TEST_MYSQL_READONLY -ErrorAction SilentlyContinue
    Remove-Item Env:PACT_TEST_SMTP_CONNECT -ErrorAction SilentlyContinue
}
~~~

Estes diagnósticos usam os segredos da API, apenas na base pact0.2_db. Leem as contas/fila existentes e verificam TLS/autenticação SMTP sem inserir dados, reclamar envios ou enviar mensagens. Exigem MySQL e SMTP disponíveis; ficam ignorados nos testes normais.

O diagnóstico adicional `PACT_TEST_MYSQL_ROLLBACK=1` destina-se à instalação de desenvolvimento antes do primeiro registo real da terapeuta: verifica o SQL de registo e identificadores dos convites numa transação revertida. Não deixa pessoas/contas/emails/convites de teste nem envia mensagens; o contador técnico de sequência pode ter intervalos. Não é um diagnóstico apenas de leitura.

npm run dev, dentro de src/PaCT.Web, é útil para desenvolvimento visual. O percurso seguro ligado à API deve ser testado pelo F5 em HTTPS, na mesma origem; não existe um proxy que ignore certificados.

## Documentação

- [Regras atuais](docs/negocio/00_LEIA_PRIMEIRO.md)
- [Pessoas e contas](docs/negocio/02_PESSOAS_CONTAS_E_REGISTO.md)
- [Segurança](docs/negocio/15_INTERFACE_SEGURANCA_E_OPERACAO.md)
- [Entrega do registo inicial](docs/IMPLEMENTACAO_REGISTO_INICIAL_E_2FA.md)
- [Convite da gestora-terapeuta](docs/IMPLEMENTACAO_CONVITE_GESTORA_TERAPEUTA.md)
- [Entrega de Clientes e registo autónomo](docs/IMPLEMENTACAO_CLIENTES_E_REGISTO.md)
- [PWA, Service Worker, IndexedDB e mobile-first](docs/IMPLEMENTACAO_PWA_MOBILE_FIRST.md)
- [Agenda, visitantes, grupos/retiros, packs e acompanhamento — edição31](docs/IMPLEMENTACAO_AGENDA_EVENTOS_PACKS.md)

A exclusão de /docs do Git, já existente, foi preservada. Os documentos ficam locais; incluir documentação num commit exige rever essa exclusão.

## Notificações de saldo negativo
A preparação de consultas cria as chaves Web Push protegidas da própria instalação e as tabelas balance_notices/push_subscriptions, após backup verificado. Não copiar chaves de outra instalação. Cliente ativa notificações em A minha conta ou Pagamentos pendentes; exige HTTPS confiável, permissão e navegador compatível. Só aviso genérico, sem email. Submissão ao serviço não comprova entrega física. Envio incerto/interrompido não é repetido automaticamente: a terapeuta pode autorizar nova tentativa reconhecendo risco de repetição. O aviso e a dívida continuam consultáveis na app sem push. Respostas privadas não ficam em cache; apenas os rascunhos autorizados usam o cofre local cifrado definido no capítulo24.

## Atualização de agenda de23/10/2026

`--prepare-consultations` acrescenta também as tabelas de visitantes, eventos/participações/avisos, caixa anónima e packs/consumos. Validar a instalação e parar a API antes de preparar; a operação exige backup cifrado verificado e não reinicia a base. A preparação foi executada nesta instalação, com dados preservados e sem mensagens enviadas.

O teste opt-in `MySqlConsultationTests`, com `PACT_TEST_MYSQL_ROLLBACK=1` e filtro explícito da classe, verifica a persistência dentro de transação revertida mesmo com dados existentes. Não deixa registos de ensaio, não envia emails e não substitui uma prova de concorrência entre duas ligações SQL. Os novos testes de navegador são `events-packs-check.cjs` e `client-followup-check.cjs`, com dados simulados. O relatório da edição31 identifica o que foi entregue e as parcelas ainda não concluídas; não declarar todo o projeto implementado por existir este incremento.

