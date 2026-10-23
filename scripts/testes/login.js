/**
 * Login test module.
 * Logs into WordPress admin with credentials.
 */
export const name = "login";
export const description = "Faz login no WordPress admin";
export const order = 10;

export async function run(page, config) {
  const { WP_URL, WP_USER, WP_PASS } = config;

  await page.goto(`${WP_URL}/wp-login.php`);
  await page.fill("#user_login", WP_USER);
  await page.fill("#user_pass", WP_PASS);
  await page.click("#wp-submit");
  await page.waitForURL(`${WP_URL}/wp-admin/**`);

  console.log("  ✓ Login realizado com sucesso");
}
