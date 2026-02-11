const nodemailer = require("nodemailer");

const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === "true" || SMTP_PORT === 465;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_CONNECTION_TIMEOUT = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 15000);
const SMTP_GREETING_TIMEOUT = Number(process.env.SMTP_GREETING_TIMEOUT_MS || 15000);
const SMTP_SOCKET_TIMEOUT = Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000);

function makeTransport({ host, port, secure }) {
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
    socketTimeout: SMTP_SOCKET_TIMEOUT
  });
}

function isConnectionTimeout(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "ETIMEDOUT" || message.includes("connection timeout");
}

function shouldTryGmailFallback(error, primaryConfig) {
  return (
    isConnectionTimeout(error) &&
    String(primaryConfig.host || "").toLowerCase() === "smtp.gmail.com" &&
    Number(primaryConfig.port) === 587 &&
    primaryConfig.secure === false
  );
}

async function sendMailWithFallback(mailOptions) {
  const primaryConfig = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE
  };

  try {
    const transport = makeTransport(primaryConfig);
    return await transport.sendMail(mailOptions);
  } catch (error) {
    if (!shouldTryGmailFallback(error, primaryConfig)) {
      throw error;
    }

    const fallbackConfig = {
      host: SMTP_HOST,
      port: 465,
      secure: true
    };

    const fallbackTransport = makeTransport(fallbackConfig);
    return fallbackTransport.sendMail(mailOptions);
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
