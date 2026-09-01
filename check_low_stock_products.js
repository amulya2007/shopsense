const db = require('./server/db');

console.log('\n🔍 CHECKING LOW STOCK PRODUCTS FOR VENDOR 1\n');

const products = db.prepare(`
  SELECT id, name, stock 
  FROM products 
  WHERE vendor_id = 1 AND stock <= 5 
  ORDER BY stock
`).all();

console.log(`Products with stock <= 5 (Low Stock Threshold):`);
console.log(`Total: ${products.length}\n`);

if (products.length === 0) {
  console.log('  ✅ No low stock products!\n');
} else {
  products.forEach(p => {
    const status = p.stock === 0 ? '❌ OUT OF STOCK' : '⚠️  LOW STOCK';
    console.log(`  ${status} - ${p.name}: ${p.stock} units`);
  });
}

console.log('\n═══════════════════════════════════════════════');

// Check what Inventory Health shows
const allProducts = db.prepare(`
  SELECT stock
  FROM products 
  WHERE vendor_id = 1
`).all();

const outOfStock = allProducts.filter(p => p.stock === 0).length;
const lowStock = allProducts.filter(p => p.stock > 0 && p.stock <= 5).length;
const healthy = allProducts.filter(p => p.stock > 5).length;

console.log('\nInventory Health Should Show:');
console.log(`  Total Products: ${allProducts.length}`);
console.log(`  Healthy Stock: ${healthy}`);
console.log(`  Low Stock: ${lowStock}`);
console.log(`  Out of Stock: ${outOfStock}`);
console.log(`  Math: ${healthy} + ${lowStock} + ${outOfStock} = ${healthy + lowStock + outOfStock} ✅`);
console.log('\n');
