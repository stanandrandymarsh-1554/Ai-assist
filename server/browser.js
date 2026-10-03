// Drives a real Chrome (or Edge) on the user's computer: a persistent profile,
// up to two tabs at once, a minimum gap between page loads, and a pause for the
// user when a site shows a "confirm you're human" check.

import os from "os";
import path from "path";
import { appendFileSync, readFileSync } from "fs";
import { chromium } from "playwright-core";

const HEADLESS = process.env.SHOPPER_HEADLESS === "true";
const PROFILE = process.env.SHOPPER_PROFILE_DIR || path.join(os.homedir(), ".bulk-shopper", "browser-profile");
const MIN_GAP_MS = Number(process.env.SHOPPER_MIN_GAP_MS ?? 800);
const TABS = 2;
const CHALLENGE_WAIT_MS = Number(process.env.SHOPPER_CHALLENGE_WAIT_MS ?? 35000);
const READY = "li.s-item, li.s-card, .x-item-title, [data-listing-id], a[href*='/listing/'], h1";
const CHALLENGE = /pardon our interruption|captcha-delivery|please enable js and disable any ad blocker|verify you are (a )?human|checking your browser/i;
// A refusal, not a puzzle: completing a check won't clear it and retrying makes it last longer.
const REFUSED = /access is temporarily restricted|detected unusual activity from your device/i;
const COOL_DOWN_MS = 30 * 60 * 1000;
const refusedUntil = new Map();
const siteOf = (url) => (/etsy\.com/i.test(new URL(url).hostname) ? "Etsy" : "eBay");

export class Blocked extends Error {}

let contextPromise = null;
let nextSlot = 0;
const idle = [];
const waiting = [];
let open = 0;

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

function getContext() {
  if (!contextPromise) {
    contextPromise = launch().then(async (ctx) => {
      ctx.on("close", () => { contextPromise = null; idle.length = 0; open = 0; });
      if (process.env.SHOPPER_TEST_ROUTES) {
        const routes = JSON.parse(readFileSync(process.env.SHOPPER_TEST_ROUTES, "utf8"));
        await ctx.route("**/*", (r) => {
          if (process.env.SHOPPER_TEST_LOG) appendFileSync(process.env.SHOPPER_TEST_LOG, r.request().url() + "\n");
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

async function takeTab() {
  const ctx = await getContext();
  if (idle.length) return idle.pop();
  if (open < TABS) {
    open++;
    const fresh = ctx.pages().find((p) => !p.__inUse) || (await ctx.newPage());
    fresh.__inUse = true;
    return fresh;
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function giveTab(page) {
  if (page.isClosed()) { open = Math.max(0, open - 1); return; }
  const next = waiting.shift();
  if (next) next(page);
  else idle.push(page);
}

const pageMatches = (page, re) =>
  page.evaluate((src) => new RegExp(src, "i").test(document.title + " " + (document.body?.innerText || "").slice(0, 3000) + " " + document.documentElement.innerHTML.slice(0, 20000)), re.source)
    .catch(() => false);
const isChallenge = (page) => pageMatches(page, CHALLENGE);

function refused(site) {
  refusedUntil.set(site, Date.now() + COOL_DOWN_MS);
  return new Blocked(
    `${site} refused this browser ("Access is temporarily restricted"): it recognises that the window is driven by software. ` +
      `This isn't a check the user can complete, and retrying makes it last longer, so ${site} is paused in this tool for 30 minutes. ` +
      `Don't retry ${site} now; tell the user, and use the other site or let them search ${site} themselves.`,
  );
}

/** Load url in a tab, wait for it to be readable, then run extract(page). Throws Blocked on a human check. */
export async function visit(url, extract) {
  const site = siteOf(url);
  if ((refusedUntil.get(site) ?? 0) > Date.now()) {
    const mins = Math.ceil((refusedUntil.get(site) - Date.now()) / 60000);
    throw new Blocked(`${site} refused this browser a few minutes ago ("Access is temporarily restricted"), so it's paused in this tool for another ${mins} min. Don't retry it; use the other site or let the user search ${site} themselves.`);
  }
  const slot = Math.max(Date.now(), nextSlot);
  nextSlot = slot + MIN_GAP_MS;
  if (slot > Date.now()) await new Promise((r) => setTimeout(r, slot - Date.now()));

  const page = await takeTab();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector(READY, { timeout: 8000 }).catch(() => {});
    if (await pageMatches(page, REFUSED)) throw refused(site);
    if (await isChallenge(page)) {
      if (HEADLESS) throw new Blocked(`The site showed a "confirm you're human" check, which can't be done with the browser hidden. Turn off "Hide the browser window" in the extension settings and try again.`);
      await page.bringToFront().catch(() => {});
      const until = Date.now() + CHALLENGE_WAIT_MS;
      while (Date.now() < until && (await isChallenge(page))) {
        if (await pageMatches(page, REFUSED)) throw refused(site);
        await page.waitForTimeout(1500);
      }
      if (await pageMatches(page, REFUSED)) throw refused(site);
      if (await isChallenge(page)) throw new Blocked("The site is asking to confirm you're human in the Chrome window. Please complete it there, then ask again. It usually only asks once.");
      await page.waitForSelector(READY, { timeout: 8000 }).catch(() => {});
    }
    // Scroll through once so lazy-loaded cards and prices render.
    await page.evaluate(async () => {
      const step = Math.max(600, window.innerHeight);
      for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
      window.scrollTo(0, 0);
    }).catch(() => {});
    return await extract(page);
  } finally {
    giveTab(page);
  }
}

export async function closeBrowser() {
  if (contextPromise) {
    const ctx = await contextPromise.catch(() => null);
    contextPromise = null;
    await ctx?.close().catch(() => {});
  }
}
