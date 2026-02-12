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

function getOverrideForSong(songFile, categoryOverrides) {
  return categoryOverrides[songFile] ?? categoryOverrides[path.parse(songFile).name] ?? null;
}

function normalizeThumbnailPath(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  const normalized = trimmed.replace(/\\/g, "/");
  if (normalized.startsWith("/media/")) return normalized;
  if (normalized.startsWith("media/")) return `/${normalized}`;

  const fileName = normalized.split("/").filter(Boolean).pop();
  if (!fileName) return "";
  return toMediaPath("thumbnails", fileName);
}

function resolveCategoryForSong(songFile, index, categoryOverrides) {
  const candidate = getOverrideForSong(songFile, categoryOverrides);
  const categoryCandidate = typeof candidate === "object" && candidate ? candidate.category : candidate;

  if (typeof categoryCandidate === "string" && MUSIC_CATEGORIES.includes(categoryCandidate)) {
    return categoryCandidate;
  }

  if (Array.isArray(categoryCandidate)) {
    const match = categoryCandidate.find((item) => MUSIC_CATEGORIES.includes(item));
    if (match) return match;
  }

  return MUSIC_CATEGORIES[index % MUSIC_CATEGORIES.length];
}

function resolveThumbnailPathForSong(songFile, index, thumbnailFiles, categoryOverrides) {
  const candidate = getOverrideForSong(songFile, categoryOverrides);

  if (typeof candidate === "object" && candidate) {
    const overrideThumbnailPath =
      normalizeThumbnailPath(
        candidate.thumbnailPath ||
          candidate.thumbnail ||
          candidate.thumbnailFile ||
          candidate.imagePath ||
          candidate.image
      ) || "";

    if (overrideThumbnailPath) {
      return overrideThumbnailPath;
    }
  }

  const songBaseName = path.parse(songFile).name.toLowerCase();
  const sameNameMatch = thumbnailFiles.find(
    (thumbnailFile) => path.parse(thumbnailFile).name.toLowerCase() === songBaseName
  );
  if (sameNameMatch) {
    return toMediaPath("thumbnails", sameNameMatch);
  }

  if (process.env.SONG_THUMBNAIL_FALLBACK_INDEX === "true" && thumbnailFiles.length > 0) {
    return toMediaPath("thumbnails", thumbnailFiles[index % thumbnailFiles.length]);
  }

  return null;
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
    const category = resolveCategoryForSong(songFile, index, categoryOverrides);
    const audioPath = toMediaPath("songs", songFile);
    const thumbnailPath = resolveThumbnailPathForSong(songFile, index, thumbnailFiles, categoryOverrides);

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
