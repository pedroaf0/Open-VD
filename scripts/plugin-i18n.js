/**
 * Extracts every translatable string from the WordPress plugin and writes the
 * translation catalogs under wordpress-plugin/v-dicom/languages:
 *
 *   v-dicom.pot          (template, always regenerated)
 *   v-dicom-en_US.po/.mo (English)
 *   v-dicom-es_ES.po/.mo (Spanish)
 *
 * Existing non-empty translations in the .po files are preserved; anything
 * else falls back to the built-in tables below.
 *
 *   node scripts/plugin-i18n.js   (ou: npm run plugin:i18n)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(root, "wordpress-plugin", "v-dicom");
const langDir = path.join(pluginDir, "languages");

const TEXT_DOMAIN = "v-dicom";
const REVISION_DATE = "2026-10-15 00:00+0000";
const GENERATOR = "v-dicom/plugin-i18n.js";

const GETTEXT_FN_RE =
  /\b(__|_e|_x|_n|_nx|esc_html__|esc_attr__|esc_html_e|esc_attr_e|esc_html_x|esc_attr_x)\s*\(/g;
const PLACEHOLDER_RE = /%[0-9]*\$?[sd]/;

/* ------------------------------------------------------------------ *
 * Built-in translation tables (msgid -> msgstr, or [msgid_plural]).  *
 * ------------------------------------------------------------------ */
const EN = {
  "%d dia restante": ["%d day left", "%d days left"],
  "%d mês": ["%d month", "%d months"],
  "%s resultado(s)": "%s result(s)",
  "(em andamento)": "(in progress)",
  "(usados para segmentação automática)": "(used for automatic segmentation)",
  "+ %d MB em planos": "+ %d MB in plans",
  "A extensão ZIP não está disponível no servidor.":
    "The ZIP extension is not available on the server.",
  'A segmentação (%1$s) da cena "%2$s" falhou.%3$sO crédito foi estornado. Tente novamente ou contate o suporte.%4$sCena: %5$s':
    'The segmentation (%1$s) of scene "%2$s" failed.%3$sThe credit was refunded. Please try again or contact support.%4$sScene: %5$s',
  'A segmentação da cena "%1$s" falhou.%2$sO crédito foi estornado. Tente novamente ou contate o suporte.%3$sCena: %4$s':
    'The segmentation of scene "%1$s" failed.%2$sThe credit was refunded. Please try again or contact support.%3$sScene: %4$s',
  "A segmentação falhou.": "The segmentation failed.",
  "API key (upload/download por chave)": "API key (upload/download by key)",
  "API key atualizada.": "API key updated.",
  Abrir: "Open",
  "Adicionar tipo": "Add type",
  "Aguarde, carregando sua cena…": "Please wait, loading your scene…",
  "Apenas o dono da cena pode solicitar a segmentação.":
    "Only the scene owner can request segmentation.",
  "Aplicado automaticamente quando uma nova conta é criada (ou na primeira sessão de contas ainda sem cota).":
    "Applied automatically when a new account is created (or on the first session of accounts that still have no quota).",
  "Após salvar, este campo virará editor visual com formatação.":
    "After saving, this field becomes a visual editor with formatting.",
  "Armazenamento inicial (MB)": "Initial storage (MB)",
  Arquivos: "Files",
  "As cores dos cortes (axial, coronal e sagital) são fixas e não podem ser alteradas. As outras cores são aplicadas automaticamente ao visualizador.":
    "The slice colors (axial, coronal and sagittal) are fixed and cannot be changed. The other colors are applied automatically to the viewer.",
  Ativo: "Active",
  Authorization: "Authorization",
  "Autorização de URLs externas": "External URL authorization",
  Buscar: "Search",
  "Buscar por nome, usuário ou e-mail…": "Search by name, username or e-mail…",
  "Buscar por título, chave ou dono…": "Search by title, key or owner…",
  'Cada tipo representa um serviço de nuvem serverless. A URL de execução recebe o payload, a URL de status é consultada durante o processamento e o callback informa a conclusão. Desmarque "Ativo" para desabilitar um tipo sem excluí-lo. A mesma cena pode usar vários tipos.':
    'Each type represents a serverless cloud service. The run URL receives the payload, the status URL is polled while processing and the callback reports completion. Uncheck "Active" to disable a type without deleting it. The same scene can use several types.',
  "Campo status ausente.": "Missing status field.",
  "Carregamento de DICOM": "DICOM loading",
  "Cena DICOM": "DICOM Scene",
  "Cena não encontrada.": "Scene not found.",
  "Cena removida.": "Scene removed.",
  "Cenas DICOM": "DICOM Scenes",
  "Cenas salvas": "Saved scenes",
  "Chave da cena.": "Scene key.",
  "Chave de API": "API key",
  "Chave de API inválida.": "Invalid API key.",
  "Chave inválida.": "Invalid key.",
  "Chunk %1$d de %2$d não encontrado.": "Chunk %1$d of %2$d not found.",
  "Configuração atualizada.": "Settings updated.",
  "Configuração do serviço de segmentação ausente para este tipo.":
    "Segmentation service configuration missing for this type.",
  "Corpo enviado na requisição de execução. Use os placeholders acima para montar o formato esperado pelo serviço.":
    "Body sent in the run request. Use the placeholders above to build the format expected by the service.",
  "Contratado em": "Purchased on",
  "Cor da interface": "Interface color",
  "Cor de destaque": "Accent color",
  "Cor de fundo": "Background color",
  "Cotas para novas contas": "Quotas for new accounts",
  "Cotas para novas contas atualizadas.": "Quotas for new accounts updated.",
  "Criada em": "Created on",
  "Crédito insuficiente para segmentar. Custo: %d créditos.":
    "Insufficient credits to segment. Cost: %d credits.",
  Créditos: "Credits",
  "Créditos de processamento:": "Processing credits:",
  "Créditos iniciais": "Initial credits",
  Custo: "Cost",
  "Debug da segmentação — por cena (admin)": "Segmentation debug — per scene (admin)",
  "Deixe vazio para desativar. Endpoints aceitos com a chave:":
    "Leave empty to disable. Endpoints accepted with the key:",
  "Descrição (texto rico — exibida no painel de segmentação)":
    "Description (rich text — shown in the segmentation panel)",
  "Descrição (texto rico)": "Description (rich text)",
  "Descrição com formatação — após salvar vira editor rico":
    "Description with formatting — becomes a rich editor after saving",
  Dono: "Owner",
  Duração: "Duration",
  "Em uso agora": "In use now",
  "Enviando…": "Sending…",
  "Endereço de execução do serviço de segmentação ausente.":
    "Segmentation service run address missing.",
  "Endereço de status do serviço de segmentação ausente.":
    "Segmentation service status address missing.",
  "Erro ao ler chunk.": "Error reading chunk.",
  "Erro ao resolver OneDrive: ": "Error resolving OneDrive: ",
  "Erro de rede ao iniciar a segmentação.": "Network error while starting segmentation.",
  "Escolher logo": "Choose logo",
  Espaço: "Space",
  "Esta URL precisa ser autorizada antes de ser baixada. Consulte o endpoint /wp-json/v-dicom/v1/authorized-url.":
    "This URL must be authorized before it can be downloaded. See the /wp-json/v-dicom/v1/authorized-url endpoint.",
  "Esta cena pertence a outro usuário.": "This scene belongs to another user.",
  "Este tipo de segmentação está desabilitado.": "This segmentation type is disabled.",
  "Ex.: Ossos": "E.g.: Bones",
  Excluir: "Delete",
  "Exigir autorização (1 crédito) para baixar arquivos de Google Drive/OneDrive.":
    "Require authorization (1 credit) to download files from Google Drive/OneDrive.",
  "Exigir autorização de URL": "Require URL authorization",
  "Expira em": "Expires on",
  Expirado: "Expired",
  "Falha ao consultar o arquivo no OneDrive.": "Failed to query the file on OneDrive.",
  "Fim:": "End:",
  "Fora de aspas o placeholder vira um valor JSON (texto com aspas, número ou array). Dentro de aspas ele vira texto já escapado. Exemplo de payload:":
    "Outside quotes the placeholder becomes a JSON value (quoted text, number or array). Inside quotes it becomes already escaped text. Example payload:",
  "Gerar chave": "Generate key",
  "Identificador deste tipo de segmentação.": "Identifier of this segmentation type.",
  "Identificador do job (disponível na URL de status e no callback).":
    "Job identifier (available in the status URL and the callback).",
  "Informe ?url=": "Provide ?url=",
  "Informe o tipo de segmentação (type).": "Provide the segmentation type (type).",
  "Iniciar %s? Confirme para consumir os créditos do tipo.":
    "Start %s? Confirm to consume the type's credits.",
  "Input enviado:": "Input sent:",
  "Início:": "Start:",
  "Já foi feita uma segmentação deste tipo para esta cena.":
    "A segmentation of this type has already been done for this scene.",
  "Limite (MB)": "Limit (MB)",
  "Limite 0 bloqueia novos uploads. O valor definido aqui é a cota base do usuário; planos de armazenamento ativos, quando existirem, somam-se a ele. Créditos são consumidos pela segmentação automática e pela autorização de URLs.":
    "A limit of 0 blocks new uploads. The value set here is the user's base quota; active storage plans, when they exist, are added to it. Credits are consumed by automatic segmentation and URL authorization.",
  'Limite de armazenamento atingido. Exclua uma cena em "Minhas cenas" ou peça mais espaço ao administrador.':
    'Storage limit reached. Delete a scene in "My scenes" or ask the administrator for more space.',
  "Limites atualizados.": "Limits updated.",
  "Limites de armazenamento por usuário": "Storage limits per user",
  Limpar: "Clear",
  "Link de compartilhamento": "Share link",
  "Link não reconhecido. Use Google Drive ou OneDrive.":
    "Unrecognized link. Use Google Drive or OneDrive.",
  Logo: "Logo",
  "Logs salvos no post meta da cena. DEBUG_SEGMENTATION=true também inclui debug na resposta JSON de /run e /segmentation-status.":
    "Logs saved in the scene's post meta. DEBUG_SEGMENTATION=true also includes debug in the JSON response of /run and /segmentation-status.",
  "Meu armazenamento": "My storage",
  "Meus planos de armazenamento": "My storage plans",
  "Microsoft não forneceu o token Badger.": "Microsoft did not provide the Badger token.",
  "Nenhum arquivo recebido.": "No file received.",
  "Nenhum job de segmentação encontrado para esta cena.":
    "No segmentation job found for this scene.",
  "Nenhum job de segmentação encontrado para este tipo nesta cena.":
    "No segmentation job found for this type in this scene.",
  "Nenhum tipo configurado.": "No type configured.",
  "Nenhum tipo de segmentação configurado.": "No segmentation type configured.",
  "Nenhum usuário com cenas ou limite definido ainda.":
    "No user with scenes or a defined limit yet.",
  "Nenhum usuário encontrado para a busca.": "No user found for the search.",
  "Nenhuma cena encontrada para a busca.": "No scene found for the search.",
  "Nenhuma cena salva ainda.": "No saved scene yet.",
  "Nome deste tipo de segmentação.": "Name of this segmentation type.",
  "Nome do visualizador": "Viewer name",
  "Nome*": "Name*",
  "Novo tipo ganha editor rico após salvar.": "A new type gets a rich editor after saving.",
  "Não foi possível criar o arquivo ZIP.": "Could not create the ZIP file.",
  "Não foi possível criar o arquivo final.": "Could not create the final file.",
  "Não foi possível gerar o arquivo ZIP.": "Could not generate the ZIP file.",
  "Não foi possível gravar o arquivo.": "Could not write the file.",
  "Não foi possível gravar o chunk.": "Could not write the chunk.",
  "Não foi possível identificar o ID do Google Drive.": "Could not identify the Google Drive ID.",
  "Não foi possível obter o redeem do OneDrive.": "Could not obtain the OneDrive redeem.",
  "Não foi possível obter o token do OneDrive.": "Could not obtain the OneDrive token.",
  "O Google Drive não forneceu um download direto. O arquivo pode exigir login, ter o download desativado ou estar sujeito a uma confirmação que o Google não permitiu resolver automaticamente.":
    "Google Drive did not provide a direct download. The file may require login, have downloads disabled, or be subject to a confirmation that Google could not resolve automatically.",
  "O visualizador tem página própria, carregada sem o tema do site.":
    "The viewer has its own page, loaded without the site theme.",
  "OneDrive não retornou URL de download.": "OneDrive did not return a download URL.",
  "OneDrive recusou o acesso ao arquivo.": "OneDrive denied access to the file.",
  Padrão: "Default",
  "Padrão do nome do vídeo 3D": "3D video filename pattern",
  "Nome usado no download do vídeo gravado no viewport 3D. Use {data}, {hora} ou {timestamp} para inserir a data/hora. Se não usar nenhum marcador de data/hora, o carimbo será acrescentado automaticamente. Não inclua a extensão (.mp4 ou .webm).":
    "Name used when downloading the video recorded in the 3D viewport. Use {data}, {hora} or {timestamp} to insert the date/time. If you do not use a date/time marker, the timestamp is appended automatically. Do not include the extension (.mp4 or .webm).",
  "Pasta não encontrada.": "Folder not found.",
  "Permissão negada.": "Permission denied.",
  "Permitir carregamento direto de DICOM": "Allow direct DICOM loading",
  "Permitir que os usuários abram DICOM de arquivos/pastas do próprio computador e façam upload direto (sem precisar de link do Drive/OneDrive).":
    "Allow users to open DICOM from files/folders on their own computer and upload them directly (no Drive/OneDrive link required).",
  "Pré-visualização do logo": "Logo preview",
  "Página do visualizador:": "Viewer page:",
  "Quando ativado, URLs externas precisam ser autorizadas antes do download. Ao desativar, todos os links são baixados sem autorização prévia.":
    "When enabled, external URLs must be authorized before download. When disabled, all links are downloaded without prior authorization.",
  "Quando desativado (padrão), os exames só podem ser carregados por link público do Google Drive ou do OneDrive. Quando ativado, também é possível selecionar arquivos ou uma pasta com as fatias DICOM e salvá-las na cena.":
    "When disabled (default), exams can only be loaded from a public Google Drive or OneDrive link. When enabled, users can also select files or a folder with the DICOM slices and save them to the scene.",
  "Redirect inválido do OneDrive.": "Invalid OneDrive redirect.",
  "Remover esta cena e seus arquivos?": "Remove this scene and its files?",
  "Requisição não autorizada.": "Unauthorized request.",
  "Resposta do serviço:": "Service response:",
  "Resposta inválida do OneDrive.": "Invalid OneDrive response.",
  "Resposta inválida do serviço de segmentação.": "Invalid segmentation service response.",
  "Salvar API key": "Save API key",
  "Salvar autorização de URL": "Save URL authorization",
  "Salvar carregamento de DICOM": "Save DICOM loading",
  "Salvar cotas para novas contas": "Save quotas for new accounts",
  "Salvar limites e créditos": "Save limits and credits",
  "Salvar tipos de segmentação": "Save segmentation types",
  "Salvar visual": "Save visual",
  Segmentação: "Segmentation",
  "Segmentação concluída — %s": "Segmentation completed — %s",
  "Segmentação falhou — %s": "Segmentation failed — %s",
  "Selecionar na biblioteca": "Select from library",
  "Sessão de upload inválida ou expirada.": "Invalid or expired upload session.",
  "Seu limite de armazenamento é zero. Peça ao administrador para definir um limite antes de enviar estudos.":
    "Your storage limit is zero. Ask the administrator to set a limit before uploading studies.",
  Situação: "Status",
  "Somente HTTP/HTTPS é permitido.": "Only HTTP/HTTPS is allowed.",
  "Somente os usuários desta página são salvos.": "Only the users on this page are saved.",
  'Sua segmentação (%1$s) da cena "%2$s" foi concluída%3$s.%4$sAbra a cena: %5$s':
    'Your segmentation (%1$s) of scene "%2$s" has completed%3$s.%4$sOpen the scene: %5$s',
  'Sua segmentação da cena "%1$s" foi concluída%2$s.%3$sAbra a cena: %4$s':
    'Your segmentation of scene "%1$s" has completed%2$s.%3$sOpen the scene: %4$s',
  "Tentar novamente": "Try again",
  "Texto de espera": "Waiting text",
  "Tipo de segmentação não encontrado.": "Segmentation type not found.",
  "Tipo migrado automaticamente da configuração anterior.":
    "Type automatically migrated from the previous configuration.",
  "Segmentação automática": "Automatic segmentation",
  "Tipos de segmentação atualizados.": "Segmentation types updated.",
  "Total:": "Total:",
  Título: "Title",
  "URL autorizada com sucesso! 1 crédito consumido.":
    "URL authorized successfully! 1 credit consumed.",
  "URL autorizará com 1 crédito. Confirme para prosseguir.":
    "The URL will be authorized with 1 credit. Confirm to proceed.",
  "URL de espera": "Waiting URL",
  "URL do servidor": "Server URL",
  "URL inválida.": "Invalid URL.",
  "Upload inválido.": "Invalid upload.",
  "Usado: %1$s de %2$s (%3$s disponíveis).": "Used: %1$s of %2$s (%3$s available).",
  Usuário: "User",
  "Usuário removido": "Removed user",
  "Ver logs da segmentação": "View segmentation logs",
  "v-dicom": "v-dicom",
  "Visual / White label": "Visual / White label",
  "Visual atualizado.": "Visual updated.",
  "Visualizador DICOM com cortes MPR, 3D e modelos STL.":
    "DICOM viewer with MPR slices, 3D and STL models.",
  "Você não tem armazenamento disponível. Contrate um plano ou peça ao administrador para definir um limite antes de enviar estudos.":
    "You have no storage available. Purchase a plan or ask the administrator to set a limit before uploading studies.",
  "Você não tem créditos para autorizar URLs. Compre créditos na loja.":
    "You have no credits to authorize URLs. Buy credits in the store.",
  "Você não tem permissão para salvar cenas.": "You do not have permission to save scenes.",
  "Você precisa estar logado para acessar este recurso.":
    "You must be logged in to access this resource.",
  "Você precisa estar logado.": "You must be logged in.",
  de: "of",
  "error (até 4k):": "error (up to 4k):",
  "output (até 8k):": "output (up to 8k):",
  segmentação: "segmentation",
  "status mapeado:": "mapped status:",
  "É necessário estar logado.": "You must be logged in.",
  "último polling": "last polling",
  "✓ Concluída": "✓ Completed",
  "✕ Falhou": "✕ Failed",
  "✕ Falhou — crédito devolvido": "✕ Failed — credit refunded",
  "Authorization (opcional)": "Authorization (optional)",
  "Lista de URLs de download da cena (array JSON).": "List of scene download URLs (JSON array).",
  "O payload da segmentação está vazio.": "The segmentation payload is empty.",
  "O payload renderizado não é um JSON válido.": "The rendered payload is not valid JSON.",
  "O serviço de segmentação não retornou um identificador de job.":
    "The segmentation service did not return a job identifier.",
  "O serviço de segmentação respondeu com HTTP %d.":
    "The segmentation service responded with HTTP %d.",
  "Payload (template)": "Payload (template)",
  "Payload enviado:": "Payload sent:",
  Placeholder: "Placeholder",
  "Placeholders disponíveis": "Available placeholders",
  "Se ficar vazia, o plugin usa {{url}}/run.": "If empty, the plugin uses {{url}}/run.",
  "Se ficar vazia, o plugin usa {{url}}/status/{{job_id}}.":
    "If empty, the plugin uses {{url}}/status/{{job_id}}.",
  "Timestamp Unix do envio.": "Unix timestamp of the request.",
  "URL base do serviço": "Service base URL",
  "URL base do serviço.": "Service base URL.",
  "URL de callback para o serviço informar o status.":
    "Callback URL for the service to report status.",
  "URL de execução (opcional)": "Run URL (optional)",
  "URL de status (opcional)": "Status URL (optional)",
  "URL do ZIP da cena (texto).": "Scene ZIP URL (text).",
  "URL do site WordPress.": "WordPress site URL.",
  "URL para o serviço enviar os modelos STL gerados.":
    "URL for the service to upload the generated STL models.",
  "Usar payload padrão": "Use default payload",
  "Valor enviado": "Value sent",
  "Também aceita os apelidos {{uploadlink}}, {{downloadlink}} e {{callbacklink}}.":
    "Also accepts the aliases {{uploadlink}}, {{downloadlink}} and {{callbacklink}}.",
  arquivo: "file",
};

const ES = {
  "%d dia restante": ["%d día restante", "%d días restantes"],
  "%d mês": ["%d mes", "%d meses"],
  "%s resultado(s)": "%s resultado(s)",
  "(em andamento)": "(en curso)",
  "(usados para segmentação automática)": "(usados para segmentación automática)",
  "+ %d MB em planos": "+ %d MB en planes",
  "A extensão ZIP não está disponível no servidor.":
    "La extensión ZIP no está disponible en el servidor.",
  'A segmentação (%1$s) da cena "%2$s" falhou.%3$sO crédito foi estornado. Tente novamente ou contate o suporte.%4$sCena: %5$s':
    'La segmentación (%1$s) de la escena "%2$s" falló.%3$sEl crédito fue reembolsado. Inténtalo de nuevo o contacta al soporte.%4$sEscena: %5$s',
  'A segmentação da cena "%1$s" falhou.%2$sO crédito foi estornado. Tente novamente ou contate o suporte.%3$sCena: %4$s':
    'La segmentación de la escena "%1$s" falló.%2$sEl crédito fue reembolsado. Inténtalo de nuevo o contacta al soporte.%3$sEscena: %4$s',
  "A segmentação falhou.": "La segmentación falló.",
  "API key (upload/download por chave)": "API key (subida/descarga por clave)",
  "API key atualizada.": "API key actualizada.",
  Abrir: "Abrir",
  "Adicionar tipo": "Añadir tipo",
  "Aguarde, carregando sua cena…": "Espere, cargando su escena…",
  "Apenas o dono da cena pode solicitar a segmentação.":
    "Solo el propietario de la escena puede solicitar la segmentación.",
  "Aplicado automaticamente quando uma nova conta é criada (ou na primeira sessão de contas ainda sem cota).":
    "Se aplica automáticamente cuando se crea una cuenta nueva (o en la primera sesión de cuentas que aún no tienen cuota).",
  "Após salvar, este campo virará editor visual com formatação.":
    "Tras guardar, este campo se convierte en un editor visual con formato.",
  "Armazenamento inicial (MB)": "Almacenamiento inicial (MB)",
  Arquivos: "Archivos",
  "As cores dos cortes (axial, coronal e sagital) são fixas e não podem ser alteradas. As outras cores são aplicadas automaticamente ao visualizador.":
    "Los colores de los cortes (axial, coronal y sagital) son fijos y no se pueden cambiar. Los demás colores se aplican automáticamente al visor.",
  Ativo: "Activo",
  Authorization: "Authorization",
  "Autorização de URLs externas": "Autorización de URL externas",
  Buscar: "Buscar",
  "Buscar por nome, usuário ou e-mail…": "Buscar por nombre, usuario o correo…",
  "Buscar por título, chave ou dono…": "Buscar por título, clave o propietario…",
  'Cada tipo representa um serviço de nuvem serverless. A URL de execução recebe o payload, a URL de status é consultada durante o processamento e o callback informa a conclusão. Desmarque "Ativo" para desabilitar um tipo sem excluí-lo. A mesma cena pode usar vários tipos.':
    'Cada tipo representa un servicio de nube serverless. La URL de ejecución recibe el payload, la URL de estado se consulta durante el procesamiento y el callback informa la finalización. Desmarca "Activo" para deshabilitar un tipo sin eliminarlo. La misma escena puede usar varios tipos.',
  "Campo status ausente.": "Falta el campo status.",
  "Carregamento de DICOM": "Carga de DICOM",
  "Cena DICOM": "Escena DICOM",
  "Cena não encontrada.": "Escena no encontrada.",
  "Cena removida.": "Escena eliminada.",
  "Cenas DICOM": "Escenas DICOM",
  "Cenas salvas": "Escenas guardadas",
  "Chave de API": "Clave de API",
  "Chave de API inválida.": "Clave de API no válida.",
  "Chave inválida.": "Clave no válida.",
  "Chunk %1$d de %2$d não encontrado.": "Fragmento %1$d de %2$d no encontrado.",
  "Configuração atualizada.": "Configuración actualizada.",
  "Configuração do serviço de segmentação ausente para este tipo.":
    "Falta la configuración del servicio de segmentación para este tipo.",
  "Contratado em": "Contratado el",
  "Cor da interface": "Color de la interfaz",
  "Cor de destaque": "Color de acento",
  "Cor de fundo": "Color de fondo",
  "Cotas para novas contas": "Cuotas para cuentas nuevas",
  "Cotas para novas contas atualizadas.": "Cuotas para cuentas nuevas actualizadas.",
  "Criada em": "Creada el",
  "Crédito insuficiente para segmentar. Custo: %d créditos.":
    "Créditos insuficientes para segmentar. Coste: %d créditos.",
  Créditos: "Créditos",
  "Créditos de processamento:": "Créditos de procesamiento:",
  "Créditos iniciais": "Créditos iniciales",
  Custo: "Coste",
  "Debug da segmentação — por cena (admin)": "Debug de segmentación — por escena (admin)",
  "Deixe vazio para desativar. Endpoints aceitos com a chave:":
    "Déjalo vacío para desactivar. Endpoints aceptados con la clave:",
  "Descrição (texto rico — exibida no painel de segmentação)":
    "Descripción (texto enriquecido — mostrada en el panel de segmentación)",
  "Descrição (texto rico)": "Descripción (texto enriquecido)",
  "Descrição com formatação — após salvar vira editor rico":
    "Descripción con formato — se convierte en editor enriquecido tras guardar",
  Dono: "Propietario",
  Duração: "Duración",
  "Em uso agora": "En uso ahora",
  "Enviando…": "Enviando…",
  "Erro ao iniciar a segmentação.": "Error al iniciar la segmentación.",
  "Erro ao ler chunk.": "Error al leer el fragmento.",
  "Erro ao resolver OneDrive: ": "Error al resolver OneDrive: ",
  "Erro de rede ao iniciar a segmentação.": "Error de red al iniciar la segmentación.",
  "Escolher logo": "Elegir logo",
  Espaço: "Espacio",
  "Esta URL precisa ser autorizada antes de ser baixada. Consulte o endpoint /wp-json/v-dicom/v1/authorized-url.":
    "Esta URL debe autorizarse antes de descargarla. Consulta el endpoint /wp-json/v-dicom/v1/authorized-url.",
  "Esta cena pertence a outro usuário.": "Esta escena pertenece a otro usuario.",
  "Este tipo de segmentação está desabilitado.": "Este tipo de segmentación está deshabilitado.",
  "Ex.: Ossos": "Ej.: Huesos",
  Excluir: "Eliminar",
  "Exigir autorização (1 crédito) para baixar arquivos de Google Drive/OneDrive.":
    "Requerir autorización (1 crédito) para descargar archivos de Google Drive/OneDrive.",
  "Exigir autorização de URL": "Requerir autorización de URL",
  "Expira em": "Caduca el",
  Expirado: "Caducado",
  "Falha ao consultar o arquivo no OneDrive.": "Error al consultar el archivo en OneDrive.",
  "Fim:": "Fin:",
  "Gerar chave": "Generar clave",
  "Informe ?url=": "Indica ?url=",
  "Informe o tipo de segmentação (type).": "Indica el tipo de segmentación (type).",
  "Iniciar %s? Confirme para consumir os créditos do tipo.":
    "¿Iniciar %s? Confirma para consumir los créditos del tipo.",
  "Input enviado:": "Input enviado:",
  "Início:": "Inicio:",
  "Já foi feita uma segmentação deste tipo para esta cena.":
    "Ya se ha realizado una segmentación de este tipo para esta escena.",
  "Limite (MB)": "Límite (MB)",
  "Limite 0 bloqueia novos uploads. O valor definido aqui é a cota base do usuário; planos de armazenamento ativos, quando existirem, somam-se a ele. Créditos são consumidos pela segmentação automática e pela autorização de URLs.":
    "Un límite de 0 bloquea las subidas nuevas. El valor definido aquí es la cuota base del usuario; los planes de almacenamiento activos, cuando existan, se suman a ella. Los créditos se consumen con la segmentación automática y la autorización de URL.",
  'Limite de armazenamento atingido. Exclua uma cena em "Minhas cenas" ou peça mais espaço ao administrador.':
    'Se alcanzó el límite de almacenamiento. Elimina una escena en "Mis escenas" o pide más espacio al administrador.',
  "Limites atualizados.": "Límites actualizados.",
  "Limites de armazenamento por usuário": "Límites de almacenamiento por usuario",
  Limpar: "Limpiar",
  "Link de compartilhamento": "Enlace para compartir",
  "Link não reconhecido. Use Google Drive ou OneDrive.":
    "Enlace no reconocido. Usa Google Drive o OneDrive.",
  Logo: "Logo",
  "Logs salvos no post meta da cena. DEBUG_SEGMENTATION=true também inclui debug na resposta JSON de /run e /segmentation-status.":
    "Registros guardados en el post meta de la escena. DEBUG_SEGMENTATION=true también incluye debug en la respuesta JSON de /run y /segmentation-status.",
  "Meu armazenamento": "Mi almacenamiento",
  "Meus planos de armazenamento": "Mis planes de almacenamiento",
  "Microsoft não forneceu o token Badger.": "Microsoft no proporcionó el token Badger.",
  "Nenhum arquivo recebido.": "No se recibió ningún archivo.",
  "Nenhum job de segmentação encontrado para esta cena.":
    "No se encontró ningún trabajo de segmentación para esta escena.",
  "Nenhum job de segmentação encontrado para este tipo nesta cena.":
    "No se encontró ningún trabajo de segmentación para este tipo en esta escena.",
  "Nenhum tipo configurado.": "Ningún tipo configurado.",
  "Nenhum tipo de segmentação configurado.": "Ningún tipo de segmentación configurado.",
  "Nenhum usuário com cenas ou limite definido ainda.":
    "Ningún usuario con escenas o límite definido todavía.",
  "Nenhum usuário encontrado para a busca.": "No se encontró ningún usuario para la búsqueda.",
  "Nenhuma cena encontrada para a busca.": "No se encontró ninguna escena para la búsqueda.",
  "Nenhuma cena salva ainda.": "Aún no hay ninguna escena guardada.",
  "Nome do visualizador": "Nombre del visor",
  "Nome*": "Nombre*",
  "Novo tipo ganha editor rico após salvar.":
    "El nuevo tipo obtiene un editor enriquecido tras guardar.",
  "Não foi possível criar o arquivo ZIP.": "No se pudo crear el archivo ZIP.",
  "Não foi possível criar o arquivo final.": "No se pudo crear el archivo final.",
  "Não foi possível gerar o arquivo ZIP.": "No se pudo generar el archivo ZIP.",
  "Não foi possível gravar o arquivo.": "No se pudo escribir el archivo.",
  "Não foi possível gravar o chunk.": "No se pudo escribir el fragmento.",
  "Não foi possível identificar o ID do Google Drive.":
    "No se pudo identificar el ID de Google Drive.",
  "Não foi possível obter o redeem do OneDrive.": "No se pudo obtener el redeem de OneDrive.",
  "Não foi possível obter o token do OneDrive.": "No se pudo obtener el token de OneDrive.",
  "O Google Drive não forneceu um download direto. O arquivo pode exigir login, ter o download desativado ou estar sujeito a uma confirmação que o Google não permitiu resolver automaticamente.":
    "Google Drive no proporcionó una descarga directa. Es posible que el archivo requiera inicio de sesión, tenga la descarga desactivada o esté sujeto a una confirmación que Google no pudo resolver automáticamente.",
  "O visualizador tem página própria, carregada sem o tema do site.":
    "El visor tiene su propia página, cargada sin el tema del sitio.",
  "OneDrive não retornou URL de download.": "OneDrive no devolvió una URL de descarga.",
  "OneDrive recusou o acesso ao arquivo.": "OneDrive denegó el acceso al archivo.",
  Padrão: "Predeterminado",
  "Padrão do nome do vídeo 3D": "Patrón del nombre del vídeo 3D",
  "Nome usado no download do vídeo gravado no viewport 3D. Use {data}, {hora} ou {timestamp} para inserir a data/hora. Se não usar nenhum marcador de data/hora, o carimbo será acrescentado automaticamente. Não inclua a extensão (.mp4 ou .webm).":
    "Nombre usado al descargar el vídeo grabado en el viewport 3D. Usa {data}, {hora} o {timestamp} para insertar la fecha/hora. Si no usas ningún marcador de fecha/hora, la marca se añade automáticamente. No incluyas la extensión (.mp4 o .webm).",
  "Pasta não encontrada.": "Carpeta no encontrada.",
  "Permissão negada.": "Permiso denegado.",
  "Permitir carregamento direto de DICOM": "Permitir la carga directa de DICOM",
  "Permitir que os usuários abram DICOM de arquivos/pastas do próprio computador e façam upload direto (sem precisar de link do Drive/OneDrive).":
    "Permitir que los usuarios abran DICOM desde archivos/carpetas de su propio ordenador y los suban directamente (sin necesidad de un enlace de Drive/OneDrive).",
  "Pré-visualização do logo": "Vista previa del logo",
  "Página do visualizador:": "Página del visor:",
  "Quando ativado, URLs externas precisam ser autorizadas antes do download. Ao desativar, todos os links são baixados sem autorização prévia.":
    "Cuando está activado, las URL externas deben autorizarse antes de la descarga. Al desactivarlo, todos los enlaces se descargan sin autorización previa.",
  "Quando desativado (padrão), os exames só podem ser carregados por link público do Google Drive ou do OneDrive. Quando ativado, também é possível selecionar arquivos ou uma pasta com as fatias DICOM e salvá-las na cena.":
    "Cuando está desactivado (predeterminado), los exámenes solo se pueden cargar desde un enlace público de Google Drive o OneDrive. Cuando está activado, también es posible seleccionar archivos o una carpeta con los cortes DICOM y guardarlos en la escena.",
  "Redirect inválido do OneDrive.": "Redirección de OneDrive no válida.",
  "Remover esta cena e seus arquivos?": "¿Eliminar esta escena y sus archivos?",
  "Requisição não autorizada.": "Solicitud no autorizada.",
  "Resposta do serviço:": "Respuesta del servicio:",
  "Resposta inválida do OneDrive.": "Respuesta no válida de OneDrive.",
  "Resposta inválida do serviço de segmentação.":
    "Respuesta no válida del servicio de segmentación.",
  "Salvar API key": "Guardar API key",
  "Salvar autorização de URL": "Guardar autorización de URL",
  "Salvar carregamento de DICOM": "Guardar carga de DICOM",
  "Salvar cotas para novas contas": "Guardar cuotas para cuentas nuevas",
  "Salvar limites e créditos": "Guardar límites y créditos",
  "Salvar tipos de segmentação": "Guardar tipos de segmentación",
  "Salvar visual": "Guardar visual",
  Segmentação: "Segmentación",
  "Segmentação concluída — %s": "Segmentación completada — %s",
  "Segmentação falhou — %s": "Segmentación fallida — %s",
  "Selecionar na biblioteca": "Seleccionar de la biblioteca",
  "Sessão de upload inválida ou expirada.": "Sesión de subida no válida o caducada.",
  "Seu limite de armazenamento é zero. Peça ao administrador para definir um limite antes de enviar estudos.":
    "Tu límite de almacenamiento es cero. Pide al administrador que defina un límite antes de subir estudios.",
  Situação: "Estado",
  "Somente HTTP/HTTPS é permitido.": "Solo se permite HTTP/HTTPS.",
  "Somente os usuários desta página são salvos.": "Solo se guardan los usuarios de esta página.",
  'Sua segmentação (%1$s) da cena "%2$s" foi concluída%3$s.%4$sAbra a cena: %5$s':
    'Tu segmentación (%1$s) de la escena "%2$s" se ha completado%3$s.%4$sAbre la escena: %5$s',
  'Sua segmentação da cena "%1$s" foi concluída%2$s.%3$sAbra a cena: %4$s':
    'Tu segmentación de la escena "%1$s" se ha completado%2$s.%3$sAbre la escena: %4$s',
  "Tentar novamente": "Intentar de nuevo",
  "Texto de espera": "Texto de espera",
  "Tipo de segmentação não encontrado.": "Tipo de segmentación no encontrado.",
  "Tipo migrado automaticamente da configuração anterior.":
    "Tipo migrado automáticamente desde la configuración anterior.",
  "Segmentação automática": "Segmentación automática",
  "Tipos de segmentação atualizados.": "Tipos de segmentación actualizados.",
  "Total:": "Total:",
  Título: "Título",
  "URL autorizada com sucesso! 1 crédito consumido.":
    "¡URL autorizada correctamente! 1 crédito consumido.",
  "URL autorizará com 1 crédito. Confirme para prosseguir.":
    "La URL se autorizará con 1 crédito. Confirma para continuar.",
  "URL de espera": "URL de espera",
  "URL do servidor": "URL del servidor",
  "URL inválida.": "URL no válida.",
  "Upload inválido.": "Subida no válida.",
  "Usado: %1$s de %2$s (%3$s disponíveis).": "Usado: %1$s de %2$s (%3$s disponibles).",
  Usuário: "Usuario",
  "Usuário removido": "Usuario eliminado",
  "Ver logs da segmentação": "Ver registros de segmentación",
  "v-dicom": "v-dicom",
  "Visual / White label": "Visual / White label",
  "Visual atualizado.": "Visual actualizado.",
  "Visualizador DICOM com cortes MPR, 3D e modelos STL.":
    "Visor DICOM con cortes MPR, 3D y modelos STL.",
  "Você não tem armazenamento disponível. Contrate um plano ou peça ao administrador para definir um limite antes de enviar estudos.":
    "No tienes almacenamiento disponible. Contrata un plan o pide al administrador que defina un límite antes de subir estudios.",
  "Você não tem créditos para autorizar URLs. Compre créditos na loja.":
    "No tienes créditos para autorizar URL. Compra créditos en la tienda.",
  "Você não tem permissão para salvar cenas.": "No tienes permiso para guardar escenas.",
  "Você precisa estar logado para acessar este recurso.":
    "Debes iniciar sesión para acceder a este recurso.",
  "Você precisa estar logado.": "Debes iniciar sesión.",
  de: "de",
  "error (até 4k):": "error (hasta 4k):",
  "output (até 8k):": "output (hasta 8k):",
  segmentação: "segmentación",
  "status mapeado:": "status mapeado:",
  "É necessário estar logado.": "Es necesario iniciar sesión.",
  "último polling": "último polling",
  "✓ Concluída": "✓ Completada",
  "✕ Falhou": "✕ Falló",
  "✕ Falhou — crédito devolvido": "✕ Falló — crédito devuelto",
  "Authorization (opcional)": "Authorization (opcional)",
  "Chave da cena.": "Clave de la escena.",
  "Corpo enviado na requisição de execução. Use os placeholders acima para montar o formato esperado pelo serviço.":
    "Cuerpo enviado en la petición de ejecución. Usa los placeholders de arriba para armar el formato esperado por el servicio.",
  "Endereço de execução do serviço de segmentação ausente.":
    "Falta la dirección de ejecución del servicio de segmentación.",
  "Endereço de status do serviço de segmentação ausente.":
    "Falta la dirección de estado del servicio de segmentación.",
  "Fora de aspas o placeholder vira um valor JSON (texto com aspas, número ou array). Dentro de aspas ele vira texto já escapado. Exemplo de payload:":
    "Fuera de comillas el placeholder se convierte en un valor JSON (texto entre comillas, número o array). Dentro de comillas se convierte en texto ya escapado. Ejemplo de payload:",
  "Identificador deste tipo de segmentação.": "Identificador de este tipo de segmentación.",
  "Identificador do job (disponível na URL de status e no callback).":
    "Identificador del trabajo (disponible en la URL de estado y en el callback).",
  "Lista de URLs de download da cena (array JSON).":
    "Lista de URLs de descarga de la escena (array JSON).",
  "Nome deste tipo de segmentação.": "Nombre de este tipo de segmentación.",
  "O payload da segmentação está vazio.": "El payload de la segmentación está vacío.",
  "O payload renderizado não é um JSON válido.": "El payload renderizado no es un JSON válido.",
  "O serviço de segmentação não retornou um identificador de job.":
    "El servicio de segmentación no devolvió un identificador de trabajo.",
  "O serviço de segmentação respondeu com HTTP %d.":
    "El servicio de segmentación respondió con HTTP %d.",
  "Payload (template)": "Payload (template)",
  "Payload enviado:": "Payload enviado:",
  Placeholder: "Placeholder",
  "Placeholders disponíveis": "Placeholders disponibles",
  "Se ficar vazia, o plugin usa {{url}}/run.": "Si queda vacía, el plugin usa {{url}}/run.",
  "Se ficar vazia, o plugin usa {{url}}/status/{{job_id}}.":
    "Si queda vacía, el plugin usa {{url}}/status/{{job_id}}.",
  "Timestamp Unix do envio.": "Timestamp Unix del envío.",
  "URL base do serviço": "URL base del servicio",
  "URL base do serviço.": "URL base del servicio.",
  "URL de callback para o serviço informar o status.":
    "URL de callback para que el servicio informe el estado.",
  "URL de execução (opcional)": "URL de ejecución (opcional)",
  "URL de status (opcional)": "URL de estado (opcional)",
  "URL do ZIP da cena (texto).": "URL del ZIP de la escena (texto).",
  "URL do site WordPress.": "URL del sitio WordPress.",
  "URL para o serviço enviar os modelos STL gerados.":
    "URL para que el servicio suba los modelos STL generados.",
  "Usar payload padrão": "Usar payload predeterminado",
  "Valor enviado": "Valor enviado",
  "Também aceita os apelidos {{uploadlink}}, {{downloadlink}} e {{callbacklink}}.":
    "También acepta los alias {{uploadlink}}, {{downloadlink}} y {{callbacklink}}.",
  arquivo: "archivo",
};

const BUILT_IN = { en_US: EN, es_ES: ES };

/* ------------------------------------------------------------------ *
 * PHP parsing                                                        *
 * ------------------------------------------------------------------ */

function phpFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...phpFiles(full));
    else if (/\.php$/i.test(entry.name)) out.push(full);
  }
  return out.sort();
}

function extractCall(text, openIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
    if (i - openIdx > 4000) break;
  }
  return null;
}

function splitArgs(call) {
  const inner = call.slice(call.indexOf("(") + 1, -1);
  const args = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      cur += ch;
      if (ch === "\\") {
        cur += inner[i + 1] ?? "";
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

function unquote(literal) {
  if (literal.length >= 2 && literal.startsWith("'") && literal.endsWith("'")) {
    return literal.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return null;
}

function collectEntries() {
  const entries = new Map();
  for (const file of phpFiles(pluginDir)) {
    const text = fs.readFileSync(file, "utf-8");
    const lines = text.split(/\r\n|\n|\r/);
    const rel = path.relative(pluginDir, file).split(path.sep).join("/");
    GETTEXT_FN_RE.lastIndex = 0;
    let m;
    while ((m = GETTEXT_FN_RE.exec(text))) {
      const fn = m[1];
      const openIdx = text.indexOf("(", m.index);
      const call = extractCall(text, openIdx);
      if (!call) continue;
      const args = splitArgs(call);
      if (unquote(args[args.length - 1]) !== TEXT_DOMAIN) continue;
      const msgid = unquote(args[0]);
      if (msgid === null) continue;

      let msgid2 = null;
      let msgctxt = null;
      if (fn === "_n" || fn === "_nx") msgid2 = unquote(args[1]);
      if (fn === "_x" || fn === "_nx") msgctxt = unquote(args[1]);

      const line = text.slice(0, m.index).split(/\r\n|\n|\r/).length;
      const previous = (lines[line - 2] ?? "").trim();
      const translators = /translators:/.test(previous) ? previous : "";

      const key = `${msgctxt ?? ""}\u0000${msgid}\u0000${msgid2 ?? ""}`;
      if (!entries.has(key)) {
        entries.set(key, {
          msgctxt,
          msgid,
          msgid2,
          refs: [],
          translators: "",
        });
      }
      const entry = entries.get(key);
      entry.refs.push(`${rel}:${line}`);
      if (!entry.translators && translators) entry.translators = translators;
    }
  }
  for (const entry of entries.values()) entry.refs.sort();
  return [...entries.values()].sort((a, b) => (a.msgid < b.msgid ? -1 : a.msgid > b.msgid ? 1 : 0));
}

/* ------------------------------------------------------------------ *
 * Existing .po parsing (to preserve manual translations)             *
 * ------------------------------------------------------------------ */

function decodePoString(literal) {
  const m = literal.match(/^"(.*)"$/s);
  if (!m) return "";
  return m[1]
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function readExistingPo(filePath) {
  const result = new Map();
  if (!fs.existsSync(filePath)) return result;
  const text = fs.readFileSync(filePath, "utf-8");
  let ctx = "";
  let id = "";
  let id2 = null;
  let strs = [];
  let field = null;
  let index = 0;

  const flush = () => {
    if (id === "" && ctx === "") return;
    const key = `${ctx}\u0000${id}\u0000${id2 ?? ""}`;
    result.set(key, strs.length ? strs : [""]);
    ctx = "";
    id = "";
    id2 = null;
    strs = [];
  };

  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (line === "") {
      flush();
      field = null;
      continue;
    }
    if (line.startsWith("#")) continue;
    let m;
    if ((m = line.match(/^msgctxt\s+(.*)$/s))) {
      field = "msgctxt";
      ctx = decodePoString(m[1]);
    } else if ((m = line.match(/^msgid_plural\s+(.*)$/s))) {
      field = "id2";
      id2 = decodePoString(m[1]);
    } else if ((m = line.match(/^msgid\s+(.*)$/s))) {
      field = "id";
      id = decodePoString(m[1]);
    } else if ((m = line.match(/^msgstr\[(\d+)\]\s+(.*)$/s))) {
      field = "str";
      index = Number(m[1]);
      strs[index] = decodePoString(m[2]);
    } else if ((m = line.match(/^msgstr\s+(.*)$/s))) {
      field = "str";
      index = 0;
      strs[0] = decodePoString(m[1]);
    } else if ((m = line.match(/^"(.*)"$/s))) {
      const value = decodePoString(m[1]);
      if (field === "msgctxt") ctx += value;
      else if (field === "id") id += value;
      else if (field === "id2") id2 = (id2 ?? "") + value;
      else if (field === "str") strs[index] = (strs[index] ?? "") + value;
    }
  }
  flush();
  return result;
}

/* ------------------------------------------------------------------ *
 * Writers                                                            *
 * ------------------------------------------------------------------ */

function poEscape(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function potHeader() {
  return [
    'msgid ""',
    'msgstr ""',
    '"Project-Id-Version: v-dicom\\n"',
    '"Report-Msgid-Bugs-To: \\n"',
    `"POT-Creation-Date: ${REVISION_DATE}\\n"`,
    '"MIME-Version: 1.0\\n"',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"',
    `"X-Generator: ${GENERATOR}\\n"`,
  ].join("\n");
}

function poHeader(locale) {
  return [
    'msgid ""',
    'msgstr ""',
    '"Project-Id-Version: v-dicom\\n"',
    '"Report-Msgid-Bugs-To: \\n"',
    `"POT-Creation-Date: ${REVISION_DATE}\\n"`,
    `"PO-Revision-Date: ${REVISION_DATE}\\n"`,
    '"Last-Translator: \\n"',
    '"Language-Team: \\n"',
    `"Language: ${locale}\\n"`,
    '"MIME-Version: 1.0\\n"',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"',
    '"Plural-Forms: nplurals=2; plural=(n != 1);\\n"',
    `"X-Generator: ${GENERATOR}\\n"`,
  ].join("\n");
}

function renderEntry(entry, msgstr) {
  const lines = [];
  if (entry.translators) lines.push(`#. ${entry.translators}`);
  lines.push(`#: ${entry.refs.join(" ")}`);
  if (PLACEHOLDER_RE.test(entry.msgid)) lines.push("#, php-format");

  if (entry.msgctxt) lines.push(`msgctxt "${poEscape(entry.msgctxt)}"`);
  lines.push(`msgid "${poEscape(entry.msgid)}"`);
  if (entry.msgid2 !== null) {
    lines.push(`msgid_plural "${poEscape(entry.msgid2)}"`);
    lines.push(`msgstr[0] "${poEscape(msgstr[0] ?? "")}"`);
    lines.push(`msgstr[1] "${poEscape(msgstr[1] ?? "")}"`);
  } else {
    lines.push(`msgstr "${poEscape(msgstr[0] ?? "")}"`);
  }
  return lines.join("\n");
}

function buildCatalog(entries, locale, translations) {
  const existing = readExistingPo(path.join(langDir, `v-dicom-${locale}.po`));
  const resolved = [];
  const missing = [];

  for (const entry of entries) {
    const key = `${entry.msgctxt ?? ""}\u0000${entry.msgid}\u0000${entry.msgid2 ?? ""}`;
    const previous = existing.get(key);
    const builtin = translations[entry.msgid];
    const fromBuiltin = builtin === undefined ? null : Array.isArray(builtin) ? builtin : [builtin];

    let chosen = null;
    if (previous && (previous[0] ?? "") !== "") {
      chosen = previous;
    } else if (fromBuiltin && (fromBuiltin[0] ?? "") !== "") {
      chosen = fromBuiltin;
    } else {
      chosen = [""];
      missing.push(entry.msgid);
    }
    resolved.push({ entry, msgstr: chosen });
  }

  const body = resolved.map((r) => renderEntry(r.entry, r.msgstr)).join("\n\n");
  const po = `${poHeader(locale)}\n\n${body}\n`;
  fs.writeFileSync(path.join(langDir, `v-dicom-${locale}.po`), po, "utf-8");

  const mo = compileMo(resolved);
  fs.writeFileSync(path.join(langDir, `v-dicom-${locale}.mo`), mo);

  return { resolved, missing, poSize: Buffer.byteLength(po), moSize: mo.length };
}

/* ------------------------------------------------------------------ *
 * MO compiler (GNU gettext)                                          *
 * ------------------------------------------------------------------ */

function compileMo(resolved) {
  const items = resolved
    .filter((r) => (r.msgstr[0] ?? "") !== "")
    .map((r) => {
      const original = (r.entry.msgctxt ? r.entry.msgctxt + "\u0004" : "") + r.entry.msgid;
      const withPlural = r.entry.msgid2 !== null ? `${original}\u0000${r.entry.msgid2}` : original;
      const translation = r.msgstr.join("\u0000");
      return {
        original: Buffer.from(withPlural, "utf-8"),
        translation: Buffer.from(translation, "utf-8"),
      };
    })
    .sort((a, b) => Buffer.compare(a.original, b.original));

  const count = items.length;
  const headerSize = 28;
  const originalTableOffset = headerSize;
  const translationTableOffset = headerSize + count * 8;
  let originalDataOffset = headerSize + count * 16;

  const origins = [];
  let cursor = originalDataOffset;
  for (const item of items) {
    origins.push({ length: item.original.length, offset: cursor });
    cursor += item.original.length + 1;
  }
  const translationDataOffset = cursor;

  const translations = [];
  cursor = translationDataOffset;
  for (const item of items) {
    translations.push({ length: item.translation.length, offset: cursor });
    cursor += item.translation.length + 1;
  }

  const total = cursor;
  const buffer = Buffer.alloc(total);
  buffer.writeUInt32LE(0x950412de, 0);
  buffer.writeUInt32LE(0, 4);
  buffer.writeUInt32LE(count, 8);
  buffer.writeUInt32LE(originalTableOffset, 12);
  buffer.writeUInt32LE(translationTableOffset, 16);
  buffer.writeUInt32LE(0, 20);

  let pos = originalTableOffset;
  for (const o of origins) {
    buffer.writeUInt32LE(o.length, pos);
    buffer.writeUInt32LE(o.offset, pos + 4);
    pos += 8;
  }
  pos = translationTableOffset;
  for (const t of translations) {
    buffer.writeUInt32LE(t.length, pos);
    buffer.writeUInt32LE(t.offset, pos + 4);
    pos += 8;
  }
  for (let i = 0; i < items.length; i++) {
    items[i].original.copy(buffer, origins[i].offset);
    buffer[origins[i].offset + items[i].original.length] = 0;
  }
  for (let i = 0; i < items.length; i++) {
    items[i].translation.copy(buffer, translations[i].offset);
    buffer[translations[i].offset + items[i].translation.length] = 0;
  }
  return buffer;
}

/* ------------------------------------------------------------------ *
 * Main                                                               *
 * ------------------------------------------------------------------ */

const entries = collectEntries();
if (entries.length === 0) {
  console.error("Nenhuma string traduzivel encontrada. Abortando.");
  process.exit(1);
}

fs.mkdirSync(langDir, { recursive: true });

const pot = `${potHeader()}\n\n${entries.map((entry) => renderEntry(entry, [""])).join("\n\n")}\n`;
const potPath = path.join(langDir, "v-dicom.pot");
fs.writeFileSync(potPath, pot, "utf-8");

console.log(`Strings extraidas: ${entries.length}`);

for (const locale of Object.keys(BUILT_IN)) {
  const { resolved, missing, poSize, moSize } = buildCatalog(entries, locale, BUILT_IN[locale]);
  const translated = resolved.filter((r) => (r.msgstr[0] ?? "") !== "").length;
  console.log(
    `  ${locale}: ${translated}/${entries.length} traduzidas -> .po ${poSize} B, .mo ${moSize} B`,
  );
  if (missing.length > 0) {
    console.warn(`    faltando traducao para ${missing.length} string(s):`);
    for (const id of missing) console.warn(`      - ${JSON.stringify(id)}`);
  }
}

console.log(`  pot -> ${path.relative(root, potPath)} (${Buffer.byteLength(pot)} B)`);
