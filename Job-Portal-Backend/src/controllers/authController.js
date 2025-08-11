import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { poolPromise } from "../config/db.js"; 
import UserModel from "../models/userModel.js"; 
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import sql from "mssql";
import { generatePath } from "react-router-dom";
import { GenerarBitacora } from "../controllers/generalController.js";


// Función para registrar un nuevo usuario
export const register = async (req, res) => {
  const { nombre, apellido1, apellido2, correo, contraseña, rolId, generoId } = req.body;

  // Validar los campos requeridos
  if (!nombre || !apellido1 || !apellido2 || !correo || !contraseña || !rolId || !generoId) {
    return res.status(400).json({ success: false, message: "All fields are required" });
  }

  try {
    const pool = await poolPromise;

    // Verificar si el usuario ya existe
    const result = await pool.request()
      .input("correo", correo)
      .query("SELECT 1 FROM Usuario_TB WHERE Correo = @correo");

    if (result.recordset.length > 0) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    // Encriptar la contraseña
    const hashedPassword = await bcrypt.hash(contraseña, 10);

    // Insertar el nuevo usuario en la base de datos
    await pool.request()
      .input("nombre", nombre)
      .input("apellido1", apellido1)
      .input("apellido2", apellido2)
      .input("correo", correo)
      .input("contraseña", hashedPassword)
      .input("rolId", rolId)
      .input("generoId", generoId)
      .query(`
        INSERT INTO Usuario_TB (Nombre, Apellido1, Apellido2, Correo, Contraseña, Rol_ID_FK, Genero_ID_FK, Estado)
        VALUES (@nombre, @apellido1, @apellido2, @correo, @contraseña, @rolId, @generoId, 1)
      `);

    const newUser = new UserModel({
      nombre,
      apellido1,
      apellido2,
      correo,
      contraseña: hashedPassword,
      rolId,
      generoId,
    });

    return res.status(201).json({ success: true, message: "User registered successfully", user: newUser });
  } catch (error) {
    console.error("Error registering user:", error);
    return res.status(500).json({ success: false, message: "Registration failed. Please try again later." });
  }
};

dotenv.config();

// Función para iniciar sesión (login) de un usuario
export const login = async (req, res) => {
  const { correo, contraseña } = req.body;

  if (!correo || !contraseña) {
    return res.status(400).json({ success: false, message: "Email and password are required" });
  }

  try {
    const pool = await poolPromise;

    // Buscar al usuario
    const result = await pool.request()
      .input("correo", sql.VarChar, correo)
      .query(`
        SELECT u.Usuario_ID_PK, u.Contraseña, u.Nombre, u.Apellido1, u.Apellido2, u.Correo, 
               r.Rol, u.Estado, g.Tipo_Genero AS Genero
        FROM Usuario_TB u
        JOIN Rol_TB r ON u.Rol_ID_FK = r.Rol_ID_PK
        JOIN Genero_TB g ON u.Genero_ID_FK = g.Genero_ID_PK
        WHERE u.Correo = @correo
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ success: false, message: "Credenciales no validas" });
    }

    const user = result.recordset[0];

    if (user.Estado !== true) {
      return res.status(403).json({ success: false, message: "Su cuenta no está disponible. Contacte al administrador." });
    }

    // Comparar contraseñas
    const isMatch = await bcrypt.compare(contraseña, user.Contraseña);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Credenciales no validas" });
    }

    // Generar el JWT
    const token = jwt.sign(
      { id: user.Usuario_ID_PK, correo: user.Correo, rol: user.Rol }, 
      process.env.JWT_SECRET, 
      { expiresIn: '1d' } 
    );

    // Enviar el JWT y el objeto de usuario al frontend
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token, // Envía el JWT
      user: {
        id: user.Usuario_ID_PK,
        nombre: user.Nombre,
        apellido1: user.Apellido1,
        apellido2: user.Apellido2,
        correo: user.Correo,
        genero: user.Genero,
        rol: user.Rol,
      }
    });

  } catch (error) {
    console.error("Error logging in user:", error);
    return res.status(500).json({ success: false, message: "Login failed. Please try again later." });
  }
};



// Configuracion de Recuperar Contraseña
dotenv.config(); 

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST, 
  port: 587, 
  secure: false,  
  auth: {
    user: process.env.EMAIL_USER,  
    pass: process.env.EMAIL_PASS,  
  },
  tls: {
    rejectUnauthorized: false, 
  },
});


//Contraseña Olvidada
export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const pool = await poolPromise; 

    const result = await pool.request()
      .input("correo", email)
      .query("SELECT * FROM Usuario_TB WHERE Correo = @correo");

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const user = result.recordset[0]; 
    const token = jwt.sign({ id: user.Usuario_ID_PK }, process.env.JWT_SECRET, { expiresIn: "15m" });

    // Construir el enlace de recuperación
    const resetLink = `https://frontend-fidecolab.vercel.app/reset-password?token=${token}`;

    // Enviar el correo
    await transporter.sendMail({
      from: `"Soporte" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Recuperación de Contraseña",
      html: `
    <html>
      <head>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            background-color: #f4f6f9;
            margin: 0;
            padding: 0;
            color: #333;
          }
          .container {
            width: 100%;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px;
            background-color: rgb(19, 30, 173);
            border-radius: 8px 8px 0 0;
            color: #ffffff;
          }
          .header img {
            width: 100px;
            margin-bottom: 10px;
          }
          .content {
            padding: 20px;
            font-size: 16px;
          }
          .button {
            display: block;
            width: 80%;
            padding: 12px 24px;
            background-color: rgb(214, 214, 214);
            color: #ffffff;
            text-decoration: none;
            border-radius: 5px;
            font-size: 16px;
            margin-top: 20px;
            text-align: center;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 14px;
            color: #888;
          }
          .footer p {
            margin: 10px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <img src="https://cdn.ufidelitas.ac.cr/wp-content/uploads/2023/11/17075151/FideLogo-04.png" alt="Logo" />
            <h1>Recuperación de Contraseña - FideColab</h1>
          </div>
          <div class="content">
            <p>Hola ${user.Nombre},</p>
            <p>Hemos recibido una solicitud para restablecer tu contraseña en la plataforma de FideColab. Haz clic en el siguiente botón para restablecerla:</p>
            <a href="${resetLink}" class="button" target="_blank">Restablecer Contraseña</a>
            <p>Este enlace es válido por 15 minutos. Si no solicitaste el restablecimiento de contraseña, por favor ignora este correo.</p>
          </div>
          <div class="footer">
            <p>Si tienes problemas, por favor contacta con nuestro soporte.</p>
            <p>Gracias por ser parte de nuestra comunidad.</p>
          </div>
        </div>
      </body>
    </html>
  `,
});
    

    res.json({ message: "Correo enviado. Revisa tu bandeja de entrada." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al enviar el correo" });
  }
};

export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    // Verificar el token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Realizar la consulta SQL para obtener el usuario
    const pool = await poolPromise; // Esperar la conexión al pool de la base de datos
    const result = await pool.request()
      .input('id', sql.Int, decoded.id)  // Asignar el id del token al parámetro
      .query('SELECT * FROM Usuario_TB WHERE Usuario_ID_PK = @id');

    const user = result.recordset[0]; // Obtener el primer usuario encontrado

    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

    // Hashear la nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Actualizar la contraseña en la base de datos
    await pool.request()
      .input('id', sql.Int, user.Usuario_ID_PK) // ID del usuario
      .input('newPassword', sql.NVarChar, hashedPassword) // Contraseña hasheada
      .query('UPDATE Usuario_TB SET Contraseña = @newPassword WHERE Usuario_ID_PK = @id');

    res.json({ message: "Contraseña actualizada con éxito" });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: "Token inválido o expirado" });
  }
};

// Función para actualizar los datos del usuario
export const updateUser = async (req, res) => {
  const { generoId } = req.body;

  // Asegurarse de que el middleware de autenticación asignó req.user
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, message: "Usuario no autenticado" });
  }

  const userId = req.user.id;

  if (!generoId) {
    return res.status(400).json({ success: false, message: "Genero ID es requerido" });
  }

  try {
    const pool = await poolPromise;

    // Verificar si el usuario existe por ID
    const userCheck = await pool.request()
      .input("id", sql.Int, userId)
      .query("SELECT * FROM Usuario_TB WHERE Usuario_ID_PK = @id");

    if (userCheck.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    }

    // Realizar la actualización
    await pool.request()
      .input("id", sql.Int, userId)
      .input("generoId", sql.Int, generoId)
      .query(`
        UPDATE Usuario_TB
        SET Genero_ID_FK = @generoId
        WHERE Usuario_ID_PK = @id
      `);

    return res.status(200).json({ success: true, message: "Género actualizado correctamente" });

  } catch (error) {
    console.error("Error al actualizar el usuario:", error);
    return res.status(500).json({ success: false, message: "Error interno del servidor" });
  }
};



 
// Función para obtener detalles completos del usuario
export const getFullUserDetails = async (req, res) => {
  const token = req.headers.authorization?.split(' ')[2];
 
  if (!token) {
    return res.status(401).json({ success: false, message: "Token not provided" });
  }
 
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const usuarioId = decoded.usuarioId;
 
    if (!usuarioId) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }
 
    const pool = await poolPromise;
 
    // Obtener todos los detalles del usuario, incluyendo género, rol y grupo
    const result = await pool.request()
      .input("usuarioId", sql.Int, usuarioId)
      .query(`
        SELECT 
    u.Usuario_ID_PK AS id,
    u.Nombre AS name,
    u.Correo AS email,
    g.Tipo_Genero AS gender,
    r.Rol AS role,
    gc.Codigo_Grupo AS groupName
    FROM Usuario_TB u
      JOIN Genero_TB g ON u.Genero_ID_FK = g.Genero_ID_PK
      JOIN Rol_TB r ON u.Rol_ID_FK = r.Rol_ID_PK
      LEFT JOIN GrupoVinculado_TB gv ON u.Usuario_ID_PK = gv.Usuario_ID_FK
      LEFT JOIN GrupoCurso_TB gc ON gv.GrupoCurso_ID_FK = gc.GrupoCurso_ID_PK
    WHERE u.Usuario_ID_PK = @usuarioId;

      `);

      console.log(result);
 
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
 
    return res.status(200).json({ success: true, user: result.recordset[0] });
 
  } catch (error) {
    console.error("Error fetching user details:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve user details" });
  }
};

export const updatePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: "Debes proporcionar ambas contraseñas." });
  }

  try {
    const pool = await poolPromise;

    // Obtener la contraseña actual desde la DB
    const result = await pool.request()
      .input("userId", sql.Int, userId)
      .query("SELECT Contraseña FROM Usuario_TB WHERE Usuario_ID_PK = @userId");

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    }

    const storedHashedPassword = result.recordset[0].Contraseña;

    // Comparar contraseña actual
    const isMatch = await bcrypt.compare(currentPassword, storedHashedPassword);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "La contraseña actual es incorrecta" });
    }

    // Hashear la nueva contraseña
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Actualizar la nueva contraseña
    await pool.request()
      .input("userId", sql.Int, userId)
      .input("newPassword", sql.NVarChar, hashedNewPassword)
      .query("UPDATE Usuario_TB SET Contraseña = @newPassword WHERE Usuario_ID_PK = @userId");

    return res.status(200).json({ success: true, message: "Contraseña actualizada correctamente" });

  } catch (error) {
    console.error("Error al actualizar la contraseña:", error);
    return res.status(500).json({ success: false, message: "No se pudo actualizar la contraseña" });
  }
};
