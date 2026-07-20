const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const testsDir = path.join(root, "tests");
const tests = JSON.parse(fs.readFileSync(path.join(root, "data", "tests.json"), "utf8"));
const baseUrl = "https://khuntest.com";
const lab = {
  name: "KHUNTEST LABS",
  url: baseUrl,
  logo: `${baseUrl}/assets/khuntest-logo.png`,
  phone: "+919234277007",
  email: "khuntest@yahoo.com",
  address: "Allalpatti, Laheriasarai, Darbhanga, Bihar"
};

const preferredSlugs = new Map([
  ["KT0157", "cbc-test"],
  ["KT0407", "liver-function-test"],
  ["KT0392", "kidney-function-test"],
  ["KT0592", "thyroid-profile"]
]);

function html(value) {
  return String(value ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

function slugify(value) {
  return String(value || "test")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "test";
}

function uniqueSlug(test, used) {
  const preferred = preferredSlugs.get(test.testCode);
  const base = preferred || test.slug || `${String(test.testCode || "").toLowerCase()}-${slugify(test.name)}`;
  let slug = slugify(base);
  if (!slug || used.has(slug)) slug = `${String(test.testCode || "").toLowerCase()}-${slugify(test.name)}`;
  let finalSlug = slug;
  let counter = 2;
  while (used.has(finalSlug)) {
    finalSlug = `${slug}-${counter}`;
    counter += 1;
  }
  used.add(finalSlug);
  return finalSlug;
}

function parameterNames(test) {
  return Array.isArray(test.parameters)
    ? test.parameters.map((p) => String(p.name || "").trim()).filter(Boolean)
    : [];
}

function pageDescription(test, parameterCount) {
  const name = test.name || "Lab Test";
  const code = test.testCode ? ` (${test.testCode})` : "";
  const category = test.category ? ` ${test.category}` : "";
  const price = Number(test.price) > 0 ? ` Price: ₹${Number(test.price).toLocaleString("en-IN")}.` : "";
  return `${name}${code}${category} test at KhunTest Lab Darbhanga with ${parameterCount || "available"} parameter${parameterCount === 1 ? "" : "s"} and online booking support.${price}`;
}

function safePreparation(test) {
  return test.preparation || test.instructions || "Preparation instructions are not configured in the verified catalog. Please confirm with KhunTest Lab or your doctor before sample collection.";
}

function safeSample(test) {
  return test.sample || "Sample type is not configured in the verified catalog and should be reviewed by admin.";
}

function needsReview(test) {
  return Boolean(test.needsParameterReview || !test.sample || !test.preparation);
}

function schemaFor(test, slug, description, faqs) {
  const url = `${baseUrl}/tests/${slug}/`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": `${baseUrl}/` },
        { "@type": "ListItem", "position": 2, "name": "All Tests", "item": `${baseUrl}/tests.html` },
        { "@type": "ListItem", "position": 3, "name": test.name, "item": url }
      ]
    },
    {
      "@context": "https://schema.org",
      "@type": "MedicalBusiness",
      "@id": `${baseUrl}/#diagnostic-lab`,
      "name": lab.name,
      "url": lab.url,
      "logo": lab.logo,
      "telephone": lab.phone,
      "email": lab.email,
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Allalpatti, Laheriasarai",
        "addressLocality": "Darbhanga",
        "addressRegion": "Bihar",
        "addressCountry": "IN"
      }
    },
    {
      "@context": "https://schema.org",
      "@type": "MedicalTest",
      "name": test.name,
      "url": url,
      "description": description,
      "code": test.testCode || "",
      "recognizingAuthority": { "@id": `${baseUrl}/#diagnostic-lab` }
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqs.map(([question, answer]) => ({
        "@type": "Question",
        "name": question,
        "acceptedAnswer": { "@type": "Answer", "text": answer }
      }))
    }
  ];
}

function renderPage(test, slug, related) {
  const params = parameterNames(test);
  const description = pageDescription(test, params.length);
  const title = `${test.name}${test.testCode ? ` ${test.testCode}` : ""} in Darbhanga | KhunTest Lab`;
  const canonical = `${baseUrl}/tests/${slug}/`;
  const sample = safeSample(test);
  const preparation = safePreparation(test);
  const price = Number(test.price) > 0 ? `₹${Number(test.price).toLocaleString("en-IN")}` : "Price is not configured in the verified catalog. Please contact the lab.";
  const review = needsReview(test);
  const faq = [
    [`Can I book ${test.name} online?`, `Yes. You can book ${test.name} from KhunTest Lab online or contact the lab for assistance.`],
    [`Is home sample collection available for ${test.name}?`, "Per-test home collection availability is not configured in the verified catalog. Please contact KhunTest Lab to confirm before booking."],
    [`What preparation is needed for ${test.name}?`, preparation]
  ];
  const paramsHtml = params.length
    ? params.slice(0, 80).map((name) => `<li>${html(name)}</li>`).join("")
    : "<li>Included parameters are not configured in the verified catalog and should be reviewed by admin.</li>";
  const relatedHtml = related.map((item) => `<a class="btn btn-outline btn-small" href="../${html(item.slug)}/">${html(item.name)}</a>`).join("");
  const jsonData = {
    testCode: test.testCode || "",
    name: test.name || "",
    slug,
    category: test.category || "",
    price: Number(test.price) > 0 ? Number(test.price) : null,
    sample: test.sample || "",
    reportTime: test.reportTime || "",
    homeCollection: null,
    needsAdminReview: review,
    parameters: params
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${html(title)}</title>
  <meta name="description" content="${html(description)}">
  <meta name="keywords" content="${html([test.name, test.testCode, test.category, ...(test.searchKeywords || [])].filter(Boolean).join(", "))}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${html(title)}">
  <meta property="og:description" content="${html(description)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${lab.logo}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${html(title)}">
  <meta name="twitter:description" content="${html(description)}">
  <link rel="stylesheet" href="../../styles.css">
  <style>.test-detail-list{padding-left:20px}.test-detail-list li{margin:5px 0}.breadcrumb{font-size:14px;color:#64748b;margin-bottom:12px}.review-note{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:12px;margin-top:12px}.detail-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}</style>
  <script type="application/ld+json">${JSON.stringify(schemaFor(test, slug, description, faq))}</script>
</head>
<body>
  <div class="topbar"><div class="container"><div>Allalpatti, Laheriasarai, Darbhanga, Bihar | Home Sample Collection Available</div><div>+91 9234277007 | khuntest@yahoo.com</div></div></div>
  <nav class="nav"><div class="container nav-inner"><a class="brand" href="../../index.html"><img src="../../assets/khuntest-logo.png" alt="KhunTest Lab diagnostic center logo"><span>KHUNTEST LABS</span></a><input class="nav-toggle" id="navToggle" type="checkbox"><label class="nav-toggle-label" for="navToggle">☰</label><div class="menu"><a href="../../index.html">Home</a><a href="../../about.html">About</a><a href="../../tests.html">All Tests</a><a href="../../packages.html">Packages</a><a href="../../home-collection.html">Home Collection</a><a href="../../contact.html">Contact</a><a href="../../patient-login.html">Patient</a></div><a class="btn btn-red" href="../../booking.html?test=${encodeURIComponent(test.testCode || test.name)}">Book Now</a></div></nav>
  <main>
    <section class="page-hero"><div class="container"><div class="breadcrumb"><a href="../../index.html">Home</a> / <a href="../../tests.html">All Tests</a> / ${html(test.name)}</div><h1>${html(test.name)} in Darbhanga</h1><p>${html(description)}</p></div></section>
    <section class="section"><div class="container grid grid-2"><article class="card"><h2>Test Overview</h2><p>${html(test.name)} is listed in the verified KhunTest Lab test catalog${test.category ? ` under ${html(test.category)}` : ""}. This page uses catalog information stored in the project and avoids unverified medical claims.</p><h2>Why the Test is Performed</h2><p>This laboratory test may be ordered by a clinician for screening, diagnosis support, monitoring, or routine health evaluation depending on the patient history and symptoms.</p><h2>Included Parameters</h2><ul class="test-detail-list">${paramsHtml}</ul>${review ? `<div class="review-note">Some content for this test requires admin review because sample, preparation, or parameter details are missing or flagged in the verified catalog.</div>` : ""}</article><aside class="card"><h2>Booking Details</h2><p><b>Test code:</b> ${html(test.testCode || "Not configured")}</p><p><b>Category:</b> ${html(test.category || "Not configured")}</p><p><b>Sample type:</b> ${html(sample)}</p><p><b>Preparation:</b> ${html(preparation)}</p><p><b>Price:</b> ${html(price)}</p><p><b>Report time:</b> ${html(test.reportTime || "Report time is not configured in the verified catalog.")}</p><p><b>Home collection:</b> Per-test availability is not configured in the verified catalog. Contact KhunTest Lab to confirm.</p><div class="detail-actions"><a class="btn btn-red" href="../../booking.html?test=${encodeURIComponent(test.testCode || test.name)}">Book This Test</a><a class="btn btn-outline" href="../../tests.html">Back to All Tests</a></div></aside></div></section>
    <section class="section white seo-faq"><div class="container"><h2>${html(test.name)} FAQ</h2>${faq.map(([q, a]) => `<details><summary>${html(q)}</summary><p>${html(a)}</p></details>`).join("")}<h2>Related Tests</h2><div class="seo-links">${relatedHtml || `<a class="btn btn-outline btn-small" href="../../tests.html">View All Tests</a>`}</div></div></section>
  </main>
  <footer class="footer"><div class="container footer-grid"><div><h3>KHUNTEST LABS</h3><p>Blood tests, home sample collection and online reports in Darbhanga.</p></div><div><h4>Public Website</h4><a href="../../about.html">About Us</a><a href="../../tests.html">All Tests</a><a href="../../packages.html">Health Packages</a><a href="../../home-collection.html">Home Collection</a></div><div><h4>Contact</h4><p>+91 9234277007</p><p>khuntest@yahoo.com</p><p>${lab.address}</p></div></div></footer>
  <script type="application/json" id="test-data">${JSON.stringify(jsonData)}</script>
</body>
</html>
`;
}

function removeGeneratedPages() {
  fs.mkdirSync(testsDir, { recursive: true });
  for (const entry of fs.readdirSync(testsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) fs.rmSync(path.join(testsDir, entry.name), { recursive: true, force: true });
  }
}

const activeTests = tests.filter((test) => test.isActive !== false && String(test.name || "").trim());
const used = new Set();
const pages = activeTests.map((test) => ({ test, slug: uniqueSlug(test, used) }));
const byCategory = new Map();
pages.forEach((page) => {
  const key = page.test.category || "Other";
  if (!byCategory.has(key)) byCategory.set(key, []);
  byCategory.get(key).push(page);
});

removeGeneratedPages();
const slugMap = {};
const reviewList = [];
for (const page of pages) {
  const related = (byCategory.get(page.test.category || "Other") || [])
    .filter((item) => item.slug !== page.slug)
    .slice(0, 5)
    .map((item) => ({ slug: item.slug, name: item.test.name }));
  const dir = path.join(testsDir, page.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), renderPage(page.test, page.slug, related));
  const key = page.test.testCode || page.test.id || page.test.slug || page.test.name;
  slugMap[key] = {
    slug: page.slug,
    name: page.test.name || "",
    testCode: page.test.testCode || "",
    sourceSlug: page.test.slug || "",
    needsAdminReview: needsReview(page.test)
  };
  if (needsReview(page.test)) reviewList.push({ testCode: page.test.testCode || "", name: page.test.name || "", slug: page.slug });
}

fs.writeFileSync(path.join(root, "data", "test-slug-map.json"), `${JSON.stringify(slugMap, null, 2)}\n`);
fs.writeFileSync(path.join(root, "data", "seo-review-required.json"), `${JSON.stringify(reviewList, null, 2)}\n`);
console.log(`Generated ${pages.length} SEO test pages.`);
console.log(`Review required: ${reviewList.length}.`);
