/**
 * Main test runner - dynamically loads and executes all test modules
 * from scripts/testes/*.js
 *
 * Uso:
 *   node scripts/test-plugin.js                    # Executa testes (sem screenshots, sem vídeo, sem logs salvos)
 *   node scripts/test-plugin.js --screenshots      # Habilita captura de screenshot em falhas
 *   node scripts/test-plugin.js --video            # Habilita gravação de vídeo da execução
 *   node scripts/test-plugin.js --logs             # Habilita salvamento de logs em arquivo
 *   node scripts/test-plugin.js --save-recording   # Salva o vídeo gravado na raiz do projeto
 *   node scripts/test-plugin.js --headless         # Executa em modo headless (sem interface gráfica)
 *   node scripts/test-plugin.js --screenshots --video --logs --save-recording  # Habilita todos
 *   npm run test:plugin                            # Executa com padrão (tudo desabilitado)
 *
 * COMPORTAMENTO PADRÃO: Todas as saídas extras (screenshots, vídeo de execução, vídeo do painel, logs)
 * estão DESABILITADAS. Use as flags acima para habilitar explicitamente cada recurso.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(__dirname, "testes");

// Parse command-line arguments
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Uso: node scripts/test-plugin.js [opções]

Opções:
  --screenshots    Habilita captura de screenshots em falhas (desabilitado por padrão)
  --video          Habilita gravação de vídeo dos testes (desabilitado por padrão)
  --logs           Habilita salvamento de logs em arquivo (desabilitado por padrão)
  --save-recording Salva o vídeo gravado pelo painel de visualização na raiz do projeto (desabilitado por padrão)
  --headless       Executa em modo headless (padrão: false - abre navegador visível)
  --only=<nome>    Executa apenas os módulos informados (separados por vírgula)
                   ex.: --only=video-recording ou --only=login,upload-comprehensive
  --help, -h       Mostra esta ajuda

Exemplos:
  node scripts/test-plugin.js                    # Execução padrão (sem screenshots, vídeo, logs)
  node scripts/test-plugin.js --screenshots      # Com screenshots em falhas
  node scripts/test-plugin.js --video --logs     # Com vídeo e logs
  node scripts/test-plugin.js --save-recording --headless  # Salva o vídeo do painel na raiz
  node scripts/test-plugin.js --headless         # Modo headless (CI/CD)
  node scripts/test-plugin.js --screenshots --video --logs --save-recording --headless  # Tudo habilitado + headless
  `);
  process.exit(0);
}

const ENABLE_SCREENSHOTS = args.includes("--screenshots");
const ENABLE_VIDEO = args.includes("--video");
const ENABLE_LOGS = args.includes("--logs");
const SAVE_RECORDING = args.includes("--save-recording");
const HEADLESS = args.includes("--headless");
const ONLY_MODULES = (() => {
  const arg = args.find((value) => value.startsWith("--only="));
  return arg
    ? arg
        .slice("--only=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
})();

const CONFIG = {
  WP_URL: "http://localhost",
  WP_USER: "adm",
  WP_PASS: "adm123",
  // Runtime flags (set via CLI args)
  ENABLE_SCREENSHOTS,
  ENABLE_VIDEO,
  ENABLE_LOGS,
  SAVE_RECORDING,
  HEADLESS,
  PROJECT_ROOT: root,
};

async function loadTestModules() {
  const files = fs
    .readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort(); // alphabetical order for predictable execution

  const modules = [];
  for (const file of files) {
    const modulePath = path.join(TESTS_DIR, file);
    const mod = await import(`file://${modulePath}`);
    if (mod.run && typeof mod.run === "function") {
      modules.push({
        name: mod.name || file.replace(".js", ""),
        description: mod.description || "Sem descrição",
        order: typeof mod.order === "number" ? mod.order : 999,
        run: mod.run,
      });
    } else {
      console.warn(`  ⚠ Módulo ${file} não exporta função run() — ignorado`);
    }
  }
  modules.sort((a, b) => a.order - b.order);
  return modules;
}

async function run() {
  console.log("\n=== Iniciando suite de testes do plugin v-dicom ===\n");
  console.log("Configuração:");
  console.log(
    `  Screenshots: ${CONFIG.ENABLE_SCREENSHOTS ? "HABILITADO (--screenshots)" : "DESABILITADO (padrão)"}`,
  );
  console.log(
    `  Vídeo:       ${CONFIG.ENABLE_VIDEO ? "HABILITADO (--video)" : "DESABILITADO (padrão)"}`,
  );
  console.log(
    `  Logs:        ${CONFIG.ENABLE_LOGS ? "HABILITADO (--logs)" : "DESABILITADO (padrão)"}`,
  );
  console.log(
    `  Vídeo painel:${CONFIG.SAVE_RECORDING ? " SALVO NA RAIZ (--save-recording)" : " DESCARTADO (padrão)"}`,
  );
  console.log("");

  const allModules = await loadTestModules();
  const testModules = ONLY_MODULES.length
    ? allModules.filter((module) => ONLY_MODULES.includes(module.name))
    : allModules;

  if (testModules.length === 0) {
    console.log(
      ONLY_MODULES.length
        ? `Módulo(s) de teste não encontrado(s): ${ONLY_MODULES.join(", ")}`
        : "Nenhum módulo de teste encontrado em scripts/testes/",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Módulos carregados (ordem de execução):`);
  testModules.forEach((m, i) =>
    console.log(`  ${i + 1}. ${m.name} (order: ${m.order}) — ${m.description}`),
  );
  console.log("");

  const browser = await chromium.launch({
    headless: CONFIG.HEADLESS,
    slowMo: CONFIG.HEADLESS ? 0 : 200,
  });

  // Setup video recording if enabled - use single context for tests
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ...(CONFIG.ENABLE_VIDEO && {
      recordVideo: {
        dir: path.join(root, "test-results", "videos"),
        size: { width: 1920, height: 1080 },
      },
    }),
  });
  const page = await context.newPage();

  // Log collection if enabled
  const collectedLogs = [];
  if (CONFIG.ENABLE_LOGS) {
    page.on("console", (msg) => {
      const entry = `[${msg.type().toUpperCase()}] ${msg.text()}`;
      collectedLogs.push(entry);
      if (msg.type() === "error") {
        console.log(`  [CONSOLE ERROR] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      const entry = `[PAGE ERROR] ${err.message}`;
      collectedLogs.push(entry);
      console.log(`  [PAGE ERROR] ${err.message}`);
    });
  } else {
    // Default: only show errors in console
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`  [CONSOLE ERROR] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      console.log(`  [PAGE ERROR] ${err.message}`);
    });
  }

  let passed = 0;
  let failed = 0;

  for (const mod of testModules) {
    console.log(`▶ ${mod.name} — ${mod.description}`);
    const startTime = Date.now();
    try {
      await mod.run(page, CONFIG);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ✓ Passou (${duration}s)`);
      passed++;
    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`  ✗ Falhou (${duration}s): ${err.message}`);
      // Take screenshot on failure if enabled
      if (CONFIG.ENABLE_SCREENSHOTS) {
        const screenshotDir = path.join(root, "test-results");
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page
          .screenshot({ path: path.join(screenshotDir, `failed-${mod.name}.png`), fullPage: true })
          .catch(() => {});
      }
      failed++;
    }
    console.log("");
  }

  // Save logs to file if enabled
  if (CONFIG.ENABLE_LOGS && collectedLogs.length > 0) {
    const logDir = path.join(root, "test-results", "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, `test-run-${Date.now()}.log`);
    fs.writeFileSync(logFile, collectedLogs.join("\n"), "utf-8");
    console.log(`Logs salvos em: ${logFile}`);
  }

  await context.close();
  await browser.close();

  console.log("=== Resumo ===");
  console.log(`  ✓ Passaram: ${passed}`);
  console.log(`  ✗ Falharam: ${failed}`);
  console.log(`  Total: ${passed + failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run();
