<p align="center"><strong>English</strong> | <a href="README.pt.md">Português</a> | <a href="README.es.md">Español</a></p>

<div align="center">

# V-DICOM 

**View DICOM/CBCT scans right in your browser.**
Open CT scans, navigate through the axial, coronal, and sagittal slices, generate
3D reconstructions, load STL/PLY models, reorient the planes with oblique MPR,
take advantage of **automatic AI segmentation (cloud processing)**, and share the
scan by **email** or by **public link**.

[![License](https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)
[![WordPress](https://img.shields.io/badge/WordPress-5.8%2B-21759b.svg?logo=wordpress&logoColor=white)](https://wordpress.org/)
[![PHP](https://img.shields.io/badge/PHP-7.4%2B-777bb4.svg?logo=php&logoColor=white)](https://www.php.net/)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20Android%20%7C%20iOS%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)
[![Version](https://img.shields.io/badge/plugin-1.71.0-success.svg)](wordpress-plugin/v-dicom/v-dicom.php)

</div>

---

v-dicom was designed to **make it easy to view and share scans without
installing additional programs** — all you need is a browser. It works on
**Windows, Android, iOS, macOS, and Linux**.

It is **free, open, and secure software**, available in two modes:

| Mode | How to access | Best for |
| --- | --- | --- |
| **Official server** | <https://v-dicom.online-web.app.br/> | Immediate use, no installation |
| **Your own server** | v-dicom plugin for WordPress | Full control over the data |

> [!TIP]
> By using the free official server, you help sustain the development of this
> free software.

## Table of contents

- [About the project](#about-the-project)
- [Features](#features)
- [How it works](#how-it-works)
- [Security](#security)
- [FAQ](#faq)
- [Start here](#start-here)
- [Contributing](#contributing)
- [License](#license)

---

## About the project

v-dicom is a viewer for dental and radiological medical scans built to run in
the browser. It decodes the most common DICOM formats, builds the volumes across
three planes, offers three-dimensional reconstruction, and enables the secure
sharing of cases by email or by public link.

All image processing for viewing happens in the browser itself, so reading a scan
requires no installation. When sharing, the files then reside on the chosen
server, so that the link works for the recipients.

## Features

- **Axial, coronal, and sagittal** slices with smooth navigation.
- **3D reconstruction** and viewing of **STL/PLY** models.
- **Oblique MPR** to reorient the planes (for example, along the tooth axis).
- **Annotations** on the slices.
- Reading a **DICOM folder** or **ZIP** file directly in the browser.
- **Sharing** by email (restricted access) or by public link.
- **Automatic AI segmentation**, with cloud processing.
- **REST API** for integration with external systems.
- Support for **JPEG lossless, JPEG 2000, and RLE**.

---

## How it works

### In-browser processing

When you open a scan, v-dicom locally decodes the DICOM formats (including
JPEG lossless, JPEG 2000, and RLE) and builds the volumes. You can drag a DICOM
folder or a **ZIP** file containing the study, without installing anything. When
you save and share a scene, the files are sent to the server so that the link
works for the recipients.

### Sharing

When you **save and share** a scene, the files are stored in
`wp-content/uploads/v-dicom/<key>/` and a private scene is created. The owner
chooses the access level:

| Level | Who has access |
| --- | --- |
| **Private** (default) | Only the owner (and administrators) |
| **Public link** | Anyone who has the link |
| **Restricted** | Only the authorized emails |

For **restricted** access, each recipient receives a private link by **email**,
even without having an account. The public link has the format
`https://your-site.com/v-dicom/KEY/` and opens the scene with the same saved
window (window/level), slices, and model colors. The owner can change a scene's
access at any time.

### Use cases

- **Teachers and speakers:** share a case by **public link** and let the audience
  navigate freely during the class or the talk.
- **Radiologists:** send the scan by **link** to the requester, so they can
  navigate the slices without installing anything.

> [!WARNING]
> When sharing by **public link**, it is highly recommended to **anonymize the
> scan file** first. Use the
> [DICOM Anonymizer Web](https://pedroaf0.github.io/dicom-anonymizer-web/) — it is
> also open, secure, and works **offline**, right in the browser.

### Automatic AI segmentation (cloud processing)

v-dicom supports **automatic AI segmentation**, with **processing performed in
the cloud** (via a configurable serverless cloud service). The administrator sets
the server URL, optional authorization header, run/status endpoints, and a custom
JSON payload template with placeholders. In the panel, the **Segment** button sends
the scene for processing and, when it finishes, the generated **STL** models are
displayed in the viewer. Each segmentation consumes 1 credit from the scene owner,
refunded in case of failure.

### Architecture

- **Front-end:** React 19 + TanStack Start/Router, Vite, Tailwind CSS 4, and
  Three.js. The viewer also runs standalone (outside WordPress).
- **WordPress plugin (PHP):** registers the viewer page, the REST API, protected
  storage in uploads (no PHP execution and no directory listing), and integration
  with the segmentation cloud.
- **JS ↔ WP bridge:** the plugin injects `window.V_DICOM` (REST base, nonce,
  and the scene key). Outside WordPress, the application keeps working as a
  purely local viewer.

### API (upload/download by key)

With an API key configured by the administrator, external systems can upload and
download files without login authentication:

- `POST /wp-json/v-dicom/v1/uploads/{id}/files?apikey=KEY` (multipart, field
  `file`)
- `GET /wp-json/v-dicom/v1/download/{id}/zip?apikey=KEY`

Without a valid key, access is denied (HTTP 401).

---

## Security

- Viewing and image processing happen locally in the browser, with no need to
  install additional programs.
- Scenes are **private by default**; public or restricted access is an explicit
  choice by the owner.
- The storage folder blocks PHP execution and directory listing.
- WordPress receives independent security updates, keeping the system's
  foundation up to date.
- Shared links should be treated as **sensitive patient data**, and scans should
  be **anonymized** before public sharing.

> [!IMPORTANT]
> Keep **WordPress always updated** to the latest version. Updates bring
> independent security fixes and keep the foundation on which v-dicom runs
> protected against known vulnerabilities.

## FAQ

**Do I need to install any program?**
No. v-dicom runs entirely in the browser, on Windows, Android, iOS, macOS, and
Linux.

**Where are the scans stored?**
In the own-server mode, the files remain on your WordPress server, in
`wp-content/uploads/v-dicom/`.

**Can I use it for free?**
Yes. The official server is free, and the software is free under the GPL license.

**How do I share a scan with a patient or colleague?**
Save the scene and choose **public link** (anyone with the link) or **restricted**
(only authorized emails receive access by email).

---

## Start here

### Option 1 — Official server (free)

Go to <https://v-dicom.online-web.app.br/>, create your account, and upload the
scans. You can save scenes and share them by email or by public link, with no
installation.

### Option 2 — Your own server

v-dicom is a **WordPress plugin**. Therefore, the prerequisite is having a
server with **WordPress installed**.

This choice is also a security factor: WordPress is the most widely used content
management system on the internet and receives **security updates independently
and constantly**. v-dicom thus relies on a mature, widely audited foundation
maintained by a large community, which keeps the system secure and current.

#### Requirements

- WordPress 5.8 or higher
- PHP 7.4 or higher
- Node.js and npm (to build the plugin)

#### 1. Get hosting (optional, recommended)

[Hostinger](https://www.hostinger.com/br?REFERRALCODE=NWMPEDROAJ6A) offers servers
**with WordPress already installed**, ready to use. Through our link, you get
**20% off** and also support the project.

> [!NOTE]
> Referral link: <https://www.hostinger.com/br?REFERRALCODE=NWMPEDROAJ6A>

#### 2. Download the project

```sh
git clone <repository-url>
cd v-dicom
```

#### 3. Install the dependencies

```sh
npm install
```

#### 4. Build the plugin

```sh
npm run build:plugin
```

The command compiles the React bundle (`v-dicom.js` / `v-dicom.css`), bumps
the plugin version, and packages the installer **`v-dicom.zip`** in the project
root.

> [!TIP]
> For local viewer development, use `npm run dev`.

#### 5. Install the plugin in WordPress

1. In the WordPress dashboard, go to **Plugins → Add New → Upload Plugin** and
   upload the `v-dicom.zip` file.
2. Activate the plugin. The `/v-dicom/` page is created automatically, with its
   own template, independent of the site theme.
3. If the page does not open, go to **Settings → Permalinks** and click **Save**
   to refresh the rewrite rules.

### Need help?

Send a direct message on Instagram:
<https://www.instagram.com/vdicom.app/>

---

## Contributing

Contributions are welcome. The project is open and can be freely used, studied,
modified, and redistributed.

### Support financially

Buy and use **credits on the official server**
(<https://v-dicom.online-web.app.br/>). Each credit consumed (for example, in
automatic AI segmentation) **directly funds the development of this project**.

### Contribute code

Build on the project's foundation to create new possibilities. You can:

- Fix bugs and improve performance.
- Add new features to the viewer, the WordPress plugin, or the API.
- Propose improvements to security, usability, or documentation.

Ideas for what to do are already listed on the repository's **issues** page —
check the open ones and **suggest your own**. Before starting a larger piece of
work, open an issue to align the proposal with the community.

### Other ways to help

- Report problems and suggest improvements through the repository's issues page.
- Send questions or suggestions by direct message on Instagram:
  <https://www.instagram.com/vdicom.app/>

## License

Distributed under the **GPL-2.0-or-later** license. Free software — use, study,
modify, and share.
