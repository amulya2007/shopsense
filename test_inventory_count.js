// Test script to verify inventory counts are accurate
const db = require('./server/db');

console.log('\n📊 INVENTORY COUNT VERIFICATION\n');
console.log('═'.repeat(50));

// Check vendor's catalog products
const vendors = db.prepare('SELECT id, business_name FROM vendors').all();

console.log(`\n👥 Total Vendors: ${vendors.length}\n`);

vendors.forEach(vendor => {
  const catalogCount = db.prepare(`
    SELECT COUNT(*) as count 
    FROM products 
    WHERE vendor_id = ?
  `).get(vendor.id).count;
  
  const catalogByStatus = db.prepare(`
    SELECT 
      SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) as out_of_stock,
      SUM(CASE WHEN stock > 0 AND stock <= 5 THEN 1 ELSE 0 END) as low_stock,
      SUM(CASE WHEN stock > 5 AND stock <= 20 THEN 1 ELSE 0 END) as medium_stock,
      SUM(CASE WHEN stock > 20 THEN 1 ELSE 0 END) as healthy_stock
    FROM products 
    WHERE vendor_id = ?
  `).get(vendor.id);
  
  console.log(`${vendor.business_name} (ID: ${vendor.id})`);
  console.log(`  Total Products: ${catalogCount}`);
  console.log(`  ✅ Healthy Stock: ${catalogByStatus.healthy_stock || 0}`);
  console.log(`  ⚠️  Low Stock: ${catalogByStatus.low_stock || 0}`);
  console.log(`  📦 Medium Stock: ${catalogByStatus.medium_stock || 0}`);
  console.log(`  ❌ Out of Stock: ${catalogByStatus.out_of_stock || 0}`);
  console.log('');
});

// Check dataset products
const datasetCount = db.prepare('SELECT COUNT(*) as count FROM analytics_products').get().count;
console.log(`📊 Historical Dataset Products: ${datasetCount}`);

console.log('\n' + '═'.repeat(50));
console.log('✅ These are the ACCURATE counts that should display\n');
