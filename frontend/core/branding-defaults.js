// Branding for the single-tenant KhunTest deployment.
//
// The platform kept this file neutral and loaded the real values per lab from
// Firestore. This app is one laboratory, so the values live here and
// branding.js simply returns them (no /labs/{labId} read).
export const DEFAULT_BRANDING = Object.freeze({
  labName: "KHUNTEST LABS",
  legalName: "KHUNTEST LABS",
  tagline: "ACCURATE • RELIABLE • TRUSTED",

  brandLine1: "KHUN",
  brandLine2: "T E S T",
  brandAccentLength: 4,

  logoUrl: "assets/khuntest-logo.png",
  stampUrl: "",
  faviconUrl: "/favicon/favicon.ico",
  primaryColor: "#d60000",
  secondaryColor: "#062b5f",
  accentColor: "#0369a1",
  address: "Allalpatti, Laheriasarai",
  city: "Darbhanga",
  state: "Bihar",
  pincode: "",
  phone: "+91 9234277007",
  altPhone: "",
  whatsapp: "+91 9234277007",
  email: "khuntest@yahoo.com",
  website: "https://khuntest.com",
  gstNumber: "",
  licenseNumber: "",
  registrationNumber: "",
  businessHours: "",
  reportTemplate: "modern-diagnostic",
  invoiceTemplate: "standard",
  reportHeaderNote: "",
  reportFooterNote: "© 2026 KHUNTEST LABS. All Rights Reserved. Tech by:- Himanshu Sahni. 📞+91 9142579601",
  disclaimer: "This report is for medical reference and is not valid for medico-legal purposes. Results relate only to the sample tested.",
  termsAndConditions: "",
  showPoweredBy: false,
  social: { facebook: "", instagram: "", youtube: "", twitter: "" },
  signatories: [
    { name: "Dr N.K SUMAN", qualification: "MBBS, MD", designation: "Consultant Pathologist" }
  ]
});

/** Fields branding.js computes at load time rather than defaulting. */
export const COMPUTED_BRANDING_FIELDS = Object.freeze([
  "labId", "fullAddress", "whatsappDigits", "whatsappLink", "phoneLink", "emailLink"
]);
