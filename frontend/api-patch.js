// KHUNTEST LABS API Patch - Clean Final Add Test Fix

let KT_API_TESTS = [];

async function loadLabApiTests() {
  try {
    const res = await fetch("/api/tests");
    const tests = await res.json();

    KT_API_TESTS = tests.map(t => ({
      id: t.id || t.test_code || t.testCode,
      name: t.name || t.test_name || t.testName,
      price: Number(t.price || t.price_inr || 0),
      category: t.category || "LAB TEST",
      report_time: t.report_time || "",
      parameters: t.parameters || []
    }));

    localStorage.setItem("kt_tests", JSON.stringify(KT_API_TESTS));

    setupPatientEntryTestBox();
    renderPatientEntryTests();
    renderTestsPage();

  } catch (err) {
    console.error("API tests load error:", err);
  }
}

function getPatientTests() {
  return JSON.parse(localStorage.getItem("kt_patient_tests_api") || "[]");
}

function setPatientTests(tests) {
  localStorage.setItem("kt_patient_tests_api", JSON.stringify(tests));
}

function setupPatientEntryTestBox() {
  const testBox = document.querySelector('#patientEntryForm input[placeholder*="Search Test"]') ||
                  document.querySelector('#patientEntryForm input[list]');

  if (!testBox) return;

  testBox.setAttribute("list", "khuntest-api-test-list");

  let datalist = document.getElementById("khuntest-api-test-list");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "khuntest-api-test-list";
    document.body.appendChild(datalist);
  }

  datalist.innerHTML = KT_API_TESTS.map(t =>
    `<option value="${t.name}"></option>`
  ).join("");

  testBox.oninput = function () {
    const selected = KT_API_TESTS.find(t =>
      t.name.toLowerCase() === testBox.value.trim().toLowerCase()
    );

    const rateInput = findRateInput();

    if (selected && rateInput) {
      rateInput.value = selected.price.toFixed(2);
    }
  };
}

function findTestInput() {
  return document.querySelector('#patientEntryForm input[placeholder*="Search Test"]') ||
         document.querySelector('#patientEntryForm input[list]');
}

function findRateInput() {
  return document.querySelector('#patientEntryForm input[name="testRate"]') ||
         Array.from(document.querySelectorAll('#patientEntryForm input')).find(i =>
           (i.previousElementSibling?.innerText || "").toLowerCase().includes("test_rate") ||
           (i.name || "").toLowerCase().includes("rate")
         );
}

// This overrides old inline onclick="addEntryTest()"
window.addEntryTest = function() {
  const testInput = findTestInput();

  if (!testInput) {
    alert("Test input not found.");
    return false;
  }

  const value = testInput.value.trim();

  const selected = KT_API_TESTS.find(t =>
    t.name.toLowerCase() === value.toLowerCase()
  );

  if (!selected) {
    alert("Please select valid test.");
    return false;
  }

  const tests = getPatientTests();

  tests.push({
    id: selected.id,
    name: selected.name,
    price: selected.price,
    category: selected.category,
    parameters: selected.parameters || []
  });

  setPatientTests(tests);
  renderPatientEntryTests();

  testInput.value = "";

  const rateInput = findRateInput();
  if (rateInput) rateInput.value = "0.00";

  return false;
};

window.removeApiPatientTest = function(index) {
  const tests = getPatientTests();
  tests.splice(index, 1);
  setPatientTests(tests);
  renderPatientEntryTests();
};

function renderPatientEntryTests() {
  const tests = getPatientTests();
  const body = document.getElementById("entryTestsBody");

  if (!body) return;

  if (!tests.length) {
    body.innerHTML = `<tr><td colspan="4">No test added.</td></tr>`;
  } else {
    body.innerHTML = tests.map((t, index) => `
      <tr>
        <td>${t.name}</td>
        <td>-</td>
        <td>${Number(t.price || 0).toFixed(2)}</td>
        <td><button type="button" onclick="removeApiPatientTest(${index})">Remove</button></td>
      </tr>
    `).join("");
  }

  const count = document.getElementById("entryTestCount");
  if (count) count.innerText = tests.length;

  updateBillingBox();
}

function setInputByLabelText(label, value) {
  const labels = Array.from(document.querySelectorAll("#patientEntryForm label"));
  const targetLabel = labels.find(l => l.innerText.trim().toLowerCase().includes(label.toLowerCase()));
  if (!targetLabel) return;

  const input = targetLabel.parentElement.querySelector("input");
  if (input) input.value = value;
}

function updateBillingBox() {
  const tests = getPatientTests();
  const total = tests.reduce((sum, t) => sum + Number(t.price || 0), 0).toFixed(2);

  setInputByLabelText("gross total", total);
  setInputByLabelText("balance/dues", total);

  // Cash/Card/Discount/Remarks ko auto total nahi karna
  setInputByLabelText("cash received", "");
  setInputByLabelText("card received", "");
  setInputByLabelText("discount", "");
  setInputByLabelText("remarks", "");
}

window.savePatientEntry = function(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  const patientTests = getPatientTests();

  if (!patientTests.length) {
    alert("Please add at least one test.");
    return false;
  }

  const form = document.getElementById("patientEntryForm");

  const patientName = form.querySelector('[name="patientName"]')?.value || "";
  const patientAge = form.querySelector('[name="age"]')?.value || "";
  const phone = form.querySelector('[name="phone"]')?.value || "";
  const email = form.querySelector('[name="email"]')?.value || "";
  const gender = form.querySelector('[name="gender"]')?.value || "";
  const billNo = form.querySelector('[name="billNo"]')?.value || String(Date.now()).slice(-6);
  const remoteNo = form.querySelector('[name="remoteNo"]')?.value || "0";
  const refDoctor = form.querySelector('[name="refDoctor"]')?.value || "";

  const grossTotal = patientTests.reduce((sum, t) => sum + Number(t.price || 0), 0);

  const booking = {
    id: "B" + Date.now(),
    billNo,
    remoteNo,
    pathologyName: "BN-MAIN",
    patientName,
    patientAge,
    age: patientAge,
    phone,
    contactNo: phone,
    email,
    gender,
    refDoctor,
    tests: patientTests,
    grossTotal,
    balance: grossTotal,
    status: "Pending",
    createdAt: new Date().toISOString()
  };

  const bookings = JSON.parse(localStorage.getItem("kt_bookings") || "[]");
  bookings.push(booking);
  localStorage.setItem("kt_bookings", JSON.stringify(bookings));

  alert("Patient entry saved successfully.");

  localStorage.removeItem("kt_patient_tests_api");
  location.reload();

  return false;
};

function renderTestsPage() {
  const body = document.getElementById("testsBody");
  if (!body || !KT_API_TESTS.length) return;

  body.innerHTML = KT_API_TESTS.map(t => `
    <tr>
      <td>${t.name}</td>
      <td>${t.category}</td>
      <td>₹${Number(t.price || 0).toLocaleString("en-IN")}</td>
      <td>${t.report_time || "-"}</td>
      <td>${(t.parameters || []).length}</td>
    </tr>
  `).join("");
}

document.addEventListener("DOMContentLoaded", function() {
  loadLabApiTests();

  const form = document.getElementById("patientEntryForm");
  if (form) {
    form.onsubmit = window.savePatientEntry;
  }
});

// FINAL PRICE + BILLING FIX

function getFieldByLabel(labelText) {
  labelText = labelText.toLowerCase();

  const labels = Array.from(document.querySelectorAll("#patientEntryForm label"));

  const label = labels.find(l =>
    (l.innerText || "").trim().toLowerCase().includes(labelText)
  );

  if (!label) return null;

  const parent = label.parentElement;

  if (parent) {
    const input = parent.querySelector("input, select, textarea");
    if (input) return input;
  }

  let next = label.nextElementSibling;
  while (next) {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(next.tagName)) return next;
    const inside = next.querySelector?.("input, select, textarea");
    if (inside) return inside;
    next = next.nextElementSibling;
  }

  return null;
}

function findRateInput() {
  return getFieldByLabel("test_rate") ||
         getFieldByLabel("test rate");
}

function findTestInput() {
  return getFieldByLabel("test_name") ||
         getFieldByLabel("test name") ||
         document.querySelector('#patientEntryForm input[placeholder*="Search Test"]') ||
         document.querySelector('#patientEntryForm input[list]');
}

function setupPatientEntryTestBox() {
  const testBox = findTestInput();
  if (!testBox) return;

  testBox.setAttribute("list", "khuntest-api-test-list");

  let datalist = document.getElementById("khuntest-api-test-list");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "khuntest-api-test-list";
    document.body.appendChild(datalist);
  }

  datalist.innerHTML = KT_API_TESTS.map(t =>
    `<option value="${t.name}"></option>`
  ).join("");

  testBox.oninput = function () {
    const selected = KT_API_TESTS.find(t =>
      t.name.toLowerCase() === testBox.value.trim().toLowerCase()
    );

    const rateInput = findRateInput();

    if (selected && rateInput) {
      rateInput.value = Number(selected.price || 0).toFixed(2);
    }
  };

  testBox.onchange = testBox.oninput;
}

function setBillingField(label, value) {
  const field = getFieldByLabel(label);
  if (field) field.value = value;
}

function updateBillingBox() {
  const tests = getPatientTests();
  const total = tests.reduce((sum, t) => sum + Number(t.price || 0), 0);
  const totalText = total.toFixed(2);

  setBillingField("gross total", totalText);
  setBillingField("balance/dues", totalText);

  const count = document.getElementById("entryTestCount");
  if (count) count.innerText = tests.length;
}

document.addEventListener("DOMContentLoaded", function() {
  setTimeout(function() {
    setupPatientEntryTestBox();
    renderPatientEntryTests();
  }, 500);
});


// DATABASE SYNC FIX: save patient entry to MySQL and load same data on all devices
(function () {
  async function loadBookingsFromDB() {
    try {
      const res = await fetch("/api/bookings");

      if (!res.ok) {
        throw new Error("Failed to load bookings from database");
      }

      const dbBookings = await res.json();

      const bookings = dbBookings.map(b => {
        const tests = Array.isArray(b.tests) ? b.tests.map(t => ({
          id: t.id || t.test_code,
          name: t.name || t.test_name,
          price: Number(t.price || t.price_inr || 0),
          test_code: t.test_code || t.id,
          test_name: t.test_name || t.name
        })) : [];

        const gross = Number(b.gross_total || 0);

        return {
          id: b.booking_code || ("KTB" + b.id),
          dbId: b.id,
          billNo: b.bill_no || "",
          remoteNo: b.remote_no || "0",
          pathologyName: "BN-MAIN",
          patientName: b.patient_name || "",
          patientAge: b.patient_age || "",
          age: b.patient_age || "",
          gender: b.patient_gender || "",
          patientGender: b.patient_gender || "",
          phone: b.phone || "",
          contactNo: b.phone || "",
          whatsapp: b.whatsapp || b.phone || "",
          email: b.email || "",
          address: b.address || "",
          refDoctor: b.ref_doctor || "",
          tests: tests,
          test: tests.map(t => t.name).join(", "),
          price: gross,
          grossTotal: gross,
          balance: Number(b.balance_due || 0),
          status: b.status || "Pending",
          bookingType: "Centre Visit",
          createdAt: b.created_at || b.admission_date || new Date().toISOString(),
          admissionDate: b.admission_date || "",
          collectionDate: b.collection_date || ""
        };
      });

      localStorage.setItem("kt_bookings", JSON.stringify(bookings));

      if (typeof renderMetrics === "function") renderMetrics();
      if (typeof renderBookings === "function") renderBookings();
      if (typeof renderReportBookingSelect === "function") renderReportBookingSelect();

      console.log("Bookings synced from MySQL:", bookings.length);
    } catch (err) {
      console.error("Booking DB sync error:", err);
    }
  }

  window.loadBookingsFromDB = loadBookingsFromDB;

  window.savePatientEntry = async function(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }

    const patientTests = JSON.parse(localStorage.getItem("kt_patient_tests_api") || "[]");

    if (!patientTests.length) {
      alert("Please add at least one test.");
      return false;
    }

    const form = document.getElementById("patientEntryForm");

    if (!form) {
      alert("Patient entry form not found.");
      return false;
    }

    const patientName = form.querySelector('[name="patientName"]')?.value || "";
    const patientAge = form.querySelector('[name="age"]')?.value || "";
    const phone = form.querySelector('[name="phone"]')?.value || "";
    const email = form.querySelector('[name="email"]')?.value || "";
    const gender = form.querySelector('[name="gender"]')?.value || "";
    const refDoctor = form.querySelector('[name="refDoctor"]')?.value || "";

    if (!patientName || !phone) {
      alert("Patient name and phone required.");
      return false;
    }

    const payload = {
      patientName: patientName,
      patientAge: patientAge,
      patientGender: gender,
      phone: phone,
      whatsapp: phone,
      email: email,
      address: "",
      bookingType: "Centre Visit",
      rateType: "General",
      refDoctor: refDoctor,
      tests: patientTests.map(t => t.id || t.name),
      paymentMode: "Pay Later"
    };

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        console.error(data);
        alert("Database save failed: " + (data.message || data.error || "Unknown error"));
        return false;
      }

      localStorage.removeItem("kt_patient_tests_api");

      await loadBookingsFromDB();

      alert("Patient entry saved in database successfully.");

      location.reload();
      return false;
    } catch (err) {
      console.error("Save patient DB error:", err);
      alert("Database connection error. Check backend/API.");
      return false;
    }
  };

  document.addEventListener("DOMContentLoaded", function() {
    setTimeout(function() {
      loadBookingsFromDB();

      const form = document.getElementById("patientEntryForm");
      if (form) {
        form.onsubmit = window.savePatientEntry;
      }
    }, 800);
  });

  document.addEventListener("submit", function(e) {
    if (e.target && e.target.id === "patientEntryForm") {
      window.savePatientEntry(e);
    }
  }, true);

  document.addEventListener("click", function(e) {
    const btn = e.target.closest("button");
    if (!btn) return;

    const text = (btn.innerText || "").toLowerCase();

    if (text.includes("save")) {
      const form = document.getElementById("patientEntryForm");
      if (form && form.contains(btn)) {
        window.savePatientEntry(e);
      }
    }
  }, true);
})();

// REPORT RELEASE DB SAVE FIX
(function () {
  function getInputValueByLabel(labelText) {
    labelText = labelText.toLowerCase();

    const labels = Array.from(document.querySelectorAll("label"));
    const label = labels.find(l =>
      (l.innerText || "").toLowerCase().includes(labelText)
    );

    if (label) {
      const box = label.parentElement;
      const field = box ? box.querySelector("input, select, textarea") : null;
      if (field) return field.value || "";
    }

    const inputs = Array.from(document.querySelectorAll("input"));
    const possible = inputs.find(i =>
      (i.closest("div")?.innerText || "").toLowerCase().includes(labelText)
    );

    return possible ? possible.value || "" : "";
  }

  function getCurrentBillNo() {
    return (
      getInputValueByLabel("bill no") ||
      document.querySelector('[name="billNo"]')?.value ||
      document.querySelector('#rBillNo')?.value ||
      ""
    ).trim();
  }

  function collectReportResultsFromPage() {
    const tables = Array.from(document.querySelectorAll("table"));

    const reportTable = tables.find(t => {
      const txt = (t.innerText || "").toLowerCase();
      return txt.includes("finding") && txt.includes("normal") && txt.includes("test");
    });

    if (!reportTable) return [];

    const rows = Array.from(reportTable.querySelectorAll("tbody tr"));
    const results = [];

    rows.forEach(row => {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length < 3) return;

      function cellValue(index) {
        const cell = cells[index];
        if (!cell) return "";
        const field = cell.querySelector("input, select, textarea");
        return field ? field.value.trim() : (cell.innerText || "").trim();
      }

      const testName = cellValue(0);
      const normalValue = cellValue(1);
      const finding = cellValue(2);
      const unit = cellValue(3);
      const comment = cellValue(4);

      if (!testName && !finding) return;

      results.push({
        testName: testName,
        parameterName: testName,
        normalValue: normalValue,
        finding: finding,
        unit: unit,
        comment: comment
      });
    });

    return results;
  }

  window.saveReleasedReportToDB = async function () {
    const billNo = getCurrentBillNo();
    const results = collectReportResultsFromPage();

    if (!billNo) {
      alert("Bill No not found.");
      return false;
    }

    if (!results.length) {
      alert("No report results found.");
      return false;
    }

    try {
      const res = await fetch("/api/reports/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          billNo: billNo,
          results: results
        })
      });

      const data = await res.json();

      if (!data.success) {
        alert(data.message || "Report save failed.");
        return false;
      }

      console.log("Report saved to DB:", data);
      return true;

    } catch (err) {
      console.error("Report save error:", err);
      alert("Report save API error.");
      return false;
    }
  };

  document.addEventListener("click", function (e) {
    const btn = e.target.closest("button, a");
    if (!btn) return;

    const text = (btn.innerText || "").toLowerCase();

    if (text.includes("release report")) {
      window.saveReleasedReportToDB();
    }
  }, true);
})();
// WhatsApp Report Button - KHUNTEST LABS
(function () {
  if (!location.pathname.includes("admin-dashboard.html")) return;

  function addWhatsAppButton() {
    if (document.getElementById("whatsappReportBtn")) return;

    const btn = document.createElement("button");
    btn.id = "whatsappReportBtn";
    btn.innerText = "Send Report WhatsApp";

    btn.style.position = "fixed";
    btn.style.right = "20px";
    btn.style.bottom = "20px";
    btn.style.zIndex = "99999";
    btn.style.background = "#25D366";
    btn.style.color = "#fff";
    btn.style.border = "none";
    btn.style.borderRadius = "12px";
    btn.style.padding = "14px 18px";
    btn.style.fontWeight = "700";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = "0 6px 20px rgba(0,0,0,0.25)";

    btn.onclick = window.sendReportWhatsApp;

    document.body.appendChild(btn);
  }

  window.sendReportWhatsApp = async function () {
    const phone = prompt("Patient WhatsApp number with country code", "919142579601");
    const patientName = prompt("Patient name", "Himanshu");
    const billNo = prompt("Bill number", "629933");

    if (!phone || !patientName || !billNo) {
      alert("Phone, patient name and bill number required.");
      return;
    }

    try {
      const res = await fetch("/api/whatsapp/send-report-ready", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone,
          patientName,
          billNo
        })
      });

      const data = await res.json();

      if (data.success) {
        alert("WhatsApp report link sent successfully.");
      } else {
        alert(data.message || "WhatsApp failed.");
        console.error(data);
      }
    } catch (err) {
      alert("WhatsApp sending failed.");
      console.error(err);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addWhatsAppButton);
  } else {
    addWhatsAppButton();
  }
})();
