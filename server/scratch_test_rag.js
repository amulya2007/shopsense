const rag = require('./services/ragService');

async function test() {
  console.log('--- TEST 1: No history, vendorId = null ---');
  let res1 = await rag.answerShoppingQuestion('Which products are in Home & Kitchen?', [], null);
  console.log('Result 1 Answer:');
  console.log(res1.answer);
  console.log('Result 1 Products:', res1.products.map(p => ({ id: p.id, name: p.name, category: p.category })));

  console.log('\n--- TEST 2: With history mentioning Men Cotton Crew T-Shirt ---');
  const history = [
    {
      role: 'assistant',
      products: [{ name: "Men's Cotton Crew T-Shirt", category: "Fashion" }]
    }
  ];
  let res2 = await rag.answerShoppingQuestion('Which products are in Home & Kitchen?', history, null);
  console.log('Result 2 Answer:');
  console.log(res2.answer);
  console.log('Result 2 Products:', res2.products.map(p => ({ id: p.id, name: p.name, category: p.category })));

  console.log('\n--- TEST 3: vendorId = 1 ---');
  let res3 = await rag.answerShoppingQuestion('Which products are in Home & Kitchen?', history, 1);
  console.log('Result 3 Answer:');
  console.log(res3.answer);
  console.log('Result 3 Products:', res3.products.map(p => ({ id: p.id, name: p.name, category: p.category })));

  console.log('\n--- TEST 4: vendorId = 2 ---');
  let res4 = await rag.answerShoppingQuestion('Which products are in Home & Kitchen?', history, 2);
  console.log('Result 4 Answer:');
  console.log(res4.answer);
  console.log('Result 4 Products:', res4.products.map(p => ({ id: p.id, name: p.name, category: p.category })));
}

test().catch(console.error);
