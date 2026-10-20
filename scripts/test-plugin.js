/**
 * Main test runner - dynamically loads and executes all test modules
 * from scripts/testes/*.js
 *
 *   node scripts/test-plugin.js
 *   npm run test:plugin
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(__dirname, "testes");

const CONFIG = {
  WP_URL: "http://localhost",
  WP_USER: "adm",
  WP_PASS: "adm123",
};

async function loadTestModules() {
  const files = fs.readdirSync(TESTS_DIR)
    .filter(f => f.endsWith(".js"))
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

  const testModules = await loadTestModules();

  if (testModules.length === 0) {
    console.log("Nenhum módulo de teste encontrado em scripts/testes/");
    return;
  }

  console.log(`Módulos carregados (ordem de execução):`);
  testModules.forEach((m, i) => console.log(`  ${i+1}. ${m.name} (order: ${m.order}) — ${m.description}`));
  console.log("");

  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: "test-results/videos/", size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();

  // Capture console logs and errors
  page.on("console", msg => {
    if (msg.type() === "error") {
      console.log(`  [CONSOLE ERROR] ${msg.text()}`);
    }
  });
  page.on("pageerror", err => {
    console.log(`  [PAGE ERROR] ${err.message}`);
  });

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
      // Take screenshot on failure
      await page.screenshot({ path: `test-results/failed-${mod.name}.png`, fullPage: true }).catch(() => {});
      failed++;
    }
    console.log("");
  }

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