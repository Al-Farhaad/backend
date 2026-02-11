require("dotenv").config();
const app = require("./app");
const { connectDB } = require("./config/db");

async function start() {
  await connectDB(process.env.MONGODB_URI);
  const port = Number(process.env.PORT || 5000);
  app.listen(port, () => console.log(`API running on http://localhost:${port}`));
}

start().catch((error) => {
  console.error("Failed to start server:", error.message);
  process.exit(1);
});
