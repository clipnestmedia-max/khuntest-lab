require("dotenv").config();
const pool = require("./src/db");

const templates = {
  CBC: [
    ["Haemoglobin", "M: 13.2-16.6, F: 11.6-15.0", "g/dL"],
    ["WBC Count", "4000-11000", "cmm"],
    ["Neutrophils", "40-75", "%"],
    ["Lymphocytes", "20-50", "%"],
    ["Monocytes", "2-8", "%"],
    ["Eosinophils", "1-6", "%"],
    ["Basophils", "0-1", "%"],
    ["RBC Count", "3.5-5.5", "mill/cumm"],
    ["PCV/HCT", "34-47", "%"],
    ["MCV", "80-96", "fL"],
    ["MCH", "27.5-33.2", "pg"],
    ["MCHC", "33.4-35.5", "%"],
    ["RDW-CV", "11.0-16.0", "%"],
    ["Platelet Count", "1,50,000-4,50,000", "/µL"],
    ["MPV", "6.5-12.0", "fL"],
    ["PDW", "9.0-17.0", "fL"]
  ],

  "LIVER FUNCTION TEST": [
    ["Total Bilirubin", "0.1-1.2", "mg/dL"],
    ["Direct Bilirubin", "0.0-0.3", "mg/dL"],
    ["Indirect Bilirubin", "Calculated", "mg/dL"],
    ["SGOT / AST", "8-33", "U/L"],
    ["SGPT / ALT", "4-36", "U/L"],
    ["Alkaline Phosphatase", "20-130", "U/L"],
    ["Total Protein", "6.0-8.3", "g/dL"],
    ["Albumin", "3.4-5.4", "g/dL"],
    ["Globulin", "2.0-3.5", "g/dL"],
    ["A/G Ratio", "1.0-2.2", "Ratio"]
  ],

  KFT: [
    ["Urea", "15-40", "mg/dL"],
    ["BUN", "6-20", "mg/dL"],
    ["Creatinine", "0.6-1.3", "mg/dL"],
    ["Uric Acid", "M: 3.4-7.0, F: 2.4-6.0", "mg/dL"],
    ["Sodium", "136-145", "mEq/L"],
    ["Potassium", "3.5-5.1", "mEq/L"],
    ["Chloride", "96-106", "mEq/L"]
  ],

  "LIPID PROFILE": [
    ["Total Cholesterol", "<200 desirable", "mg/dL"],
    ["Triglycerides", "<150 normal", "mg/dL"],
    ["HDL Cholesterol", ">40", "mg/dL"],
    ["LDL Cholesterol", "<100 optimal", "mg/dL"],
    ["VLDL Cholesterol", "5-40", "mg/dL"],
    ["TC/HDL Ratio", "<5.0", "Ratio"]
  ],

  "THYROID PROFILE": [
    ["T3", "80-220", "ng/dL"],
    ["T4", "5.0-12.0", "µg/dL"],
    ["TSH", "0.5-5.0", "mIU/L"]
  ],

  HBA1C: [
    ["HbA1c", "Normal <5.7, Prediabetes 5.7-6.4, Diabetes ≥6.5", "%"],
    ["Estimated Average Glucose", "Calculated", "mg/dL"]
  ],

  "BLOOD SUGAR": [
    ["Blood Sugar", "Depends on fasting/random/PP sample", "mg/dL"]
  ],

  "URINE ROUTINE": [
    ["Colour", "Pale Yellow", ""],
    ["Appearance", "Clear", ""],
    ["Specific Gravity", "1.005-1.030", ""],
    ["pH", "4.5-8.0", ""],
    ["Protein", "Absent/Trace", ""],
    ["Glucose", "Absent", ""],
    ["Ketone", "Absent", ""],
    ["Pus Cells", "0-5", "/HPF"],
    ["RBC", "0-2", "/HPF"],
    ["Epithelial Cells", "0-5", "/HPF"],
    ["Bacteria", "Absent", ""]
  ],

  "VITAMIN D": [
    ["Vitamin D 25-OH", "Deficiency <20, Sufficiency ≥30", "ng/mL"]
  ],

  "VITAMIN-B12": [
    ["Vitamin B12", "200-800", "pg/mL"]
  ],

  "DENGUE": [
    ["Dengue Result", "Negative", ""]
  ],

  "MALARIA": [
    ["Malaria Parasite", "Not Seen / Negative", ""]
  ]
};

function matchTemplate(testName) {
  const name = testName.toUpperCase();

  if (name.includes("CBC")) return templates.CBC;
  if (name.includes("LIVER FUNCTION") || name.includes("LFT")) return templates["LIVER FUNCTION TEST"];
  if (name.includes("KFT") || name.includes("KIDNEY FUNCTION") || name.includes("RENAL PROFILE")) return templates.KFT;
  if (name.includes("LIPID")) return templates["LIPID PROFILE"];
  if (name.includes("THYROID") || name.includes("T3,T4,TSH")) return templates["THYROID PROFILE"];
  if (name.includes("HBA1C")) return templates.HBA1C;
  if (name.includes("BLOOD SUGAR") || name.includes("GLUCOSE")) return templates["BLOOD SUGAR"];
  if (name.includes("URINE ROUTINE") || name.includes("URINE R/E")) return templates["URINE ROUTINE"];
  if (name.includes("VITAMIN D")) return templates["VITAMIN D"];
  if (name.includes("VITAMIN-B12") || name.includes("VITAMIN B12")) return templates["VITAMIN-B12"];
  if (name.includes("DENGUE")) return templates.DENGUE;
  if (name.includes("MALARIA")) return templates.MALARIA;

  return [
    ["Result", "As per lab method / reference range", ""]
  ];
}

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS test_parameters (
      id INT AUTO_INCREMENT PRIMARY KEY,
      test_id INT NULL,
      test_name VARCHAR(255),
      parameter_name VARCHAR(255),
      normal_value TEXT,
      unit VARCHAR(100),
      sort_order INT DEFAULT 1
    )
  `);

  await pool.query("DELETE FROM test_parameters");

  const [tests] = await pool.query("SELECT id, name FROM tests WHERE is_active=1");

  let inserted = 0;

  for (const test of tests) {
    const params = matchTemplate(test.name);

    for (let i = 0; i < params.length; i++) {
      await pool.query(
        `INSERT INTO test_parameters 
        (test_id, test_name, parameter_name, normal_value, unit, sort_order) 
        VALUES (?, ?, ?, ?, ?, ?)`,
        [test.id, test.name, params[i][0], params[i][1], params[i][2], i + 1]
      );
      inserted++;
    }
  }

  console.log(`Parameters added for ${tests.length} tests. Total parameter rows: ${inserted}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
