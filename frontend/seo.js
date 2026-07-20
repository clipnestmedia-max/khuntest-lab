(function () {
  "use strict";

  const site = {
    name: "KhunTest Lab",
    legalName: "KHUNTEST LABS",
    url: "https://khuntest.com",
    logo: "https://khuntest.com/assets/khuntest-logo.png",
    phone: "+919234277007",
    displayPhone: "+91 9234277007",
    email: "khuntest@yahoo.com",
    address: {
      streetAddress: "Allalpatti, Laheriasarai",
      addressLocality: "Darbhanga",
      addressRegion: "Bihar",
      postalCode: "846001",
      addressCountry: "IN"
    },
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=KHUNTEST%20LABS%20Allalpatti%20Laheriasarai%20Darbhanga%20Bihar",
    sameAs: [
      "https://khuntest.com",
      "https://wa.me/919234277007"
    ]
  };

  const sharedKeywords = "KhunTest Lab, KHUNTEST LABS, blood test in Darbhanga, diagnostic lab in Darbhanga, pathology lab in Bihar, home sample collection Darbhanga, CBC test, thyroid test, liver function test, kidney function test";

  const pageMap = {
    "/": {
      title: "KhunTest Lab - Blood Test, Home Collection & Diagnostic Center",
      description: "Book blood tests online, download reports, and schedule home sample collection with KhunTest Lab in Darbhanga, Bihar.",
      keywords: sharedKeywords,
      type: "website",
      faq: [
        ["Can I book a blood test online with KhunTest Lab?", "Yes. Patients can book tests online for home sample collection or a centre visit."],
        ["Does KhunTest Lab provide home sample collection in Darbhanga?", "Yes. Home sample collection is available in Darbhanga service areas."],
        ["Can patients download reports online?", "Yes. Released reports can be viewed from the patient portal or report link."]
      ]
    },
    "/index.html": null,
    "/about.html": {
      title: "About KhunTest Lab - Diagnostic Lab in Darbhanga",
      description: "Learn about KhunTest Lab, a diagnostic and pathology lab in Darbhanga offering blood tests, home collection and online reports.",
      keywords: `${sharedKeywords}, about KhunTest Lab, pathology services Darbhanga`,
      type: "article"
    },
    "/contact.html": {
      title: "Contact KhunTest Lab - Diagnostic Lab in Darbhanga",
      description: "Contact KhunTest Lab in Allalpatti, Laheriasarai, Darbhanga for blood tests, home sample collection and report support.",
      keywords: `${sharedKeywords}, KhunTest Lab phone number, diagnostic lab near me, Google Maps Darbhanga`,
      type: "article"
    },
    "/tests.html": {
      title: "Blood Tests in Darbhanga - KhunTest Lab Test Catalog",
      description: "Search CBC, thyroid, liver, kidney, diabetes and wellness tests from KhunTest Lab with home collection and online booking.",
      keywords: `${sharedKeywords}, lab test list, pathology test catalog, test price Darbhanga`,
      type: "article"
    },
    "/packages.html": {
      title: "Health Checkup Packages in Darbhanga - KhunTest Lab",
      description: "Affordable health checkup packages from KhunTest Lab for routine screening, full body checkup and senior citizen health profiles.",
      keywords: `${sharedKeywords}, full body checkup Darbhanga, health package Bihar`,
      type: "article"
    },
    "/home-collection.html": {
      title: "Home Sample Collection in Darbhanga - KhunTest Lab",
      description: "Schedule doorstep sample collection in Darbhanga with KhunTest Lab and receive released reports online.",
      keywords: `${sharedKeywords}, home blood sample collection, doorstep lab test Darbhanga`,
      type: "article"
    },
    "/booking.html": {
      title: "Book Blood Test Online in Darbhanga - KhunTest Lab",
      description: "Book diagnostic tests online with KhunTest Lab for home collection or centre visit in Darbhanga.",
      keywords: `${sharedKeywords}, book blood test online, online lab booking Darbhanga`,
      type: "website"
    },
    "/patient-login.html": {
      title: "Patient Login - KhunTest Lab Report Portal",
      description: "Secure patient portal for KhunTest Lab patients to access released reports.",
      keywords: "KhunTest Lab patient login, report portal, diagnostic report download",
      robots: "noindex, nofollow",
      type: "website"
    },
    "/report.html": {
      title: "Report Download - KhunTest Lab",
      description: "Secure KhunTest Lab report viewing page for patients with a valid report link.",
      keywords: "KhunTest Lab report download, patient lab report",
      robots: "noindex, nofollow",
      type: "website"
    },
    "/bill.html": {
      title: "Bill View - KhunTest Lab",
      description: "Secure KhunTest Lab bill viewing page for patients with a valid bill link.",
      keywords: "KhunTest Lab bill, patient bill",
      robots: "noindex, nofollow",
      type: "website"
    },
    "/admin-login.html": {
      title: "Admin Login - KhunTest Lab",
      description: "Private KhunTest Lab admin login.",
      robots: "noindex, nofollow",
      type: "website"
    },
    "/admin-import-tests.html": {
      title: "Import Tests - KhunTest Lab",
      description: "Private KhunTest Lab test import page.",
      robots: "noindex, nofollow",
      type: "website"
    },
    "/admin-dashboard.html": {
      title: "Admin Dashboard - KhunTest Lab",
      description: "Private KhunTest Lab admin dashboard.",
      robots: "noindex, nofollow",
      type: "website"
    },
    "/patient-dashboard.html": {
      title: "Patient Dashboard - KhunTest Lab",
      description: "Private KhunTest Lab patient dashboard.",
      robots: "noindex, nofollow",
      type: "website"
    },
    "/forgot-password.html": {
      title: "Forgot Password - KhunTest Lab",
      description: "Private password reset support for KhunTest Lab users.",
      robots: "noindex, nofollow",
      type: "website"
    }
  };
  pageMap["/index.html"] = pageMap["/"];

  const testPages = {
    "/tests/cbc-test/": {
      title: "CBC Test in Darbhanga - Complete Blood Count | KhunTest Lab",
      description: "Book CBC test in Darbhanga with KhunTest Lab. Includes haemoglobin, WBC, RBC, platelet count and home sample collection.",
      keywords: "CBC test Darbhanga, complete blood count, haemoglobin test, platelet count, blood test in Darbhanga",
      type: "article"
    },
    "/tests/liver-function-test/": {
      title: "Liver Function Test in Darbhanga - LFT | KhunTest Lab",
      description: "Book liver function test in Darbhanga for bilirubin, SGOT, SGPT, alkaline phosphatase and protein profile.",
      keywords: "LFT test Darbhanga, liver function test, SGPT, SGOT, bilirubin test",
      type: "article"
    },
    "/tests/kidney-function-test/": {
      title: "Kidney Function Test in Darbhanga - KFT | KhunTest Lab",
      description: "Book kidney function test in Darbhanga for urea, creatinine, uric acid and electrolytes with home collection.",
      keywords: "KFT test Darbhanga, kidney function test, creatinine test, urea test",
      type: "article"
    },
    "/tests/thyroid-profile/": {
      title: "Thyroid Profile Test in Darbhanga - T3 T4 TSH | KhunTest Lab",
      description: "Book thyroid profile test in Darbhanga for T3, T4 and TSH with KhunTest Lab.",
      keywords: "thyroid test Darbhanga, T3 T4 TSH, thyroid profile, TSH test",
      type: "article"
    }
  };

  const normalizedPath = window.location.pathname.endsWith("/index.html")
    ? window.location.pathname.replace(/index\.html$/, "")
    : window.location.pathname;
  const meta = testPages[normalizedPath] || pageMap[window.location.pathname] || pageMap[normalizedPath] || pageMap["/"];
  const canonicalUrl = `${site.url}${normalizedPath === "/" ? "/" : normalizedPath}`;

  function upsertMeta(selector, attrs) {
    let tag = document.head.querySelector(selector);
    if (!tag) {
      tag = document.createElement("meta");
      document.head.appendChild(tag);
    }
    Object.entries(attrs).forEach(([key, value]) => tag.setAttribute(key, value));
  }

  function upsertLink(rel, href) {
    let tag = document.head.querySelector(`link[rel="${rel}"]`);
    if (!tag) {
      tag = document.createElement("link");
      tag.setAttribute("rel", rel);
      document.head.appendChild(tag);
    }
    tag.setAttribute("href", href);
  }

  document.title = meta.title;
  upsertMeta('meta[name="description"]', { name: "description", content: meta.description });
  upsertMeta('meta[name="keywords"]', { name: "keywords", content: meta.keywords || sharedKeywords });
  upsertMeta('meta[name="robots"]', { name: "robots", content: meta.robots || "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" });
  upsertMeta('meta[name="author"]', { name: "author", content: site.legalName });
  upsertMeta('meta[name="theme-color"]', { name: "theme-color", content: "#062b59" });
  const googleVerification = window.KHUNTEST_GOOGLE_SITE_VERIFICATION || document.documentElement.dataset.googleSiteVerification || "";
  if (googleVerification) upsertMeta('meta[name="google-site-verification"]', { name: "google-site-verification", content: googleVerification });
  upsertLink("canonical", canonicalUrl);
  upsertLink("preload", "/assets/khuntest-logo.png");
  const preload = document.head.querySelector('link[rel="preload"][href="/assets/khuntest-logo.png"]');
  if (preload) {
    preload.setAttribute("as", "image");
    preload.setAttribute("fetchpriority", "high");
  }

  upsertMeta('meta[property="og:title"]', { property: "og:title", content: meta.title });
  upsertMeta('meta[property="og:description"]', { property: "og:description", content: meta.description });
  upsertMeta('meta[property="og:type"]', { property: "og:type", content: meta.type || "website" });
  upsertMeta('meta[property="og:url"]', { property: "og:url", content: canonicalUrl });
  upsertMeta('meta[property="og:site_name"]', { property: "og:site_name", content: site.name });
  upsertMeta('meta[property="og:image"]', { property: "og:image", content: site.logo });
  upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: meta.title });
  upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: meta.description });
  upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: site.logo });

  const businessSchema = {
    "@context": "https://schema.org",
    "@type": ["MedicalBusiness", "DiagnosticLab", "LocalBusiness"],
    "@id": `${site.url}/#diagnostic-lab`,
    "name": site.legalName,
    "alternateName": site.name,
    "url": site.url,
    "logo": site.logo,
    "image": site.logo,
    "telephone": site.phone,
    "email": site.email,
    "priceRange": "₹₹",
    "medicalSpecialty": ["Pathology", "Diagnostic Laboratory", "Blood Testing"],
    "address": {
      "@type": "PostalAddress",
      ...site.address
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": 26.136641,
      "longitude": 85.907174
    },
    "openingHoursSpecification": [{
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      "opens": "07:00",
      "closes": "20:00"
    }],
    "hasMap": site.mapsUrl,
    "sameAs": site.sameAs
  };

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${site.url}/#website`,
    "url": site.url,
    "name": site.name,
    "publisher": { "@id": `${site.url}/#organization` },
    "potentialAction": {
      "@type": "SearchAction",
      "target": `${site.url}/tests.html?q={search_term_string}`,
      "query-input": "required name=search_term_string"
    }
  };

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${site.url}/#organization`,
    "name": site.legalName,
    "url": site.url,
    "logo": site.logo,
    "contactPoint": [{
      "@type": "ContactPoint",
      "telephone": site.phone,
      "contactType": "customer support",
      "areaServed": "IN",
      "availableLanguage": ["English", "Hindi"]
    }],
    "sameAs": site.sameAs
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": `${site.url}/` },
      { "@type": "ListItem", "position": 2, "name": document.querySelector("h1")?.textContent || site.name, "item": canonicalUrl }
    ]
  };

  const schemas = [businessSchema, websiteSchema, organizationSchema, breadcrumbSchema];
  if (meta.faq) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": meta.faq.map(([question, answer]) => ({
        "@type": "Question",
        "name": question,
        "acceptedAnswer": { "@type": "Answer", "text": answer }
      }))
    });
  }

  if (normalizedPath.startsWith("/tests/") && normalizedPath !== "/tests/") {
    const pageHeading = document.querySelector("h1")?.textContent || meta.title;
    schemas.push({
      "@context": "https://schema.org",
      "@type": "MedicalTest",
      "name": pageHeading,
      "url": canonicalUrl,
      "description": meta.description,
      "recognizingAuthority": { "@id": `${site.url}/#diagnostic-lab` }
    });
  }

  const schemaTag = document.createElement("script");
  schemaTag.type = "application/ld+json";
  schemaTag.text = JSON.stringify(schemas);
  document.head.appendChild(schemaTag);
}());
