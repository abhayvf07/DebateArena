// Auth controller — delegates to authService
const authService = require("../services/authService");
const { asyncHandler } = require("../middleware/errorMiddleware");

const setRefreshTokenCookie = (res, token) => {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

const getCookie = (req, name) => {
  const match = req.headers.cookie?.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : null;
};

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const result = await authService.registerUser(req.body);
  setRefreshTokenCookie(res, result.refreshToken);
  delete result.refreshToken;
  res.status(201).json(result);
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const result = await authService.loginUser(req.body);
  setRefreshTokenCookie(res, result.refreshToken);
  delete result.refreshToken;
  res.json(result);
});

// POST /api/auth/refresh-token
const refreshToken = asyncHandler(async (req, res) => {
  const token = getCookie(req, "refreshToken");
  if (!token) {
    return res.status(401).json({ message: "Refresh token is required" });
  }

  const result = await authService.refreshAccessToken(token);
  res.json(result);
});

// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
  res.clearCookie("refreshToken");
  res.json({ message: "Logged out successfully" });
});

// GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user._id);
  res.json(user);
});

// GET /api/auth/stats
const getUserStats = asyncHandler(async (req, res) => {
  const stats = await authService.getUserStats(req.user._id);
  res.json(stats);
});

// PUT /api/auth/avatar
const updateAvatar = asyncHandler(async (req, res) => {
  const user = await authService.updateAvatar(req.user._id, req.file);
  res.json(user);
});

// GET /api/users/leaderboard
const getLeaderboard = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const users = await authService.getLeaderboard(limit);
  res.json(users);
});

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  getUserStats,
  updateAvatar,
  getLeaderboard,
};