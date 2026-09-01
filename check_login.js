const db = require('./server/db');
const bcrypt = require('bcryptjs');

console.log('\n🔍 CHECKING LOGIN CREDENTIALS\n');
console.log('═══════════════════════════════════════════════');

// Check vendor
const vendor = db.prepare("SELECT * FROM vendors WHERE email = ?").get('vendor@demo.com');
console.log('\n📦 VENDOR ACCOUNT:');
if (vendor) {
  console.log(`  ✅ Found: ${vendor.full_name}`);
  console.log(`  Email: ${vendor.email}`);
  console.log(`  Business: ${vendor.business_name}`);
  console.log(`  Status: ${vendor.status}`);
  console.log(`  Has Password: ${vendor.password ? 'Yes' : 'No'}`);
  
  // Test password
  const testPassword = 'vendor123';
  const matches = bcrypt.compareSync(testPassword, vendor.password);
  console.log(`  Password 'vendor123' matches: ${matches ? '✅ YES' : '❌ NO'}`);
} else {
  console.log('  ❌ NOT FOUND - Need to create demo vendor');
}

// Check admin
const admin = db.prepare("SELECT * FROM admins WHERE email = ?").get('admin@demo.com');
console.log('\n👤 ADMIN ACCOUNT:');
if (admin) {
  console.log(`  ✅ Found: ${admin.name}`);
  console.log(`  Email: ${admin.email}`);
  console.log(`  Has Password: ${admin.password ? 'Yes' : 'No'}`);
  
  // Test password
  const testPassword = 'admin123';
  const matches = bcrypt.compareSync(testPassword, admin.password);
  console.log(`  Password 'admin123' matches: ${matches ? '✅ YES' : '❌ NO'}`);
} else {
  console.log('  ❌ NOT FOUND - Need to create demo admin');
}

console.log('\n═══════════════════════════════════════════════');
console.log('\n📝 EXPECTED CREDENTIALS:');
console.log('  Vendor: vendor@demo.com / vendor123');
console.log('  Admin: admin@demo.com / admin123');
console.log('\n');
