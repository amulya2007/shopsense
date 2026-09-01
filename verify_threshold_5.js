const db = require('./server/db');

console.log('\n✅ VERIFYING THRESHOLD = 5 BEHAVIOR\n');
console.log('═══════════════════════════════════════════════');

const products = db.prepare(`
  SELECT id, name, stock 
  FROM products 
  WHERE vendor_id = 1
  ORDER BY stock
`).all();

console.log('\n📦 All Products for Demo Goods Co.:\n');

const outOfStock = [];
const lowStock = [];
const healthy = [];

products.forEach(p => {
  if (p.stock === 0) {
    outOfStock.push(p);
    console.log(`  ❌ OUT OF STOCK - ${p.name}: ${p.stock} units`);
  } else if (p.stock <= 5) {
    lowStock.push(p);
    console.log(`  ⚠️  LOW STOCK - ${p.name}: ${p.stock} units`);
  } else {
    healthy.push(p);
    console.log(`  ✅ HEALTHY - ${p.name}: ${p.stock} units`);
  }
});

console.log('\n═══════════════════════════════════════════════');
console.log('\n📊 SUMMARY (Threshold = 5):\n');
console.log(`  Total Products: ${products.length}`);
console.log(`  Out of Stock (0): ${outOfStock.length}`);
console.log(`  Low Stock (1-5): ${lowStock.length}`);
console.log(`  Healthy (6+): ${healthy.length}`);
console.log(`  Math: ${outOfStock.length} + ${lowStock.length} + ${healthy.length} = ${products.length} ✅`);

console.log('\n═══════════════════════════════════════════════');
console.log('\n🔔 NOTIFICATIONS SHOULD SHOW:\n');
console.log(`  Total Alerts: ${outOfStock.length + lowStock.length}`);
if (outOfStock.length > 0) {
  console.log(`  ${outOfStock.length} out of stock`);
  outOfStock.forEach(p => console.log(`    - ${p.name}`));
}
if (lowStock.length > 0) {
  console.log(`  ${lowStock.length} low stock`);
  lowStock.forEach(p => console.log(`    - ${p.name} (${p.stock} units)`));
}

console.log('\n═══════════════════════════════════════════════');
console.log('\n✅ EXPECTED BEHAVIOR:\n');
console.log('  Stock = 0     → OUT OF STOCK notification ❌');
console.log('  Stock 1-5     → LOW STOCK notification ⚠️');
console.log('  Stock > 5     → NO notification ✅');
console.log('\n');
