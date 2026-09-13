const db = require('./db');

console.log('--- VENDORS ---');
console.log(db.prepare('SELECT id, full_name, business_name, email FROM vendors').all());

console.log('--- PRODUCTS ---');
console.log(db.prepare('SELECT id, name, category, price, stock, vendor_id FROM products').all());

