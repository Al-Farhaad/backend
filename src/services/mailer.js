const nodemailer = require("nodemailer");

function makeTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendOtpEmail(to, otp) {
  const transport = makeTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Frishta Email Verification OTP",
    text: `Your Frishta OTP is ${otp}. It expires in ${process.env.OTP_EXPIRY_MINUTES} minutes.`
  });
}

async function sendWelcomeEmail({ to, fullName, categories, songs }) {
  const transport = makeTransport();
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

  await transport.sendMail({
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
