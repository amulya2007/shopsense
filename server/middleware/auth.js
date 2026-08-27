const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "shopsense-dev-secret";

function requireAuth(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    try {
      const payload = jwt.verify(token, SECRET);
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ error: "Forbidden for this role" });
      }
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}

module.exports = { requireAuth, signToken, SECRET };
