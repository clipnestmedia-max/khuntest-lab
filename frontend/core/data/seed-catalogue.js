// Clone the standard test catalogue into a laboratory.
//
// Runs during one-click onboarding. Writes in batches of 400 (Firestore's
// limit is 500 operations per batch) and reports progress, because 677 writes
// take a few seconds and a silent UI looks broken.
import { writeBatch, doc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { normalizeLabId } from "../tenant.js";
import { buildSearchTokens } from "./helpers.js";

const CATALOGUE_URL = new URL("../../data/seed-catalogue.json", import.meta.url).href;
const BATCH_SIZE = 400;

let catalogue = null;

export async function loadSeedCatalogue() {
  if (catalogue) return catalogue;
  const response = await fetch(CATALOGUE_URL);
  if (!response.ok) throw new Error(`Seed catalogue not found at data/seed-catalogue.json (${response.status}). Run: node scripts/build-seed-catalogue.mjs`);
  catalogue = await response.json();
  return catalogue;
}

/** Bundled catalogue size, for the deployment checklist. */
export function catalogueSize() { return catalogue?.length ?? 677; }

/**
 * Write every catalogue entry into /labs/{labId}/tests. Safe to re-run: each
 * test is keyed by its test code, so a second run refreshes rather than
 * duplicating - but it also overwrites any price the laboratory has since
 * edited, which is why the Super Admin UI asks before doing it.
 */
export async function seedCatalogueForLab(labId, { onProgress = null } = {}) {
  const id = normalizeLabId(labId);
  if (!id) throw new Error("seedCatalogueForLab needs a labId.");
  const tests = await loadSeedCatalogue();

  let written = 0;
  for (let i = 0; i < tests.length; i += BATCH_SIZE) {
    const slice = tests.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    slice.forEach((test) => {
      batch.set(doc(db, `labs/${id}/tests/${test.testCode}`), {
        ...test,
        labId: id,
        searchKeywords: test.searchKeywords?.length
          ? test.searchKeywords
          : buildSearchTokens(test.name, test.testCode, test.category),
        seededAt: new Date().toISOString()
      });
    });
    await batch.commit();
    written += slice.length;
    onProgress?.(written, tests.length);
  }
  return { written, total: tests.length, labId: id };
}
