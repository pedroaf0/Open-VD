/**
 * Panel video recording test module.
 *
 * Covers the record button in the lateral rail (and inside the slice/3D
 * viewports), the audio choice prompt, the red recording indicator with its
 * elapsed timer, the stop control, the preview modal with playback and
 * download, the composed 2×2 frame (all four viewports),
 * a recording while one viewport is expanded, and starting a second recording
 * after the first one has been finalized (resource cleanup). The first preview
 * proves the no-audio path; the second one uses Chromium's fake microphone and
 * proves the audio track is included.
 *
 * Optional final verification screenshots are captured only when the runner is
 * invoked with `--screenshots` (disabled by default). The downloaded recording
 * is discarded by default; `--save-recording` keeps it in the project root.
 */
import { expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureLoggedIn, readSceneKey, waitForViewerReady } from "./test-helpers.mjs";

export const name = "video-recording";
export const description =
  "Gravação do painel: trilho, quatro janelas, áudio opcional, janela expandida, prévia e download";
export const order = 85;

const VIEWPORT_3D = '.viewport-frame:has(.plane-label:text-is("3D / STL"))';
const START_LABEL = /Gravar vídeo do painel|Record panel video|Grabar vídeo del panel/;
const STOP_LABEL = /Parar gravação|Stop Recording|Detener grabación/;
const INDICATOR_LABEL = /Gravando|Recording|Grabando/;
const AUDIO_PROMPT_LABEL =
  /Gravar áudio do microfone|Record microphone audio|Grabar audio del micrófono/;
const WITHOUT_AUDIO_LABEL = /Gravar sem áudio|Record without audio|Grabar sin audio/;
const WITH_AUDIO_LABEL = /Gravar com microfone|Record with microphone|Grabar con micrófono/;
const CANCEL_LABEL = /Cancelar|Cancel/;
const CLOSE_LABEL = /^(Fechar|Close|Cerrar)$/;
const SHARE_LABEL = /Compartilhar vídeo|Share video|Compartir vídeo/;
const BACK_TO_GRID_LABEL = /Voltar ao mosaico|Back to grid|Volver a la cuadrícula/;
const PANEL_TOGGLE_LABEL = /Painel de parâmetros|Parameters panel|Panel de parámetros/;
const DEFAULT_PATTERN = "openvd-3d-recording-{timestamp}";
const MAX_OUTPUT = 1920;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Converte o padrão configurado no admin no nome de arquivo esperado. */
function recordingNamePatternToRegExp(pattern) {
  const template =
    (pattern || DEFAULT_PATTERN).replace(/\.(?:mp4|webm)\s*$/i, "").trim() || DEFAULT_PATTERN;
  const hasTimestamp = /\{timestamp\}/i.test(template);
  const hasDate = /\{data\}/i.test(template);
  const hasTime = /\{hora\}/i.test(template);
  let source = template
    .split(/(\{timestamp\}|\{data\}|\{hora\})/i)
    .map((part) => {
      if (/^\{timestamp\}$/i.test(part)) return "\\d{8}-\\d{6}";
      if (/^\{data\}$/i.test(part)) return "\\d{8}";
      if (/^\{hora\}$/i.test(part)) return "\\d{6}";
      return escapeRegExp(part);
    })
    .join("");
  if (!hasTimestamp) {
    if (!hasDate && !hasTime) source += "-\\d{8}-\\d{6}";
    else if (!hasTime) source += "-\\d{6}";
    else if (!hasDate) source += "-\\d{8}";
  }
  return new RegExp(`^${source}\\.(webm|mp4)$`);
}

function screenshotDir() {
  const dir = path.join(process.cwd(), "test-results", "final");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function capture(page, config, fileName, locator = null) {
  if (!config.ENABLE_SCREENSHOTS) return;
  const target = path.join(screenshotDir(), fileName);
  if (locator) {
    await locator.screenshot({ path: target });
  } else {
    await page.screenshot({ path: target, fullPage: true });
  }
  console.log(`  📸 Screenshot salvo: ${target}`);
}

/** Abre a escolha de áudio e inicia a gravação com ou sem microfone. */
async function startRecording(page, button, audio = false) {
  await button.click();
  const prompt = page.getByRole("dialog", { name: AUDIO_PROMPT_LABEL }).first();
  await expect(prompt).toBeVisible({ timeout: 10000 });
  await prompt
    .getByRole("button", { name: audio ? WITH_AUDIO_LABEL : WITHOUT_AUDIO_LABEL })
    .click();
  await expect(prompt).not.toBeVisible({ timeout: 5000 });
}

/** Lê a quantidade de faixas de áudio do blob gravado (0 = vídeo sem áudio). */
async function videoAudioTrackCount(video) {
  return video.evaluate((element) => {
    if (typeof element.captureStream !== "function") return -1;
    const stream = element.captureStream();
    const count = stream.getAudioTracks().length;
    stream.getTracks().forEach((track) => track.stop());
    return count;
  });
}

async function waitForVideoMetadata(page) {
  await page.waitForFunction(
    () => {
      const video = document.querySelector('[role="dialog"] video');
      return !!video && video.readyState >= 1 && video.videoWidth > 0;
    },
    null,
    { timeout: 20000 },
  );
}

/** Replica `outputSize()` de usePanelRecorder para conferir o canvas composto. */
function expectedOutputSize(box, dpr) {
  const scale = Math.min(2, dpr || 1);
  let width = Math.max(2, Math.round(box.width * scale));
  let height = Math.max(2, Math.round(box.height * scale));
  const fit = Math.min(1, MAX_OUTPUT / width, MAX_OUTPUT / height);
  width = Math.max(2, Math.round((width * fit) / 2) * 2);
  height = Math.max(2, Math.round((height * fit) / 2) * 2);
  return { width, height };
}

/**
 * Procura um frame no meio do vídeo e conta os pixels claros em cada
 * quadrante. Os quatro viewports têm conteúdo claro (cortes e volume 3D);
 * um vídeo só do viewport 3D deixaria os outros quadrantes praticamente
 * vazios, e um vídeo vazio falharia em todos.
 */
async function analyzeVideoFrame(video) {
  return video.evaluate(async (element) => {
    if (element.readyState < 2) {
      await new Promise((resolve) =>
        element.addEventListener("loadeddata", resolve, { once: true }),
      );
    }
    const duration = Number.isFinite(element.duration) ? element.duration : 0;
    const target = duration > 0 ? Math.min(0.5, duration / 2) : 0;
    if (target > 0 && Math.abs(element.currentTime - target) > 0.05) {
      await new Promise((resolve) => {
        element.addEventListener("seeked", resolve, { once: true });
        element.currentTime = target;
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 120));

    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D indisponível para inspecionar o vídeo");
    ctx.drawImage(element, 0, 0);

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const quadrants = { axial: 0, coronal: 0, sagittal: 0, threeD: 0 };
    const halfWidth = canvas.width / 2;
    const halfHeight = canvas.height / 2;
    for (let y = 0; y < canvas.height; y += 2) {
      for (let x = 0; x < canvas.width; x += 2) {
        const i = (y * canvas.width + x) * 4;
        // Fundo/cabeçalho gravados ficam abaixo deste limiar; tecido e volume
        // 3D ficam acima.
        if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 90) continue;
        const key =
          y < halfHeight
            ? x < halfWidth
              ? "axial"
              : "coronal"
            : x < halfWidth
              ? "sagittal"
              : "threeD";
        quadrants[key] += 1;
      }
    }
    return { width: canvas.width, height: canvas.height, quadrants };
  });
}

export async function run(page, config) {
  const { WP_URL } = config;

  const sceneKey = readSceneKey();
  if (!sceneKey) {
    throw new Error("Nenhuma cena disponível — testes de upload/share devem rodar antes");
  }
  console.log(`  📝 Usando cena: ${sceneKey}`);

  // O módulo recording-name-pattern define este global na suíte completa.
  // Quando este teste roda isolado, lê o padrão efetivamente salvo no admin.
  let configuredPattern = globalThis.__TEST_RECORDING_NAME_PATTERN__;
  if (!configuredPattern) {
    await ensureLoggedIn(page, config);
    await page.goto(`${WP_URL}/wp-admin/admin.php?page=v-dicom-settings`);
    await page.waitForLoadState("networkidle");
    const patternInput = page.locator("#v-dicom-recording-name-pattern");
    await expect(patternInput).toBeVisible({ timeout: 10000 });
    configuredPattern = (await patternInput.inputValue()).trim() || DEFAULT_PATTERN;
    console.log(`  🏷 Padrão configurado no admin: ${configuredPattern}`);
  }

  await page.goto(`${WP_URL}/v-dicom/${sceneKey}/`);
  await waitForViewerReady(page, 4, 240000);

  const viewport3d = page.locator(VIEWPORT_3D).first();
  await expect(viewport3d).toBeVisible({ timeout: 15000 });

  // A captura de imagem e a gravação ficam lado a lado no viewport 3D e nos
  // cortes 2D; a gravação continua sendo a de todo o painel.
  await expect(viewport3d.locator("button:has(svg.lucide-camera)").first()).toBeVisible({
    timeout: 10000,
  });
  const viewport3dRecord = viewport3d.getByRole("button", { name: START_LABEL }).first();
  await expect(viewport3dRecord).toBeVisible({ timeout: 10000 });
  await expect(viewport3dRecord).toHaveAttribute("aria-pressed", "false");
  const axialViewport = page.locator('[data-recording-viewport="axial"]').first();
  const axialRecord = axialViewport.getByRole("button", { name: START_LABEL }).first();
  await expect(axialRecord).toBeVisible({ timeout: 10000 });

  const rail = page.locator("nav.rail").first();
  await expect(rail).toBeVisible({ timeout: 10000 });
  const recordBtn = rail.getByRole("button", { name: START_LABEL });
  await expect(recordBtn).toBeVisible({ timeout: 10000 });
  await expect(recordBtn).toHaveAttribute("aria-pressed", "false");

  const panel = page.locator("[data-recording-panel]").first();
  await expect(panel).toBeVisible({ timeout: 10000 });
  const panelBox = await panel.boundingBox();
  expect(panelBox).toBeTruthy();
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  const expectedSize = expectedOutputSize(panelBox, dpr);

  console.log("  🎥 Botão de gravação no trilho (fora do viewport 3D)");
  await capture(page, config, "video-recording-01-initial.png");

  // ============================================================
  // TEST 1: the record button asks about microphone audio first.
  // Cancelling must not start the recorder.
  // ============================================================
  await recordBtn.click();
  const audioPrompt = page.getByRole("dialog", { name: AUDIO_PROMPT_LABEL }).first();
  await expect(audioPrompt).toBeVisible({ timeout: 10000 });
  await audioPrompt.getByRole("button", { name: CANCEL_LABEL }).click();
  await expect(audioPrompt).not.toBeVisible({ timeout: 5000 });
  await expect(recordBtn).toHaveAttribute("aria-pressed", "false");
  expect(await rail.getByRole("button", { name: STOP_LABEL }).count()).toBe(0);
  console.log("  🎙 Pergunta de áudio exibida; cancelar não iniciou a gravação");

  // O botão do viewport 3D dispara a mesma pergunta e não grava ao cancelar.
  await viewport3dRecord.click();
  const viewportPrompt = page.getByRole("dialog", { name: AUDIO_PROMPT_LABEL }).first();
  await expect(viewportPrompt).toBeVisible({ timeout: 10000 });
  await viewportPrompt.getByRole("button", { name: CANCEL_LABEL }).click();
  await expect(viewportPrompt).not.toBeVisible({ timeout: 5000 });
  await expect(viewport3dRecord).toHaveAttribute("aria-pressed", "false");
  console.log("  🎥 Botão de gravação do viewport 3D abriu a pergunta de áudio");

  // ============================================================
  // TEST 2: start without audio — stop state + red indicator + timer.
  // ============================================================
  await startRecording(page, recordBtn);

  const stopBtn = rail.getByRole("button", { name: STOP_LABEL });
  await expect(stopBtn).toBeVisible({ timeout: 10000 });
  await expect(stopBtn).toHaveAttribute("aria-pressed", "true");
  await expect(stopBtn).toHaveClass(/text-red-400/);

  const indicator = page.getByRole("status", { name: INDICATOR_LABEL }).first();
  await expect(indicator).toBeVisible({ timeout: 5000 });
  // Tailwind v4 emits oklch(); Chrome exposes the computed value as lab(...),
  // so assert the utility class and that the background is not transparent
  // instead of pinning a single color-space serialization.
  await expect(indicator).toHaveClass(/bg-red-600/);
  const indicatorBackground = await indicator.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(indicatorBackground).not.toMatch(/^(transparent|rgba?\(0,\s*0,\s*0,\s*0\))$/);
  const timer = indicator.locator("span.tabular-nums").first();
  await expect(timer).toHaveText(/^\d{2}:\d{2}$/);

  // O indicador fica sobre o painel inteiro, não dentro do viewport 3D.
  expect(await viewport3d.locator('[role="status"]').count()).toBe(0);

  const firstElapsed = await timer.textContent();
  await page.waitForTimeout(1500);
  await expect(timer).not.toHaveText(firstElapsed ?? "", { timeout: 5000 });
  console.log(`  ⏺ Gravação ativa no painel (${firstElapsed} → ${await timer.textContent()})`);
  await capture(page, config, "video-recording-02-active.png");

  // ============================================================
  // TEST 3: stop finalizes the video and opens the preview modal.
  // ============================================================
  await stopBtn.click();

  const dialog = page.locator('[role="dialog"]:has(video)').first();
  await expect(dialog).toBeVisible({ timeout: 20000 });
  await expect(dialog).toContainText(/Vídeo do painel|Panel video|Vídeo del panel/);
  const video = dialog.locator("video").first();
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("src", /^blob:/);
  await waitForVideoMetadata(page);

  // O botão de compartilhar só existe quando o navegador aceita compartilhar
  // arquivos pela Web Share API (nível 2); sem suporte ele não é renderizado.
  const canShareVideo = await page.evaluate(() => {
    if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
      return false;
    }
    const probe = new File([new Blob([new Uint8Array(1)], { type: "video/mp4" })], "probe.mp4", {
      type: "video/mp4",
    });
    return navigator.canShare({ files: [probe] });
  });
  const shareBtn = dialog.getByRole("button", { name: SHARE_LABEL });
  if (canShareVideo) {
    await expect(shareBtn).toBeVisible({ timeout: 15000 });
    // Fica ao lado do download, dentro do mesmo grupo de ações.
    const [downloadBtn, shareBox] = await Promise.all([
      dialog.locator("button:has(svg.lucide-download)").first().boundingBox(),
      shareBtn.boundingBox(),
    ]);
    expect(downloadBtn).toBeTruthy();
    expect(shareBox).toBeTruthy();
    expect(shareBox.y).toBeLessThan(downloadBtn.y + downloadBtn.height);
    console.log("  🔗 Botão de compartilhar vídeo visível ao lado do download");
  } else {
    await expect(shareBtn).toHaveCount(0);
    console.log("  🔗 Navegador sem Web Share de arquivos: botão de compartilhar omitido");
  }

  const metadata = await video.evaluate((element) => ({
    width: element.videoWidth,
    height: element.videoHeight,
  }));
  expect(metadata.width).toBeGreaterThan(0);
  expect(metadata.height).toBeGreaterThan(0);
  // O canvas composto tem o tamanho do painel inteiro, não só do viewport 3D.
  expect(Math.abs(metadata.width - expectedSize.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(metadata.height - expectedSize.height)).toBeLessThanOrEqual(2);
  const viewport3dBox = await viewport3d.boundingBox();
  expect(viewport3dBox).toBeTruthy();
  expect(metadata.width).toBeGreaterThan(viewport3dBox.width * 1.5);
  expect(await videoAudioTrackCount(video)).toBe(0);
  console.log(`  🎬 Prévia do painel aberta sem áudio (${metadata.width}×${metadata.height})`);

  const frame = await analyzeVideoFrame(video);
  expect(frame.width).toBe(metadata.width);
  expect(frame.height).toBe(metadata.height);
  for (const [quadrant, count] of Object.entries(frame.quadrants)) {
    expect(count, `quadrante ${quadrant} sem conteúdo gravado`).toBeGreaterThan(100);
  }
  console.log(
    `  🖼 Quatro viewports no vídeo (${Object.entries(frame.quadrants)
      .map(([key, count]) => `${key}: ${count}px`)
      .join(", ")})`,
  );
  await capture(page, config, "video-recording-03-preview.png");

  // ============================================================
  // TEST 4: download the recorded file.
  // ============================================================
  const downloadPromise = page.waitForEvent("download");
  await dialog.locator("button:has(svg.lucide-download)").first().click();
  const download = await downloadPromise;
  const fileName = download.suggestedFilename();

  // The name must follow the pattern configured in WP Admin by
  // recording-name-pattern (defaults to openvd-3d-recording-{timestamp}).
  const expectedName = recordingNamePatternToRegExp(configuredPattern);
  expect(fileName).toMatch(expectedName);
  console.log(`  🏷 Nome seguiu o padrão do admin: ${configuredPattern}`);

  // MP4/H.264 is preferred; WebM remains the fallback for browsers that do
  // not expose an MP4 encoder through MediaRecorder (e.g. Firefox).
  const supportsMp4 = await page.evaluate(
    () =>
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("video/mp4;codecs=avc1.42E01E"),
  );
  if (supportsMp4) {
    expect(fileName).toMatch(/\.mp4$/);
  }
  console.log(`  🎞 Formato gravado: ${fileName.split(".").pop()?.toUpperCase()}`);

  const keepRecording = config.SAVE_RECORDING === true;
  const tmpRoot = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(tmpRoot, { recursive: true });
  const projectRoot = config.PROJECT_ROOT || process.cwd();
  const downloadedPath = keepRecording
    ? path.join(projectRoot, fileName)
    : path.join(tmpRoot, `video-download-${Date.now()}-${fileName}`);
  await download.saveAs(downloadedPath);
  const size = fs.statSync(downloadedPath).size;
  expect(size).toBeGreaterThan(1000);
  if (keepRecording) {
    console.log(`  💾 Vídeo salvo na raiz do projeto: ${downloadedPath}`);
  } else {
    fs.rmSync(downloadedPath, { force: true });
  }
  console.log(`  ⬇ Download do vídeo validado: ${fileName} (${size} bytes)`);

  // ============================================================
  // TEST 5: close the modal, record again with microphone audio, and prove
  // the recorder and its tracks were released between recordings.
  // ============================================================
  await dialog.getByRole("button", { name: CLOSE_LABEL }).first().click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });

  const recordAgain = rail.getByRole("button", { name: START_LABEL });
  await expect(recordAgain).toBeVisible({ timeout: 10000 });
  await startRecording(page, recordAgain, true);
  await page.waitForTimeout(1200);
  const stopAgain = rail.getByRole("button", { name: STOP_LABEL });
  await expect(stopAgain).toBeVisible({ timeout: 10000 });
  await stopAgain.click();

  const secondDialog = page.locator('[role="dialog"]:has(video)').first();
  await expect(secondDialog).toBeVisible({ timeout: 20000 });
  await waitForVideoMetadata(page);
  const secondVideo = secondDialog.locator("video").first();
  await expect.poll(() => videoAudioTrackCount(secondVideo), { timeout: 10000 }).toBeGreaterThan(0);
  await secondDialog.getByRole("button", { name: CLOSE_LABEL }).first().click();
  await expect(secondDialog).not.toBeVisible({ timeout: 5000 });
  console.log("  🎙 Segunda gravação com microfone incluiu faixa de áudio");

  // ============================================================
  // TEST 6: recording follows the expanded single-viewport layout.
  // ============================================================
  const expandBtn = page.locator('main button[aria-label^="Expandir"]').first();
  await expect(expandBtn).toBeVisible({ timeout: 10000 });
  await expandBtn.click();
  await expect(page.locator("[data-recording-viewport]")).toHaveCount(1);

  await startRecording(page, rail.getByRole("button", { name: START_LABEL }));
  await page.waitForTimeout(1200);
  const stopExpanded = rail.getByRole("button", { name: STOP_LABEL });
  await expect(stopExpanded).toBeVisible({ timeout: 10000 });
  await stopExpanded.click();

  const expandedDialog = page.locator('[role="dialog"]:has(video)').first();
  await expect(expandedDialog).toBeVisible({ timeout: 20000 });
  const expandedVideo = expandedDialog.locator("video").first();
  await waitForVideoMetadata(page);
  const expandedMetadata = await expandedVideo.evaluate((element) => ({
    width: element.videoWidth,
    height: element.videoHeight,
  }));
  expect(Math.abs(expandedMetadata.width - expectedSize.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(expandedMetadata.height - expectedSize.height)).toBeLessThanOrEqual(2);
  const expandedFrame = await analyzeVideoFrame(expandedVideo);
  const expandedTotal = Object.values(expandedFrame.quadrants).reduce(
    (sum, count) => sum + count,
    0,
  );
  expect(expandedTotal).toBeGreaterThan(1000);
  console.log(
    `  🔍 Janela expandida gravada (${expandedMetadata.width}×${expandedMetadata.height})`,
  );
  await capture(page, config, "video-recording-04-expanded.png");
  await expandedDialog.getByRole("button", { name: CLOSE_LABEL }).first().click();
  await expect(expandedDialog).not.toBeVisible({ timeout: 5000 });

  const backToGrid = rail.getByRole("button", { name: BACK_TO_GRID_LABEL });
  await expect(backToGrid).toBeVisible({ timeout: 10000 });
  await backToGrid.click();
  await expect(page.locator("[data-recording-viewport]")).toHaveCount(4);

  // ============================================================
  // TEST 7: tablet has no rail, so the same control lives in the
  // parameters side panel and records the panel there too.
  // ============================================================
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(800);
  const panelToggle = page.getByRole("button", { name: PANEL_TOGGLE_LABEL });
  if ((await panelToggle.getAttribute("aria-pressed")) !== "true") await panelToggle.click();
  await expect(page.locator("nav.rail")).toHaveCount(0);
  const tabletRecord = page.getByRole("button", { name: START_LABEL }).first();
  await expect(tabletRecord).toBeVisible({ timeout: 10000 });
  await startRecording(page, tabletRecord);
  const tabletStop = page.getByRole("button", { name: STOP_LABEL }).first();
  await expect(tabletStop).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await tabletStop.click();
  const tabletDialog = page.locator('[role="dialog"]:has(video)').first();
  await expect(tabletDialog).toBeVisible({ timeout: 20000 });
  await waitForVideoMetadata(page);
  const tabletMetadata = await tabletDialog.locator("video").evaluate((element) => ({
    width: element.videoWidth,
    height: element.videoHeight,
  }));
  expect(tabletMetadata.width).toBeGreaterThan(0);
  expect(tabletMetadata.height).toBeGreaterThan(0);
  console.log(
    `  📱 Gravação no painel lateral do tablet (${tabletMetadata.width}×${tabletMetadata.height})`,
  );
  await tabletDialog.getByRole("button", { name: CLOSE_LABEL }).first().click();
  await expect(tabletDialog).not.toBeVisible({ timeout: 5000 });

  // ============================================================
  // TEST 8: mobile records from the 3D sheet (only the focused
  // viewport is visible, so the composed video follows it).
  // ============================================================
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "3D", exact: true }).click();
  const mobileSheet = page.locator('[role="dialog"]').first();
  await expect(mobileSheet).toBeVisible({ timeout: 10000 });
  const mobileRecord = mobileSheet.getByRole("button", { name: START_LABEL });
  await expect(mobileRecord).toBeVisible({ timeout: 10000 });
  await startRecording(page, mobileRecord);
  const mobileStop = mobileSheet.getByRole("button", { name: STOP_LABEL });
  await expect(mobileStop).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await mobileStop.click();
  const mobileDialog = page.locator('[role="dialog"]:has(video)').first();
  await expect(mobileDialog).toBeVisible({ timeout: 20000 });
  await waitForVideoMetadata(page);
  const mobileMetadata = await mobileDialog.locator("video").evaluate((element) => ({
    width: element.videoWidth,
    height: element.videoHeight,
  }));
  expect(mobileMetadata.width).toBeGreaterThan(0);
  expect(mobileMetadata.height).toBeGreaterThan(mobileMetadata.width);
  console.log(`  📱 Gravação no mobile (${mobileMetadata.width}×${mobileMetadata.height})`);
  await mobileDialog.getByRole("button", { name: CLOSE_LABEL }).first().click();
  await expect(mobileDialog).not.toBeVisible({ timeout: 5000 });

  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log("  ✓ Todos os testes de gravação de vídeo passaram");
  return { passed: true, sceneKey, fileName, size };
}
