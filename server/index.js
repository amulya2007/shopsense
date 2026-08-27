require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
require("./db"); // initializes + seeds the database

const authRoutes = require("./routes/auth");
const vendorRoutes = require("./routes/vendor");
const adminRoutes = require("./routes/admin");
const analyticsRoutes = require("./routes/analytics");

const app = express();
const allowedOrigins = [
  "http://localhost:5173",
  "https://shopsense-client.onrender.com",
  process.env.CLIENT_ORIGIN,
].filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Requests without an Origin header include Render health checks and server-to-server calls.
    if (!origin || allowedOrigins.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
}));
app.use(express.json({ limit: "2mb" }));
// Product uploads receive unique filenames, so they can be safely cached by the
// browser instead of being downloaded again whenever a catalog page is opened.
app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  maxAge: "1y",
  immutable: true,
}));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/analytics", analyticsRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request is too large. Use a smaller image and try again." });
  }
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid request data. Please check the form and try again." });
  }
  return res.status(err.status && err.status >= 400 && err.status < 500 ? err.status : 500).json({
    error: err.status && err.status >= 400 && err.status < 500 ? err.message : "Unable to process this request. Please try again.",
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`ShopSense API running on port ${PORT}`));
