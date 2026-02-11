const Session = require("../models/Session");
const { hashSessionToken } = require("../utils/crypto");

async function auth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return res.status(401).json({ message: "Missing token" });

  const tokenHash = hashSessionToken(token);
  const session = await Session.findOne({ tokenHash }).lean();
  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ message: "Invalid session" });
  }

  req.userId = session.userId;
  req.tokenHash = tokenHash;
  next();
}

module.exports = { auth };
