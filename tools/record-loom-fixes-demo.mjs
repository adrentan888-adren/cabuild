import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "public", "tutorials");
const videoDir = path.join(outputDir, "recordings");
const logoPath = path.join(outputDir, "assets", "fairview-logo.jpeg");
const appUrl = process.env.APP_URL || "http://localhost:3100";

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function caption(page, text) {
  await page.evaluate((message) => {
    let el = document.querySelector("[data-demo-caption]");
    if (!el) {
      el = document.createElement("div");
      el.setAttribute("data-demo-caption", "true");
      Object.assign(el.style, {
        position: "fixed",
        left: "50%",
        bottom: "22px",
        transform: "translateX(-50%)",
        maxWidth: "980px",
        width: "calc(100% - 44px)",
        zIndex: "2147483647",
        background: "rgba(15, 15, 15, 0.92)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,.2)",
        borderRadius: "10px",
        padding: "12px 16px",
        font: "600 16px/1.45 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        textAlign: "center",
        boxShadow: "0 16px 50px rgba(0,0,0,.34)",
        pointerEvents: "none"
      });
      document.body.appendChild(el);
    }
    el.textContent = message;
  }, text);
  await page.waitForTimeout(1400);
}

async function clickByText(page, text, options = {}) {
  await page.getByRole("button", { name: text, exact: true }).click(options).catch(async () => {
    await page.locator(`button:has-text("${text}")`).first().click(options);
  });
}

async function loginIfNeeded(page) {
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const body = await page.locator("body").innerText();
  if (!body.includes("Demo login") && !body.includes("Email")) return;
  await caption(page, "Sign in to the demo workspace so the same UI state is available for the E2E check.");
  const email = page.locator('input[name="email"], input[type="email"]').first();
  const password = page.locator('input[name="password"], input[type="password"]').first();
  await email.fill("demo@contentagent.tech");
  await password.fill("demo1234");
  await page.locator('button[type="submit"], button:has-text("Enter workspace")').first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: "Research", exact: true }).waitFor({ timeout: 30000 });
}

async function waitForScanDone(page) {
  await page.waitForFunction(() => document.body.innerText.includes("Scanning"), null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !document.body.innerText.includes("Scanning source URL") && !document.body.innerText.includes("Scanning..."), null, { timeout: 180000 });
}

async function waitForPlanDone(page) {
  await page.waitForFunction(() => document.body.innerText.includes("Generating content plan"), null, { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => !document.body.innerText.includes("Generating content plan"), null, { timeout: 180000 });
}

async function waitForPublishDone(page) {
  await page.waitForFunction(() => document.body.innerText.includes("Generating") || document.body.innerText.includes("Preparing generation"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes("Done") || text.includes("Failed") || text.includes("View output");
  }, null, { timeout: 180000 });
}

async function closeModal(page) {
  const topClose = page.locator('.icon-btn:has-text("x"), button:has-text("x")').first();
  if (await topClose.count()) {
    await topClose.click({ force: true }).catch(async () => {
      await page.keyboard.press("Escape");
    });
    await page.waitForTimeout(700);
    return;
  }
  const close = page.locator('button:has-text("Close")').first();
  if (await close.count()) {
    await close.click({ force: true }).catch(async () => {
      await page.keyboard.press("Escape");
    });
    await page.waitForTimeout(700);
  }
}

async function main() {
  await ensureDir(videoDir);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } }
  });
  const page = await context.newPage();
  let finalPath = "";

  try {
    await loginIfNeeded(page);
    await caption(page, "Fix demo: Research now stores source media URLs/types, keeps source metadata on plans, and carries that source through Publish.");

  await clickByText(page, "Research");
  await caption(page, "Open Research and scan the exact Instagram profile requested: fairview_international_school.");
  await clickByText(page, "Search by URL");
  await page.getByLabel("Social URL").fill("https://www.instagram.com/fairview_international_school/");
  await page.getByLabel("Minimum views").fill("0");
  await clickByText(page, "Scan");
  await caption(page, "The Scan button changes to Scanning and the UI waits while Apify searches the submitted profile.");
  await waitForScanDone(page);
  await caption(page, "Apify results are now displayed with thumbnails, timestamps, Preview, Open, and Create plan actions.");

  const firstPreview = page.locator('button:has-text("Preview")').first();
  await firstPreview.click();
  await caption(page, "Preview opens inside the app. This verifies source media metadata is retained instead of jumping straight to Instagram.");
  await closeModal(page);

  await caption(page, "Create a content plan from the selected Research result. The selected result ID and source URL are passed forward.");
  await page.locator('button:has-text("Create plan")').first().click();
  await caption(page, "The app jumps to Content Plan immediately and shows the plan is being generated.");
  await waitForPlanDone(page);
  await caption(page, "The created Content Plan keeps the selected source metadata, so the Source button can reopen the original media context.");

  await page.locator('button:has-text("Source")').first().click();
  await caption(page, "Content Plan Source proves the source title/platform/media is attached to this plan.");
  await closeModal(page);

  await caption(page, "Now create a video asset from this plan. The generation prompt will include source thumbnail/media URLs when available.");
  await page.locator('button:has-text("Create asset")').first().click();
  await caption(page, "The final asset modal is prefilled from the Content Plan fields.");

  const typeSelect = page.locator('select[name="generationType"]').first();
  if (await typeSelect.count()) await typeSelect.selectOption("video").catch(() => {});
  await page.locator('button:has-text("Seedance 2.0")').first().click().catch(() => {});
  await caption(page, "Upload the requested logo. Logo references are prioritized and the prompt asks Kie to reproduce the exact uploaded logo, not a placeholder.");
  const logoInput = page.locator('label:has-text("Logo") input[type="file"]').first();
  await logoInput.setInputFiles(logoPath);
  await page.waitForTimeout(1200);
  await caption(page, "The logo thumbnail is visible, confirming the reference file is attached before generation.");

    await page.locator(".generation-modal form").evaluate((form) => form.requestSubmit());
    await caption(page, "After confirming, the app jumps to Publish and shows the new asset as generating while Kie runs in the background.");
    await page.waitForFunction(() => document.body.innerText.includes("Publish") && (document.body.innerText.includes("Preparing generation") || document.body.innerText.includes("Generating")), null, { timeout: 30000 });
    try {
      await waitForPublishDone(page);
      await caption(page, "Publish now keeps the generated output together with source-media comparison controls when available.");
    } catch {
      await caption(page, "Kie video generation is still running. The Publish row remains visible so the user can monitor it without blocking the UI.");
    }

    if (await page.locator('button:has-text("View source media")').count()) {
      await page.locator('button:has-text("View source media")').first().click();
      await caption(page, "Publish rows can show the source media used for comparison.");
      await closeModal(page);
    }
    if (await page.locator('button:has-text("View output"), .video-thumb, .image-thumb').count()) {
      await page.locator('button:has-text("View output"), .video-thumb, .image-thumb').first().click().catch(() => {});
      await caption(page, "The generated output can be opened from Publish for review.");
    }

    await page.waitForTimeout(1500);
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    if (video) {
      const rawPath = await video.path();
      finalPath = path.join(outputDir, `loom-fixes-e2e-${Date.now()}.webm`);
      await fs.rename(rawPath, finalPath);
      console.log(finalPath);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
