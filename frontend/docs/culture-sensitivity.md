# Culture & Sensitivity module

A test whose catalogue entry has `reportType: "cultureSensitivity"` (Admin → Test Catalogue) gets the
dedicated C/S editor in **Report Entry** instead of the numeric grid. Example: `KT0685 Suction Tip
Culture & Sensitivity`.

## Where things live

| Piece | File |
| --- | --- |
| Pure logic (MIC parsing, S/I/R, panel matching, validation) | `core/culture-logic.js` (unit-tested, no Firebase/DOM) |
| Master data + AST standard access (Firestore) | `core/data/culture.js` |
| Master screens (specimens, organisms, antibiotics, panels, breakpoints, AST standard) | `admin/culture-masters-screen.js`, `admin-dashboard.html` → *Culture & Sensitivity* |
| Report Entry editor | `admin/culture-report-entry.js`, wired in `admin/report-entry.js` |
| Print (admin templates) | `cultureResultSection()` in `core/report-templates.js` |
| Patient / secure-link / WhatsApp view | `cultureResultSection()` in `report.html` (a separate copy — keep both in step) |

## Firestore

Reference data (read: anyone, write: admin) — same rules shape as `/tests`:
`csSpecimens`, `csOrganisms`, `csAntibiotics`, `csPanels`, `csBreakpoints`.
Lab setting: `settings/ast` = `{ standardName, version, effectiveDate, notes, showOnReport }`.

No existing collection or field was removed. Reports keep `cultureResults[]` (one entry per C/S test on the
report); new fields are additive and every reader treats them as optional, so reports saved before this
change still open, validate and print.

```
cultureResults[]: {
  testId, testCode, testName,
  specimenId, specimenName, specimenCustom?,     // custom specimens have specimenId "" and a typed name
  cultureResult,                                 // Pending | No Growth | Sterile | Growth Detected | Significant Growth |
                                                 // Insignificant Growth | Mixed Growth | Contaminated | Final | Other
  colonyCount, colonyCountUnit, gramStain, pusCells, rbc, epithelialCells, otherFindings,
  astStandard: { name, version, effectiveDate, show },   // captured when the block is created
  organisms[]: {
    organismId, organismName,                    // organismId "" = typed organism with no master record
    comments,
    sensitivities[]: { antibioticId, antibioticName, testingMethod, micValue, micUnit, zoneDiameter, zoneUnit,
                       sir /* S|I|R|NA|NT */, grade /* ""|+|++|+++|++++ */, auto, breakpointId, standard, standardVersion, comment }
  },
  resistanceMarkers, comments
}
```

## Clinical-safety rules (do not weaken)

* No breakpoint values ship in code. S/I/R is auto-interpreted only from a breakpoint the lab entered for that
  exact organism + antibiotic + method (+ standard). Otherwise the row stays *Not Tested* and the technician
  picks S/I/R by hand.
* Open-ended MICs (`≤4`, `>2`) are only interpreted when the bound alone decides the category.
* "Auto Fill Sensitivity Panel" loads only a panel the admin configured (by specimen, organism and/or Gram
  reaction). The 17 antibiotics from the reference report are in the starter list; nothing selects them
  automatically.

## Validation

* Draft: an invalid MIC blocks saving (drafts autosave 2 s after typing stops, never on a released report).
* Release: specimen required; organism required for growth results; every organism named, no duplicate
  organism, every antibiotic row named, no duplicate antibiotic per organism, valid MIC text.
* MIC, S/I/R and zone are optional per drug (empty = Not Tested).

## Tests

```
node frontend/scripts/test-culture.mjs
```

Runs the logic, the editor's data functions against fixture masters (Firebase stubbed) and both renderers.
