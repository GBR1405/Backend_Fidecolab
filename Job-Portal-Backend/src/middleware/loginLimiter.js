import rateLimit from "express-rate-limit";

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 30, 
  message: { success: false, message: "Demasiados intentos de login. Inténtalo más tarde." }
});
