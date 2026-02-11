const nodemailer = require("nodemailer");
const dns = require("dns").promises;
const net = require("net");

const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === "true" || SMTP_PORT === 465;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_CONNECTION_TIMEOUT = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 15000);
const SMTP_GREETING_TIMEOUT = Number(process.env.SMTP_GREETING_TIMEOUT_MS || 15000);
const SMTP_SOCKET_TIMEOUT = Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000);
const SMTP_FORCE_IPV4 = process.env.SMTP_FORCE_IPV4 !== "false";

function makeTransport({ host, port, secure, tlsServername }) {
  const tls = tlsServername ? { servername: tlsServername } : undefined;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT,
    greetingTimeout: SMTP_GREETING_TIMEOUT,
    socketTimeout: SMTP_SOCKET_TIMEOUT,
    tls
  });
}

function isConnectionTimeout(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "ETIMEDOUT" || message.includes("connection timeout");
}

function isNetworkUnreachable(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "ENETUNREACH" || message.includes("enetunreach") || message.includes("network is unreachable");
}

function isRetryableNetworkError(error) {
  return isConnectionTimeout(error) || isNetworkUnreachable(error);
}

function shouldTryGmailFallback(error, primaryConfig) {
  return (
    isRetryableNetworkError(error) &&
    String(primaryConfig.host || "").toLowerCase() === "smtp.gmail.com" &&
    Number(primaryConfig.port) === 587 &&
    primaryConfig.secure === false
  );
}

async function getPrimaryTargets(primaryConfig) {
  const host = String(primaryConfig.host || "").trim();
  if (!host || !SMTP_FORCE_IPV4 || net.isIP(host)) {
    return [{ ...primaryConfig }];
  }

  try {
    const ipv4List = await dns.resolve4(host);
    if (!Array.isArray(ipv4List) || ipv4List.length === 0) {
      return [{ ...primaryConfig }];
    }

    return ipv4List.map((ipv4) => ({
      ...primaryConfig,
      host: ipv4,
      tlsServername: host
    }));
  } catch {
    return [{ ...primaryConfig }];
  }
}

async function trySendWithTargets(targets, mailOptions) {
  let lastError;
  for (const target of targets) {
    try {
      const transport = makeTransport(target);
      return await transport.sendMail(mailOptions);
    } catch (error) {
      lastError = error;
      if (!isRetryableNetworkError(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function sendMailWithFallback(mailOptions) {
  const primaryConfig = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE
  };

  try {
    const primaryTargets = await getPrimaryTargets(primaryConfig);
    return await trySendWithTargets(primaryTargets, mailOptions);
  } catch (error) {
    if (!shouldTryGmailFallback(error, primaryConfig)) {
      throw error;
    }

    const fallbackConfig = {
      host: SMTP_HOST,
      port: 465,
      secure: true
    };

    const fallbackTargets = await getPrimaryTargets(fallbackConfig);
    return trySendWithTargets(fallbackTargets, mailOptions);
  }
}

async function sendOtpEmail(to, otp) {
  await sendMailWithFallback({
    from: process.env.SMTP_FROM,
    to,
    subject: "Frishta Email Verification OTP",
    text: `Your Frishta OTP is ${otp}. It expires in ${process.env.OTP_EXPIRY_MINUTES} minutes.`
  });
}

async function sendWelcomeEmail({ to, fullName, categories, songs }) {
  const userName = fullName || "Frishta User";
  const selectedCategories = Array.isArray(categories) ? categories : [];
  const matchedSongs = Array.isArray(songs) ? songs : [];

  const attachmentLines = [
    `Welcome to Frishta, ${userName}!`,
    "",
    "Your selected categories:",
    ...selectedCategories.map((category) => `- ${category}`),
    "",
    "Songs for your categories:"
  ];

  if (matchedSongs.length === 0) {
    attachmentLines.push("- No songs available yet for selected categories.");
  } else {
    matchedSongs.forEach((song, index) => {
      attachmentLines.push(`${index + 1}. ${song.title} [${song.category}]`);
      attachmentLines.push(`   ${song.audioUrl}`);
    });
  }

  await sendMailWithFallback({
    from: process.env.SMTP_FROM,
    to,
    subject: "Welcome to Frishta - Your Category Songs",
    text: [
      `Hi ${userName},`,
      "",
      "Your account is verified successfully.",
      "We have attached your category-based song links file.",
      "",
      "Enjoy your music journey with Frishta."
    ].join("\n"),
    attachments: [
      {
        filename: "frishta-category-songs.txt",
        content: attachmentLines.join("\n"),
        contentType: "text/plain"
      }
    ]
  });
}

module.exports = { sendOtpEmail, sendWelcomeEmail };
