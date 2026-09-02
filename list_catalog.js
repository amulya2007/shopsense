const db = require('./server/db');

const products = db.prepare(`
  SELECT id, name, category, price, stock 
  FROM products 
  WHERE vendor_id = 1 
  ORDER BY category, name
`).all();

console.log('\n📦 DEMO CATALOG (Demo Goods Co.)\n');
console.log('═══════════════════════════════════════════════\n');

const byCategory = {};
products.forEach(p => {
  if (!byCategory[p.category]) byCategory[p.category] = [];
  byCategory[p.category].push(p);
});

Object.keys(byCategory).sort().forEach(cat => {
  console.log(`${cat} (${byCategory[cat].length} products):`);
  byCategory[cat].forEach(p => {
    console.log(`  - ${p.name} (₹${p.price}, Stock: ${p.stock})`);
  });
  console.log('');
});

console.log('═══════════════════════════════════════════════');
console.log(`\nTotal: ${products.length} products\n`);
