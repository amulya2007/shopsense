
(async () => {
  const response = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'adminpass', role: 'admin' })
  });
  const text = await response.text();
  console.log('Status:', response.status);
  console.log('Body:', text);
})();
