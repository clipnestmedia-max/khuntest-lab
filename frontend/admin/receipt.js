// Printable booking receipt / bill, branded per laboratory.
import { esc, rupees, formatDateTime } from "../core/format.js";

export function receiptHtml(booking, branding, { title = "PAYMENT RECEIPT" } = {}) {
  const line = (label, value) =>
    `<div class="r-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;

  return `
<div class="receipt">
  <header>
    ${branding.logoUrl ? `<img src="${esc(branding.logoUrl)}" alt="">` : ""}
    <h1>${esc(branding.labName)}</h1>
    ${branding.tagline ? `<p class="tag">${esc(branding.tagline)}</p>` : ""}
    <p class="small">${esc(branding.fullAddress)}</p>
    <p class="small">${esc([branding.phone, branding.email].filter(Boolean).join(" · "))}</p>
    ${branding.gstNumber ? `<p class="small">GSTIN: ${esc(branding.gstNumber)}</p>` : ""}
  </header>
  <h2>${esc(title)}</h2>
  ${line("Bill No", booking.billNo)}
  ${line("Date", formatDateTime(booking.createdAt || new Date()))}
  ${line("Patient", booking.patientName)}
  ${line("Patient ID", booking.patientId)}
  ${line("Age / Gender", [booking.age, booking.gender].filter(Boolean).join(" / ") || "—")}
  ${line("Mobile", booking.phone)}
  ${booking.refBy ? line("Referred by", booking.refBy) : ""}
  <table>
    <thead><tr><th>#</th><th>Test</th><th class="r">Amount</th></tr></thead>
    <tbody>${(booking.tests || []).map((t, i) =>
      `<tr><td>${i + 1}</td><td>${esc(t.name)}<br><span class="small">${esc(t.testCode)}</span></td>
       <td class="r">${esc(rupees(t.price))}</td></tr>`).join("")}</tbody>
  </table>
  <div class="totals">
    ${line("Subtotal", rupees(booking.subtotal))}
    ${booking.collectionCharge ? line("Home collection", rupees(booking.collectionCharge)) : ""}
    ${booking.discount ? line("Discount", `− ${rupees(booking.discount)}`) : ""}
    <div class="r-row grand"><span>Grand Total</span><b>${esc(rupees(booking.totalAmount))}</b></div>
    ${line(`Received (${booking.paymentMode})`, rupees(booking.paidAmount))}
    <div class="r-row ${booking.balanceDue ? "due" : ""}"><span>Balance Due</span><b>${esc(rupees(booking.balanceDue))}</b></div>
  </div>
  <footer>
    <p class="small">${esc(branding.termsAndConditions || "Please collect your report using the bill number above.")}</p>
    ${branding.whatsapp ? `<p class="small">Reports on WhatsApp: ${esc(branding.whatsapp)}</p>` : ""}
    ${branding.showPoweredBy !== false ? `<p class="small powered">Powered by Swati Softtech Solution</p>` : ""}
  </footer>
</div>`;
}

export function receiptStyles(branding) {
  return `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f1f5f9; font-family: "Segoe UI", Arial, sans-serif; }
  .receipt {
    width: 80mm; margin: 0 auto; background: #fff; padding: 10mm 6mm;
    color: #111827; font-size: 11.5px; line-height: 1.45;
  }
  .receipt header { text-align: center; border-bottom: 1px dashed #9ca3af; padding-bottom: 8px; }
  .receipt header img { max-height: 52px; margin-bottom: 4px; }
  .receipt h1 { font-size: 15px; margin: 0; color: ${branding.primaryColor || "#c62828"}; }
  .receipt .tag { font-size: 9px; letter-spacing: 1.4px; text-transform: uppercase; margin: 2px 0; }
  .receipt h2 { font-size: 12px; text-align: center; letter-spacing: 2px; margin: 10px 0 8px; }
  .receipt .small { font-size: 9.5px; margin: 1px 0; color: #4b5563; }
  .r-row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
  .r-row.grand { border-top: 1px solid #111827; border-bottom: 1px solid #111827; padding: 4px 0; margin: 4px 0; font-size: 13px; }
  .r-row.due b { color: #b91c1c; }
  .receipt table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  .receipt th { text-align: left; font-size: 9.5px; text-transform: uppercase; border-bottom: 1px solid #9ca3af; padding: 4px 2px; }
  .receipt td { padding: 4px 2px; border-bottom: 1px dotted #d1d5db; vertical-align: top; }
  .receipt .r { text-align: right; white-space: nowrap; }
  .receipt footer { border-top: 1px dashed #9ca3af; margin-top: 10px; padding-top: 6px; text-align: center; }
  .receipt .powered { color: #9ca3af; }
  @media print { body { background: #fff; } .receipt { width: auto; padding: 4mm; } @page { margin: 4mm; } }`;
}

export function printReceipt(booking, branding) {
  const win = window.open("", "_blank", "width=420,height=760");
  if (!win) throw new Error("Please allow pop-ups to print the receipt.");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Receipt ${esc(booking.billNo)}</title><style>${receiptStyles(branding)}</style></head>
    <body>${receiptHtml(booking, branding)}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
  return win;
}
