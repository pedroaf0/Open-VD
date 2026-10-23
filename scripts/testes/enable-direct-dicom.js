/**
 * Test to enable direct DICOM upload in WordPress admin
 * Also sets admin user storage limit to allow uploads
 */
import { expect } from "@playwright/test";
import { ensureLoggedIn } from "./test-helpers.mjs";

export const name = "enable-direct-dicom";
export const description =
  "Habilita directDicomEnabled, publicLoadingEnabled e define limite de armazenamento";
export const order = 30;

export async function run(page, config) {
  const { WP_URL, WP_USER } = config;

  console.log("  🔐 Fazendo login no admin...");
  await ensureLoggedIn(page, config);
  console.log("  ✓ Login realizado");

  await page.goto(`${WP_URL}/wp-admin/admin.php?page=v-dicom`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  console.log("  📄 Página de configurações carregada");

  // ============================================================
  // 1. Set the admin user's storage limit and credits
  // ============================================================
  console.log("  💾 Configurando limite de armazenamento do admin (10 GB)...");

  // The limits form has its own submit button ("Salvar limites e créditos").
  // Using a generic submit here would post a different form (the default
  // quotas for new accounts) and the per-user limit would never be saved.
  const limitsForm = page.locator('form:has(input[value="Salvar limites e créditos"])').first();
  await expect(limitsForm).toBeVisible({ timeout: 10000 });

  const adminRow = limitsForm
    .locator("tbody tr")
    .filter({ hasText: `@${WP_USER}` })
    .first();
  await expect(adminRow).toBeVisible({ timeout: 5000 });

  const limitInput = adminRow.locator('input[name^="v_dicom_limit["]').first();
  const creditInput = adminRow.locator('input[name^="v_dicom_credit["]').first();

  const currentLimit = Number(await limitInput.inputValue());
  console.log(`  📊 Limite atual: ${currentLimit} MB`);

  if (currentLimit < 10000) {
    await limitInput.fill("10000");
  }
  if ((await creditInput.count()) > 0 && Number(await creditInput.inputValue()) < 100) {
    await creditInput.fill("100");
  }

  if (currentLimit < 10000) {
    console.log("  🔘 Salvando limites e créditos...");
    await Promise.all([
      page.waitForURL(/limitsaved=1/, { timeout: 30000 }),
      limitsForm.locator('input[type="submit"], button[type="submit"]').first().click(),
    ]);
    await page.waitForLoadState("networkidle");
  } else {
    console.log("  ✓ Limite já era suficiente");
  }

  // Re-read after the redirect to prove the value persisted.
  const savedLimitInput = page
    .locator('form:has(input[value="Salvar limites e créditos"]) tbody tr')
    .filter({ hasText: `@${WP_USER}` })
    .locator('input[name^="v_dicom_limit["]')
    .first();
  await expect(savedLimitInput).toHaveValue("10000", { timeout: 5000 });
  console.log("  ✓ Limite de 10000 MB confirmado");

  // ============================================================
  // 2. Enable direct DICOM loading
  // ============================================================
  const directForm = page.locator("form:has(#v-dicom-direct-dicom-enabled)").first();
  const directCheckbox = directForm.locator("#v-dicom-direct-dicom-enabled");
  await expect(directCheckbox).toBeAttached({ timeout: 5000 });

  const directChecked = await directCheckbox.isChecked();
  console.log(`  ☐ Checkbox directDicom: ${directChecked ? "marcado" : "desmarcado"}`);

  if (!directChecked) {
    await directCheckbox.check();
    await Promise.all([
      page.waitForURL(/directdicomsaved=1/, { timeout: 30000 }),
      directForm.locator('input[type="submit"], button[type="submit"]').first().click(),
    ]);
    await page.waitForLoadState("networkidle");
    console.log("  ✓ directDicom habilitado e salvo");
  } else {
    console.log("  ✓ directDicom já estava habilitado");
  }

  // ============================================================
  // 3. Enable public loading
  // ============================================================
  const publicForm = page.locator("form:has(#v-dicom-public-loading-enabled)").first();
  const publicCheckbox = publicForm.locator("#v-dicom-public-loading-enabled");
  await expect(publicCheckbox).toBeAttached({ timeout: 5000 });

  const publicChecked = await publicCheckbox.isChecked();
  console.log(`  ☐ Checkbox publicLoading: ${publicChecked ? "marcado" : "desmarcado"}`);

  if (!publicChecked) {
    await publicCheckbox.check();
    await Promise.all([
      page.waitForURL(/publicloadingsaved=1/, { timeout: 30000 }),
      publicForm.locator('input[type="submit"], button[type="submit"]').first().click(),
    ]);
    await page.waitForLoadState("networkidle");
    console.log("  ✓ publicLoading habilitado e salvo");
  } else {
    console.log("  ✓ publicLoading já estava habilitado");
  }

  // Verify the saved state after the redirects.
  await expect(page.locator("#v-dicom-direct-dicom-enabled")).toBeChecked();
  await expect(page.locator("#v-dicom-public-loading-enabled")).toBeChecked();
  console.log("  ✓ Configurações confirmadas no admin");

  // ============================================================
  // 4. Verify the viewer now exposes the direct DICOM inputs
  // ============================================================
  await page.goto(`${WP_URL}/v-dicom/`);
  await expect(page.locator("#v-dicom-root")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);

  const stlInput = page.locator('input[type="file"][accept*=".stl"]').first();
  const dicomInput = page.locator('input[type="file"][accept*=".dcm"]').first();
  const dicomFolderInput = page.locator('input[type="file"][webkitdirectory]').first();

  await expect(stlInput).toBeAttached({ timeout: 5000 });
  await expect(dicomInput).toBeAttached({ timeout: 5000 });
  await expect(dicomFolderInput).toBeAttached({ timeout: 5000 });

  console.log("  ✓ Inputs DICOM/STL disponíveis no viewer");

  return { enabled: true, storageLimitSet: true };
}
