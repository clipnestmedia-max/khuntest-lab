
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role ENUM('admin','patient','staff') NOT NULL DEFAULT 'patient',
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  is_active TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  patient_code VARCHAR(50) UNIQUE,
  name VARCHAR(150) NOT NULL,
  age VARCHAR(20),
  gender VARCHAR(20),
  phone VARCHAR(20),
  whatsapp VARCHAR(20),
  email VARCHAR(150),
  address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  test_code VARCHAR(50) UNIQUE NOT NULL,
  test_name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  sample VARCHAR(100),
  report_time VARCHAR(100),
  price_inr DECIMAL(10,2) DEFAULT 0,
  is_active TINYINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS test_parameters (
  id INT AUTO_INCREMENT PRIMARY KEY,
  test_code VARCHAR(50) NOT NULL,
  parameter_name VARCHAR(255) NOT NULL,
  normal_value VARCHAR(255),
  unit VARCHAR(80),
  sort_order INT DEFAULT 0,
  FOREIGN KEY (test_code) REFERENCES tests(test_code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS packages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  package_code VARCHAR(50) UNIQUE NOT NULL,
  package_name VARCHAR(255) NOT NULL,
  price_inr DECIMAL(10,2) DEFAULT 0,
  is_active TINYINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS package_tests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  package_code VARCHAR(50),
  test_code VARCHAR(50),
  FOREIGN KEY (package_code) REFERENCES packages(package_code) ON DELETE CASCADE,
  FOREIGN KEY (test_code) REFERENCES tests(test_code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS staff (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(80) DEFAULT 'Field Boy',
  is_active TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_code VARCHAR(50) UNIQUE NOT NULL,
  bill_no VARCHAR(50),
  remote_no VARCHAR(50),
  patient_id INT,
  patient_name VARCHAR(150),
  patient_age VARCHAR(20),
  patient_gender VARCHAR(20),
  phone VARCHAR(20),
  whatsapp VARCHAR(20),
  email VARCHAR(150),
  address TEXT,
  booking_type ENUM('Home Collection','Centre Visit') DEFAULT 'Home Collection',
  rate_type ENUM('General','Rebat','Lab Charge','Clinical') DEFAULT 'General',
  pathology_name VARCHAR(150) DEFAULT 'BN-MAIN',
  ref_doctor VARCHAR(150),
  co_name VARCHAR(150),
  field_boy_id INT,
  field_boy_name VARCHAR(150),
  associate_lab VARCHAR(150),
  admission_date DATETIME,
  collection_date DATETIME,
  reporting_date DATETIME,
  status ENUM('Pending','Confirmed','Collected','Provisional','Reported','Released','Cancelled') DEFAULT 'Pending',
  gross_total DECIMAL(10,2) DEFAULT 0,
  cash_received DECIMAL(10,2) DEFAULT 0,
  card_received DECIMAL(10,2) DEFAULT 0,
  online_received DECIMAL(10,2) DEFAULT 0,
  discount DECIMAL(10,2) DEFAULT 0,
  balance_due DECIMAL(10,2) DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
  FOREIGN KEY (field_boy_id) REFERENCES staff(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS booking_tests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  test_code VARCHAR(50),
  test_name VARCHAR(255),
  price_inr DECIMAL(10,2) DEFAULT 0,
  status ENUM('Pending','Provisional','Reported','Released') DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_values (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_test_id INT NOT NULL,
  parameter_name VARCHAR(255) NOT NULL,
  normal_value VARCHAR(255),
  finding VARCHAR(255),
  unit VARCHAR(80),
  comment TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_test_id) REFERENCES booking_tests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  report_no VARCHAR(80) UNIQUE,
  file_name VARCHAR(255),
  file_url TEXT,
  status ENUM('Draft','Provisional','Released') DEFAULT 'Draft',
  released_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT,
  razorpay_order_id VARCHAR(255),
  razorpay_payment_id VARCHAR(255),
  amount DECIMAL(10,2),
  payment_method VARCHAR(80),
  status ENUM('Created','Paid','Failed','Refunded') DEFAULT 'Created',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT,
  patient_phone VARCHAR(20),
  channel ENUM('SMS','WhatsApp','Email') DEFAULT 'WhatsApp',
  message TEXT,
  status VARCHAR(80),
  provider_response TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
);
