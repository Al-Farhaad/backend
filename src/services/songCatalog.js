const fs = require("fs/promises");
const path = require("path");
const { MUSIC_CATEGORIES } = require("../constants/musicCategories");

const SONG_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);
const THUMBNAIL_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function formatTitle(fileName) {
  return path
    .parse(fileName)
    .name
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toMediaPath(folderName, fileName) {
  return `/media/${folderName}/${encodeURIComponent(fileName)}`;
}

function toAbsoluteUrl(baseUrl, mediaPath) {
  if (!baseUrl) return "";
  return `${baseUrl.replace(/\/+$/, "")}${mediaPath}`;
}

async function readFilesByExtension(directoryPath, extensionSet) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => extensionSet.has(path.extname(fileName).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

async function readCategoryOverrides(publicDir) {
  const overridesPath = path.join(publicDir, "song-categories.json");
  try {
    const raw = await fs.readFile(overridesPath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function resolveCategoryForSong(songFile, index, categoryOverrides) {
  const byFileName = categoryOverrides[songFile];
  const byBaseName = categoryOverrides[path.parse(songFile).name];
  const candidate = byFileName ?? byBaseName;

  if (typeof candidate === "string" && MUSIC_CATEGORIES.includes(candidate)) {
    return candidate;
  }

  if (Array.isArray(candidate)) {
    const match = candidate.find((item) => MUSIC_CATEGORIES.includes(item));
    if (match) return match;
  }

  return MUSIC_CATEGORIES[index % MUSIC_CATEGORIES.length];
}

async function getSongCatalog({ baseUrl = "" } = {}) {
  const publicDir = path.join(__dirname, "..", "..", "public");
  const songsDir = path.join(publicDir, "songs");
  const thumbnailsDir = path.join(publicDir, "thumbnails");

  const [songFiles, thumbnailFiles, categoryOverrides] = await Promise.all([
    readFilesByExtension(songsDir, SONG_EXTENSIONS),
    readFilesByExtension(thumbnailsDir, THUMBNAIL_EXTENSIONS),
    readCategoryOverrides(publicDir)
  ]);

  return songFiles.map((songFile, index) => {
    const thumbnailFile = thumbnailFiles.length > 0 ? thumbnailFiles[index % thumbnailFiles.length] : null;
    const category = resolveCategoryForSong(songFile, index, categoryOverrides);
    const audioPath = toMediaPath("songs", songFile);
    const thumbnailPath = thumbnailFile ? toMediaPath("thumbnails", thumbnailFile) : null;

    return {
      id: `song-${index + 1}`,
      title: formatTitle(songFile),
      artist: "Frishta Artist",
      category,
      audioPath,
      thumbnailPath,
      audioUrl: toAbsoluteUrl(baseUrl, audioPath),
      thumbnailUrl: thumbnailPath ? toAbsoluteUrl(baseUrl, thumbnailPath) : ""
    };
  });
}

module.exports = { getSongCatalog };
