#!/usr/bin/env node

const [, , ...uids] = process.argv;
const projectId = process.env.FIREBASE_PROJECT_ID || "khuntest-lab-e5966";
const token = process.env.FIREBASE_ACCESS_TOKEN;

if (!uids.length) {
  console.error("Usage: FIREBASE_ACCESS_TOKEN=$(gcloud auth print-access-token) node scripts/ensure-admin-active.mjs <admin-uid> [admin-uid...]");
  process.exit(1);
}

if (!token) {
  console.error("FIREBASE_ACCESS_TOKEN is required. Use an operator account with permission to update Firestore users.");
  process.exit(1);
}

function userUrl(uid) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
}

function stringField(doc, field) {
  return doc?.fields?.[field]?.stringValue || "";
}

async function firestoreJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error?.message || `Firestore request failed: ${response.status}`);
  }
  return body;
}

for (const uid of uids) {
  try {
    const existing = await firestoreJson(userUrl(uid));
    const role = stringField(existing, "role");

    if (role !== "admin") {
      console.error(`users/${uid} has role=${role || "(missing)"}. Refusing to modify non-admin user.`);
      process.exitCode = 1;
      continue;
    }

    const url = `${userUrl(uid)}?updateMask.fieldPaths=isActive&updateMask.fieldPaths=active`;
    await firestoreJson(url, {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          isActive: { booleanValue: true },
          active: { booleanValue: true }
        }
      })
    });

    console.log(`Updated users/${uid}: isActive=true active=true`);
  } catch (error) {
    console.error(`Failed to update users/${uid}: ${error.message}`);
    process.exitCode = 1;
  }
}
