const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const baseUrl = "https://khuntest.com";
const corePages = [
  ["/", "weekly", "1.0"],
  ["/about.html", "monthly", "0.8"],
  ["/contact.html", "monthly", "0.8"],
  ["/tests.html", "weekly", "0.9"],
  ["/packages.html", "weekly", "0.8"],
  ["/home-collection.html", "weekly", "0.8"],
  ["/booking.html", "weekly", "0.7"]
];

const seoTests = JSON.parse(fs.readFileSync(path.join(root, "data", "seo-tests.json"), "utf8"));
const testPages = seoTests.map((test) => [`/tests/${test.slug}/`, "monthly", "0.75"]);
const urls = [...corePages, ...testPages];

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
  .map(([loc, changefreq, priority]) => `  <url><loc>${baseUrl}${loc}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`)
  .join("\n")}\n</urlset>\n`;

fs.writeFileSync(path.join(root, "sitemap.xml"), xml);
console.log(`Generated sitemap.xml with ${urls.length} URLs.`);
