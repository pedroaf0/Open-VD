/**
 * Share scene test module.
 * Re-saves an existing scene and verifies the generated public link.
 */
import { expect } from "@playwright/test";
import {
  readSceneKey,
  restSceneUrl,
  waitForViewerReady,
  writeSceneKey,
} from "./test-helpers.mjs";

export const name = "share-scene";
export const description = "Compartilhamento de cena existente (usa chave do upload)";
export const order = 50;

export async function run(page, config) {
  const { WP_URL } = config;

  const sceneKey = readSceneKey();
  if (!sceneKey) {
    throw new Error("Nenhuma chave de cena disponível — teste upload-comprehensive deve rodar antes");
  }
  console.log(`  📝 Usando cena existente: ${sceneKey}`);

  // The scene must exist before we try to re-share it.
  const beforeResponse = await page.request.get(restSceneUrl(WP_URL, sceneKey));
  expect(beforeResponse.status()).toBe(200);

  const url = `${WP_URL}/v-dicom/${sceneKey}/`;
  await page.goto(url);
  await waitForViewerReady(page, 4, 240000);
  console.log("  ✓ Viewer carregado para compartilhamento");

  const shareBtn = page.locator("header button.btn-primary:has(svg.lucide-share-2)").first();
  await expect(shareBtn).toBeEnabled({ timeout: 15000 });
  await shareBtn.click();
  await page.waitForTimeout(500);
  console.log("  ✓ Botão de compartilhar clicado");

  const shareDialog = page.locator('[role="dialog"][aria-label="Compartilhar cena"]').first();
  await expect(shareDialog).toBeVisible({ timeout: 5000 });
  console.log("  ✓ Dialog de compartilhamento aberto");

  // This dialog has no per-scene "public" flag: scenes are readable through
  // the REST API (GET /scenes/<key>) and the public link is the scene URL.
  const nameInput = shareDialog.locator("input").first();
  await nameInput.fill("Teste Automatizado Compartilhamento Publico");
  console.log("  ✓ Nome da cena preenchido");

  const submitBtn = shareDialog.locator("button.btn-primary").first();
  await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  await submitBtn.click();
  console.log("  ⏳ Salvando cena e gerando link...");

  const shareInput = page.locator('input[readonly][value*="v-dicom"]').first();
  await expect(shareInput).toBeVisible({ timeout: 600000 });
  const shareUrl = await shareInput.inputValue();
  console.log(`  🔗 URL de compartilhamento: ${shareUrl}`);

  const match =
    shareUrl.match(/\/v-dicom\/([a-z0-9]+)(?:\/|$|\?)/i) ||
    shareUrl.match(/[?&]scene=([a-z0-9]+)/i);
  expect(match?.[1]).toBe(sceneKey);

  // The saved title must round-trip through the REST payload.
  const afterResponse = await page.request.get(restSceneUrl(WP_URL, sceneKey));
  expect(afterResponse.status()).toBe(200);
  const payload = await afterResponse.json();
  expect(payload.title).toBe("Teste Automatizado Compartilhamento Publico");
  console.log("  ✓ Título e link confirmados no servidor");

  globalThis.__TEST_SHARE_URL__ = shareUrl;
  globalThis.__TEST_SHARE_SCENE_KEY__ = sceneKey;
  writeSceneKey(sceneKey);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  return { sceneKey, shareUrl };
}
