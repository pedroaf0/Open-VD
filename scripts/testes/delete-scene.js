/**
 * Delete scene test module.
 * Deletes the test scene via REST API to ensure a clean state.
 * This also tests the DELETE /scenes/<key> endpoint.
 */
import { expect } from "@playwright/test";
import {
  clearSceneKey,
  ensureLoggedIn,
  getRestNonce,
  readSceneKey,
  restSceneUrl,
} from "./test-helpers.mjs";

export const name = "delete-scene";
export const description = "Exclusão da cena de teste via API (limpeza final)";
export const order = 90;

export async function run(page, config) {
  const { WP_URL } = config;

  const sceneKey = readSceneKey();
  if (!sceneKey) {
    throw new Error("Nenhuma chave de cena para excluir — testes anteriores devem criar uma cena");
  }
  console.log(`  🗑 Excluindo cena: ${sceneKey}`);

  await ensureLoggedIn(page, config);
  console.log("  ✓ Sessão admin ativa");

  const sceneUrl = restSceneUrl(WP_URL, sceneKey);

  // The scene must exist before we delete it.
  const before = await page.request.get(sceneUrl);
  expect(before.status()).toBe(200);

  const nonce = await getRestNonce(page, WP_URL);
  if (!nonce) throw new Error("Não foi possível obter o nonce wp_rest do admin");
  console.log("  🔑 Nonce REST obtido");

  let response = await page.request.delete(sceneUrl, {
    headers: { "X-WP-Nonce": nonce },
  });
  console.log(`  📡 DELETE response: ${response.status()} ${response.statusText()}`);

  // A stale nonce is the only expected transient failure; refresh and retry.
  if (response.status() === 403) {
    const freshNonce = await getRestNonce(page, WP_URL);
    if (freshNonce && freshNonce !== nonce) {
      response = await page.request.delete(sceneUrl, {
        headers: { "X-WP-Nonce": freshNonce },
      });
      console.log(`  📡 DELETE retry: ${response.status()} ${response.statusText()}`);
    }
  }

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`Falha ao excluir cena: ${response.status()} - ${errorText}`);
  }

  const result = await response.json();
  expect(result.ok).toBe(true);
  console.log(`  ✓ Cena excluída com sucesso: ${JSON.stringify(result)}`);

  // The page route always returns the viewer shell (HTTP 200), so scene
  // existence must be verified through the REST endpoint (404 when gone).
  await expect
    .poll(
      async () => {
        const check = await page.request.get(sceneUrl);
        return check.status();
      },
      { timeout: 30000, intervals: [500, 1000, 2000] },
    )
    .toBe(404);
  console.log("  ✓ REST GET /scenes/<key> passou a responder 404");

  clearSceneKey();
  delete globalThis.__TEST_SCENE_KEY__;
  delete globalThis.__TEST_SHARE_SCENE_KEY__;
  delete globalThis.__TEST_SHARE_URL__;

  // Restore the default video filename pattern changed by the admin test.
  if (globalThis.__TEST_RECORDING_NAME_PATTERN__) {
    console.log("  ♻ Restaurando padrão do nome do vídeo 3D...");
    await page.goto(`${WP_URL}/wp-admin/admin.php?page=v-dicom-settings`);
    await page.waitForLoadState("networkidle");

    const form = page.locator("form:has(#v-dicom-recording-name-pattern)").first();
    const input = form.locator("#v-dicom-recording-name-pattern");
    await expect(input).toBeVisible({ timeout: 10000 });

    await input.fill("openvd-3d-recording-{timestamp}");
    // Preserve the general switches while saving the pattern.
    await form.locator("#v-dicom-direct-dicom-enabled").check();
    await form.locator("#v-dicom-public-loading-enabled").check();

    await Promise.all([
      page.waitForURL(/generalsaved=1/, { timeout: 30000 }),
      form.locator('input[type="submit"], button[type="submit"]').first().click(),
    ]);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#v-dicom-recording-name-pattern")).toHaveValue(
      "openvd-3d-recording-{timestamp}",
      { timeout: 5000 },
    );
    delete globalThis.__TEST_RECORDING_NAME_PATTERN__;
    console.log("  ✓ Padrão restaurado");
  }

  return { deleted: true, sceneKey };
}
