<p align="center"><a href="README.md">English</a> | <a href="README.pt.md">Português</a> | <strong>Español</strong></p>

<div align="center">

# V-DICOM 

**Visor de exámenes DICOM/CBCT directamente en el navegador.**
Abra tomografías, navegue por los cortes axial, coronal y sagital, genere
reconstrucción 3D, cargue modelos STL/PLY, reoriente los planos con MPR oblicuo,
cuente con **segmentación automática con IA (procesamiento en la nube)** y comparta
el examen por **correo electrónico** o por **enlace público**.

[![Licencia](https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)
[![WordPress](https://img.shields.io/badge/WordPress-5.8%2B-21759b.svg?logo=wordpress&logoColor=white)](https://wordpress.org/)
[![PHP](https://img.shields.io/badge/PHP-7.4%2B-777bb4.svg?logo=php&logoColor=white)](https://www.php.net/)
[![Plataformas](https://img.shields.io/badge/platform-Windows%20%7C%20Android%20%7C%20iOS%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)
[![Versión](https://img.shields.io/badge/plugin-1.71.0-success.svg)](wordpress-plugin/v-dicom/v-dicom.php)

</div>

---

El v-dicom fue diseñado para **facilitar la visualización y el uso compartido de
exámenes sin necesidad de instalar programas adicionales** — basta con un
navegador. Funciona en **Windows, Android, iOS, macOS y Linux**.

Es **software libre, abierto y seguro**, disponible en dos modalidades:

| Modalidad | Cómo acceder | Indicado para |
| --- | --- | --- |
| **Servidor oficial** | <https://v-dicom.online-web.app.br/> | Uso inmediato, sin instalación |
| **Servidor propio** | Plugin v-dicom para WordPress | Control total sobre los datos |

> [!TIP]
> Al usar el servidor oficial gratuito, contribuyes a la continuidad del
> desarrollo de este software libre.

## Índice

- [Sobre el proyecto](#sobre-el-proyecto)
- [Recursos](#recursos)
- [Cómo funciona](#cómo-funciona)
- [Seguridad](#seguridad)
- [FAQ](#faq)
- [Empieza aquí](#empieza-aquí)
- [Contribuir](#contribuir)
- [Licencia](#licencia)

---

## Sobre el proyecto

El v-dicom es un visor de exámenes médicos odontológicos y radiológicos hecho
para funcionar en el navegador. Decodifica los formatos DICOM más comunes,
construye los volúmenes en tres planos, ofrece reconstrucción tridimensional y
permite compartir casos de forma segura por correo electrónico o por enlace
público.

Todo el procesamiento de imagen de la visualización ocurre en el propio
navegador, de modo que la lectura de un examen no requiere ninguna instalación. Al
compartir, los archivos pasan a residir en el servidor elegido, para que el enlace
funcione para los destinatarios.

## Recursos

- Cortes **axial, coronal y sagital** con navegación fluida.
- **Reconstrucción 3D** y visualización de modelos **STL/PLY**.
- **MPR oblicuo** para reorientar los planos (por ejemplo, a lo largo del eje del
  diente).
- **Anotaciones** sobre los cortes.
- Lectura de **carpeta DICOM** o archivo **ZIP** directamente en el navegador.
- **Uso compartido** por correo electrónico (acceso restringido) o por enlace
  público.
- **Segmentación automática con IA**, con procesamiento en la nube.
- **REST API** para integración con sistemas externos.
- Compatibilidad con **JPEG lossless, JPEG 2000 y RLE**.

---

## Cómo funciona

### Procesamiento en el navegador

Al abrir un examen, el v-dicom decodifica localmente los formatos DICOM
(incluidos JPEG lossless, JPEG 2000 y RLE) y monta los volúmenes. Es posible
arrastrar una carpeta DICOM o un archivo **ZIP** con el estudio, sin instalar
nada. Al guardar y compartir una escena, los archivos se envían al servidor para
que el enlace funcione para los destinatarios.

### Uso compartido

Al **guardar y compartir** una escena, los archivos se almacenan en
`wp-content/uploads/v-dicom/<clave>/` y se crea una escena privada. El
responsable elige el nivel de acceso:

| Nivel | Quién accede |
| --- | --- |
| **Privado** (predeterminado) | Solo el responsable (y administradores) |
| **Enlace público** | Cualquier persona que tenga el enlace |
| **Restringido** | Solo los correos autorizados |

En el acceso **restringido**, cada destinatario recibe por **correo electrónico**
un enlace privado, incluso sin tener cuenta. El enlace público tiene el formato
`https://tu-sitio.com/v-dicom/CLAVE/` y abre la escena con la misma ventana
(window/level), cortes y colores de modelo guardados. El responsable puede
cambiar el acceso de una escena en cualquier momento.

### Casos de uso

- **Profesores y ponentes:** comparte un caso por **enlace público** y permite
  que el público navegue libremente durante la clase o la ponencia.
- **Radiólogos:** envía el examen por **enlace** al solicitante, para que navegue
  por los cortes sin instalar nada.

> [!WARNING]
> Al compartir por **enlace público**, es muy recomendable **anonimizar el
> archivo del examen** antes. Utiliza el
> [DICOM Anonymizer Web](https://pedroaf0.github.io/dicom-anonymizer-web/) —
> también es abierto, seguro y funciona **sin conexión**, directamente en el
> navegador.

### Segmentación automática con IA (procesamiento en la nube)

El v-dicom admite **segmentación automática con IA**, con el **procesamiento
realizado en la nube** (mediante un servicio de nube serverless configurable). El
administrador define la URL del servidor, la cabecera de autorización opcional,
los endpoints de ejecución/estado y una plantilla de payload JSON con
placeholders. En el panel, el botón **Segmentar** envía la escena para su
procesamiento y, al finalizar, los modelos **STL** generados se muestran en el
visor. Cada segmentación consume 1 crédito del responsable de la escena,
reembolsado en caso de fallo.

### Arquitectura

- **Front-end:** React 19 + TanStack Start/Router, Vite, Tailwind CSS 4 y
  Three.js. El visor también funciona de forma standalone (fuera de WordPress).
- **Plugin de WordPress (PHP):** registra la página del visor, la REST API, el
  almacenamiento protegido en uploads (sin ejecución de PHP y sin listado de
  directorios) y la integración con la nube de segmentación.
- **Puente JS ↔ WP:** el plugin inyecta `window.V_DICOM` (base REST, nonce y
  la clave de la escena). Fuera de WordPress, la aplicación sigue funcionando como
  visor puramente local.

### API (carga/descarga por clave)

Con una API key configurada por el administrador, los sistemas externos pueden
enviar y descargar archivos sin autenticación por inicio de sesión:

- `POST /wp-json/v-dicom/v1/uploads/{id}/files?apikey=KEY` (multipart, campo
  `file`)
- `GET /wp-json/v-dicom/v1/download/{id}/zip?apikey=KEY`

Sin una clave válida, se deniega el acceso (HTTP 401).

---

## Seguridad

- La visualización y el procesamiento de imagen ocurren localmente en el
  navegador, sin necesidad de instalar programas adicionales.
- Las escenas son **privadas por defecto**; el acceso público o restringido es una
  elección explícita del responsable.
- La carpeta de almacenamiento bloquea la ejecución de PHP y el listado de
  directorios.
- WordPress recibe actualizaciones de seguridad independientes, manteniendo la
  base del sistema actualizada.
- Los enlaces compartidos deben tratarse como **datos sensibles de pacientes**, y
  los exámenes deben **anonimizarse** antes de compartirlos públicamente.

> [!IMPORTANT]
> Mantén **WordPress siempre actualizado** a la última versión. Las actualizaciones
> aportan correcciones de seguridad independientes y mantienen protegida la base
> sobre la que funciona el v-dicom frente a vulnerabilidades conocidas.

## FAQ

**¿Necesito instalar algún programa?**
No. El v-dicom funciona íntegramente en el navegador, en Windows, Android, iOS,
macOS y Linux.

**¿Dónde se almacenan los exámenes?**
En la modalidad de servidor propio, los archivos permanecen en tu servidor
WordPress, en `wp-content/uploads/v-dicom/`.

**¿Puedo usarlo gratis?**
Sí. El servidor oficial es gratuito y el software es libre bajo licencia GPL.

**¿Cómo comparto un examen con un paciente o colega?**
Guarda la escena y elige **enlace público** (cualquier persona con el enlace) o
**restringido** (solo los correos autorizados reciben el acceso por correo
electrónico).

---

## Empieza aquí

### Opción 1 — Servidor oficial (gratuito)

Accede a <https://v-dicom.online-web.app.br/>, crea tu cuenta y carga los
exámenes. Es posible guardar escenas y compartirlas por correo electrónico o por
enlace público, sin ninguna instalación.

### Opción 2 — Servidor propio

El v-dicom es un **plugin para WordPress**. Por lo tanto, el requisito previo
es disponer de un servidor con **WordPress instalado**.

Esta elección es también un factor de seguridad: WordPress es el sistema de
gestión de contenido más utilizado de internet y recibe **actualizaciones de
seguridad de forma independiente y constante**. El v-dicom se apoya así en una
base madura, ampliamente auditada y mantenida por una gran comunidad, lo que
mantiene el sistema seguro y actualizado.

#### Requisitos

- WordPress 5.8 o superior
- PHP 7.4 o superior
- Node.js y npm (para generar el build del plugin)

#### 1. Contrata un hosting (opcional, recomendado)

[Hostinger](https://www.hostinger.com/br?REFERRALCODE=NWMPEDROAJ6A) ofrece
servidores **con WordPress ya instalado**, listos para usar. Con nuestro enlace,
obtienes **20% de descuento** y además apoyas el proyecto.

> [!NOTE]
> Enlace de referencia: <https://www.hostinger.com/br?REFERRALCODE=NWMPEDROAJ6A>

#### 2. Descarga el proyecto

```sh
git clone <url-del-repositorio>
cd v-dicom
```

#### 3. Instala las dependencias

```sh
npm install
```

#### 4. Genera el build del plugin

```sh
npm run build:plugin
```

El comando compila el bundle de React (`v-dicom.js` / `v-dicom.css`),
incrementa la versión del plugin y empaqueta el instalador **`v-dicom.zip`** en
la raíz del proyecto.

> [!TIP]
> Para el desarrollo local del visor, usa `npm run dev`.

#### 5. Instala el plugin en WordPress

1. En el panel de WordPress, ve a **Plugins → Añadir nuevo → Subir plugin** y sube
   el archivo `v-dicom.zip`.
2. Activa el plugin. La página `/v-dicom/` se crea automáticamente, con
   plantilla propia, independiente del tema del sitio.
3. Si la página no se abre, ve a **Ajustes → Enlaces permanentes** y haz clic en
   **Guardar** para actualizar las reglas de reescritura.

### ¿Necesitas ayuda?

Envía un mensaje directo por Instagram:
<https://www.instagram.com/vdicom.app/>

---

## Contribuir

Las contribuciones son bienvenidas. El proyecto es abierto y puede usarse,
estudiarse, modificarse y redistribuirse libremente.

### Apoya económicamente

Compra y usa **créditos en el servidor oficial**
(<https://v-dicom.online-web.app.br/>). Cada crédito consumido (por ejemplo, en la
segmentación automática con IA) **financia directamente el desarrollo de este
proyecto**.

### Contribuye con código

Aprovecha la base del proyecto para crear nuevas posibilidades. Puedes:

- Corregir errores y mejorar el rendimiento.
- Añadir nuevas funciones al visor, al plugin de WordPress o a la API.
- Proponer mejoras de seguridad, usabilidad o documentación.

Las ideas sobre qué hacer ya están listadas en la página de **issues** del
repositorio: consulta las abiertas y **sugiere las tuyas**. Antes de empezar un
trabajo mayor, abre un issue para alinear la propuesta con la comunidad.

### Otras formas de ayudar

- Reporta problemas y sugiere mejoras en la página de issues del repositorio.
- Envía dudas o sugerencias por mensaje directo en Instagram:
  <https://www.instagram.com/vdicom.app/>

## Licencia

Distribuido bajo la licencia **GPL-2.0-or-later**. Software libre — úsalo,
estúdialo, modifícalo y compártelo.
