const rag = require('./services/ragService');

async function testConversation() {
  console.log('Turn 1: Ask "Show me products under ₹1000"');
  const res1 = await rag.answerShoppingQuestion('Show me products under ₹1000', [], 1);
  console.log('Turn 1 Answer products:', res1.products.map(p => p.name));

  const history = [
    {
      role: 'assistant',
      products: res1.products.map(p => ({ name: p.name, category: p.category }))
    }
  ];

  console.log('\nTurn 2: Now ask "Which products are in Home & Kitchen?"');
  const res2 = await rag.answerShoppingQuestion('Which products are in Home & Kitchen?', history, 1);
  console.log('Turn 2 Answer:');
  console.log(res2.answer);
  console.log('Turn 2 Answer products:', res2.products.map(p => ({ name: p.name, category: p.category })));
}

testConversation().catch(console.error);
