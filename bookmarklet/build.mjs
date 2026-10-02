// Minifies the bookmarklet and writes it into the install page.
import { readFileSync, writeFileSync } from "fs";
import { minify } from "terser";

const here = (f) => new URL(f, import.meta.url);
const src = readFileSync(here("copy-for-claude.js"), "utf8");
const { code } = await minify(src, { compress: true, mangle: true, format: { comments: false } });
writeFileSync(here("copy-for-claude.min.js"), code + "\n");
const href = "javascript:" + encodeURIComponent(code);
const page = readFileSync(here("install.template.html"), "utf8")
  .replace("__BOOKMARKLET_JSON__", JSON.stringify(href).replace(/</g, "\\u003c"));
writeFileSync(here("install.html"), page);
console.log(`built install.html (bookmarklet ${href.length} chars)`);
