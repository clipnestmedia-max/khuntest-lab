
CREATE DATABASE IF NOT EXISTS khuntest_lab;
USE khuntest_lab;
CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120), email VARCHAR(120) UNIQUE, password_hash VARCHAR(255), role ENUM('patient','admin','staff') DEFAULT 'patient', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE patients (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, phone VARCHAR(20), age INT, gender VARCHAR(20), address TEXT, FOREIGN KEY (user_id) REFERENCES users(id));
CREATE TABLE tests (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(150), category VARCHAR(100), price DECIMAL(10,2), report_time VARCHAR(50), is_active BOOLEAN DEFAULT TRUE);
CREATE TABLE packages (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(150), description TEXT, price DECIMAL(10,2), is_active BOOLEAN DEFAULT TRUE);
CREATE TABLE package_tests (package_id INT, test_id INT, PRIMARY KEY(package_id,test_id));
CREATE TABLE staff (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120), phone VARCHAR(20), area VARCHAR(120), is_active BOOLEAN DEFAULT TRUE);
CREATE TABLE bookings (id INT AUTO_INCREMENT PRIMARY KEY, booking_code VARCHAR(40) UNIQUE, patient_id INT, test_id INT NULL, package_id INT NULL, booking_type ENUM('Home Collection','Centre Visit'), collection_date DATE, collection_time TIME, address TEXT, status ENUM('Pending','Confirmed','Collected','Reported','Cancelled') DEFAULT 'Pending', assigned_staff_id INT NULL, amount DECIMAL(10,2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE reports (id INT AUTO_INCREMENT PRIMARY KEY, booking_id INT, file_url VARCHAR(500), uploaded_by INT, uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE payments (id INT AUTO_INCREMENT PRIMARY KEY, booking_id INT, razorpay_order_id VARCHAR(120), razorpay_payment_id VARCHAR(120), amount DECIMAL(10,2), status ENUM('Pending','Paid','Failed','Refunded') DEFAULT 'Pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE notifications (id INT AUTO_INCREMENT PRIMARY KEY, booking_id INT, channel ENUM('SMS','WhatsApp','Email'), message TEXT, status VARCHAR(50), sent_at TIMESTAMP NULL);
