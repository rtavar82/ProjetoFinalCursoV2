# PaCT.Web

Frontend React com JavaScript, Vite, ESLint e CSS. Identificadores em inglês; interface em português de Portugal.

O percurso entregue é o registo inicial do gestor técnico, convite da gestora-terapeuta pelo frontend, registo da destinatária, confirmação de email e Google Authenticator, com códigos de recuperação e navegador reconhecido por 30 dias. Não existem contas, pedidos ou respostas de sucesso fictícios no frontend.

Após entrar, ambos os gestores usam Clientes. O técnico usa A minha conta → Gestora-terapeuta para enviar, substituir, cancelar e acompanhar o convite. A destinatária abre o link do email e regista os próprios dados; não escolhe o papel nem altera o email convidado. A criação da conta exige ação explícita e não dispensa confirmação do email ou 2FA.

Clientes entrega pesquisa/lista, ficha manual sem conta, edição com controlo de versão e revisão de coincidências com seleção de dados, sem bloco de notas privadas no formulário. O alerta fica abaixo do cabeçalho comum dos gestores, acima do título. O cartão mostra todos os dados recebidos no pedido; candidata e ficha atual abrem só para leitura, preservando a seleção ao fechar. Nome e apelido são obrigatórios em todos os registos e não podem ser apagados na edição. Cliente autónomo fornece também email, nascimento, género e localidade no primeiro formulário, reutilizando ClientProfileForm; depois confirma email e define palavra-passe. Tem Meus dados e 2FA opcional em A minha conta. Com coincidência e email não reservado por outra conta, usa a nova conta isolada com Identidade por verificar, sem dados anteriores; recusa mantém-na separada. Email reservado não cria segunda conta; a consulta limitada da proposta não concede acesso. Na gravação pelo cliente, nascimento é obrigatório; pela gestão, pode estar ausente. A restante incompletude não bloqueia ações.

Não existem módulos financeiros/consultas/compras simulados, transferência de valores, recuperação de palavra-passe ou alteração direta do email de entrada. O procedimento seguro de alteração deste contacto é um próximo incremento; o campo fica só para leitura na ficha com conta.

Verificação visual isolada: tests/PaCT.Web.Tests/client-visual-check.cjs, com Playwright fornecido pelo ambiente de testes. Interceta todos os recursos e respostas; não liga à API nem usa dados reais. Recebe opcionalmente o caminho de node_modules e o canal do navegador (por exemplo msedge). As imagens são saídas ignoradas em artifacts/clients, não dados iniciais da aplicação.

## Usar com a API

Abrir a solução na raiz, definir PaCT.Api como projeto de arranque e iniciar com F5 no perfil https.
O frontend compilado é servido em https://localhost:7161, na mesma origem da API. Esta é a forma de testar registo e cookies seguros.

## Trabalhar no frontend

~~~powershell
npm ci
npm run dev
npm run lint
npm run build
~~~

O servidor Vite isolado é para desenvolvimento visual; não configura autenticação HTTP ou um proxy que ignore TLS.
O build produz dist, que a API copia para wwwroot. Ambas são saídas geradas.
Nunca colocar dados, chaves ou ficheiros privados em public, dist ou wwwroot.
QR gerado localmente: não enviar o segredo do autenticador a serviços externos.
Não são usados localStorage, sessionStorage ou cache offline para contas/tokens.

Consultar as instruções de instalação e os limites desta entrega no README da raiz.

## Mobile-first e PWA

Layout base para 320 px, expandido por min-width. Manifesto e ícones públicos; o build gera um único service-worker.js versionado, com lista permitida de recursos. IndexedDB guarda exclusivamente versão e data do build público, usadas no aviso offline. Nenhum dado privado ou fila de operações é persistido no navegador.

Nova versão aguarda confirmação; alterações não submetidas nesta ou noutra janela impedem a atualização. Testes reais do worker/IndexedDB em tests/PaCT.Web.Tests/pwa-check.cjs e verificação isolada dos ecrãs em client-visual-check.cjs. Repetir ambos após novos incrementos. A simulação não substitui instalação/ensaio no Android físico com HTTPS confiável.

Os formulários não guardam cópias automáticas no aparelho. Ao carregar a nova versão, apenas a base retirada PaCT.PrivateDrafts.v1 é eliminada; as notas, imagens e mensagens já gravadas expressamente no servidor são preservadas.
