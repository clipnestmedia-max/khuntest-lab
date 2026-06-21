
const jwt = require("jsonwebtoken");

function auth(requiredRole = null) {
  return (req, res, next) => {
    try {
      const header = req.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token) return res.status(401).json({ message: "Missing token" });

      const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");
      if (requiredRole && decoded.role !== requiredRole) {
        return res.status(403).json({ message: "Forbidden" });
      }

      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ message: "Invalid token" });
    }
  };
}

module.exports = auth;
