/**
 * Admin test module: configure the panel video watermark (text, position, font size).
 *
 * The values are saved through the "Configurações gerais" form and re-read after
 * the redirect to prove they persisted. The video-recording module then asserts
 * that the downloaded video includes the watermark with the configured settings.
 */
import { expect } from "@playwright/test";
import { ensureLoggedIn } from "./test-helpers.mjs";

export const name = "watermark-config";
export const description = "Define e confirma texto, posição e tamanho da marca d'água do vídeo no WP Admin";
export const order = 37;

/** Test values used by this module; restored at the end of the suite if needed. */
export const TEST_WATERMARK_TEXT = "Teste Marca d'Água v-dicom";
export const TEST_WATERMARK_POSITION = "center";
export const TEST_WATERMARK_FONT_SIZE = 24;

export async function run(page, config) {
  const { WP_URL } = config;

  await ensureLoggedIn(page, config);
  console.log("  ✓ Sessão admin ativa");

  await page.goto(`${WP_URL}/wp-admin/admin.php?page=v-dicom-settings`);
  await page.waitForLoadState("networkidle");

  const form = page.locator("form:has(#v-dicom-recording-name-pattern)").first();
  await expect(form).toBeVisible({ timeout: 10000 });

  // --- Watermark text ---
  const textInput = form.locator("#v-dicom-watermark-text");
  await expect(textInput).toBeVisible({ timeout: 5000 });

  const previousText = await textInput.inputValue();
  console.log(`  🏷 Texto de marca d'água atual: ${previousText || "(vazio)"}`);

  await textInput.fill(TEST_WATERMARK_TEXT);

  // --- Watermark position ---
  const positionSelect = form.locator("#v-dicom-watermark-position");
  await expect(positionSelect).toBeVisible({ timeout: 5000 });

  const previousPosition = await positionSelect.inputValue();
  console.log(`  📍 Posição atual: ${previousPosition}`);

  await positionSelect.selectOption(TEST_WATERMARK_POSITION);

  // --- Watermark font size ---
  const fontSizeInput = form.locator("#v-dicom-watermark-font-size");
  await expect(fontSizeInput).toBeVisible({ timeout: 5000 });

  const previousFontSize = await fontSizeInput.inputValue();
  console.log(`  🔠 Tamanho da fonte atual: ${previousFontSize || "(padrão)"}`);

  await fontSizeInput.fill(String(TEST_WATERMARK_FONT_SIZE));

  // Keep the other general settings enabled when this form is submitted.
  await form.locator("#v-dicom-direct-dicom-enabled").check();
  await form.locator("#v-dicom-public-loading-enabled").check();

  await Promise.all([
    page.waitForURL(/generalsaved=1/, { timeout: 30000 }),
    form.locator('input[type="submit"], button[type="submit"]').first().click(),
  ]);
  await page.waitForLoadState("networkidle");

  // Re-read after the redirect: the fields must contain the saved values.
  await expect(page.locator("#v-dicom-watermark-text")).toHaveValue(
    TEST_WATERMARK_TEXT,
    { timeout: 5000 },
  );
  await expect(page.locator("#v-dicom-watermark-position")).toHaveValue(
    TEST_WATERMARK_POSITION,
    { timeout: 5000 },
  );
  await expect(page.locator("#v-dicom-watermark-font-size")).toHaveValue(
    String(TEST_WATERMARK_FONT_SIZE),
    { timeout: 5000 },
  );

  globalThis.__TEST_WATERMARK_TEXT__ = TEST_WATERMARK_TEXT;
  globalThis.__TEST_WATERMARK_POSITION__ = TEST_WATERMARK_POSITION;
  globalThis.__TEST_WATERMARK_FONT_SIZE__ = TEST_WATERMARK_FONT_SIZE;

  console.log(`  ✓ Marca d'água salva e persistida:`);
  console.log(`    Texto: ${TEST_WATERMARK_TEXT}`);
  console.log(`    Posição: ${TEST_WATERMARK_POSITION}`);
  console.log(`    Tamanho: ${TEST_WATERMARK_FONT_SIZE}px`);

  return {
    text: TEST_WATERMARK_TEXT,
    position: TEST_WATERMARK_POSITION,
    fontSize: TEST_WATERMARK_FONT_SIZE,
    previousText,
    previousPosition,
    previousFontSize,
  };
}