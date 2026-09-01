const db = require('./server/db');

console.log('\n🔍 CHECKING DATABASE\n');
console.log('═══════════════════════════════════════════════');

// Check vendor
const vendor = db.prepare("SELECT id, full_name, business_name, email, status FROM vendors WHERE email = ?").get('vendor@demo.com');
console.log('\n📦 VENDOR ACCOUNT:');
if (vendor) {
  console.log(`  ✅ Found: ${vendor.full_name}`);
  console.log(`  ID: ${vendor.id}`);
  console.log(`  Email: ${vendor.email}`);
  console.log(`  Business: ${vendor.business_name}`);
  console.log(`  Status: ${vendor.status}`);
} else {
  console.log('  ❌ NOT FOUND');
}

// Check admin
const admin = db.prepare("SELECT id, name, email FROM admins WHERE email = ?").get('admin@demo.com');
console.log('\n👤 ADMIN ACCOUNT:');
if (admin) {
  console.log(`  ✅ Found: ${admin.name}`);
  console.log(`  ID: ${admin.id}`);
  console.log(`  Email: ${admin.email}`);
} else {
  console.log('  ❌ NOT FOUND');
}

// Check products count
const products = db.prepare("SELECT COUNT(*) as count FROM products WHERE vendor_id = 1").get();
console.log('\n📦 PRODUCTS FOR VENDOR 1:');
console.log(`  Total: ${products.count} products`);

// Check inventory status
const inventory = db.prepare(`
  SELECT 
    SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END) as out_of_stock,
    SUM(CASE WHEN stock > 0 AND stock <= 5 THEN 1 ELSE 0 END) as low_stock,
    SUM(CASE WHEN stock > 5 THEN 1 ELSE 0 END) as healthy
  FROM products 
  WHERE vendor_id = 1
`).get();

console.log('\n📊 INVENTORY STATUS (Threshold = 5):');
console.log(`  Out of Stock (0): ${inventory.out_of_stock}`);
console.log(`  Low Stock (1-5): ${inventory.low_stock}`);
console.log(`  Healthy (6+): ${inventory.healthy}`);
console.log(`  Total: ${inventory.out_of_stock + inventory.low_stock + inventory.healthy}`);

console.log('\n═══════════════════════════════════════════════\n');
