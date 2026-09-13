const rag = require('./services/ragService');

const SUGGESTED_QUESTIONS = [
  "Show me products in Electronics",
  "What fitness products do you have?",
  "Show me products under ₹1000",
  "Which products are currently out of stock?",
  "Show me beauty products",
  "What's the most expensive product?",
  "Show me Sports & Fitness items",
  "Which products are in Home & Kitchen?"
];

async function run() {
  for (const q of SUGGESTED_QUESTIONS) {
    console.log('====================================================');
    console.log('QUERY:', q);
    const { products, constraints, constraintsMissed } = rag.retrieveProducts(q, 6);
    console.log('CONSTRAINTS:', constraints);
    console.log('MISSED:', constraintsMissed);
    console.log('PRODUCTS FOUND (' + products.length + '):');
    products.forEach((p, i) => console.log(`  ${i+1}. [${p.category}] ${p.name} - ₹${p.price} (Stock: ${p.stock})`));
    const res = await rag.answerShoppingQuestion(q, [], null);
    console.log('ANSWER PREVIEW:');
    console.log(res.answer.slice(0, 200) + '...');
  }
}

run().catch(console.error);
