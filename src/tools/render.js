import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const baseCssPath = path.join(repoRoot, 'design', 'base.css');

function getOutputDir() {
  const dateStr = new Date().toISOString().slice(0, 10);
  return path.join(repoRoot, 'workdir', 'media', dateStr);
}

function injectCss(html, css) {
  const styleTag = `<style>\n${css}\n</style>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${styleTag}\n</head>`);
  }
  if (html.includes('<body')) {
    return styleTag + '\n' + html;
  }
  return styleTag + '\n' + html;
}

export async function renderHtmlToPng(html, filename, outputDir) {
  const dir = outputDir ?? getOutputDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const outPath = path.join(dir, filename.endsWith('.png') ? filename : `${filename}.png`);

  let baseCss = '';
  if (existsSync(baseCssPath)) {
    baseCss = readFileSync(baseCssPath, 'utf8');
  }

  const isSquare = /<body[^>]*data-square="true"/.test(html);
  const width = isSquare ? 1080 : 1200;
  const height = isSquare ? 1080 : 675;

  // Inject base.css then enforce overflow containment so nothing clips at the card edge
  const withBase = baseCss ? injectCss(html, baseCss) : html;
  const overflowCss = `html,body{overflow:hidden!important;max-width:${width}px!important;}`;
  const finalHtml = injectCss(withBase, overflowCss);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width, height });
    await page.setContent(finalHtml, { waitUntil: 'networkidle' });
    await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width, height } });
  } finally {
    await browser.close();
  }

  return outPath;
}
