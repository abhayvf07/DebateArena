// Server startup
require("dotenv").config();

// Crash if frontend URL is missing in production
if (process.env.NODE_ENV === "production" && !process.env.CLIENT_URL) {
  console.error("FATAL: CLIENT_URL must be set in production");
  process.exit(1);
}

const express = require("express");
const connectDB = require("./config/db");
const http = require("http");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");

const { errorHandler } = require("./middleware/errorMiddleware");
const { initSocket } = require("./socket/index");

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);

// Real-time sockets
initSocket(server);

// Security headers
app.use(helmet({ crossOriginResourcePolicy: false }));

// CORS
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  }),
);

// Request logging
app.use(morgan(":method :url :status :response-time ms"));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Sanitization
app.use(mongoSanitize());
app.use(xss());

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: "Too many auth requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { message: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", generalLimiter, require("./routes/userRoutes"));
app.use("/api/debates", generalLimiter, require("./routes/debateRoutes"));
app.use("/api/arguments", generalLimiter, require("./routes/argumentRoutes"));
app.use("/api/bookmarks", generalLimiter, require("./routes/bookmarkRoutes"));
app.use("/api/reports", generalLimiter, require("./routes/reportRoutes"));
app.use("/api/admin", generalLimiter, require("./routes/adminRoutes"));

// Health check
app.get("/", (req, res) => {
  res.json({ message: "Internet Debate Arena API is running" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Start server after DB connects
const startServer = async () => {
  try {
    await connectDB();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
};

startServer();