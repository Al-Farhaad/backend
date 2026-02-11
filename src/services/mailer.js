const RESEND_API_BASE_URL = process.env.RESEND_API_BASE_URL || "https://api.resend.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "Frishta <onboarding@resend.dev>";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || "";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return [value];
}

async function sendResendEmail({ to, subject, text, html }) {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set");
  }

  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available in this Node runtime");
  }

  const payload = {
    from: RESEND_FROM,
    to: toArray(to),
    subject,
    text,
    html
  };

  if (RESEND_REPLY_TO) {
    payload.reply_to = RESEND_REPLY_TO;
  }

  const response = await fetch(`${RESEND_API_BASE_URL.replace(/\/+$/, "")}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      (Array.isArray(data?.errors) && data.errors.length > 0 ? data.errors[0]?.message : "") ||
      `Resend API request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

function buildSongsText(songs) {
  const matchedSongs = Array.isArray(songs) ? songs : [];
  if (matchedSongs.length === 0) {
    return ["No songs available yet for your selected categories."];
  }

  return matchedSongs.map((song, index) => {
    const title = song?.title || "Untitled";
    const category = song?.category || "Unknown Category";
    const url = song?.audioUrl || song?.audioPath || "";
    return `${index + 1}. ${title} [${category}]${url ? `\n   ${url}` : ""}`;
  });
}

function buildSongsHtml(songs) {
  const matchedSongs = Array.isArray(songs) ? songs : [];
  if (matchedSongs.length === 0) {
    return "<li>No songs available yet for your selected categories.</li>";
  }

  return matchedSongs
    .map((song) => {
      const title = escapeHtml(song?.title || "Untitled");
      const category = escapeHtml(song?.category || "Unknown Category");
      const url = song?.audioUrl || song?.audioPath || "";
      if (!url) {
        return `<li><strong>${title}</strong> <em>[${category}]</em></li>`;
      }
      const safeUrl = escapeHtml(url);
      return `<li><strong>${title}</strong> <em>[${category}]</em> - <a href="${safeUrl}">Listen</a></li>`;
    })
    .join("");
}

async function sendOtpEmail(to, otp) {
  const expiryMinutes = Number(process.env.OTP_EXPIRY_MINUTES || 10);
  const safeOtp = escapeHtml(otp);

  await sendResendEmail({
    to,
    subject: "Frishta Email Verification OTP",
    text: `Your Frishta OTP is ${otp}. It expires in ${expiryMinutes} minutes.`,
    html: [
      "<div style=\"font-family:Arial,sans-serif;line-height:1.5\">",
      "<h2>Frishta Email Verification</h2>",
      `<p>Your OTP is:</p><p style="font-size:24px;font-weight:700;letter-spacing:2px">${safeOtp}</p>`,
      `<p>This OTP expires in ${expiryMinutes} minutes.</p>`,
      "<p>If you did not request this, you can ignore this email.</p>",
      "</div>"
    ].join("")
  });
}

async function sendWelcomeEmail({ to, fullName, categories, songs }) {
  const userName = fullName || "Frishta User";
  const selectedCategories = Array.isArray(categories) ? categories : [];
  const songLines = buildSongsText(songs);
  const songsHtml = buildSongsHtml(songs);

  await sendResendEmail({
    to,
    subject: "Welcome to Frishta - Your Category Songs",
    text: [
      `Hi ${userName},`,
      "",
      "Your account is verified successfully.",
      "",
      "Your selected categories:",
      ...(selectedCategories.length > 0
        ? selectedCategories.map((category) => `- ${category}`)
        : ["- None selected"]),
      "",
      "Songs for your categories:",
      ...songLines,
      "",
      "Enjoy your music journey with Frishta."
    ].join("\n"),
    html: [
      "<div style=\"font-family:Arial,sans-serif;line-height:1.5\">",
      `<h2>Welcome to Frishta, ${escapeHtml(userName)}!</h2>`,
      "<p>Your account is verified successfully.</p>",
      "<h3>Your selected categories</h3>",
      selectedCategories.length > 0
        ? `<ul>${selectedCategories.map((category) => `<li>${escapeHtml(category)}</li>`).join("")}</ul>`
        : "<p>None selected.</p>",
      "<h3>Suggested songs for you</h3>",
      `<ol>${songsHtml}</ol>`,
      "<p>Enjoy your music journey with Frishta.</p>",
      "</div>"
    ].join("")
  });
}

module.exports = { sendOtpEmail, sendWelcomeEmail };
