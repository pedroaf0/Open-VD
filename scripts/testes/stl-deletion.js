/**
 * STL Deletion test module.
 * Tests that STL models can be deleted from a saved scene, including:
 * - Confirmation dialog appears when delete button is clicked
 * - Cancel keeps the model
 * - Confirm removes the model from the viewer and model list
 * - Scene is persisted (deleted STL doesn't reappear after refresh)
 * - Orphaned file cleanup runs on the server
 */
import { expect } from "@playwright/test";
import {
  ensurePanelOpen,
  openSection,
  readSceneKey,
  waitForViewerReady,
} from "./test-helpers.mjs";

export const name = "stl-deletion";
export const description = "Testes de exclusão de modelos STL com persistência na cena";
export const order = 50;

export async function run(page, config) {
  const { WP_URL } = config;

  const sceneKey = readSceneKey();
  if (!sceneKey) {
    throw new Error("Nenhuma cena disponível — testes de upload devem rodar antes");
  }
  console.log(`  📝 Usando cena: ${sceneKey}`);

  const url = `${WP_URL}/v-dicom/${sceneKey}/`;
  await page.goto(url);
  await waitForViewerReady(page, 4, 240000);
  console.log("  ✓ Viewer carregado para teste de exclusão STL");

  // Open the parameters panel and expand the "Modelos" section
  await ensurePanelOpen(page);
  const modelsSection = await openSection(page, "Modelos");

  // Find all STL mesh items in the list
  // The name buttons have title ending in .stl and no aria-label
  const meshNameButtons = modelsSection.locator(
    'button[title$=".stl"]:not([aria-label]), ' +
      'button[title$=".ply"]:not([aria-label]), ' +
      'button[title$=".obj"]:not([aria-label])'
  );

  const meshCount = await meshNameButtons.count();
  expect(meshCount).toBeGreaterThan(0);
  console.log(`  🧱 ${meshCount} modelo(s) STL encontrado(s) na lista`);

  // Get the name of the first mesh for verification
  const firstMeshName = await meshNameButtons.first().getAttribute("title");
  console.log(`  🎯 Modelo alvo para exclusão: "${firstMeshName}"`);

  // Find the delete button for the first mesh
  // It's an icon button with aria-label containing "Remover" or "Remove" or "Eliminar"
  const deleteButton = modelsSection
    .locator('button[aria-label*="Remover"], button[aria-label*="Remove"], button[aria-label*="Eliminar"]')
    .first();

  await expect(deleteButton).toBeAttached({ timeout: 10000 });
  console.log("  🔘 Botão de exclusão encontrado");

  // ============================================================
  // TEST 1: Clicking delete opens confirmation dialog
  // ============================================================
  console.log("\n  === TESTE 1: Diálogo de confirmação abre ao clicar excluir ===");
  await deleteButton.click();

  const dialog = page.locator('[role="dialog"]').filter({ hasText: /Excluir.*STL|Delete.*STL|Eliminar.*STL/i }).first();
  await expect(dialog).toBeVisible({ timeout: 5000 });
  console.log("  ✓ Diálogo de confirmação visível");

  // Verify dialog mentions the hide alternative
  const dialogText = await dialog.textContent();
  expect(dialogText).toMatch(/olho|eye|ocult|hide/i);
  console.log("  ✓ Diálogo menciona a alternativa de ocultar (botão olho)");

  // Verify the mesh name appears in the dialog
  expect(dialogText).toContain(firstMeshName);
  console.log(`  ✓ Diálogo referencia o modelo correto: "${firstMeshName}"`);

  // ============================================================
  // TEST 2: Cancel button keeps the model
  // ============================================================
  console.log("\n  === TESTE 2: Cancelar mantém o modelo ===");
  // Cancel button uses t("viewer.common.cancel") -> "Cancelar" (pt), "Cancel" (en), "Cancelar" (es)
  const cancelBtn = dialog.locator("button:has-text('Cancelar'), button:has-text('Cancel')").first();
  await cancelBtn.click();

  await expect(dialog).not.toBeVisible({ timeout: 5000 });
  console.log("  ✓ Diálogo fechado ao cancelar");

  // Verify the model is still in the list
  await expect(modelsSection.locator(`button[title="${firstMeshName}"]`)).toBeVisible({ timeout: 5000 });
  console.log(`  ✓ Modelo "${firstMeshName}" permanece na lista após cancelar`);

  // ============================================================
  // TEST 3: Confirm deletion removes the model
  // ============================================================
  console.log("\n  === TESTE 3: Confirmar exclui o modelo ===");
  await deleteButton.click();
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // The confirm button uses t("viewer.meshes.remove", { name: meshName })
  // which renders as "Remover {{name}}" (pt), "Remove {{name}}" (en), "Eliminar {{name}}" (es)
  const confirmBtn = dialog
    .locator("button")
    .filter({ hasText: new RegExp(`(Remover|Remove|Eliminar).*${firstMeshName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") })
    .first();
  await expect(confirmBtn).toBeVisible({ timeout: 5000 });
  await confirmBtn.click();

  await expect(dialog).not.toBeVisible({ timeout: 5000 });
  console.log("  ✓ Diálogo fechado ao confirmar exclusão");

  // Verify the model is removed from the list
  await expect(modelsSection.locator(`button[title="${firstMeshName}"]`)).not.toBeVisible({ timeout: 10000 });
  console.log(`  ✓ Modelo "${firstMeshName}" removido da lista`);

  // Verify mesh count decreased
  const meshCountAfter = await meshNameButtons.count();
  expect(meshCountAfter).toBe(meshCount - 1);
  console.log(`  ✓ Contagem de meshes: ${meshCount} → ${meshCountAfter}`);

  // ============================================================
  // TEST 4: Scene persistence - refresh and verify STL is gone
  // ============================================================
  console.log("\n  === TESTE 4: Persistência - refresh não traz o STL de volta ===");
  await page.reload({ waitUntil: "networkidle" });
  await waitForViewerReady(page, 4, 240000);
  console.log("  🔄 Página recarregada");

  // Re-open panel and models section
  await ensurePanelOpen(page);
  const modelsSectionAfterRefresh = await openSection(page, "Modelos");

  // The deleted mesh should NOT be in the list
  await expect(modelsSectionAfterRefresh.locator(`button[title="${firstMeshName}"]`)).not.toBeVisible({ timeout: 10000 });
  console.log(`  ✓ Modelo "${firstMeshName}" NÃO reapareceu após refresh`);

  // Verify the remaining meshes are still there
  const meshCountAfterRefresh = await modelsSectionAfterRefresh
    .locator(
      'button[title$=".stl"]:not([aria-label]), ' +
        'button[title$=".ply"]:not([aria-label]), ' +
        'button[title$=".obj"]:not([aria-label])'
    )
    .count();
  expect(meshCountAfterRefresh).toBe(meshCount - 1);
  console.log(`  ✓ ${meshCountAfterRefresh} modelo(s) restante(s) persistido(s) corretamente`);

  // ============================================================
  // TEST 5: Verify server-side cleanup via REST API
  // ============================================================
  console.log("\n  === TESTE 5: Verificação via API - arquivo órfão removido do servidor ===");
  const payloadResponse = await page.request.get(
    `${WP_URL}/wp-json/v-dicom/v1/scenes/${sceneKey}`
  );
  expect(payloadResponse.status()).toBe(200);
  const payload = await payloadResponse.json();

  // Check that the deleted STL is no longer in the files meta
  const fileNames = (payload.files ?? []).map((f) => f.name ?? "");
  const stlNames = fileNames.filter((n) => /\.stl$/i.test(n));
  const deletedStlStillExists = stlNames.some((n) => n === firstMeshName);
  expect(deletedStlStillExists).toBe(false);
  console.log(`  ✓ Arquivo "${firstMeshName}" removido do meta _v_dicom_files`);

  // Check settings.meshes no longer contains the deleted mesh
  const settingsMeshes = payload.settings?.meshes ?? [];
  const deletedMeshInSettings = settingsMeshes.some((m) => m.name === firstMeshName);
  expect(deletedMeshInSettings).toBe(false);
  console.log(`  ✓ Modelo "${firstMeshName}" removido de settings.meshes`);

  // The remaining STLs should still be present
  expect(stlNames.length).toBe(meshCount - 1);
  console.log(`  ✓ ${stlNames.length} STL(s) restante(s) preservado(s) no servidor`);

  console.log("\n  ✓ Todos os testes de exclusão STL passaram");
  return {
    initialMeshCount: meshCount,
    deletedMesh: firstMeshName,
    remainingMeshes: meshCount - 1,
    persisted: true,
    sceneKey,
  };
}