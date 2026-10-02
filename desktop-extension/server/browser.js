// Opens pages in a real Chrome (or Edge) window on the user's computer and reads them
// with the same extractor as the "Copy for Claude" bookmarklet.

import os from "os";
import path from "path";
import { readFileSync } from "fs";
import { chromium } from "playwright-core";
import { EXTRACTOR } from "./extract-source.js";

const HEADLESS = process.env.SHOPPER_HEADLESS === "true";
const PROFILE = process.env.SHOPPER_PROFILE_DIR || path.join(os.homedir(), ".ebay-etsy-shopper", "browser-profile");
const MIN_GAP_MS = Number(process.env.SHOPPER_MIN_GAP_MS ?? 1500); // stay at a human pace
const MAX_TEXT = 24000;
const READY = "li.s-item, li.s-card, .x-item-title, [data-listing-id], a[href*='/listing/'], h1";
const CHALLENGE = /pardon our interruption|captcha-delivery|please enable js and disable any ad blocker|verify you are (a )?human|checking your browser/i;

let contextPromise = null;
let lastNav = 0;
let queue = Promise.resolve();

/** Run browser jobs one at a time. */
export function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function launch() {
  const opts = { headless: HEADLESS, viewport: null, args: ["--window-size=1200,950"] };
  if (process.env.SHOPPER_BROWSER_PATH) {
    return chromium.launchPersistentContext(PROFILE, { ...opts, executablePath: process.env.SHOPPER_BROWSER_PATH });
  }
  let lastErr;
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launchPersistentContext(PROFILE, { ...opts, channel });
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    "Couldn't start Google Chrome or Microsoft Edge on this computer. Install Google Chrome " +
      "(https://www.google.com/chrome/) and try again. Details: " + String(lastErr?.message || lastErr).split("\n")[0],
  );
}

async function getContext() {
  if (!contextPromise) {
    contextPromise = launch().then(async (ctx) => {
      ctx.on("close", () => { contextPromise = null; }); // user closed the window: relaunch next time
      if (process.env.SHOPPER_TEST_ROUTES) {
        const routes = JSON.parse(readFileSync(process.env.SHOPPER_TEST_ROUTES, "utf8"));
        await ctx.route("**/*", (r) => {
          const hit = routes[r.request().url()];
          if (hit == null) return r.fulfill({ status: 204, body: "" });
          const { body, headers = {} } = typeof hit === "string" ? { body: hit } : hit;
          return r.fulfill({ contentType: "text/html; charset=utf-8", headers, body });
        });
      }
      return ctx;
    });
    contextPromise.catch(() => { contextPromise = null; });
  }
  return contextPromise;
}

async function getPage() {
  const ctx = await getContext();
  return ctx.pages()[0] || ctx.newPage();
}

const isChallenge = (page) =>
  page.evaluate((re) => new RegExp(re, "i").test(document.title + " " + (document.body?.innerText || "").slice(0, 3000) + " " + document.documentElement.innerHTML.slice(0, 20000)), CHALLENGE.source)
    .catch(() => false);

/** Open url and return the extracted page text, or an explanation if it couldn't be read. */
export async function readPage(url) {
  const wait = lastNav + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNav = Date.now();

  const page = await getPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector(READY, { timeout: 8000 }).catch(() => {});

  if (await isChallenge(page)) {
    if (HEADLESS) {
      return `The site showed a "confirm you're human" check, which can't be completed with the browser hidden. ` +
        `Turn off "Hide the browser window" in this extension's settings, then try again.\nPage: ${url}`;
    }
    await page.bringToFront().catch(() => {});
    // Give the user time to complete the check, but stay well inside the tool-call time limit.
    const until = Date.now() + Number(process.env.SHOPPER_CHALLENGE_WAIT_MS ?? 35000);
    while (Date.now() < until && (await isChallenge(page))) await page.waitForTimeout(2000);
    if (await isChallenge(page)) {
      return `The site is asking to confirm you're human in the browser window that opened. ` +
        `Please complete it there, then ask again. It usually only asks once.\nPage: ${url}`;
    }
    await page.waitForSelector(READY, { timeout: 8000 }).catch(() => {});
  }

  // Scroll once through the page so lazy-loaded cards render.
  await page.evaluate(async () => {
    for (let i = 0; i < 8; i++) { window.scrollBy(0, window.innerHeight); await new Promise((r) => setTimeout(r, 200)); }
    window.scrollTo(0, 0);
  }).catch(() => {});

  // A string expression runs through the devtools protocol, so the site's script rules don't block it.
  const text = await page.evaluate(`window.__c4cSilent = true;\n${EXTRACTOR}\n;window.__copyForClaude`);
  if (!text) return `Opened the page but couldn't read any text from it.\nPage: ${url}`;
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "\n…(trimmed)" : text;
}

export async function closeBrowser() {
  if (contextPromise) {
    const ctx = await contextPromise.catch(() => null);
    contextPromise = null;
    await ctx?.close().catch(() => {});
  }
}
