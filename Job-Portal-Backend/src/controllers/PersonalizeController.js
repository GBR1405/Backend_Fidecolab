import { sql, poolPromise } from "../config/db.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import fetch from "node-fetch";
import multer from "multer";

// Obtener juegos disponibles
export const getTipoJuegos = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT * FROM Tipo_Juego_TB");
    res.json({ success: true, juegos: result.recordset });
  } catch (error) {
    console.error("Error al obtener juegos:", error);
    res.status(500).json({ success: false, error: "Error al obtener juegos" });
  }
};

// Obtener temas activos de un juego
export const getTemasPorJuego = async (req, res) => {
  try {
    const { juegoId } = req.params;
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("JuegoID", sql.Int, juegoId)
      .query("SELECT * FROM Tema_Juego_TB WHERE Tipo_Juego_ID_FK = @JuegoID AND Estado = 1");

    res.json({ success: true, temas: result.recordset });
  } catch (error) {
    console.error("Error al obtener temas:", error);
    res.status(500).json({ success: false, error: "Error al obtener temas" });
  }
};

export const getTemasPorJuegoTotal = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .query(`
        SELECT tjt.Tema_Juego_ID_PK, tjt.Tipo_Juego_ID_FK, tj.Juego AS Tipo_Juego, 
               tjt.Contenido, tjt.Estado
        FROM Tema_Juego_TB tjt
        JOIN Tipo_Juego_TB tj ON tjt.Tipo_Juego_ID_FK = tj.Tipo_Juego_ID_PK
        ORDER BY tjt.Tema_Juego_ID_PK DESC
      `);  
    res.json({ success: true, temas: result.recordset });
  } catch (error) {
    console.error("Error al obtener temas:", error);
    res.status(500).json({ success: false, error: "Error al obtener temas" });
  }
};




// Guardar configuración de personalización
export const guardarPersonalizacion = async (req, res) => {
    try {
        // Desestructurar los datos recibidos del frontend
        const { juegos, titulo, usuarioId } = req.body; // No necesitamos personalizacionId aquí

        if (!usuarioId) {
            return res.status(400).json({ success: false, error: "ID de usuario no proporcionado" });
        }

        if (!juegos || juegos.length === 0) {
            return res.status(400).json({ success: false, error: "No hay juegos seleccionados" });
        }

        const pool = await poolPromise;

        // Crear la nueva personalización
        const resultPersonalizacion = await pool
            .request()
            .input("Nombre", sql.NVarChar, titulo)
            .input("UsuarioID", sql.Int, usuarioId)
            .query(
                "INSERT INTO Personalizacion_TB (Nombre_Personalizacion, Usuario_ID_FK, Estado) OUTPUT INSERTED.Personalizacion_ID_PK VALUES (@Nombre, @UsuarioID, 1)"
            );

        const personalizacionId = resultPersonalizacion.recordset[0].Personalizacion_ID_PK;

        // Insertar la configuración de juegos
        for (const juego of juegos) {
            //console.log("Juego a insertar:", juego);

            if ((juego.Juego !== 'Memoria' && (!juego.tema || juego.tema === null || juego.tema === undefined))) {
              return res.status(400).json({ success: false, error: "Tema no seleccionado para el juego " + juego.Juego });
            }

            await pool
                .request()
                .input("JuegoID", sql.Int, juego.Tipo_Juego_ID_PK)
                .input("PersonalizacionID", sql.Int, personalizacionId)
                .input("Dificultad", sql.Int, juego.dificultad)
                .input("Orden", sql.Int, juego.orden)
                .input("TemaID", sql.Int, juego.tema)
                .query(
                    "INSERT INTO ConfiguracionJuego_TB (Tipo_Juego_ID_FK, Personalizacion_ID_PK, Dificultad, Orden, Tema_Juego_ID_FK) VALUES (@JuegoID, @PersonalizacionID, @Dificultad, @Orden, @TemaID)"
                );
        }

        res.json({ success: true, message: "Configuración guardada con éxito" });
    } catch (error) {
        console.error("Error al guardar personalización:", error);
        res.status(500).json({ success: false, error: "Error al guardar configuración" });
    }
};

export const editarPersonalizacion = async (req, res) => {
  try {
      const { juegos, personalizacionId, titulo, usuarioId } = req.body;

      if (!usuarioId) {
          return res.status(400).json({ success: false, error: "ID de usuario no proporcionado" });
      }

      if (!personalizacionId) {
          return res.status(400).json({ success: false, error: "ID de personalización no proporcionado" });
      }

      if (!juegos || juegos.length === 0) {
          return res.status(400).json({ success: false, error: "No hay juegos seleccionados" });
      }

      const pool = await poolPromise;

      // Verificar si la personalización está siendo usada en alguna partida
      const partidaResult = await pool
          .request()
          .input("PersonalizacionID", sql.Int, personalizacionId)
          .query("SELECT COUNT(*) as count FROM Partida_TB WHERE Personalizacion_ID_FK = @PersonalizacionID");

      const estaEnUso = partidaResult.recordset[0].count > 0;

      let nuevaPersonalizacionId = personalizacionId;

      // Si está en uso, crear una copia y desactivar la original
      if (estaEnUso) {
          // Crear la nueva personalización (copia)
          const resultNuevaPersonalizacion = await pool
              .request()
              .input("Nombre", sql.NVarChar, titulo)
              .input("UsuarioID", sql.Int, usuarioId)
              .query(
                  "INSERT INTO Personalizacion_TB (Nombre_Personalizacion, Usuario_ID_FK) OUTPUT INSERTED.Personalizacion_ID_PK VALUES (@Nombre, @UsuarioID)"
              );

          nuevaPersonalizacionId = resultNuevaPersonalizacion.recordset[0].Personalizacion_ID_PK;

          // Copiar la configuración de juegos a la nueva personalización
          for (const juego of juegos) {
              await pool
                  .request()
                  .input("JuegoID", sql.Int, juego.Tipo_Juego_ID_PK)
                  .input("PersonalizacionID", sql.Int, nuevaPersonalizacionId)
                  .input("Dificultad", sql.Int, juego.dificultad)
                  .input("Orden", sql.Int, juego.orden)
                  .input("TemaID", sql.Int, juego.tema)
                  .query(
                      "INSERT INTO ConfiguracionJuego_TB (Tipo_Juego_ID_FK, Personalizacion_ID_PK, Dificultad, Orden, Tema_Juego_ID_FK) VALUES (@JuegoID, @PersonalizacionID, @Dificultad, @Orden, @TemaID)"
                  );
          }

          // Desactivar la personalización original
          await pool
              .request()
              .input("PersonalizacionID", sql.Int, personalizacionId)
              .query("UPDATE Personalizacion_TB SET Activo = 0 WHERE Personalizacion_ID_PK = @PersonalizacionID");

          return res.json({ 
              success: true, 
              message: "La personalización estaba en uso en partidas existentes. Se ha creado una copia y desactivado la original.",
              nuevaPersonalizacionId 
          });
      } else {
          // Si no está en uso, editar normalmente
          // Actualizar el nombre de la personalización
          await pool
              .request()
              .input("PersonalizacionID", sql.Int, personalizacionId)
              .input("Titulo", sql.NVarChar, titulo)
              .query("UPDATE Personalizacion_TB SET Nombre_Personalizacion = @Titulo WHERE Personalizacion_ID_PK = @PersonalizacionID");

          // Eliminar los juegos anteriores
          await pool
              .request()
              .input("PersonalizacionID", sql.Int, personalizacionId)
              .query("DELETE FROM ConfiguracionJuego_TB WHERE Personalizacion_ID_PK = @PersonalizacionID");

          // Insertar los nuevos juegos
          for (const juego of juegos) {
              await pool
                  .request()
                  .input("JuegoID", sql.Int, juego.Tipo_Juego_ID_PK)
                  .input("PersonalizacionID", sql.Int, personalizacionId)
                  .input("Dificultad", sql.Int, juego.dificultad)
                  .input("Orden", sql.Int, juego.orden)
                  .input("TemaID", sql.Int, juego.tema)
                  .query(
                      "INSERT INTO ConfiguracionJuego_TB (Tipo_Juego_ID_FK, Personalizacion_ID_PK, Dificultad, Orden, Tema_Juego_ID_FK) VALUES (@JuegoID, @PersonalizacionID, @Dificultad, @Orden, @TemaID)"
                  );
          }

          return res.json({ success: true, message: "Configuración editada con éxito" });
      }
  } catch (error) {
      console.error("Error al editar personalización:", error);
      res.status(500).json({ success: false, error: "Error al editar configuración" });
  }
};

// Obtener configuración guardada por usuario
export const getConfiguracionPersonalizada = async (req, res) => {
  try {
    const token = req.cookies.IFUser_Info;
    if (!token) return res.status(401).json({ success: false, error: "Usuario no autenticado" });

    const decoded = jwt.verify(token, "tu_secreto_jwt");
    const usuarioId = decoded.id;

    const pool = await poolPromise;

    // Obtener la personalización más reciente del usuario
    const result = await pool
      .request()
      .input("UsuarioID", sql.Int, usuarioId)
      .query(
        `SELECT p.Personalizacion_ID_PK, p.Nombre_Personalizacion, c.Tipo_Juego_ID_FK, t.Juego, 
          c.Dificultad, c.Orden, c.Tema_Juego_ID_FK, tm.Contenido AS Tema
          FROM Personalizacion_TB p
          JOIN ConfiguracionJuego_TB c ON p.Personalizacion_ID_PK = c.Personalizacion_ID_PK
          JOIN Tipo_Juego_TB t ON c.Tipo_Juego_ID_FK = t.Tipo_Juego_ID_PK
          JOIN Tema_Juego_TB tm ON c.Tema_Juego_ID_FK = tm.Tema_Juego_ID_PK
          WHERE p.Usuario_ID_FK = @UsuarioID
          ORDER BY p.Personalizacion_ID_PK DESC, c.Orden ASC`
      );

    if (result.recordset.length === 0) {
      return res.json({ success: false, error: "No hay configuraciones guardadas" });
    }

    const personalizacion = {
      id: result.recordset[0].Personalizacion_ID_PK,
      nombre: result.recordset[0].Nombre_Personalizacion,
      juegos: result.recordset.map((row) => ({
        Tipo_Juego_ID_PK: row.Tipo_Juego_ID_FK,
        Juego: row.Juego,
        Dificultad: row.Dificultad,
        Orden: row.Orden,
        Tema_Juego_ID_FK: row.Tema_Juego_ID_FK,
        Tema: row.Tema,
      })),
    };

    res.json({ success: true, personalizacion });
  } catch (error) {
    console.error("Error al obtener configuración personalizada:", error);
    res.status(500).json({ success: false, error: "Error al obtener configuración" });
  }
};

// Controlador para guardar tema de juego
export const saveTemaJuego = async (req, res) => {

  try {
    const { tipoJuegoID, contenido } = req.body;

    if (!tipoJuegoID || !contenido) {
      return res.status(400).json({ success: false, error: "Tipo de juego y contenido son requeridos" });
    }

    var pool = await poolPromise;
    var sqlQuery = `
      INSERT INTO Tema_Juego_TB (Tipo_Juego_ID_FK, Contenido, Estado)
      VALUES (@tipoJuegoID, @contenido, @estado)
    `;

    await pool
      .request()
      .input("tipoJuegoID", sql.Int, tipoJuegoID)
      .input("contenido", sql.NVarChar, contenido) // Guarda la URL de la imagen o el texto
      .input("estado", sql.Bit, 1) // Estado activo
      .query(sqlQuery);

    res.json({ success: true, message: "Tema guardado correctamente" });
  } catch (error) {
    console.error("Error al guardar tema:", error);
    res.status(500).json({ success: false, error: "Error al guardar tema" });
  }
};

export const deletePersonalization = async (req, res) => {
  try {
    const { personalizationId } = req.body;

    if (!personalizationId) {
      return res.status(400).json({ success: false, error: "El ID de la personalización es requerido" });
    }

    var pool = await poolPromise;

    // Primero verificar si la personalización está siendo usada en Partida_TB
    var checkUsageQuery = `
      SELECT COUNT(*) as usageCount 
      FROM Partida_TB 
      WHERE Personalizacion_ID_FK = @personalizationId
    `;
    
    const usageResult = await pool.request()
      .input("personalizationId", sql.Int, personalizationId)
      .query(checkUsageQuery);

    const isUsed = usageResult.recordset[0].usageCount > 0;

    if (isUsed) {
      // Si está siendo usada, actualizar el estado a 2 (inactivo)
      var updateQuery = `
        UPDATE Personalizacion_TB
        SET Estado = 2
        WHERE Personalizacion_ID_PK = @personalizationId
      `;
      await pool.request()
        .input("personalizationId", sql.Int, personalizationId)
        .query(updateQuery);

      return res.json({ 
        success: true, 
        message: "La personalización está en uso. Se ha marcado como inactiva (Estado 2) en lugar de borrarla." 
      });
    } else {
      // Si no está siendo usada, borrar completamente
      var deletePersonalizationQuery = `
        DELETE FROM Personalizacion_TB
        WHERE Personalizacion_ID_PK = @personalizationId
      `;
      await pool.request()
        .input("personalizationId", sql.Int, personalizationId)
        .query(deletePersonalizationQuery);

      return res.json({ 
        success: true, 
        message: "Personalización eliminada correctamente" 
      });
    }

  } catch (error) {
    console.error("Error al eliminar personalización:", error);
    res.status(500).json({ 
      success: false, 
      error: "Error al eliminar personalización",
      details: error.message 
    });
  }
};

export const obtenerPersonalizacionPorId = async (req, res) => {
  try {
    console.log("Obteniendo personalización por ID...");
    console.log("Headers:", req.body);
    
    // Obtener el ID de los parámetros de consulta
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        error: "ID de personalización no proporcionado"
      });
    }

    const pool = await poolPromise;

    // 1. Obtener información básica de la personalización
    const personalizacionResult = await pool
      .request()
      .input("PersonalizacionID", sql.Int, id)
      .query(`
        SELECT 
          Personalizacion_ID_PK as id,
          Nombre_Personalizacion as titulo,
          Usuario_ID_FK as usuarioId
        FROM Personalizacion_TB
        WHERE Personalizacion_ID_PK = @PersonalizacionID
        AND Estado = 1  -- Asumiendo que 1 significa activo
      `);

    if (personalizacionResult.recordset.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Personalización no encontrada o inactiva"
      });
    }

    const personalizacion = personalizacionResult.recordset[0];

    // 2. Obtener juegos configurados
    const juegosResult = await pool
      .request()
      .input("PersonalizacionID", sql.Int, id)
      .query(`
        SELECT 
          cj.ConfiguracionJuego_ID_PK,
          cj.Orden,
          cj.Dificultad,
          cj.Tema_Juego_ID_FK as temaId,
          tj.Tipo_Juego_ID_PK,
          tj.Juego
        FROM ConfiguracionJuego_TB cj
        JOIN Tipo_Juego_TB tj ON cj.Tipo_Juego_ID_FK = tj.Tipo_Juego_ID_PK
        WHERE cj.Personalizacion_ID_PK = @PersonalizacionID
        ORDER BY cj.Orden
      `);

    const juegos = juegosResult.recordset;

    // 3. Obtener temas para cada juego (excepto Memoria)
    const juegosConTemas = await Promise.all(
      juegos.map(async (juego) => {
        if (juego.Juego === 'Memoria') {
          return { 
            ...juego,
            temas: [],
            tema: null
          };
        }

        const temasResult = await pool
          .request()
          .input("JuegoID", sql.Int, juego.Tipo_Juego_ID_PK)
          .query(`
            SELECT 
              Tema_Juego_ID_PK as id,
              Nombre,
              Contenido
            FROM Tema_Juego_TB
            WHERE Tipo_Juego_ID_FK = @JuegoID
          `);

        return {
          ...juego,
          temas: temasResult.recordset,
          tema: juego.temaId  // Mantener el tema seleccionado
        };
      })
    );

    res.json({
      success: true,
      personalizacion: {
        id: personalizacion.id,
        titulo: personalizacion.titulo,
        usuarioId: personalizacion.usuarioId,
        juegos: juegosConTemas
      }
    });

  } catch (error) {
    console.error("Error al obtener personalización:", error);
    
    res.status(500).json({ 
      success: false, 
      error: "Error al obtener personalización",
      details: error.message 
    });
  }
};


