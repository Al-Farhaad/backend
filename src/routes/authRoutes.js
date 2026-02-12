const express = require("express");
const User = require("../models/User");
const OtpCode = require("../models/OtpCode");
const Session = require("../models/Session");
const { sendOtpEmail, sendWelcomeEmail } = require("../services/mailer");
const { MUSIC_CATEGORIES } = require("../constants/musicCategories");
const { getSongCatalog } = require("../services/songCatalog");
const {
  hashPassword,
  verifyPassword,
  randomOtp,
  hashOtp,
  randomSessionToken,
  hashSessionToken
} = require("../utils/crypto");
const { auth } = require("../middleware/auth");

const router = express.Router();
const GENDERS = new Set(["male", "female", "other"]);
const PHONE_REGEX = /^[+\d][\d\s-]{6,19}$/;

function normalizeCategoryKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

const CATEGORY_LOOKUP = new Map(
  MUSIC_CATEGORIES.map((category) => [normalizeCategoryKey(category), category])
);

function canonicalizeCategory(value) {
  return CATEGORY_LOOKUP.get(normalizeCategoryKey(value)) || null;
}

router.post("/register/start", async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      role,
      phoneNo,
      country,
      state: stateName,
      gender,
      age,
      categories
    } = req.body;

    if (!fullName || !email || !password || !role || !phoneNo || !country || !stateName || !gender || age == null) {
      return res.status(400).json({ message: "Missing fields" });
    }

    if (!["artist", "listener"].includes(role)) return res.status(400).json({ message: "Invalid role" });

    const normalizedGender = String(gender).trim().toLowerCase();
    if (!GENDERS.has(normalizedGender)) return res.status(400).json({ message: "Invalid gender" });

    const parsedAge = Number(age);
    if (!Number.isInteger(parsedAge) || parsedAge < 5 || parsedAge > 120) {
      return res.status(400).json({ message: "Invalid age" });
    }

    const normalizedPhoneNo = String(phoneNo).trim();
    if (!PHONE_REGEX.test(normalizedPhoneNo)) {
      return res.status(400).json({ message: "Invalid phone number" });
    }

    const normalizedCountry = String(country).trim();
    const normalizedState = String(stateName).trim();
    if (!normalizedCountry || !normalizedState) {
      return res.status(400).json({ message: "Country and state are required" });
    }

    const canonicalizedCategories = Array.isArray(categories)
      ? categories.map((category) => canonicalizeCategory(category))
      : [];

    const normalizedCategories = canonicalizedCategories.filter(Boolean);

    if (canonicalizedCategories.some((category) => !category)) {
      return res.status(400).json({ message: "One or more categories are invalid" });
    }

    if (normalizedCategories.length !== 3) {
      return res.status(400).json({ message: "Please select exactly 3 categories" });
    }

    if (new Set(normalizedCategories).size !== normalizedCategories.length) {
      return res.status(400).json({ message: "Duplicate categories are not allowed" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing && existing.isEmailVerified) return res.status(409).json({ message: "Email already registered" });

    const { salt, hash } = hashPassword(password);

    await User.findOneAndUpdate(
      { email: normalizedEmail },
      {
        fullName: String(fullName).trim(),
        role,
        phoneNo: normalizedPhoneNo,
        country: normalizedCountry,
        state: normalizedState,
        gender: normalizedGender,
        age: parsedAge,
        categories: normalizedCategories,
        passwordHash: hash,
        passwordSalt: salt,
        isEmailVerified: false
      },
      { upsert: true, returnDocument: "after" }
    );

    const otp = randomOtp();
    const otpHash = hashOtp(otp, process.env.OTP_PEPPER);
    const expiresAt = new Date(Date.now() + Number(process.env.OTP_EXPIRY_MINUTES || 10) * 60 * 1000);

    await OtpCode.findOneAndUpdate(
      { email: normalizedEmail },
      { otpHash, expiresAt, attempts: 0 },
      { upsert: true, returnDocument: "after" }
    );

    const payload = {
      message: "OTP generated. Please check your email.",
      emailQueued: true
    };

    if (process.env.EXPOSE_OTP_IN_RESPONSE === "true") {
      payload.otp = otp;
    }

    res.json(payload);

    sendOtpEmail(normalizedEmail, otp)
      .then(() => {
        console.log(`OTP email sent to ${normalizedEmail}`);
      })
      .catch((error) => {
        console.error(`OTP email failed for ${normalizedEmail}:`, error?.message || error);
      });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

router.post("/register/verify", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = (email || "").toLowerCase().trim();

    const record = await OtpCode.findOne({ email: normalizedEmail });
    if (!record) return res.status(400).json({ message: "OTP not found" });
    if (record.expiresAt < new Date()) return res.status(400).json({ message: "OTP expired" });
    if (record.attempts >= 5) return res.status(429).json({ message: "Too many attempts" });

    const incomingHash = hashOtp(String(otp), process.env.OTP_PEPPER);
    if (incomingHash !== record.otpHash) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const user = await User.findOneAndUpdate(
      { email: normalizedEmail },
      { isEmailVerified: true },
      { returnDocument: "after" }
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    await OtpCode.deleteOne({ email: normalizedEmail });

    try {
      const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const catalog = await getSongCatalog({ baseUrl });
      const rawSelectedCategories = Array.isArray(user.categories)
        ? user.categories.map((category) => String(category || "").trim()).filter(Boolean)
        : [];
      const canonicalSelectedCategories = rawSelectedCategories
        .map((category) => canonicalizeCategory(category))
        .filter(Boolean);
      const selectedCategories =
        canonicalSelectedCategories.length > 0 ? canonicalSelectedCategories : rawSelectedCategories;
      const selectedKeys = new Set(selectedCategories.map((category) => normalizeCategoryKey(category)));
      const songsForUser = catalog.filter((song) => {
        return selectedKeys.has(normalizeCategoryKey(song.category));
      });

      await sendWelcomeEmail({
        to: user.email,
        fullName: user.fullName,
        categories: selectedCategories,
        songs: songsForUser
      });
    } catch (emailError) {
      console.error("Welcome email failed:", emailError.message);
    }

    res.json({ message: "Email verified. You can now login." });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

router.post("/register/resend", async (req, res) => {
  try {
    const normalizedEmail = (req.body?.email || "").toLowerCase().trim();
    if (!normalizedEmail) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: "User not found. Please register first." });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ message: "Email is already verified" });
    }

    const otp = randomOtp();
    const otpHash = hashOtp(otp, process.env.OTP_PEPPER);
    const expiresAt = new Date(Date.now() + Number(process.env.OTP_EXPIRY_MINUTES || 10) * 60 * 1000);

    await OtpCode.findOneAndUpdate(
      { email: normalizedEmail },
      { otpHash, expiresAt, attempts: 0 },
      { upsert: true, returnDocument: "after" }
    );

    const payload = {
      message: "New OTP generated. Please check your email.",
      emailQueued: true
    };

    if (process.env.EXPOSE_OTP_IN_RESPONSE === "true") {
      payload.otp = otp;
    }

    res.json(payload);

    sendOtpEmail(normalizedEmail, otp)
      .then(() => {
        console.log(`Resend OTP email sent to ${normalizedEmail}`);
      })
      .catch((error) => {
        console.error(`Resend OTP email failed for ${normalizedEmail}:`, error?.message || error);
      });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = (email || "").toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    if (!user.isEmailVerified) return res.status(403).json({ message: "Email not verified" });

    const ok = verifyPassword(password, user.passwordSalt, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = randomSessionToken();
    const tokenHash = hashSessionToken(token);
    const days = Number(process.env.SESSION_EXPIRY_DAYS || 7);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await Session.create({
      userId: user._id,
      tokenHash,
      userAgent: req.headers["user-agent"] || "",
      expiresAt
    });

    res.json({
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        phoneNo: user.phoneNo,
        country: user.country,
        state: user.state,
        gender: user.gender,
        age: user.age,
        categories: user.categories
      }
    });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

router.get("/me", auth, async (req, res) => {
  const user = await User.findById(req.userId).select(
    "fullName email role phoneNo country state gender age categories"
  );
  if (!user) return res.status(404).json({ message: "User not found" });
  res.json({ user });
});

router.post("/logout", auth, async (req, res) => {
  await Session.deleteOne({ tokenHash: req.tokenHash });
  res.json({ message: "Logged out" });
});

module.exports = router;
