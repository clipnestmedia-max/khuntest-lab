
const API_BASE = "http://localhost:5000";

function getToken() {
  return localStorage.getItem("khuntest_token");
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;

  const res = await fetch(API_BASE + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "API error");
  return data;
}

async function adminLogin(email, password) {
  const data = await api("/api/auth/admin/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  localStorage.setItem("khuntest_token", data.token);
  return data;
}

async function sendReportToWhatsApp(bookingId) {
  return api(`/api/admin/bookings/${bookingId}/send-whatsapp-report`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

async function uploadReport(bookingId, file) {
  const fd = new FormData();
  fd.append("report", file);
  return api(`/api/admin/bookings/${bookingId}/report-upload`, {
    method: "POST",
    body: fd
  });
}
