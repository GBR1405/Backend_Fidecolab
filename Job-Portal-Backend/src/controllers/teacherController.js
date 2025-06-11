import { poolPromise } from '../config/db.js'; // Importar la conexión
import sql from 'mssql';
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import multer from "multer";
import xlsx from "xlsx";
import pdfkit from "pdfkit";
import bcrypt from 'bcryptjs';

import { io } from '../app.js';


export const obtenerCursosPersonalizados = async (req, res) => {
    try {
        const userId = req.user.id;  

        // Realizar la consulta usando poolPromise
        const pool = await poolPromise;  // Esperar la conexión al pool
        const result = await pool.request()
            .input('userId', sql.Int, userId)  // Añadir el parámetro para la consulta
            .query(`
                SELECT 
                    p.Personalizacion_ID_PK,
                    p.Nombre_Personalizacion,
                    COUNT(cj.ConfiguracionJuego_ID_PK) AS Total_Juegos
                FROM Personalizacion_TB p
                LEFT JOIN ConfiguracionJuego_TB cj
                    ON cj.Personalizacion_ID_PK = p.Personalizacion_ID_PK
                WHERE p.Usuario_ID_FK = @userId AND p.Estado = 1
                GROUP BY p.Personalizacion_ID_PK, p.Nombre_Personalizacion
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: "No se encontraron personalizaciones para este usuario." });
        }

        // Enviar los resultados
        return res.json(result.recordset);

    } catch (error) {
        console.error("Error al obtener cursos personalizados:", error);
        return res.status(500).json({ message: "Error al obtener cursos personalizados." });
    }
};

export const obtenerGruposVinculados = async (req, res) => {
    try {
        const userId = req.user.id;  // ID del usuario extraído del token

        // Realizar la consulta usando el poolPromise
        const pool = await poolPromise;  // Esperar la conexión al pool
        const result = await pool.request()
            .input('userId', sql.Int, userId)  // Añadir el parámetro para la consulta
            .query(`
                SELECT 
                    gv.GruposEncargados_ID_PK,
                    gc.Codigo_Grupo,
                    cc.Codigo_Curso,
                    cc.Nombre_Curso,
                    CONCAT(gc.Codigo_Grupo, ' - ', cc.Nombre_Curso) AS Codigo_Grupo_Nombre
                FROM GrupoVinculado_TB gv
                INNER JOIN GrupoCurso_TB gc
                    ON gv.GrupoCurso_ID_FK = gc.GrupoCurso_ID_PK
                INNER JOIN CodigoCurso_TB cc
                    ON gc.Curso_ID_FK = cc.CodigoCurso_ID_PK
                WHERE gv.Usuario_ID_FK = @userId
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: "No se encontraron grupos vinculados para este usuario." });
        }

        // Enviar los resultados
        return res.json(result.recordset);

    } catch (error) {
        console.error("Error al obtener los grupos vinculados:", error);
        return res.status(500).json({ message: "Error al obtener los grupos vinculados." });
    }
};

export const agregarEstudiante = async (req, res) => {
  try {
      console.log("Datos recibidos", req.body);
      const { manual, estudiantes } = req.body;
      let estudiantesData = [];
      let saltados = 0;
      let nuevosEstudiantes = [];

      // Obtener el ID del rol 'Estudiante'
      const pool = await poolPromise;
      const rolResult = await pool.request().query(`SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = 'Estudiante'`);

      if (rolResult.recordset.length === 0) {
          return res.status(400).json({ mensaje: "El rol 'Estudiante' no está disponible en la base de datos." });
      }

      const rolId = rolResult.recordset[0].Rol_ID_PK;
      console.log('ID del rol de Estudiante:', rolId);

      if (manual === "true") {
          const { name, lastName1, lastName2, email, gender, grupoId } = req.body;

          if (!name || !lastName1 || !lastName2 || !email || !gender || !grupoId) {
              return res.status(400).json({ message: 'Todos los campos son obligatorios' });
          }

          const generatedPassword = generatePassword(name);
          const hashedPassword = await bcrypt.hash(generatedPassword, 10);

          estudiantesData.push({
              name,
              lastName1,
              lastName2,
              email,
              password: hashedPassword,
              generatedPassword,
              rolId,
              generoId: gender,
              grupoId
          });

      } else {
          if (!estudiantes || estudiantes.length === 0) {
              return res.status(400).json({ mensaje: "No se han recibido datos de estudiantes." });
          }

          estudiantesData = estudiantes.map(est => {
              const generatedPassword = generatePassword(est.name);
              return {
                  name: est.name,
                  lastName1: est.lastName1,
                  lastName2: est.lastName2,
                  email: est.email,
                  password: bcrypt.hashSync(generatedPassword, 10),
                  generatedPassword,
                  rolId,
                  generoId: est.gender,
                  grupoId: req.body.grupoId
              };
          });
      }

      for (const est of estudiantesData) {
          console.log('Procesando estudiante:', est);

          let existingUserResult = await pool.request()
              .input("email", sql.NVarChar, est.email)
              .query(`SELECT Usuario_ID_PK FROM Usuario_TB WHERE Correo = @email`);

          let usuarioId;
          if (existingUserResult.recordset.length > 0) {
              usuarioId = existingUserResult.recordset[0].Usuario_ID_PK;
              console.log(`El correo ${est.email} ya existe. Verificando su grupo.`);

              let grupoAsignado = await pool.request()
                  .input("usuarioId", sql.Int, usuarioId)
                  .query(`SELECT GrupoCurso_ID_FK FROM GrupoVinculado_TB WHERE Usuario_ID_FK = @usuarioId`);

              if (grupoAsignado.recordset.length === 0) {
                  console.log(`El usuario ${est.email} no tiene un grupo asignado. Se asignará el grupo ${est.grupoId}`);

                  // 🔴 Hacer el SELECT para obtener el GrupoCurso_ID_FK real
                  let grupoCursoQuery = await pool.request()
                      .input("gruposEncargadosId", sql.Int, est.grupoId)
                      .query(`SELECT GrupoCurso_ID_FK FROM GrupoVinculado_TB WHERE GruposEncargados_ID_PK = @gruposEncargadosId`);

                  if (grupoCursoQuery.recordset.length === 0) {
                      return res.status(400).json({ mensaje: "No se encontró un grupo válido para este ID." });
                  }

                  const grupoCursoId = grupoCursoQuery.recordset[0].GrupoCurso_ID_FK;

                  // 🔵 Insertar con el GrupoCurso_ID_FK real
                  await pool.request()
                      .input("usuarioId", sql.Int, usuarioId)
                      .input("grupoCursoId", sql.Int, grupoCursoId)
                      .query(`INSERT INTO GrupoVinculado_TB (Usuario_ID_FK, GrupoCurso_ID_FK) VALUES (@usuarioId, @grupoCursoId)`);
              } else {
                  console.log(`El usuario ${est.email} ya está vinculado a un grupo. No se realiza ninguna acción.`);
              }

              saltados++;

          } else {
              const result = await pool.request()
                  .input("name", sql.NVarChar, est.name)
                  .input("lastName1", sql.NVarChar, est.lastName1)
                  .input("lastName2", sql.NVarChar, est.lastName2)
                  .input("email", sql.NVarChar, est.email)
                  .input("password", sql.NVarChar, est.password)
                  .input("rolId", sql.Int, est.rolId)
                  .input("generoId", sql.Int, est.generoId)
                  .input("estado", sql.Bit, 1)
                  .query(`
                      INSERT INTO Usuario_TB (Nombre, Apellido1, Apellido2, Correo, Contraseña, Rol_ID_FK, Genero_ID_FK, Estado) 
                      OUTPUT INSERTED.Usuario_ID_PK
                      VALUES (@name, @lastName1, @lastName2, @email, @password, @rolId, @generoId, @estado)
                  `);

              if (result.recordset.length > 0) {
                  usuarioId = result.recordset[0].Usuario_ID_PK;
                  console.log('Estudiante insertado correctamente:', est);

                  // 🔴 Hacer el SELECT para obtener el GrupoCurso_ID_FK real
                  let grupoCursoQuery = await pool.request()
                      .input("gruposEncargadosId", sql.Int, est.grupoId)
                      .query(`SELECT GrupoCurso_ID_FK FROM GrupoVinculado_TB WHERE GruposEncargados_ID_PK = @gruposEncargadosId`);

                  if (grupoCursoQuery.recordset.length === 0) {
                      return res.status(400).json({ mensaje: "No se encontró un grupo válido para este ID." });
                  }

                  const grupoCursoId = grupoCursoQuery.recordset[0].GrupoCurso_ID_FK;

                  // 🔵 Insertar con el GrupoCurso_ID_FK real
                  await pool.request()
                      .input("usuarioId", sql.Int, usuarioId)
                      .input("grupoCursoId", sql.Int, grupoCursoId)
                      .query(`INSERT INTO GrupoVinculado_TB (Usuario_ID_FK, GrupoCurso_ID_FK) VALUES (@usuarioId, @grupoCursoId)`);

                  nuevosEstudiantes.push(est);
              } else {
                  return res.status(400).json({ mensaje: "No se pudo insertar el nuevo usuario." });
              }
          }
      }

      let pdfPath = '';
      if (nuevosEstudiantes.length > 0) {
          pdfPath = await generatePDF(nuevosEstudiantes, saltados);
      } else {
          pdfPath = await generatePDF([], saltados);
      }

      const pdfBuffer = fs.readFileSync(pdfPath);
      const pdfBase64 = pdfBuffer.toString('base64');

      const mensaje = saltados === estudiantesData.length
          ? 'Se omitieron el ingreso de estudiantes y se agregaron al grupo aquellos que no estaban vinculados a uno (Si no fueron agregados significa que estan vinculados a un curso, si es asi llamar a administracion para la desvinculacion)'
          : `Se omitieron ${saltados} estudiantes por estar ya registrados y se agregaron al grupo aquellos que no estaban vinculados a uno`;

      res.json({
          success: true,
          pdfBase64,
          mensaje
      });

      fs.unlink(pdfPath, (err) => {
          if (err) console.error("Error al eliminar el archivo PDF:", err);
      });

  } catch (error) {
      console.error("Error al agregar estudiantes:", error);
      res.status(500).json({ mensaje: "Error interno del servidor" });
  }
};

export const obtenerEstudiantesPorProfesor = async (req, res) => {
  try {
      const profesorId = req.user.id;

      const pool = await poolPromise;

      // Obtener los grupos en los que el profesor está vinculado
      const gruposResult = await pool.request()
          .input("profesorId", sql.Int, profesorId)
          .query(`
              SELECT GrupoCurso_ID_FK 
              FROM GrupoVinculado_TB 
              WHERE Usuario_ID_FK = @profesorId
          `);

      if (gruposResult.recordset.length === 0) {
          return res.status(404).json({ mensaje: "El profesor no está vinculado a ningún grupo." });
      }

      const gruposIds = gruposResult.recordset.map(row => row.GrupoCurso_ID_FK);

      // Obtener el ID del rol 'Estudiante'
      const rolResult = await pool.request()
          .query(`SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = 'Estudiante'`);

      if (rolResult.recordset.length === 0) {
          return res.status(400).json({ mensaje: "El rol 'Estudiante' no está disponible en la base de datos." });
      }

      const rolId = rolResult.recordset[0].Rol_ID_PK;

      // Usar IN para los grupos y pasar todos los IDs de grupo como un solo parámetro
      const gruposIdsStr = gruposIds.map((grupoId, index) => `@grupoId${index}`).join(", ");

      // Crear la consulta dinámicamente para agregar los parámetros
      let request = pool.request().input("rolId", sql.Int, rolId);
      gruposIds.forEach((grupoId, index) => {
          request = request.input(`grupoId${index}`, sql.Int, grupoId);
      });

      // Obtener todos los estudiantes vinculados a esos grupos y agregar el código de curso y número de grupo
      const estudiantesResult = await request.query(`
              SELECT U.Usuario_ID_PK, 
                     U.Nombre, 
                     U.Apellido1, 
                     U.Apellido2, 
                     U.Correo, 
                     GV.GrupoCurso_ID_FK AS GrupoID,
                     CC.Codigo_Curso,  -- Código del curso
                     GC.Codigo_Grupo   -- Número del grupo
              FROM Usuario_TB U
              INNER JOIN GrupoVinculado_TB GV ON U.Usuario_ID_PK = GV.Usuario_ID_FK
              INNER JOIN GrupoCurso_TB GC ON GV.GrupoCurso_ID_FK = GC.GrupoCurso_ID_PK
              INNER JOIN CodigoCurso_TB CC ON GC.Curso_ID_FK = CC.CodigoCurso_ID_PK
              WHERE GV.GrupoCurso_ID_FK IN (${gruposIdsStr}) 
              AND U.Rol_ID_FK = @rolId
          `);

      res.json({
          success: true,
          estudiantes: estudiantesResult.recordset
      });
      console.log(estudiantesResult);
  } catch (error) {
      console.error("Error al obtener los estudiantes:", error);
      res.status(500).json({ mensaje: "Error interno del servidor" });
  }
};

export const startSimulation = async (req, res) => {
    const { personalizationId, grupoID } = req.body;
    const userId = req.user.id;

    console.log('Iniciando simulación:', req.body);

    try {
        const pool = await poolPromise;

        // Verificar si hay una partida iniciada
        const partidaIniciada = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT Partida_ID_PK, FechaInicio 
                FROM Partida_TB 
                WHERE Profesor_ID_FK = @userId AND EstadoPartida = 'iniciada'
            `);

        if (partidaIniciada.recordset.length > 0) {
            const partida = partidaIniciada.recordset[0];
            const fechaInicio = new Date(partida.FechaInicio);
            const ahora = new Date();
            const diferenciaHoras = (ahora - fechaInicio) / (1000 * 60 * 60);

            if (diferenciaHoras > 4 || ahora.getDate() !== fechaInicio.getDate()) {
                // Cerrar la partida automáticamente si ha pasado más de 4 horas o es de otro día
                await pool.request()
                    .input('partidaId', sql.Int, partida.Partida_ID_PK)
                    .input('fechaFin', sql.DateTime, ahora)
                    .query(`
                        UPDATE Partida_TB 
                        SET EstadoPartida = 'finalizada', FechaFin = @fechaFin 
                        WHERE Partida_ID_PK = @partidaId
                    `);
            } else {
                return res.status(400).json({ message: 'Ya existe una partida iniciada' });
            }
        }

        const grupoVinculado = await pool.request()
            .input('grupoID', sql.Int, grupoID)
            .query(`
                SELECT GrupoCurso_ID_FK 
                FROM GrupoVinculado_TB 
                WHERE GruposEncargados_ID_PK = @grupoID
            `);

        if (grupoVinculado.recordset.length === 0) {
            return res.status(404).json({ message: 'Grupo no encontrado' });
        }

        const grupoCursoId_ = grupoVinculado.recordset[0].GrupoCurso_ID_FK;

        // Insertar nueva partida
        const nuevaPartida = await pool.request()
            .input('fechaInicio', sql.DateTime, new Date())
            .input('userId', sql.Int, userId)
            .input('grupoCursoId', sql.Int, grupoCursoId_)
            .input('personalizationId', sql.Int, personalizationId)
            .query(`
                INSERT INTO Partida_TB (FechaInicio, Profesor_ID_FK, Grupo_ID_FK, EstadoPartida, Personalizacion_ID_FK)
                OUTPUT INSERTED.Partida_ID_PK
                VALUES (@fechaInicio, @userId, @grupoCursoId, 'iniciada', @personalizationId)
            `);

        const partidaId = nuevaPartida.recordset[0].Partida_ID_PK;

        // Obtener el GrupoCurso_ID_FK
        const grupoCurso = await pool.request()
            .input('grupoID', sql.Int, grupoID)
            .query(`
                SELECT GrupoCurso_ID_FK 
                FROM GrupoVinculado_TB 
                WHERE GruposEncargados_ID_PK = @grupoID
            `);

        const grupoCursoId = grupoCurso.recordset[0].GrupoCurso_ID_FK;

        // Obtener todos los estudiantes del grupo
        const estudiantes = await pool.request()
            .input('grupoCursoId', sql.Int, grupoCursoId)
            .query(`
                SELECT u.Usuario_ID_PK 
                FROM Usuario_TB u
                INNER JOIN GrupoVinculado_TB gv ON u.Usuario_ID_PK = gv.Usuario_ID_FK
                WHERE gv.GrupoCurso_ID_FK = @grupoCursoId
                AND u.Rol_ID_FK = (SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = 'estudiante')
            `);

        const estudiantesIds = estudiantes.recordset.map(row => row.Usuario_ID_PK);

        // Dividir estudiantes en grupos de 4
        const grupos = [];
        for (let i = 0; i < estudiantesIds.length; i += 4) {
            grupos.push(estudiantesIds.slice(i, i + 4));
        }

        // Asegurar que no haya grupos de menos de 3
        if (grupos.length > 1 && grupos[grupos.length - 1].length < 3) {
            const ultimoGrupo = grupos.pop();
            grupos[grupos.length - 1] = grupos[grupos.length - 1].concat(ultimoGrupo);
        }

        // Insertar participantes en la tabla Participantes_TB
        for (let i = 0; i < grupos.length; i++) {
            for (const estudianteId of grupos[i]) {
                await pool.request()
                    .input('estudianteId', sql.Int, estudianteId)
                    .input('equipoNumero', sql.Int, i + 1)
                    .input('partidaId', sql.Int, partidaId)
                    .query(`
                        INSERT INTO Participantes_TB (Usuario_ID_FK, Equipo_Numero, Partida_ID_FK)
                        VALUES (@estudianteId, @equipoNumero, @partidaId)
                    `);
            }
        }

        // Crear una sala con el ID de la partida
        io.emit('CreateRoom', partidaId);

        // Unir a los estudiantes a la sala
        for (const estudianteId of estudiantesIds) {
            io.emit('JoinRoom', partidaId, estudianteId);
        }

        res.status(200).json({ message: 'Partida iniciada correctamente', partidaId });

    } catch (error) {
        console.error('Error al iniciar la simulación:', error);
        res.status(500).json({ message: 'Error al iniciar la simulación' });
    }
};

export const cancelarPartida = async (req, res) => {
    const userId = req.user.id;

    try {
        const pool = await poolPromise;

        // Verificar si hay una partida iniciada
        const partidaIniciada = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT Partida_ID_PK 
                FROM Partida_TB 
                WHERE Profesor_ID_FK = @userId AND EstadoPartida = 'iniciada'
            `);

        if (partidaIniciada.recordset.length > 0) {
            const partidaId = partidaIniciada.recordset[0].Partida_ID_PK;

            // Actualizar el estado de la partida a "finalizada"
            await pool.request()
                .input('partidaId', sql.Int, partidaId)
                .input('fechaFin', sql.DateTime, new Date())
                .query(`
                    UPDATE Partida_TB 
                    SET EstadoPartida = 'finalizada', FechaFin = @fechaFin 
                    WHERE Partida_ID_PK = @partidaId
                `);

            // Notificar a los usuarios en la sala que la partida ha sido cancelada
            io.to(`partida-${partidaId}`).emit('PartidaCancelada', { partidaId });

            // Destruir la sala en Socket.IO
            const sala = io.sockets.adapter.rooms.get(`partida-${partidaId}`);
            if (sala) {
                // Forzar la desconexión de todos los sockets en la sala
                sala.forEach(socketId => {
                    io.sockets.sockets.get(socketId).disconnect(true); // Desconectar el socket
                });
            }

            res.status(200).json({ message: 'Partida cancelada correctamente', partidaId });
        } else {
            res.status(404).json({ message: 'No hay partidas iniciadas para cancelar' });
        }
    } catch (error) {
        console.error('Error al cancelar la partida:', error);
        res.status(500).json({ message: 'Error al cancelar la partida' });
    }
};


  // Función para generar una contraseña aleatoria
function generatePassword(name) {
    const randomNumber = Math.floor(10000 + Math.random() * 90000);
    return `${name}${randomNumber}`;
  }
  
  // Función para generar el PDF
  async function generatePDF(profesores) {
    const pdf = new PDFDocument();
    const filePath = `./profesores_${Date.now()}.pdf`;
    const writeStream = fs.createWriteStream(filePath);
  
    // Pipe el PDF al archivo
    pdf.pipe(writeStream);
  
    // Título de la página
    pdf.fontSize(20).text("Credenciales de Profesores", { align: "center" });
    pdf.moveDown(2);
  
    // Dibujar la cabecera de la tabla con fondo azul
    const startX = 50;
    let startY = pdf.y;
    const columnWidths = [100, 100, 100, 100, 100]; // Ancho de cada columna
  
    pdf.fillColor('#3b82f6')  // Fondo azul
      .rect(startX, startY, columnWidths.reduce((a, b) => a + b), 30)  // Cabecera de la tabla
      .fill()
      .stroke();
  
    pdf.fillColor('#FFFFFF')  // Color del texto
      .fontSize(12)
      .text('Correo', startX, startY + 7, { width: columnWidths[0], align: 'center' })
      .text('Contraseña', startX + columnWidths[0], startY + 7, { width: columnWidths[1], align: 'center' })
      .text('Nombre', startX + columnWidths[0] + columnWidths[1], startY + 7, { width: columnWidths[2], align: 'center' })
      .text('Apellido', startX + columnWidths[0] + columnWidths[1] + columnWidths[2], startY + 7, { width: columnWidths[3], align: 'center' })
      .text('Género', startX + columnWidths[0] + columnWidths[1] + columnWidths[2] + columnWidths[3], startY + 7, { width: columnWidths[4], align: 'center' });
    
    pdf.moveDown();
  
    // Línea separadora entre el encabezado y las filas
    startY += 30;
    pdf.moveTo(startX, startY).lineTo(startX + columnWidths.reduce((a, b) => a + b), startY).stroke();
    startY += 5;
  
    // Añadir filas de la tabla
    profesores.forEach((prof, index) => {
      pdf.rect(startX, startY, columnWidths.reduce((a, b) => a + b), 30)  // Borde de las filas
        .fill('#FFFFFF')  // Color de fondo de las filas
        .stroke();
  
      pdf.fillColor('#000000')
        .text(prof.email, startX, startY + 7, { width: columnWidths[0], align: 'center' })
        .text(prof.generatedPassword, startX + columnWidths[0], startY + 7, { width: columnWidths[1], align: 'center' })
        .text(prof.name, startX + columnWidths[0] + columnWidths[1], startY + 7, { width: columnWidths[2], align: 'center' })
        .text(prof.lastName1, startX + columnWidths[0] + columnWidths[1] + columnWidths[2], startY + 7, { width: columnWidths[3], align: 'center' });
  
      // Línea separadora entre las filas
      startY += 30;
      pdf.moveTo(startX, startY).lineTo(startX + columnWidths.reduce((a, b) => a + b), startY).stroke();
      startY += 5;
    });
  
    // Terminar el PDF
    pdf.end();
  
    // Asegurarse de que el archivo esté completamente escrito antes de retornar el path
    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => resolve(filePath));  // Si se completa la escritura
      writeStream.on('error', reject);  // Si hay un error
    });
  }
  
  export { generatePDF };