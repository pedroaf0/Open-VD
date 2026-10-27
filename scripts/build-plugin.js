/**
 * Builds the WordPress plugin bundle (v-dicom.js/css) and repacks
 * the installable v-dicom.zip at the project root.
 *
 *   node scripts/build-plugin.js   (ou: npm run build:plugin)
 */
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(root, "wordpress-plugin", "v-dicom");

const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

function stripBom(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    fs.writeFileSync(filePath, buf.slice(3));
    console.log(`  removed BOM: ${path.relative(root, filePath)}`);
  }
}

/**
 * WordPress Plugin Check flags "Internal.LineEndings.Mixed". Normalise any
 * file that mixes CRLF / LF / CR to its dominant ending so the warning can
 * never reappear in the packed plugin.
 */
function normalizeLineEndings(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  const cr = (text.match(/\r(?!\n)/g) || []).length;

  const kinds = [crlf, lf, cr].filter((n) => n > 0).length;
  if (kinds <= 1) {
    return;
  }

  const dominant = crlf >= lf && crlf >= cr ? "\r\n" : lf >= cr ? "\n" : "\r";
  const normalized = text.replace(/\r\n|\r|\n/g, dominant);
  if (normalized !== text) {
    fs.writeFileSync(filePath, normalized, "utf-8");
    console.log(`  normalized line endings: ${path.relative(root, filePath)}`);
  }
}

/**
 * Guards against WordPress.WP.I18n.MissingTranslatorsComment: every gettext
 * call whose string contains a placeholder (%s, %1$d, ...) must have a
 * "translators:" comment on the line immediately above it.
 */
function findMissingTranslatorsComments() {
  const gettextRe =
    /\b(?:__|_e|_x|_n|_nx|esc_html__|esc_attr__|esc_html_e|esc_attr_e|esc_html_x|esc_attr_x)\s*\(/;
  const placeholderRe = /%[0-9]*\$?[sd]/;
  const errors = [];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.php$/i.test(entry.name)) files.push(full);
    }
  };
  walk(pluginDir);

  for (const file of files) {
    const lines = fs.readFileSync(file, "utf-8").split(/\r\n|\n|\r/);
    for (let i = 0; i < lines.length; i++) {
      const match = gettextRe.exec(lines[i]);
      if (!match) {
        continue;
      }

      let call = lines[i].slice(match.index);
      let depth = 0;
      let started = false;
      for (let j = i; j < lines.length; j++) {
        const chunk = j === i ? lines[j].slice(match.index) : lines[j];
        for (const ch of chunk) {
          if (ch === "(") {
            depth++;
            started = true;
          } else if (ch === ")") {
            depth--;
          }
        }
        call += j === i ? "" : "\n" + chunk;
        if (started && depth <= 0) break;
        if (j - i > 50) break;
      }

      if (!placeholderRe.test(call)) {
        continue;
      }

      let prev = i - 1;
      while (prev >= 0 && lines[prev].trim() === "") prev--;
      if (prev < 0 || !/translators:/.test(lines[prev])) {
        errors.push(`${path.relative(root, file)}:${i + 1}`);
      }
    }
  }
  return errors;
}

function step(msg) {
  console.log(`\n=== ${msg} ===`);
}

const pluginMain = path.join(pluginDir, "v-dicom.php");
const pluginReadme = path.join(pluginDir, "readme.txt");
const testPluginDir = "C:\\xampp\\htdocs\\wp-content\\plugins\\v-dicom";

function readPluginVersion() {
  const php = fs.readFileSync(pluginMain, "utf-8");
  const match = php.match(/V_DICOM_VERSION',\s*'(\d+\.\d+\.\d+)'/);
  if (!match || !match[1]) {
    throw new Error("Versao do plugin nao encontrada em v-dicom.php");
  }
  return match[1];
}

function nextMinorVersion(version) {
  const [major, minor] = version.split(".");
  return `${major}.${Number(minor) + 1}.0`;
}

function bumpVersion() {
  const php = fs.readFileSync(pluginMain, "utf-8");
  const match = php.match(/V_DICOM_VERSION',\s*'(\d+)\.(\d+)\.(\d+)'/);
  if (!match) {
    throw new Error("Versao do plugin nao encontrada em v-dicom.php");
  }
  const [, major, minor] = match;
  const next = `${major}.${Number(minor) + 1}.0`;

  const updated = php
    .replace(/(\*\s*Version:\s*)\d+\.\d+\.\d+/, `$1${next}`)
    .replace(/(V_DICOM_VERSION',\s*')\d+\.\d+\.\d+(')/, `$1${next}$2`);

  if (updated === php) {
    throw new Error("Falha ao atualizar a versao em v-dicom.php");
  }
  fs.writeFileSync(pluginMain, updated, "utf-8");

  // Keep readme.txt Stable tag identical to the plugin Version, otherwise
  // WordPress.org reports "stable_tag_mismatch".
  const readme = fs.readFileSync(pluginReadme, "utf-8");
  if (!/^Stable tag:\s*\d+\.\d+\.\d+/m.test(readme)) {
    throw new Error("Stable tag nao encontrada em readme.txt");
  }
  const readmeUpdated = readme.replace(/^(Stable tag:\s*)\d+\.\d+\.\d+/m, `$1${next}`);
  fs.writeFileSync(pluginReadme, readmeUpdated, "utf-8");

  console.log(`Versao do plugin atualizada: ${match[0].match(/\d+\.\d+\.\d+/)[0]} -> ${next}`);
  console.log(`Stable tag do readme.txt sincronizada: ${next}`);
  return next;
}

if (process.argv.includes("--check-i18n")) {
  const missing = findMissingTranslatorsComments();
  if (missing.length > 0) {
    console.error("Faltando comentario 'translators:':\n  " + missing.join("\n  "));
    process.exit(1);
  }
  console.log("OK: todas as chamadas gettext com placeholders tem comentario translators:");
  process.exit(0);
}

try {
  const buildVersion = nextMinorVersion(readPluginVersion());

  step("1/5 Gerando bundle do plugin (vite build)");
  console.log(`  Versao de cache-busting dos chunks: ${buildVersion}`);
  execSync("npx vite build --config .\\vite.embed.config.ts", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, V_DICOM_ASSET_VERSION: buildVersion },
  });

  if (!fs.existsSync(pluginDir)) {
    throw new Error(`Pasta do plugin nao encontrada: ${pluginDir}`);
  }

  step("2/5 Removendo BOM e normalizando line endings");
  const cleanWalk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) cleanWalk(full);
      else if (/\.(php|js|css)$/i.test(entry.name)) {
        stripBom(full);
        normalizeLineEndings(full);
      }
    }
  };
  cleanWalk(pluginDir);

  step("3/5 Incrementando versao do plugin");
  const bumpedVersion = bumpVersion();
  if (bumpedVersion !== buildVersion) {
    throw new Error(
      `Versao do build (${buildVersion}) difere da versao gravada (${bumpedVersion})`,
    );
  }

  step("4/5 Verificando comentarios translators");
  const missingTranslators = findMissingTranslatorsComments();
  if (missingTranslators.length > 0) {
    throw new Error(
      "Comentario 'translators:' ausente acima de chamadas gettext com placeholders:\n  " +
        missingTranslators.join("\n  "),
    );
  }
  console.log("  OK: todas as chamadas gettext com placeholders tem comentario translators:");

  step("5/5 Empacotando v-dicom.zip");
  const version = fs
    .readFileSync(pluginMain, "utf-8")
    .match(/V_DICOM_VERSION',\s*'(\d+\.\d+\.\d+)'/)[1];
  const outZip = path.join(root, `v-dicom-${version}.zip`);

  const { zipSync } = await import("fflate");
  const files = {};
  const collectFiles = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectFiles(full);
      else {
        const rel = path.relative(pluginDir, full).split(path.sep).join("/");
        files[`v-dicom/${rel}`] = fs.readFileSync(full);
      }
    }
  };
  collectFiles(pluginDir);
  const zipped = zipSync(files, { level: 9 });
  fs.writeFileSync(outZip, zipped);

  const sizeKb = (fs.statSync(outZip).size / 1024).toFixed(1);
  step(`5/5 Pronto: ${path.relative(root, outZip)} (${sizeKb} KB)`);

  step("6/5 Atualizando ambiente de testes");
  if (fs.existsSync(testPluginDir)) {
    fs.rmSync(testPluginDir, { recursive: true, force: true });
  }
  fs.cpSync(pluginDir, testPluginDir, { recursive: true });
  console.log(`  Plugin copiado para: ${testPluginDir}`);
} catch (err) {
  console.error("\nFalha no build do plugin:", err.message || err);
  process.exitCode = 1;
}
