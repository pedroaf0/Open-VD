/**
 * Viewer test module: verify subscription URL features in the frontend.
 *
 * Tests:
 * 1. Diamond icon (Gem) appears in the top header when subscription URL is configured
 * 2. "Remover marca d'água" button appears in video preview dialog for non-subscribers
 */
import { expect } from "@playwright/test";
import { readSceneKey, waitForViewerReady } from "./test-helpers.mjs";

export const name = "subscription-url-viewer";
export const description = "Verifica ícone de assinatura no header e botão 'Remover marca d'água' na prévia do vídeo";
export const order = 86;

export async function run(page, config) {
  const { WP_URL } = config;

  const sceneKey = readSceneKey();
  if (!sceneKey) {
    throw new Error("Nenhuma cena disponível — testes de upload/share devem rodar antes");
  }
  console.log(`  📝 Usando cena: ${sceneKey}`);

  await page.goto(`${WP_URL}/v-dicom/${sceneKey}/`);
  await waitForViewerReady(page, 4, 240000);
  console.log("  ✓ Viewer carregado");

  // TEST 1: Diamond icon (Gem) in header
  // The subscription URL was configured in subscription-url-config test
  // We look for the <a> with href containing the subscription URL and a Gem icon
  const subscriptionLink = page.locator('header a[href*="example.com/assinatura"]').first();
  await expect(subscriptionLink).toBeVisible({ timeout: 10000 });
  const href = await subscriptionLink.getAttribute("href");
  expect(href).toContain("example.com/assinatura");
  console.log(`  💎 Ícone de assinatura (diamante) visível no header: ${href}`);

  // Verify it has the Gem icon
  const gemIcon = subscriptionLink.locator("svg.lucide-gem");
  await expect(gemIcon).toBeVisible({ timeout: 5000 });
  console.log("  💎 Link tem ícone de diamante (Gem)");

  // Verify the link opens in new tab
  const target = await subscriptionLink.getAttribute("target");
  expect(target).toBe("_blank");
  const rel = await subscriptionLink.getAttribute("rel");
  expect(rel).toContain("noreferrer");
  console.log("  🔗 Link de assinatura abre em nova aba com rel=noreferrer");

  // TEST 3: Start a recording and check the preview dialog for "Remover marca d'água" button
  // First ensure we have the recording button in the rail
  const rail = page.locator("nav.rail").first();
  await expect(rail).toBeVisible({ timeout: 10000 });
  const startLabel = /Gravar vídeo do painel|Record panel video|Grabar vídeo del panel/;
  const recordBtn = rail.getByRole("button", { name: startLabel });
  await expect(recordBtn).toBeVisible({ timeout: 10000 });

  // Start recording without audio
  await recordBtn.click();
  const audioPromptLabel = /Gravar áudio do microfone|Record microphone audio|Grabar audio del micrófono/;
  const audioPrompt = page.getByRole("dialog", { name: audioPromptLabel }).first();
  await expect(audioPrompt).toBeVisible({ timeout: 10000 });
  const withoutAudioLabel = /Gravar sem áudio|Record without audio|Grabar sin audio/;
  await audioPrompt.getByRole("button", { name: withoutAudioLabel }).click();
  await expect(audioPrompt).not.toBeVisible({ timeout: 5000 });

  // Wait a bit for recording
  await page.waitForTimeout(1500);

  // Stop recording
  const stopLabel = /Parar gravação|Stop Recording|Detener grabación/;
  const stopBtn = rail.getByRole("button", { name: stopLabel });
  await expect(stopBtn).toBeVisible({ timeout: 10000 });
  await stopBtn.click();

  // Preview dialog should open
  const dialog = page.locator('[role="dialog"]:has(video)').first();
  await expect(dialog).toBeVisible({ timeout: 20000 });
  await expect(dialog).toContainText(/Vídeo do painel|Panel video|Vídeo del panel/);

  // Check for "Remover marca d'água" button - it should appear because:
  // 1. subscription URL is configured
  // 2. the test user (adm) is NOT a subscriber (assinante = false)
  const removeWatermarkLabel = /Remover marca d'água|Remove watermark|Quitar marca de agua/;
  const removeWatermarkBtn = dialog.getByRole("link", { name: removeWatermarkLabel });
  await expect(removeWatermarkBtn).toBeVisible({ timeout: 10000 });

  const removeHref = await removeWatermarkBtn.getAttribute("href");
  expect(removeHref).toContain("example.com/assinatura");
  console.log(`  💧 Botão "Remover marca d'água" visível na prévia: ${removeHref}`);

  // Verify it also has the Gem icon
  const removeGemIcon = removeWatermarkBtn.locator("svg.lucide-gem");
  await expect(removeGemIcon).toBeVisible({ timeout: 5000 });
  console.log("  💎 Botão tem ícone de diamante (Gem)");

  // Close the dialog
  const closeLabel = /^(Fechar|Close|Cerrar)$/;
  await dialog.getByRole("button", { name: closeLabel }).first().click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });

  console.log("  ✓ Todos os testes de URL de assinatura no viewer passaram");
  return { passed: true };
}