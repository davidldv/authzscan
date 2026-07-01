import { readFileSync } from "node:fs";
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const required = ["npx authzscan", "github.com/davidldv/authzscan"];
const banned = ["82%", "91%"]; // invented mockup numbers must never ship
for (const s of required) if (!html.includes(s)) throw new Error(`missing required string: ${s}`);
for (const s of banned) if (html.includes(s)) throw new Error(`fabricated mockup number present: ${s}`);
// Both metric slots must stay unfilled until a real eval runs (Task 4 replaces this check).
const slots = (html.match(/pending eval/g) || []).length;
if (slots !== 2) throw new Error(`expected 2 unfilled "pending eval" metric slots, found ${slots}`);
console.log("landing check ok");
