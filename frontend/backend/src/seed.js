
require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./db");

const tests = [
  {
    test_code:"CBC", test_name:"Complete Blood Count (CBC)", category:"Hematology", sample:"EDTA Whole Blood", report_time:"Same Day", price_inr:399,
    parameters:[
      ["Haemoglobin","Male: 13.2-16.6; Female: 11.6-15.0","g/dL"],
      ["RBC Count","Male: 4.35-5.65; Female: 3.92-5.13","million/µL"],
      ["WBC Count","3,400-9,600","/µL"],
      ["Platelet Count","150,000-450,000","/µL"],
      ["Hematocrit/PCV","Male: 38.3-48.6; Female: 35.5-44.9","%"],
      ["MCV","80-96","fL"],
      ["MCH","27-32","pg"],
      ["MCHC","33.4-35.5","g/dL"],
      ["RDW-CV","11.5-14.5","%"],
      ["Neutrophils","40-75","%"],
      ["Lymphocytes","20-50","%"],
      ["Monocytes","2-8","%"],
      ["Eosinophils","1-6","%"],
      ["Basophils","0-1","%"],
      ["MPV","6.5-12.0","fL"],
      ["PDW","9.0-17.0","fL"]
    ]
  },
  { test_code:"FBS", test_name:"Blood Sugar Fasting", category:"Diabetes", sample:"Fluoride Plasma", report_time:"Same Day", price_inr:100, parameters:[["Fasting Plasma Glucose","Normal: <100; Prediabetes: 100-125; Diabetes: ≥126","mg/dL"]] },
  { test_code:"PPBS", test_name:"Blood Sugar Post Prandial", category:"Diabetes", sample:"Fluoride Plasma", report_time:"Same Day", price_inr:100, parameters:[["Post Prandial Blood Sugar","Usually <140 after 2 hours","mg/dL"]] },
  { test_code:"RBS", test_name:"Blood Sugar Random", category:"Diabetes", sample:"Fluoride Plasma", report_time:"Same Day", price_inr:100, parameters:[["Random Blood Sugar","Usually <140; ≥200 with symptoms may suggest diabetes","mg/dL"]] },
  { test_code:"HBA1C", test_name:"HbA1c", category:"Diabetes", sample:"EDTA Whole Blood", report_time:"Same Day", price_inr:500, parameters:[["HbA1c","Normal: <5.7; Prediabetes: 5.7-6.4; Diabetes: ≥6.5","%"],["Estimated Average Glucose","Calculated from HbA1c","mg/dL"]] },
  { test_code:"LIPID", test_name:"Lipid Profile", category:"Heart Health", sample:"Serum", report_time:"24 Hours", price_inr:799, parameters:[["Total Cholesterol","<200 desirable","mg/dL"],["Triglycerides","<150 normal","mg/dL"],["HDL Cholesterol","≥60 best; <50 low","mg/dL"],["LDL Cholesterol","<100 optimal","mg/dL"],["VLDL Cholesterol","5-40","mg/dL"],["Non-HDL Cholesterol","<130","mg/dL"],["TC/HDL Ratio","<5.0","ratio"]] },
  { test_code:"LFT", test_name:"Liver Function Test", category:"Biochemistry", sample:"Serum", report_time:"24 Hours", price_inr:899, parameters:[["Total Bilirubin","0.1-1.2","mg/dL"],["Direct Bilirubin","0.0-0.3","mg/dL"],["Indirect Bilirubin","Calculated","mg/dL"],["SGOT/AST","8-33","U/L"],["SGPT/ALT","4-36","U/L"],["Alkaline Phosphatase","20-130","U/L"],["Total Protein","6.0-8.3","g/dL"],["Albumin","3.4-5.4","g/dL"],["Globulin","2.0-3.5","g/dL"],["A/G Ratio","1.0-2.2","ratio"]] },
  { test_code:"KFT", test_name:"Kidney Function Test", category:"Biochemistry", sample:"Serum", report_time:"24 Hours", price_inr:899, parameters:[["Urea","15-40","mg/dL"],["BUN","6-20","mg/dL"],["Creatinine","0.6-1.3","mg/dL"],["Uric Acid","Male: 3.4-7.0; Female: 2.4-6.0","mg/dL"],["Sodium","136-145","mEq/L"],["Potassium","3.5-5.1","mEq/L"],["Chloride","96-106","mEq/L"],["eGFR",">90 normal","mL/min/1.73m²"]] },
  { test_code:"TFT", test_name:"Thyroid Profile", category:"Hormone", sample:"Serum", report_time:"24 Hours", price_inr:699, parameters:[["T3 Total","80-220","ng/dL"],["T4 Total","5.0-12.0","µg/dL"],["TSH","0.5-5.0","mIU/L"]] },
  { test_code:"VITD", test_name:"Vitamin D 25-OH", category:"Vitamin", sample:"Serum", report_time:"24 Hours", price_inr:899, parameters:[["25-OH Vitamin D","Deficiency often <20; sufficiency commonly ≥30","ng/mL"]] },
  { test_code:"B12", test_name:"Vitamin B12", category:"Vitamin", sample:"Serum", report_time:"24 Hours", price_inr:799, parameters:[["Vitamin B12","200-800 typical range; lab dependent","pg/mL"]] },
  { test_code:"URINE_RM", test_name:"Urine Routine & Microscopy", category:"Urine", sample:"Urine", report_time:"Same Day", price_inr:250, parameters:[["Colour","Pale yellow to dark yellow",""],["Appearance","Clear",""],["Specific Gravity","1.005-1.030",""],["pH","4.5-8.0",""],["Protein","Absent/Trace",""],["Glucose","Absent",""],["Ketone","Absent",""],["Pus Cells/WBC","0-5","/HPF"],["RBC","0-2","/HPF"],["Epithelial Cells","0-5","/HPF"],["Bacteria","Absent",""]] },
  { test_code:"DENGUE_NS1", test_name:"Dengue NS1 Antigen", category:"Infectious Disease", sample:"Serum", report_time:"Same Day", price_inr:800, parameters:[["Dengue NS1 Antigen","Negative",""]] },
  { test_code:"MALARIA", test_name:"Malaria Parasite / Rapid Test", category:"Infectious Disease", sample:"Blood", report_time:"Same Day", price_inr:500, parameters:[["Malaria Parasite","Not seen / Negative",""],["P. falciparum antigen","Negative",""],["P. vivax antigen","Negative",""]] },
  { test_code:"FULL_BODY_BASIC", test_name:"Full Body Checkup Basic", category:"Package", sample:"Blood + Urine", report_time:"24-48 Hours", price_inr:1999, parameters:[["CBC","Detailed CBC values",""],["Fasting Sugar","<100","mg/dL"],["HbA1c","<5.7","%"],["Lipid Profile","See Lipid Profile",""],["Liver Function Test","See LFT",""],["Kidney Function Test","See KFT",""],["Thyroid Profile","See TFT",""],["Urine Routine","See Urine R/M",""]] }
];

const packages = [
  { package_code:"PKG_BASIC", package_name:"Basic Health Checkup", price_inr:999, included_tests:["CBC","FBS","LIPID"] },
  { package_code:"PKG_FULL", package_name:"Full Body Checkup", price_inr:1999, included_tests:["CBC","FBS","HBA1C","LIPID","LFT","KFT","TFT","URINE_RM"] },
  { package_code:"PKG_FEVER", package_name:"Fever Package", price_inr:1499, included_tests:["CBC","MALARIA","DENGUE_NS1","LFT"] }
];

async function seed() {
  const adminHash = await bcrypt.hash("admin123", 10);
  await pool.query(
    "INSERT INTO users (role,name,email,phone,password_hash) VALUES ('admin','Admin','admin@khuntest.com','9876543210',?) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)",
    [adminHash]
  );

  for (const t of tests) {
    await pool.query(
      "INSERT INTO tests (test_code,test_name,category,sample,report_time,price_inr) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE test_name=VALUES(test_name), price_inr=VALUES(price_inr)",
      [t.test_code,t.test_name,t.category,t.sample,t.report_time,t.price_inr]
    );
    await pool.query("DELETE FROM test_parameters WHERE test_code=?", [t.test_code]);
    for (let i=0;i<t.parameters.length;i++) {
      const p = t.parameters[i];
      await pool.query(
        "INSERT INTO test_parameters (test_code,parameter_name,normal_value,unit,sort_order) VALUES (?,?,?,?,?)",
        [t.test_code,p[0],p[1],p[2],i+1]
      );
    }
  }

  for (const pkg of packages) {
    await pool.query(
      "INSERT INTO packages (package_code,package_name,price_inr) VALUES (?,?,?) ON DUPLICATE KEY UPDATE package_name=VALUES(package_name), price_inr=VALUES(price_inr)",
      [pkg.package_code,pkg.package_name,pkg.price_inr]
    );
    await pool.query("DELETE FROM package_tests WHERE package_code=?", [pkg.package_code]);
    for (const code of pkg.included_tests) {
      await pool.query("INSERT INTO package_tests (package_code,test_code) VALUES (?,?)", [pkg.package_code, code]);
    }
  }

  await pool.query("INSERT INTO staff (name,phone,role) VALUES ('Amit Jha','9876543210','Field Boy')");

  console.log("Seed completed. Admin: admin@khuntest.com / admin123");
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
