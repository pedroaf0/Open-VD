# Migração dos tipos de segmentação

Este snippet faz backup da configuração atual e converte os tipos antigos
(`max_voxels` / `max_triangles`) para o novo formato com `payload` em template.

O arquivo é separado do plugin de propósito: rode uma vez após atualizar o
plugin e guarde o backup gerado.

## Arquivos

- `scripts/migrate-segmentation-payload.php` — snippet PHP.
- Backups gerados em `wp-content/v-dicom-segmentation-backups/` (protegido por
  `.htaccess` e `index.php`). Em servidores Nginx, restrinja esse diretório
  manualmente. O backup contém o header `Authorization`, então guarde-o em local
  seguro e apague-o quando não precisar mais.
- `output=<caminho>` grava o backup em outro local.
- `restore=<arquivo>` restaura as opções a partir de um backup.

## Uso com WP-CLI

No diretório onde está o `wp-cli.phar` (no XAMPP local, `C:\xampp\htdocs`):

```powershell
# Só mostra o que será feito (o backup ainda é gravado)
php wp-cli.phar eval-file C:\caminho\para\Open-VD\scripts\migrate-segmentation-payload.php dry-run

# Aplica a migração
php wp-cli.phar eval-file C:\caminho\para\Open-VD\scripts\migrate-segmentation-payload.php

# Backup em um caminho específico
php wp-cli.phar eval-file C:\caminho\para\Open-VD\scripts\migrate-segmentation-payload.php output=C:\backups\segmentacao.json

# Restaurar um backup
php wp-cli.phar eval-file C:\caminho\para\Open-VD\scripts\migrate-segmentation-payload.php restore=C:\xampp\htdocs\wp-content\v-dicom-segmentation-backups\segmentation-backup-20261022-120000.json
```

## O que a migração altera

Para cada tipo:

- `payload` vazio recebe o template padrão com os placeholders
  `{{download_urls}}`, `{{upload_url}}` e `{{callback_url}}`.
- Se o antigo tipo tinha `max_voxels` / `max_triangles`, esses valores entram
  no payload gerado como `max-voxels` e `max-triangles`.
- `run_url` recebe a URL antiga com `/run` no final e `status_url` recebe
  `url/status/{{job_id}}`, preservando o comportamento antigo.
- Os campos `max_voxels` e `max_triangles` são removidos.
- Ao final, a opção legada `v_dicom_runpod` é removida (o backup guarda uma
  cópia).

## Depois da migração

Abra **V-DICOM → Segmentação** no admin e revise cada tipo. A partir daí o
payload é livre: use qualquer JSON e os placeholders disponíveis na própria
tela. Fora de aspas o placeholder vira um valor JSON; dentro de aspas vira
texto escapado.
