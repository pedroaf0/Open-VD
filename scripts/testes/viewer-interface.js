/**
 * Viewer interface test module.
 * Tests MPR navigation, 3D modes, annotations, measurements, and UI interactions.
 * Fails if expected UI elements are not found.
 */
import { expect } from "@playwright/test";
import {
  ensureAnnotationMode,
  ensurePanelOpen,
  openSection,
  readSceneKey,
  waitForViewerReady,
} from "./test-helpers.mjs";

export const name = "viewer-interface";
export const description = "Testes de interface do viewer: MPR, 3D, anotações, medições";
export const order = 80;

export async function run(page, config) {
  const { WP_URL } = config;

  const sceneKey = readSceneKey();
  if (!sceneKey) {
    throw new Error("Nenhuma cena disponível — testes de upload/share devem rodar antes");
  }
  console.log(`  📝 Usando cena: ${sceneKey}`);

  const url = `${WP_URL}/v-dicom/${sceneKey}/`;
  await page.goto(url);
  await waitForViewerReady(page, 4, 240000);
  console.log("  ✓ Viewer carregado para testes de interface");

  // Test 1: MPR Navigation - must have 3 slice views with canvases
  // Portuguese labels: Axial, Coronal, Sagital (note: Sagital not Sagittal)
  const sliceViews = await page
    .locator(
      '.viewport-frame:has(.plane-label:has-text("Axial")), ' +
        '.viewport-frame:has(.plane-label:has-text("Coronal")), ' +
        '.viewport-frame:has(.plane-label:has-text("Sagital"))',
    )
    .count();
  expect(sliceViews).toBeGreaterThanOrEqual(3);
  console.log(`  📐 ${sliceViews} viewport(s) MPR detectado(s) (Axial, Coronal, Sagital)`);

  // Test 2: Mouse wheel navigation on the Axial slice view
  const axialFrame = page.locator('.viewport-frame:has(.plane-label:text-is("Axial"))').first();
  const firstSliceCanvas = axialFrame.locator("canvas").first();
  await expect(firstSliceCanvas).toBeAttached({ timeout: 5000 });

  const sliceIndex = axialFrame.locator(".viewport-header .data-mono").first();
  const indexBefore = await sliceIndex.textContent();
  const box = await firstSliceCanvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await expect(sliceIndex).not.toHaveText(indexBefore ?? "", { timeout: 5000 });
  await page.mouse.wheel(0, 100);
  await expect(sliceIndex).toHaveText(indexBefore ?? "", { timeout: 5000 });
  console.log("  🖱 Navegação por scroll testada no corte Axial");

  // Test 3: Window/Level controls live in the parameters panel.
  await ensurePanelOpen(page);
  const panel = page.locator("aside[aria-label]").first();
  const wlLabel = panel.locator("label").filter({ hasText: /^WL/ }).first();
  const wwLabel = panel.locator("label").filter({ hasText: /^WW/ }).first();
  await expect(wlLabel).toBeVisible({ timeout: 5000 });
  await expect(wwLabel).toBeVisible({ timeout: 5000 });
  const rangeInputs = await panel.locator('input[type="range"]').count();
  expect(rangeInputs).toBeGreaterThanOrEqual(2);
  console.log(`  🎚 Controles Window/Level detectados (${rangeInputs} sliders no painel)`);

  // Test 4: 3D Viewport interactions (the real Volume3D canvas, not the first canvas)
  const canvas3d = page
    .locator('.viewport-frame:has(.plane-label:text-is("3D / STL")) canvas')
    .first();
  await expect(canvas3d).toBeVisible({ timeout: 5000 });

  const box3d = await canvas3d.boundingBox();
  expect(box3d).toBeTruthy();
  await page.mouse.move(box3d.x + box3d.width / 2, box3d.y + box3d.height / 2);
  await page.mouse.down();
  await page.mouse.move(box3d.x + box3d.width / 2 + 100, box3d.y + box3d.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForTimeout(500);
  console.log("  🎮 Rotação 3D (orbit) testada");

  // Test 5: Render mode selector (Equilibrada/Mais precisa/Mais rápida)
  const renderModeBtn = page.locator("button:has(svg.lucide-gauge)").first();
  await expect(renderModeBtn).toBeVisible({ timeout: 5000 });
  const modeBefore = await renderModeBtn.textContent();

  await renderModeBtn.click();
  const menuItems = page.locator('[role="menuitem"]');
  await expect(menuItems.first()).toBeVisible({ timeout: 5000 });
  const options = await menuItems.count();
  expect(options).toBeGreaterThanOrEqual(3);
  console.log(`  🎨 Seletor de modo de renderização: ${options} opções`);

  // Pick "Mais rápida" (third option) to prove the selection changes the mode.
  await menuItems.nth(2).click();
  await expect(renderModeBtn).not.toHaveText(modeBefore ?? "");
  console.log("  🎨 Modo de renderização alterado");

  // Restore the default mode for the remaining tests.
  await renderModeBtn.click();
  await page.locator('[role="menuitem"]').first().click();
  await expect(renderModeBtn).toHaveText(modeBefore ?? "");

  // Test 6: Annotation mode and tools
  const rail = await ensureAnnotationMode(page);
  const toolNames = ["Cursor", "Régua", "Seta", "Marcação", "Desenho", "Texto"];
  for (const toolName of toolNames) {
    await expect(rail.locator(`button[aria-label="${toolName}"]`)).toBeVisible({
      timeout: 5000,
    });
  }
  console.log(`  ✏️  ${toolNames.length} ferramentas de anotação disponíveis`);

  // Test 7: Measurement tool (ruler) - draw on the Axial slice
  await rail.locator('button[aria-label="Régua"]').click();
  const sliceCanvas = axialFrame.locator("canvas").first();
  const sliceBox = await sliceCanvas.boundingBox();
  expect(sliceBox).toBeTruthy();

  await page.mouse.move(sliceBox.x + sliceBox.width * 0.3, sliceBox.y + sliceBox.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(sliceBox.x + sliceBox.width * 0.6, sliceBox.y + sliceBox.height * 0.6, {
    steps: 10,
  });
  await page.mouse.up();

  const annotationsSection = await openSection(page, "Anotações");
  const measurement = annotationsSection
    .locator("button")
    .filter({ hasText: /\d+([.,]\d+)?\s*mm/ })
    .first();
  await expect(measurement).toBeVisible({ timeout: 5000 });
  console.log("  📏 Medição (régua) criada e listada em Anotações");

  // Back to navigation mode so the slices are unlocked for the rest of the suite.
  const navGroup = page.locator('header [role="group"]').first();
  await navGroup.getByRole("button", { name: "Navegação", exact: true }).click();

  // Test 8: Mesh list / model visibility toggles
  const modelsTitle = page
    .locator("aside section .group-title")
    .filter({ hasText: "Modelos" })
    .first();
  await expect(modelsTitle).toBeVisible({ timeout: 10000 });
  const modelsSection = await openSection(page, "Modelos");
  // The name button has a title with the file name and no aria-label; the
  // eye/center buttons also end in ".stl" but carry an aria-label.
  const meshItems = await modelsSection
    .locator(
      'button[title$=".stl"]:not([aria-label]), ' +
        'button[title$=".ply"]:not([aria-label]), ' +
        'button[title$=".obj"]:not([aria-label])',
    )
    .count();
  expect(meshItems).toBeGreaterThan(0);
  console.log(`  🧱 ${meshItems} item(ns) na lista de meshes`);

  // Test 9: Fullscreen toggle
  const fullscreenBtn = page.locator("header button:has(svg.lucide-maximize-2)").first();
  await expect(fullscreenBtn).toBeVisible({ timeout: 5000 });
  await fullscreenBtn.click();
  const exitFullscreenBtn = page.locator("header button:has(svg.lucide-minimize-2)").first();
  await expect(exitFullscreenBtn).toBeVisible({ timeout: 5000 });
  await exitFullscreenBtn.click();
  console.log("  🖥 Botão tela cheia testado");

  // Test 10: Language switcher
  const langBtn = page.locator("header button:has(svg.lucide-languages)").first();
  await expect(langBtn).toBeVisible({ timeout: 5000 });
  await langBtn.click();
  const langOptions = await page.locator('[role="menuitem"]').count();
  expect(langOptions).toBeGreaterThanOrEqual(3);
  console.log(`  🌐 Seletor de idioma: ${langOptions} opções`);
  await page.keyboard.press("Escape");

  console.log("  ✓ Todos os testes de interface passaram");
  return { passed: true };
}
