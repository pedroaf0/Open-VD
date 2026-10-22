<p align="center"><a href="README.md">English</a> | <strong>Português</strong> | <a href="README.es.md">Español</a></p>

<div align="center">

# V-DICOM 

**Visualizador de exames DICOM/CBCT direto no navegador.**
Abra tomografias, navegue pelos cortes axial, coronal e sagital, gere
reconstrução 3D, carregue modelos STL/PLY, reoriente os planos com MPR oblíquo,
conte com **segmentação automática com IA (processamento na nuvem)** e compartilhe
o exame por **e-mail** ou por **link público**.

[![Licença](https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)
[![WordPress](https://img.shields.io/badge/WordPress-5.8%2B-21759b.svg?logo=wordpress&logoColor=white)](https://wordpress.org/)
[![PHP](https://img.shields.io/badge/PHP-7.4%2B-777bb4.svg?logo=php&logoColor=white)](https://www.php.net/)
[![Plataformas](https://img.shields.io/badge/platform-Windows%20%7C%20Android%20%7C%20iOS%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)
[![Versão](https://img.shields.io/badge/plugin-1.71.0-success.svg)](wordpress-plugin/v-dicom/v-dicom.php)

</div>

---

O v-dicom foi projetado para **facilitar a visualização e o compartilhamento de
exames sem a necessidade de instalar programas adicionais** — basta um navegador.
Funciona em **Windows, Android, iOS, macOS e Linux**.

É **software livre, aberto e seguro**, disponível em duas modalidades:

| Modalidade | Como acessar | Indicado para |
| --- | --- | --- |
| **Servidor oficial** | <https://v-dicom.online-web.app.br/> | Uso imediato, sem instalação |
| **Servidor próprio** | Plugin v-dicom para WordPress | Controle total sobre os dados |

> [!TIP]
> Ao usar o servidor oficial gratuito, você contribui para a continuidade do
> desenvolvimento deste software livre.

## Índice

- [Sobre o projeto](#sobre-o-projeto)
- [Recursos](#recursos)
- [Como funciona](#como-funciona)
- [Segurança](#segurança)
- [FAQ](#faq)
- [Comece aqui](#começe-aqui)
- [Contribuindo](#contribuindo)
- [Licença](#licença)

---

## Sobre o projeto

O v-dicom é um visualizador de exames médicos odontológicos e radiológicos
feito para rodar no navegador. Ele decodifica os formatos DICOM mais comuns,
constrói os volumes em três planos, oferece reconstrução tridimensional e permite
o compartilhamento seguro de casos por e-mail ou por link público.

Todo o processamento de imagem da visualização ocorre no próprio navegador, de
modo que a leitura de um exame dispensa qualquer instalação. No compartilhamento,
os arquivos passam a residir no servidor escolhido, para que o link funcione para
os destinatários.

## Recursos

- Cortes **axial, coronal e sagital** com navegação fluida.
- **Reconstrução 3D** e visualização de modelos **STL/PLY**.
- **MPR oblíquo** para reorientar os planos (por exemplo, ao longo eixo do dente).
- **Anotações** sobre os cortes.
- Leitura de **pasta DICOM** ou arquivo **ZIP** diretamente no navegador.
- **Compartilhamento** por e-mail (acesso restrito) ou por link público.
- **Segmentação automática com IA**, com processamento na nuvem.
- **REST API** para integração com sistemas externos.
- Suporte a **JPEG lossless, JPEG 2000 e RLE**.

---

## Como funciona

### Processamento no navegador

Ao abrir um exame, o v-dicom decodifica localmente os formatos DICOM
(inclusive JPEG lossless, JPEG 2000 e RLE) e monta os volumes. É possível
arrastar uma pasta DICOM ou um arquivo **ZIP** com o estudo, sem instalar nada.
Ao salvar e compartilhar uma cena, os arquivos são enviados ao servidor para que
o link funcione para os destinatários.

### Compartilhamento

Ao **salvar e compartilhar** uma cena, os arquivos são armazenados em
`wp-content/uploads/v-dicom/<chave>/` e uma cena privada é criada. O
responsável escolhe o nível de acesso:

| Nível | Quem acessa |
| --- | --- |
| **Privado** (padrão) | Somente o responsável (e administradores) |
| **Link público** | Qualquer pessoa que possua o link |
| **Restrito** | Apenas os e-mails autorizados |

No acesso **restrito**, cada destinatário recebe por **e-mail** um link privado,
mesmo sem possuir conta. O link público tem o formato
`https://seu-site.com/v-dicom/CHAVE/` e abre a cena com a mesma janela
(window/level), cortes e cores de modelo salvas. O responsável pode alterar o
acesso de uma cena a qualquer momento.

### Casos de uso

- **Professores e palestrantes:** compartilhe um caso por **link público** e
  permita que a plateia navegue livremente durante a aula ou a palestra.
- **Radiologistas:** envie o exame por **link** ao solicitante, para que ele
  navegue pelos cortes sem instalar nada.

> [!WARNING]
> Ao compartilhar por **link público**, é altamente recomendável **anonimizar o
> arquivo do exame** antes. Utilize o
> [DICOM Anonymizer Web](https://pedroaf0.github.io/dicom-anonymizer-web/) — também
> é aberto, seguro e funciona **offline**, direto no navegador.

### Segmentação automática com IA (processamento na nuvem)

O v-dicom oferece suporte a **segmentação automática com IA**, com o
**processamento realizado na nuvem** (via serviço de nuvem serverless
configurável). O administrador define a URL do servidor, o cabeçalho de
autorização opcional, os endpoints de execução/status e um template de payload
JSON com placeholders. No painel, o botão **Segmentar** envia a cena para
processamento e, ao concluir, os modelos **STL** gerados passam a ser exibidos no
visualizador. Cada segmentação consome 1 crédito do responsável pela cena,
devolvido em caso de falha.

### Arquitetura

- **Front-end:** React 19 + TanStack Start/Router, Vite, Tailwind CSS 4 e
  Three.js. O visualizador também roda de forma standalone (fora do WordPress).
- **Plugin WordPress (PHP):** registra a página do visualizador, a REST API, o
  armazenamento protegido em uploads (sem execução de PHP e sem listagem de
  diretório) e a integração com a nuvem de segmentação.
- **Ponte JS ↔ WP:** o plugin injeta `window.V_DICOM` (base REST, nonce e a
  chave da cena). Fora do WordPress, a aplicação segue funcionando como
  visualizador puramente local.

### API (upload/download por chave)

Com uma API key configurada pelo administrador, sistemas externos podem enviar e
baixar arquivos sem autenticação por login:

- `POST /wp-json/v-dicom/v1/uploads/{id}/files?apikey=KEY` (multipart, campo
  `file`)
- `GET /wp-json/v-dicom/v1/download/{id}/zip?apikey=KEY`

Sem chave válida, o acesso é negado (HTTP 401).

---

## Segurança

- A visualização e o processamento de imagem ocorrem localmente no navegador,
  sem a necessidade de instalar programas adicionais.
- As cenas são **privadas por padrão**; o acesso público ou restrito é uma escolha
  explícita do responsável.
- A pasta de armazenamento bloqueia a execução de PHP e a listagem de diretórios.
- O WordPress recebe atualizações de segurança independentes, mantendo a base do
  sistema atualizada.
- Links compartilhados devem ser tratados como **dados sensíveis de paciente**, e
  os exames devem ser **anonimizados** antes de compartilhamentos públicos.

> [!IMPORTANT]
> Mantenha o **WordPress sempre atualizado** para a versão mais recente. As
> atualizações trazem correções de segurança independentes e mantêm a base sobre a
> qual o v-dicom roda protegida contra vulnerabilidades conhecidas.

## FAQ

**Preciso instalar algum programa?**
Não. O v-dicom funciona inteiramente no navegador, em Windows, Android, iOS,
macOS e Linux.

**Onde ficam armazenados os exames?**
Na modalidade de servidor próprio, os arquivos permanecem no seu servidor
WordPress, em `wp-content/uploads/v-dicom/`.

**Posso usar gratuitamente?**
Sim. O servidor oficial é gratuito, e o software é livre sob licença GPL.

**Como compartilho um exame com um paciente ou colega?**
Salve a cena e escolha **link público** (qualquer pessoa com o link) ou
**restrito** (somente e-mails autorizados recebem o acesso por e-mail).

---

## Comece aqui

### Opção 1 — Servidor oficial (gratuito)

Acesse <https://v-dicom.online-web.app.br/>, crie sua conta e carregue os exames.
É possível salvar cenas e compartilhá-las por e-mail ou por link público, sem
qualquer instalação.

### Opção 2 — Servidor próprio

O v-dicom é um **plugin para WordPress**. Portanto, o pré-requisito é dispor de
um servidor com o **WordPress instalado**.

Essa escolha é também um fator de segurança: o WordPress é o sistema de
gerenciamento de conteúdo mais utilizado da internet e recebe **atualizações de
segurança de forma independente e constante**. O v-dicom, assim, apoia-se em
uma base madura, amplamente auditada e mantida por uma grande comunidade, o que
mantém o sistema seguro e atualizado.

#### Requisitos

- WordPress 5.8 ou superior
- PHP 7.4 ou superior
- Node.js e npm (para gerar o build do plugin)

#### 1. Contrate uma hospedagem (opcional, recomendado)

A [Hostinger](https://www.hostinger.com/br?REFERRALCODE=NWMPEDROAJ6A) oferece
servidores **com o WordPress já instalado**, prontos para uso. Por meio do nosso
link, você obtém **20% de desconto** e ainda apoia o projeto.

> [!NOTE]
> Link de indicação: <https://www.hostinger.com/br?REFERRALCODE=NWMPEDROAJ6A>

#### 2. Baixe o projeto

```sh
git clone <url-do-repositorio>
cd v-dicom
```

#### 3. Instale as dependências

```sh
npm install
```

#### 4. Gere o build do plugin

```sh
npm run build:plugin
```

O comando compila o bundle React (`v-dicom.js` / `v-dicom.css`), incrementa
a versão do plugin e empacota o instalador **`v-dicom.zip`** na raiz do
projeto.

> [!TIP]
> Para desenvolvimento local do visualizador, use `npm run dev`.

#### 5. Instale o plugin no WordPress

1. No painel do WordPress, acesse **Plugins → Adicionar novo → Enviar plugin** e
   envie o arquivo `v-dicom.zip`.
2. Ative o plugin. A página `/v-dicom/` é criada automaticamente, com template
   próprio, independente do tema do site.
3. Caso a página não abra, acesse **Configurações → Links permanentes** e clique
   em **Salvar** para atualizar as regras de reescrita.

### Precisa de ajuda?

Envie uma mensagem direta pelo Instagram:
<https://www.instagram.com/vdicom.app/>

---

## Contribuindo

Contribuições são bem-vindas. O projeto é aberto e pode ser usado, estudado,
modificado e redistribuído livremente.

### Apoie financeiramente

Compre e use **créditos no servidor oficial** (<https://v-dicom.online-web.app.br/>).
Cada crédito consumido (por exemplo, na segmentação automática com IA) **financia
diretamente o desenvolvimento deste projeto**.

### Contribua com código

Aproveite a base do projeto para criar novas possibilidades. Você pode:

- Corrigir bugs e melhorar o desempenho.
- Adicionar recursos novos ao visualizador, ao plugin WordPress ou à API.
- Propor melhorias de segurança, usabilidade ou documentação.

Ideias do que fazer já estão listadas na página de **issues** do repositório —
confira as abertas e **sugira as suas**. Antes de começar um trabalho maior,
abra uma issue para alinhar a proposta com a comunidade.

### Outras formas de ajudar

- Relate problemas e sugira melhorias pela página de issues do repositório.
- Envie dúvidas ou sugestões por mensagem direta no Instagram:
  <https://www.instagram.com/vdicom.app/>

## Licença

Distribuído sob a licença **GPL-2.0-or-later**. Software livre — use, estude,
modifique e compartilhe.
