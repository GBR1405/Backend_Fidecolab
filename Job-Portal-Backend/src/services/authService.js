import { poolPromise } from "../config/db.js"; // Asegúrate de tener poolPromise en lugar de pool
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import sql from 'mssql';

const JWT_SECRET = "76348734687346874363443434343443333333333"; // Cambia esto a una variable de entorno

// Registrar Usuario
export const registerUser = async (user) => {
  try {
    // Verificar si el usuario ya existe
    const result = await poolPromise.request()
      .input("correo", user.correo)
      .query("SELECT * FROM Usuario_TB WHERE Correo = @correo");

    if (result.recordset.length > 0) {
      return { success: false, message: "El usuario ya existe" };
    }

    // Encriptar contraseña
    const hashedPassword = await bcrypt.hash(user.contraseña, 10);

    // Insertar nuevo usuario
    await poolPromise.request()
      .input("nombre", user.nombre)
      .input("correo", user.correo)
      .input("contraseña", hashedPassword)
      .input("rolId", user.rolId)
      .input("generoId", user.generoId)
      .query(`
        INSERT INTO Usuario_TB (Nombre, Correo, Contraseña, Rol_ID_FK, Genero_ID_FK)
        VALUES (@nombre, @correo, @contraseña, @rolId, @generoId)
      `);

    return { success: true, message: "Usuario registrado exitosamente" };
  } catch (error) {
    console.error("Error al registrar el usuario:", error);
    return { success: false, message: "Error en el registro. Intente de nuevo más tarde." };
  }
};

// Iniciar sesión con JWT
export const loginUser = async (correo, contraseña) => {
  try {
    // Buscar usuario por correo
    const result = await poolPromise.request()
      .input("correo", correo)
      .query("SELECT * FROM Usuario_TB WHERE Correo = @correo");

    if (result.recordset.length === 0) {
      return { success: false, message: "Usuario no encontrado" };
    }

    const user = result.recordset[0];

    // Verificar contraseña
    const passwordMatch = await bcrypt.compare(contraseña, user.Contraseña);
    if (!passwordMatch) {
      return { success: false, message: "Contraseña incorrecta" };
    }

    // Generar token JWT
    const token = jwt.sign(
      { id: user.Usuario_ID_PK, correo: user.Correo, rolId: user.Rol_ID_FK },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    return {
      success: true,
      message: "Inicio de sesión exitoso",
      token,
      user: {
        id: user.Usuario_ID_PK,
        nombre: user.Nombre,
        correo: user.Correo,
        rolId: user.Rol_ID_FK,
      },
    };
  } catch (error) {
    console.error("Error al iniciar sesión:", error);
    return { success: false, message: "Error al iniciar sesión. Intente de nuevo más tarde." };
  }
};

// Obtener detalles de usuario desde el token
export const getUserFromToken = async (token) => {
  try {
    // Verificar el token
    const decoded = jwt.verify(token.trim(), JWT_SECRET);

    // Buscar detalles del usuario en la base de datos
    const result = await poolPromise.request()
      .input("id", decoded.id)
      .query("SELECT Usuario_ID_PK, Nombre, Correo, Rol_ID_FK FROM Usuario_TB WHERE Usuario_ID_PK = @id");

    if (result.recordset.length === 0) {
      return { success: false, message: "Usuario no encontrado" };
    }

    const user = result.recordset[0];
    return { success: true, user };
  } catch (error) {
    console.error("Error al verificar el token:", error);
    return { success: false, message: "Token inválido o expirado" };
  }
};

// Genera un JWT para restablecer la contraseña
export const generateResetToken = async (email) => {
  try {
      let pool = await sql.connect(dbConfig);
      const result = await pool.request()
          .input('email', sql.VarChar, email)
          .query('SELECT id FROM Usuario_TB WHERE email = @email');

      if (result.recordset.length === 0) return null;

      const userId = result.recordset[0].id;
      const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' }); // Token válido por 1 hora
      return token;
  } catch (error) {
      console.error("Error generando el token:", error);
      throw error;
  }
};

// Verifica el JWT
export const verifyResetToken = async (token) => {
  try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return decoded.userId;
  } catch (error) {
      return null; // Token inválido o expirado
  }
};

// Actualiza la contraseña en la BD
export const updatePassword = async (userId, newPassword) => {
  try {
    const pool = await poolPromise;

    // Encriptar la nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.request()
      .input('userId', sql.Int, userId)
      .input('newPassword', sql.VarChar, hashedPassword)
      .query('UPDATE Usuario_TB SET Contraseña = @newPassword WHERE Usuario_ID_PK = @userId');
  } catch (error) {
    console.error("Error actualizando contraseña:", error);
    throw error;
  }
};

const authService = {
  registerUser,
  loginUser,
  getUserFromToken,
  generateResetToken,
  verifyResetToken,
  updatePassword,
};

export default authService;
