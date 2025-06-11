import { poolPromise } from "../config/db.js";  // Importamos el poolPromise
import UserModel from "../models/userModel.js";

// Obtener todos los usuarios
export const getAllUsers = async (req, res) => {
  try {
    const pool = await poolPromise;  // Esperamos que se resuelva el pool de conexiones
    const result = await pool.request().query("SELECT * FROM Usuario_TB");

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "No users found" });
    }

    // Mapear los resultados a objetos UserModel
    const users = result.recordset.map((user) => new UserModel(user));

    return res.status(200).json(users); // Retornar los usuarios como respuesta
  } catch (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({ message: "Error retrieving users. Please try again later." });
  }
};

// Crear un nuevo usuario
export const createUser = async (req, res) => {
  const { nombre, correo, contraseña, rolId, generoId} = req.body;

  // Validar los campos requeridos
  if (!nombre || !correo || !contraseña || !rolId || !generoId) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const pool = await poolPromise;  // Esperamos que se resuelva el pool de conexiones

    // Verificar si el usuario ya existe
    const result = await pool.request()
      .input("correo", correo)
      .query("SELECT * FROM Usuario_TB WHERE Correo = @correo");

    if (result.recordset.length > 0) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Encriptar la contraseña
    const hashedPassword = await bcrypt.hash(contraseña, 10);

    // Insertar el nuevo usuario en la base de datos
    const insertResult = await pool.request()
      .input("nombre", nombre)
      .input("correo", correo)
      .input("contraseña", hashedPassword)
      .input("rolId", rolId)
      .input("generoId", generoId)
      .query(`
        INSERT INTO Usuario_TB (Nombre, Correo, Contraseña, Rol_ID_FK, Genero_ID_FK)
        VALUES (@nombre, @correo, @contraseña, @rolId, @generoId)
      `);

    // Crear un nuevo objeto UserModel con los datos
    const newUser = new UserModel({ 
      nombre, 
      correo, 
      contraseña: hashedPassword, 
      rolId, 
      generoId
    });

    return res.status(201).json({ message: "User registered successfully", user: newUser });
  } catch (error) {
    console.error("Error creating user:", error);
    return res.status(500).json({ message: "Error creating user. Please try again later." });
  }
};
