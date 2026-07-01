import { readFileSync } from "node:fs";
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const required = ["npx authzscan", "github.com/davidldv/authzscan"];
const banned = ["82%", "91%"]; // invented mockup numbers must never ship
for (const s of required) if (!html.includes(s)) throw new Error(`missing required string: ${s}`);
for (const s of banned) if (html.includes(s)) throw new Error(`fabricated mockup number present: ${s}`);
console.log("landing check ok");