import rateLimit from "express-rate-limit";

// Este middleware limita el número de intentos de inicio de sesión para prevenir ataques de fuerza bruta
// Es un poco fuerte pero al ser un sistema el cual requiere mucha potencia via backend, es una forma de evitar que se sature si lo atacan
// No se para que atacar al sistema pero, mejor prevenir que lamentar

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 30, 
  message: { success: false, message: "Demasiados intentos de login. Inténtalo más tarde." }
});
