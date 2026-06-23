import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "public", "tutorials");
const rawDir = path.join(outputDir, "raw-persona-video");
const finalVideo = path.join(outputDir, "persona-webgui-tutorial.webm");

await fs.mkdir(rawDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  recordVideo: { dir: rawDir, size: { width: 1280, height: 900 } }
});
const page = await context.newPage();

async function wait(ms) {
  await page.waitForTimeout(ms);
}

async function clearCallouts() {
  await page.evaluate(() => document.querySelectorAll(".tutorial-callout").forEach((el) => el.remove()));
}

async function calloutForText(text, label, options = {}) {
  await clearCallouts();
  await page.evaluate(({ text, label, options }) => {
    const candidates = Array.from(document.querySelectorAll("button, input, textarea, [class], h1, h2, h3, p, label, div"));
    const target = candidates.find((el) => el.textContent?.trim().includes(text) || el.getAttribute("name") === text);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const box = document.createElement("div");
    box.className = "tutorial-callout";
    box.style.cssText = [
      "position:fixed",
      `left:${Math.max(4, rect.left - 6)}px`,
      `top:${Math.max(4, rect.top - 6)}px`,
      `width:${Math.min(window.innerWidth - rect.left - 8, rect.width + 12)}px`,
      `height:${Math.min(window.innerHeight - rect.top - 8, rect.height + 12)}px`,
      "border:5px solid #e11d48",
      "border-radius:10px",
      "z-index:9999",
      "pointer-events:none",
      "box-shadow:0 0 0 9999px rgba(0,0,0,.12)"
    ].join(";");
    const tag = document.createElement("div");
    tag.className = "tutorial-callout";
    const tagLeft = options.labelLeft ?? Math.min(window.innerWidth - 520, Math.max(230, rect.right + 18));
    const tagTop = options.labelTop ?? Math.max(18, Math.min(window.innerHeight - 80, rect.top));
    tag.textContent = label;
    tag.style.cssText = [
      "position:fixed",
      `left:${tagLeft}px`,
      `top:${tagTop}px`,
      "max-width:470px",
      "background:#e11d48",
      "color:#fff",
      "padding:12px 16px",
      "border-radius:8px",
      "font:700 18px Arial, sans-serif",
      "line-height:1.35",
      "z-index:10000",
      "pointer-events:none"
    ].join(";");
    const arrow = document.createElement("div");
    arrow.className = "tutorial-callout";
    arrow.textContent = options.arrow || "←";
    arrow.style.cssText = [
      "position:fixed",
      `left:${Math.max(8, tagLeft - 34)}px`,
      `top:${tagTop + 3}px`,
      "color:#e11d48",
      "font:900 42px Arial, sans-serif",
      "z-index:10000",
      "pointer-events:none"
    ].join(";");
    document.body.append(box, tag, arrow);
  }, { text, label, options });
}

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await wait(1200);

const enterWorkspace = page.getByRole("button", { name: "Enter workspace" });
if (await enterWorkspace.isVisible().catch(() => false)) {
  await enterWorkspace.click();
  await wait(1800);
}

await calloutForText("Persona", "Step 1: Click Persona in the left sidebar.");
await wait(2200);
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const personaButton = buttons.find((button) => button.textContent?.trim() === "Persona");
  personaButton?.click();
});
await wait(1200);

await calloutForText("Persona setup", "Step 2: This is the Persona page. The saved profile appears here.", { labelLeft: 520, labelTop: 115 });
await wait(2200);

await calloutForText("Gregory Charles", "Step 3: The auto-filled persona is saved as Gregory Charles.");
await wait(2200);

await calloutForText("Strategic Product Leader, Technologist", "Step 4: The test filled role, company, audience, tone, and topic fields.");
await wait(2200);

await page.mouse.wheel(0, 560);
await wait(900);
await calloutForText("LinkedIn", "Step 5: Source URLs are stored here. The test used LinkedIn and Facebook.");
await wait(2600);

await page.mouse.wheel(0, -900);
await wait(900);
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const profileButton = buttons.find((button) => button.textContent?.includes("Sean Tan") && button.textContent?.includes("owner"));
  profileButton?.click();
});
await wait(700);
await calloutForText("Persona", "Alternative route: click Sean Tan at bottom-left, then choose Persona.", { labelLeft: 515, labelTop: 690 });
await wait(2600);

await clearCallouts();
await wait(800);

const video = page.video();
await context.close();
await browser.close();

const rawPath = await video.path();
await fs.copyFile(rawPath, finalVideo);
console.log(finalVideo);
