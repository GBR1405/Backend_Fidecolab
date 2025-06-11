import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import CryptoJS from "crypto-js"; // Asegúrate de tener CryptoJS importado

const secretKey = process.env.JWT_SECRET; // Asegúrate de definir esto en tu .env

export const authMiddleware = (req, res, next) => {
  try {
      // Leer el JWT desde la cookie 'authToken'
      const token = req.cookies.authToken;

      if (!token) {
          console.log("No se recibió la cookie authToken.");
          return res.status(401).json({ message: "No autorizado" });
      }

      // Verificar el JWT
      const decoded = jwt.verify(token, secretKey);

      // Adjuntar la información del usuario a la solicitud
      req.user = decoded;
      next();
  } catch (error) {
      console.log("Error al verificar el token:", error); // Mostrar error en consola
      return res.status(403).json({ message: "Token inválido o expirado" });
  }
};


export default authMiddleware;
