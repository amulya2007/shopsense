async function test() {
  const loginRes = await fetch("http://localhost:4000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "vendor@demo.com", password: "vendor123", role: "vendor" })
  });
  const { token } = await loginRes.json();
  const res = await fetch("http://localhost:4000/api/analytics/customers", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  console.log("Customers length:", data.customers?.length);
  console.log("Tiers:", data.summary?.tiers);
  const forecastRes = await fetch("http://localhost:4000/api/analytics/forecast?days=30&scope=all", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const fData = await forecastRes.json();
  console.log("Forecasts:", fData.forecasts?.length);
}
test();
