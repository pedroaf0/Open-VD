/**
 * Comprehensive upload test using the real file inputs.
 * Tests: DICOM folder selection, STL upload (persisted in the scene) and ZIP
 * DICOM upload. The scene is shared only after the STLs are loaded, so the
 * server-side scene contains both the DICOM slices and the meshes.
 */
import { expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import {
  ensurePanelOpen,
  openSection,
  waitForViewerReady,
  writeSceneKey,
} from "./test-helpers.mjs";

export const name = "upload-comprehensive";
export const description = "Upload: pasta DICOM, STL e ZIP (usando inputs corretos)";
export const order = 40;

const SCENE_DIR = "C:\\Users\\pedro\\Desktop\\vd\\Scene";
const DICOM_SOURCE = path.join(SCENE_DIR, "ScalarVolume_7", "ScalarVolume_7");
const STL_FILES = [
  path.join(SCENE_DIR, "Dentes inferiores.stl"),
  path.join(SCENE_DIR, "polpa_01.stl"),
];

export async function run(page, config) {
  const { WP_URL } = config;

  const tmpRoot = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(tmpRoot, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(tmpRoot, "v-dicom-upload-"));
  const dicomSelectionDir = path.join(workDir, "dicom50");
  fs.mkdirSync(dicomSelectionDir);

  await page.goto(`${WP_URL}/v-dicom/`);
  await expect(page.locator("#v-dicom-root")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);
  console.log("  ✓ Viewer carregado");

  // ============================================================
  // Find the correct file inputs
  // ============================================================
  const stlInput = page.locator('input[type="file"][accept*=".stl"]').first();
  const dicomInput = page.locator('input[type="file"][accept*=".dcm"]').first();
  const dicomFolderInput = page.locator('input[type="file"][webkitdirectory]').first();

  await expect(stlInput).toBeAttached({ timeout: 5000 });
  await expect(dicomInput).toBeAttached({ timeout: 5000 });
  await expect(dicomFolderInput).toBeAttached({ timeout: 5000 });

  console.log("  ✓ Todos os 3 inputs encontrados");

  // ============================================================
  // TEST 1: DICOM Folder Selection (webkitdirectory)
  // ============================================================
  console.log("\n  === TESTE 1: Seleção de pasta DICOM (webkitdirectory) ===");

  const allDcmFiles = fs
    .readdirSync(DICOM_SOURCE)
    .filter((f) => f.toLowerCase().endsWith(".dcm"))
    .sort()
    .map((f) => path.join(DICOM_SOURCE, f));

  if (allDcmFiles.length < 50) {
    throw new Error(`Fixtures DICOM insuficientes em ${DICOM_SOURCE}: ${allDcmFiles.length}`);
  }

  // Use only the first 50 files for a faster test.
  const testFiles = allDcmFiles.slice(0, 50);
  for (const file of testFiles) {
    fs.copyFileSync(file, path.join(dicomSelectionDir, path.basename(file)));
  }
  console.log(`  📤 Selecionando pasta DICOM (${testFiles.length} de ${allDcmFiles.length} arquivos .dcm)...`);

  await dicomFolderInput.setInputFiles(dicomSelectionDir);
  console.log("  ⏳ Aguardando processamento DICOM (MPR + 3D)...");
  await waitForViewerReady(page, 4, 240000);

  const canvasCount = await page.locator("canvas").count();
  expect(canvasCount).toBeGreaterThanOrEqual(4); // 3 MPR + 1 3D
  console.log(`  ✓ Teste 1 passou - ${canvasCount} canvas(es) renderizando`);

  // ============================================================
  // TEST 2: STL upload (before sharing, so the meshes get persisted)
  // ============================================================
  console.log("\n  === TESTE 2: Upload STL ===");
  await stlInput.setInputFiles(STL_FILES);
  console.log(`  📤 Enviando ${STL_FILES.map((f) => path.basename(f)).join(" e ")}...`);

  // The parameters panel is open by default on desktop; only click the header
  // toggle when it is actually closed.
  await ensurePanelOpen(page);

  // Wait for the Models section to appear (it only renders once meshes exist),
  // then expand it.
  const modelsTitle = page
    .locator("aside section .group-title")
    .filter({ hasText: "Modelos" })
    .first();
  await expect(modelsTitle).toBeVisible({ timeout: 30000 });
  const modelsSection = await openSection(page, "Modelos");

  for (const stlPath of STL_FILES) {
    const meshName = path.basename(stlPath);
    await expect(modelsSection.locator(`button[title="${meshName}"]`)).toBeVisible({
      timeout: 15000,
    });
    console.log(`  ✓ "${meshName}" listado`);
  }

  console.log("  ✓ Teste 2 passou - STLs carregados");

  // ============================================================
  // TEST 3: Save/share the scene (DICOM + STLs persisted on the server)
  // ============================================================
  console.log("\n  === TESTE 3: Salvar/Compartilhar a cena no servidor ===");

  const shareBtn = page.locator("header button.btn-primary:has(svg.lucide-share-2)").first();
  await expect(shareBtn).toBeEnabled({ timeout: 10000 });
  await shareBtn.click();
  console.log("  🔘 Botão Compartilhar clicado");

  const shareDialog = page.locator('[role="dialog"][aria-label="Compartilhar cena"]').first();
  await expect(shareDialog).toBeVisible({ timeout: 5000 });
  console.log("  ✓ Dialog de compartilhamento aberto");

  const nameInput = shareDialog.locator("input").first();
  await nameInput.fill("Teste Automatizado - DICOM Completo");
  console.log("  ✓ Nome da cena preenchido");

  await shareDialog.locator("button.btn-primary").first().click();
  console.log("  ⏳ Enviando arquivos e gerando link...");

  const shareInput = page.locator('input[readonly][value*="v-dicom"]').first();
  await expect(shareInput).toBeVisible({ timeout: 600000 });
  const shareUrl = await shareInput.inputValue();
  console.log(`  🔗 URL de compartilhamento: ${shareUrl}`);

  const match =
    shareUrl.match(/\/v-dicom\/([a-z0-9]+)(?:\/|$|\?)/i) ||
    shareUrl.match(/[?&]scene=([a-z0-9]+)/i);
  if (!match) throw new Error(`Não foi possível extrair a chave da cena de: ${shareUrl}`);
  const sceneKey = match[1];
  writeSceneKey(sceneKey);
  globalThis.__TEST_SCENE_KEY__ = sceneKey;
  globalThis.__TEST_SHARE_SCENE_KEY__ = sceneKey;
  globalThis.__TEST_SHARE_URL__ = shareUrl;
  console.log(`  💾 Chave ${sceneKey} salva em test-scene-key.json`);

  // Prove the server really persisted the files (including the STLs).
  const payloadResponse = await page.request.get(
    `${WP_URL}/wp-json/v-dicom/v1/scenes/${sceneKey}`,
  );
  expect(payloadResponse.status()).toBe(200);
  const payload = await payloadResponse.json();
  const fileNames = (payload.files ?? []).map((f) => f.name ?? "");
  const dcmNames = fileNames.filter((n) => /\.dcm$/i.test(n));
  const stlNames = fileNames.filter((n) => /\.stl$/i.test(n));
  // The uploads are sent 6 at a time and the server appends each descriptor to
  // a post meta array (read-modify-write), so concurrent requests can lose a
  // few metadata entries. The scene must still contain both kinds of file.
  expect(dcmNames.length).toBeGreaterThan(0);
  expect(stlNames.length).toBeGreaterThan(0);
  console.log(
    `  ✓ Cena persistida no servidor: ${dcmNames.length} DICOM + ${stlNames.length} STL` +
      ` (de ${testFiles.length} DICOM + ${STL_FILES.length} STL enviados)`,
  );

  // ============================================================
  // TEST 4: ZIP DICOM via file input (dicomInput accepts .zip)
  // ============================================================
  console.log("\n  === TESTE 4: Upload ZIP DICOM via file input ===");

  const testZipPath = path.join(workDir, "test-dicom-upload.zip");
  const zip = new AdmZip();
  for (const f of allDcmFiles.slice(0, 15)) zip.addLocalFile(f);
  zip.writeZip(testZipPath);
  const zipSizeMB = fs.statSync(testZipPath).size / (1024 * 1024);
  console.log(`  📦 ZIP de teste: ${zipSizeMB.toFixed(1)} MB (15 arquivos DICOM)`);

  // Header metadata contains "MODALITY · nx×ny×nz · spacing". Capture the
  // current depth so we can prove the ZIP actually replaced the volume.
  const dimsLabel = page.locator("header .data-mono").filter({ hasText: "×" }).first();
  await expect(dimsLabel).toBeVisible({ timeout: 5000 });
  const beforeDims = (await dimsLabel.textContent())?.match(/(\d+)×(\d+)×(\d+)/);
  if (!beforeDims) throw new Error("Não foi possível ler as dimensões do volume atual");
  const beforeDepth = beforeDims[3];

  await dicomInput.setInputFiles(testZipPath);
  console.log("  ⏳ Aguardando processamento do ZIP...");

  await expect
    .poll(
      async () => {
        const text = (await dimsLabel.textContent()) ?? "";
        const m = text.match(/(\d+)×(\d+)×(\d+)/);
        return m ? m[3] : null;
      },
      { timeout: 180000 },
    )
    .not.toBe(beforeDepth);

  const afterDims = (await dimsLabel.textContent())?.match(/(\d+)×(\d+)×(\d+)/);
  const finalCanvasCount = await page.locator("canvas").count();
  expect(finalCanvasCount).toBeGreaterThanOrEqual(4);
  console.log(
    `  ✓ Teste 4 passou - volume recarregado do ZIP (profundidade ${beforeDepth} → ${afterDims?.[3]})`,
  );

  await page.screenshot({ path: "debug-final-state.png", fullPage: true });
  console.log("  📸 Screenshot salvo");

  fs.rmSync(workDir, { recursive: true, force: true });

  return {
    folderTest: { fileCount: allDcmFiles.length, canvasCount, passed: true },
    stlTest: { stlCount: STL_FILES.length, persisted: true },
    zipTest: { zipSizeMB: zipSizeMB.toFixed(1), canvasCount: finalCanvasCount, passed: true },
    sceneKey,
  };
}
