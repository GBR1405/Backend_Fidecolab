import sql from "mssql";
import { poolPromise } from "../config/db.js";

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

    console.log(`Bitácora registrada: Usuario ${Usuario_ID_FK} - Acción: "${Accion}"`);

  } catch (error) {
    console.error("Error al registrar en la bitácora:", error);
  }
};

