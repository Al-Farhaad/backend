const express = require("express");
const { auth } = require("../middleware/auth");
const { MUSIC_CATEGORIES } = require("../constants/musicCategories");
const { getSongCatalog } = require("../services/songCatalog");

const router = express.Router();

router.get("/", auth, async (req, res) => {
  try {
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const songs = await getSongCatalog({ baseUrl });
    res.json({ songs });
  } catch (error) {
    res.status(500).json({
      message: "Failed to load songs from public folders",
      error: error.message
    });
  }
});

router.get("/categories", auth, (_, res) => {
  res.json({ categories: MUSIC_CATEGORIES });
});

module.exports = router;
