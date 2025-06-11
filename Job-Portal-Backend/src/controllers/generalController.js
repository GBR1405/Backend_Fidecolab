import sql from "mssql";
import { poolPromise } from "../config/db.js";

/**
 * Registra una acción en la bitácora.
 * @param {number} Usuario_ID_FK - ID del usuario que realiza la acción.
 * @param {string} Accion - Descripción de la acción realizada.
 * @param {string|null} Error - Mensaje de error (o `null` si no hay error).
 */
export const GenerarBitacora = async (Usuario_ID_FK, Accion, Error = null) => {
  try {
    const pool = await poolPromise;
    const Fecha = new Date();

    await pool.request()
      .input("Usuario_ID_FK", sql.Int, Usuario_ID_FK)
      .input("Accion", sql.VarChar(200), Accion)
      .input("Error", sql.VarChar(512), Error || "No Aplica") // Si es null, se pone "No Aplica"
      .input("Fecha", sql.DateTime, Fecha)
      .query(`
        INSERT INTO Bitacora_TB (Usuario_ID_FK, Accion, Error, Fecha) 
        VALUES (@Usuario_ID_FK, @Accion, @Error, @Fecha)
      `);

    console.log(`📌 Bitácora registrada: Usuario ${Usuario_ID_FK} - Acción: "${Accion}"`);

  } catch (error) {
    console.error("❌ Error al registrar en la bitácora:", error);
  }
};

