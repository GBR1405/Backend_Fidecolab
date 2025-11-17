import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import CryptoJS from "crypto-js";

//Este archivo contiene el middleware de autenticación que verifica el JWT en las cookies de las solicitudes entrantes
//Usalo cuando sea necesario, en realidad es mejor usarlo para todo, quitando login o los CRUD que no requieran un usuario autenticado

const secretKey = process.env.JWT_SECRET; 

export const authMiddleware = (req, res, next) => {
  try {

      const token = req.cookies.authToken;

      if (!token) {
          console.log("No se recibió la cookie authToken.");
          return res.status(401).json({ message: "No autorizado" });
      }

      const decoded = jwt.verify(token, secretKey);

      req.user = decoded;
      next();
  } catch (error) {
      console.log("Error al verificar el token:", error); // Mostrar error en consola
      return res.status(403).json({ message: "Token inválido o expirado" });
  }
};


export default authMiddleware;
