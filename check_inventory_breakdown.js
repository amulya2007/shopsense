const db = require('./server/db');

console.log('\n🔍 CHECKING INVENTORY BREAKDOWN FOR VENDOR 1\n');

const products = db.prepare(`
  SELECT id, name, stock, 
    CASE 
      WHEN stock <= 0 THEN 'out_of_stock'
      WHEN stock <= 5 THEN 'low_stock' 
      WHEN stock <= 20 THEN 'medium_stock'
      ELSE 'healthy_stock'
    END as status
  FROM products 
  WHERE vendor_id = 1 
  ORDER BY stock
`).all();

console.log(`Total products: ${products.length}\n`);

const counts = products.reduce((acc, p) => {
  acc[p.status] = (acc[p.status] || 0) + 1;
  return acc;
}, {});

console.log('Breakdown by status:');
console.log(`  Out of Stock: ${counts.out_of_stock || 0}`);
console.log(`  Low Stock: ${counts.low_stock || 0}`);
console.log(`  Medium Stock: ${counts.medium_stock || 0}`);
console.log(`  Healthy Stock: ${counts.healthy_stock || 0}`);
console.log(`  Sum: ${(counts.out_of_stock || 0) + (counts.low_stock || 0) + (counts.medium_stock || 0) + (counts.healthy_stock || 0)}`);

console.log('\n📦 All Products:');
products.forEach(p => {
  console.log(`  ID: ${p.id}, Stock: ${p.stock.toString().padStart(3)}, Status: ${p.status.padEnd(15)}, Name: ${p.name}`);
});
