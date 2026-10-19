=== v-dicom ===
Contributors: v-dicom
Tags: dicom, cbct, stl, viewer, radiology
Requires at least: 5.8
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.79.0
License: GPLv2 or later

View DICOM/CBCT studies in the browser: axial, coronal and sagittal slices, 3D reconstruction and STL/PLY models, with study upload and link sharing.

== Installation ==

1. In the WordPress dashboard go to Plugins > Add New > Upload Plugin and upload the v-dicom.zip file.
2. Activate the plugin. The /v-dicom/ page is created automatically with its own template, without the site theme.
3. If the page does not open, go to Settings > Permalinks and click Save to refresh the rewrite rules.

== Usage ==

* Open the viewer page and use "Open DICOM folder" or "Open DICOM / ZIP". All image processing happens in the browser.
* Users with upload permission (author or higher) see the "Save and share" button: files are uploaded to wp-content/uploads/v-dicom/<key>/ and the scene link is generated.
* The link has the form https://your-site.com/v-dicom/KEY/ and opens the scene with the same windowing, slices and model colors.
* Under v-dicom (dashboard menu) you can list, open and delete saved scenes.

== API key (upload/download by key) ==

The administrator can set an API key on the plugin screen ("API key" field). With it, external systems can send files to a folder and download it as a ZIP without logging in:

* Upload a file to folder {id}:
  POST /wp-json/v-dicom/v1/uploads/{id}/files?apikey=KEY
  (multipart, field "file")

* Download folder {id} as a ZIP:
  GET /wp-json/v-dicom/v1/download/{id}/zip?apikey=KEY

Without a valid key the access is denied (HTTP 401). Leaving the field empty disables key access.

== Automatic segmentation ==

The administrator configures it in v-dicom > "Automatic segmentation (RunPod)":

* Segmentation server URL (e.g. https://api.runpod.ai/v2/ENDPOINT_ID)
* Authorization Header (e.g. Bearer rpa_xxxxxxxxx)
* Maximum voxels (max-voxels)
* Maximum triangles (max-triangles)

Flow per scene ("Segment" button in the dashboard):

1. Backend validations: a scene can be segmented only once and the owner must have at least 1 credit.
2. The operation consumes 1 credit from the scene owner. If RunPod fails, the credit is refunded.
3. WordPress sends POST {url}/run with an input containing:
   - "download-url": /wp-json/v-dicom/v1/download/{key}/zip?apikey=KEY
   - "upload-url":   /wp-json/v-dicom/v1/uploads/{key}/files?apikey=KEY
   - "max-voxels" and "max-triangles": values configured by the admin.
4. The returned job_id is saved and the status can be queried at
   GET /wp-json/v-dicom/v1/scenes/{key}/segmentation-status
5. When the status becomes COMPLETED the STL files sent by RunPod are already in the scene folder; the page is reloaded to display them.
6. On FAILED the user is notified and receives the credit back.

== Processing credits ==

Each user has a credit balance (default 0), set by the administrator in the "Storage limits per user" table. The balance appears in the "My storage" section. Currently only automatic segmentation consumes credits (1 per scene).

== Viewer page ==

/v-dicom/          default viewer
/v-dicom/KEY/      opens a specific scene

== Security notes ==

* Any logged-in user (including subscribers) can upload studies, as long as they are within the storage limit defined by the administrator (0 = blocked).
* The storage folder blocks PHP execution and directory listing.
* Anyone with the scene link can view it: treat links as sensitive patient data.
