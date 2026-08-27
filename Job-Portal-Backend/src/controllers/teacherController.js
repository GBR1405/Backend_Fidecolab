import { poolPromise } from '../config/db.js'; // Importar la conexión
import axios from 'axios';
import sql from 'mssql';
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import multer from "multer";
import xlsx from "xlsx";
import pdfkit from "pdfkit";
import bcrypt from 'bcryptjs';
import { io } from '../app.js';
import nodemailer from "nodemailer";
import { GenerarBitacora } from "../controllers/generalController.js";
import { enviarCorreosBienvenidaMasivo  } from "../config/emailservice.js";


const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,      // Brevo usa STARTTLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  family: 4, // 👈 Fuerza IPv4 (OBLIGATORIO en Render)
});


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
    const { manual, estudiantes } = req.body;
    let estudiantesData = [];
    let saltados = 0;
    let nuevosEstudiantes = [];

    const pool = await poolPromise;
    const rolResult = await pool.request().query(`SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = 'Estudiante'`);
    if (rolResult.recordset.length === 0) {
      return res.status(400).json({ mensaje: "El rol 'Estudiante' no está disponible." });
    }
    const rolId = rolResult.recordset[0].Rol_ID_PK;

    // Procesar estudiantes manuales o por lista
    if (manual === "true") {
      const { name, lastName1, lastName2, email, gender, grupoId } = req.body;
      if (!name || !lastName1 || !lastName2 || !email || !gender || !grupoId) {
        return res.status(400).json({ message: 'Todos los campos son obligatorios' });
      }
      const generatedPassword = generatePassword(name);
      const hashedPassword = await bcrypt.hash(generatedPassword, 10);
      estudiantesData.push({ name, lastName1, lastName2, email, password: hashedPassword, generatedPassword, rolId, generoId: gender, grupoId });
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

    // Registrar o vincular estudiantes
    for (const est of estudiantesData) {
      const existingUser = await pool.request()
        .input("email", sql.NVarChar, est.email)
        .query(`SELECT Usuario_ID_PK FROM Usuario_TB WHERE Correo = @email`);

      let usuarioId;
      if (existingUser.recordset.length > 0) {
        usuarioId = existingUser.recordset[0].Usuario_ID_PK;
        const grupoCheck = await pool.request()
          .input("usuarioId", sql.Int, usuarioId)
          .query(`SELECT GrupoCurso_ID_FK FROM GrupoVinculado_TB WHERE Usuario_ID_FK = @usuarioId`);

        if (grupoCheck.recordset.length === 0) {
          const grupoCursoQuery = await pool.request()
            .input("gruposEncargadosId", sql.Int, est.grupoId)
            .query(`SELECT GrupoCurso_ID_FK FROM GrupoVinculado_TB WHERE GruposEncargados_ID_PK = @gruposEncargadosId`);

          if (grupoCursoQuery.recordset.length === 0) {
            return res.status(400).json({ mensaje: "Grupo inválido para este ID." });
          }

          const grupoCursoId = grupoCursoQuery.recordset[0].GrupoCurso_ID_FK;
          await pool.request()
            .input("usuarioId", sql.Int, usuarioId)
            .input("grupoCursoId", sql.Int, grupoCursoId)
            .query(`INSERT INTO GrupoVinculado_TB (Usuario_ID_FK, GrupoCurso_ID_FK) VALUES (@usuarioId, @grupoCursoId)`);
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
          const grupoCursoQuery = await pool.request()
            .input("gruposEncargadosId", sql.Int, est.grupoId)
            .query(`SELECT GrupoCurso_ID_FK FROM GrupoVinculado_TB WHERE GruposEncargados_ID_PK = @gruposEncargadosId`);
          if (grupoCursoQuery.recordset.length === 0) {
            return res.status(400).json({ mensaje: "Grupo inválido para este ID." });
          }
          const grupoCursoId = grupoCursoQuery.recordset[0].GrupoCurso_ID_FK;
          await pool.request()
            .input("usuarioId", sql.Int, usuarioId)
            .input("grupoCursoId", sql.Int, grupoCursoId)
            .query(`INSERT INTO GrupoVinculado_TB (Usuario_ID_FK, GrupoCurso_ID_FK) VALUES (@usuarioId, @grupoCursoId)`);

          // Guardar en lista para enviar correo
          nuevosEstudiantes.push(est);
        }
      }
    }

    // Enviar correos a los nuevos estudiantes
    const { enviados, fallidos, detalles } = await enviarCorreosBienvenidaMasivo(nuevosEstudiantes);

    if (fallidos > 0) {
      const correosFallidos = detalles.filter(d => !d.ok).map(d => d.correo);
      console.error(`No se pudo enviar el correo a: ${correosFallidos.join(", ")}`);
    }


    const mensaje = nuevosEstudiantes.length > 0
      ? saltados === 0
        ? 'Todos los estudiantes fueron agregados y notificados correctamente.'
        : `Se omitieron ${saltados} estudiantes por estar ya registrados o vinculados.`
      : 'Se omitieron todos los estudiantes y no se agregaron nuevos.';

    res.json({ success: true, mensaje });

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

const MIN_TEAM_SIZE = 2;
const MAX_TEAM_SIZE = 10;

// Distribuye una lista de IDs de estudiantes en equipos balanceados según el tamaño de equipo deseado.
// Si la división exacta deja un grupo sobrante, ese sobrante se combina con el último grupo completo
// y se reparte entre los dos para evitar equipos demasiado pequeños o inválidos (ej: 6 personas y
// equipos de 5 -> en vez de [5,1] queda [3,3]).
const distribuirEquipos = (estudiantesIds, teamSize) => {
  const N = estudiantesIds.length;
  const T = Math.min(MAX_TEAM_SIZE, Math.max(MIN_TEAM_SIZE, parseInt(teamSize, 10) || 4));

  if (N === 0) return [];
  if (N <= T) return [estudiantesIds.slice()];

  const numFullGroups = Math.floor(N / T);
  const remainder = N % T;

  if (remainder === 0) {
    const grupos = [];
    for (let g = 0; g < numFullGroups; g++) {
      grupos.push(estudiantesIds.slice(g * T, (g + 1) * T));
    }
    return grupos;
  }

  const untouchedGroupsCount = numFullGroups - 1;
  const grupos = [];
  for (let g = 0; g < untouchedGroupsCount; g++) {
    grupos.push(estudiantesIds.slice(g * T, (g + 1) * T));
  }

  const combinedPool = estudiantesIds.slice(untouchedGroupsCount * T);

  if (combinedPool.length >= MIN_TEAM_SIZE * 2) {
    const half = Math.floor(combinedPool.length / 2);
    grupos.push(combinedPool.slice(0, half));
    grupos.push(combinedPool.slice(half));
  } else {
    grupos.push(combinedPool);
  }

  return grupos;
};

// Obtiene los IDs de todos los estudiantes vinculados a los grupos que maneja el profesor,
// usado para validar que los equipos personalizados solo contengan alumnos propios del profesor.
const getValidStudentIdsForProfesor = async (pool, profesorId) => {
  const gruposResult = await pool.request()
    .input('profesorId', sql.Int, profesorId)
    .query(`
      SELECT GrupoCurso_ID_FK
      FROM GrupoVinculado_TB
      WHERE Usuario_ID_FK = @profesorId
    `);

  const gruposIds = [...new Set(gruposResult.recordset.map(row => row.GrupoCurso_ID_FK))];
  if (gruposIds.length === 0) return [];

  const rolResult = await pool.request()
    .query(`SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = 'Estudiante'`);
  if (rolResult.recordset.length === 0) return [];
  const rolId = rolResult.recordset[0].Rol_ID_PK;

  let request = pool.request().input('rolId', sql.Int, rolId);
  const gruposIdsStr = gruposIds.map((grupoId, index) => {
    request = request.input(`grupoId${index}`, sql.Int, grupoId);
    return `@grupoId${index}`;
  }).join(', ');

  const estudiantesResult = await request.query(`
    SELECT DISTINCT U.Usuario_ID_PK
    FROM Usuario_TB U
    INNER JOIN GrupoVinculado_TB GV ON U.Usuario_ID_PK = GV.Usuario_ID_FK
    WHERE GV.GrupoCurso_ID_FK IN (${gruposIdsStr})
    AND U.Rol_ID_FK = @rolId
  `);

  return estudiantesResult.recordset.map(row => row.Usuario_ID_PK);
};

export const startSimulation = async (req, res) => {
  const { personalizationId, grupoID, teamSize, customGroups } = req.body;
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
            WHERE Profesor_ID_FK = @userId
            AND EstadoPartida IN ('iniciada', 'en proceso');
        `);

    if (partidaIniciada.recordset.length > 0) {
      const partida = partidaIniciada.recordset[0];
      const fechaInicio = new Date(partida.FechaInicio);
      const ahora = new Date();
      const diferenciaHoras = (ahora - fechaInicio) / (1000 * 60 * 60);

      if (diferenciaHoras > 4 || ahora.getDate() !== fechaInicio.getDate()) {
        // Partida vencida → frontend debe cerrarla
        return res.status(200).json({ status: 1, partidaId: partida.Partida_ID_PK });
      } else {
        // Partida aún activa → preguntar si desea cancelarla
        return res.status(200).json({ status: 2, partidaId: partida.Partida_ID_PK });
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

    // Determinar la distribución de estudiantes en equipos: personalizada (arrastrada por el profesor)
    // o automática (a partir de la cantidad de estudiantes por equipo indicada)
    const usaGruposPersonalizados = Array.isArray(customGroups) && customGroups.length > 0;
    let grupos = [];
    let estudiantesIds = [];

    if (usaGruposPersonalizados) {
      for (const equipo of customGroups) {
        if (!Array.isArray(equipo) || equipo.length < MIN_TEAM_SIZE) {
          return res.status(400).json({ message: `Cada equipo personalizado debe tener al menos ${MIN_TEAM_SIZE} estudiantes` });
        }
      }

      const idsSanitizados = customGroups.map(equipo =>
        equipo.map(id => parseInt(id, 10)).filter(id => !isNaN(id))
      );
      const idsFlatten = idsSanitizados.flat();

      if (new Set(idsFlatten).size !== idsFlatten.length) {
        return res.status(400).json({ message: 'Un mismo estudiante no puede estar en más de un equipo' });
      }

      const idsValidos = await getValidStudentIdsForProfesor(pool, userId);
      const idsValidosSet = new Set(idsValidos);
      const idsInvalidos = idsFlatten.filter(id => !idsValidosSet.has(id));

      if (idsInvalidos.length > 0) {
        return res.status(400).json({ message: 'Uno o más estudiantes seleccionados no pertenecen a tus grupos' });
      }

      grupos = idsSanitizados;
      estudiantesIds = idsFlatten;

    } else {
      // Obtener todos los estudiantes del grupo seleccionado
      const estudiantes = await pool.request()
        .input('grupoCursoId', sql.Int, grupoCursoId_)
        .query(`
                    SELECT u.Usuario_ID_PK
                    FROM Usuario_TB u
                    INNER JOIN GrupoVinculado_TB gv ON u.Usuario_ID_PK = gv.Usuario_ID_FK
                    WHERE gv.GrupoCurso_ID_FK = @grupoCursoId
                    AND u.Rol_ID_FK = (SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = 'estudiante')
                `);

      estudiantesIds = estudiantes.recordset.map(row => row.Usuario_ID_PK);

      if (estudiantesIds.length < MIN_TEAM_SIZE) {
        return res.status(400).json({ message: `No hay suficientes estudiantes en el grupo para iniciar una partida (mínimo ${MIN_TEAM_SIZE})` });
      }

      const shuffleArray = (array) => {
        for (let i = array.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
      };

      const shuffledEstudiantes = shuffleArray([...estudiantesIds]);
      grupos = distribuirEquipos(shuffledEstudiantes, teamSize);
    }

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

    res.status(200).json({
      status: 3,
      message: 'Partida iniciada correctamente',
      partidaId,
      equipos: grupos.length,
      distribucion: grupos.map(g => g.length)
    });

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
                WHERE Profesor_ID_FK = @userId AND EstadoPartida IN ('iniciada', 'en proceso');
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
function generatePassword(nombre) {
  const base = nombre.trim().toLowerCase();
  const random = Math.random().toString(36).slice(-4);
  const capital = nombre[0].toUpperCase();
  const num = Math.floor(100 + Math.random() * 900);
  return `${capital}${base.slice(1)}${num}${random}`;
}


// PDF para estudiantes
async function generatePDF(estudiantes, saltados) {
  return new Promise(async (resolve, reject) => {
    if (estudiantes.length === 0) return resolve("");

    const reportsDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const imageUrl = "https://www.coopeande1.com/sites/default/files/styles/420_width_retina/public/2021-01/u_fidelitas.png?itok=DC77XGsA";
    const imagePath = path.join(reportsDir, "u_fidelitas.png");
    const writer = fs.createWriteStream(imagePath);

    const imageResponse = await axios({ method: 'get', url: imageUrl, responseType: 'stream' });
    imageResponse.data.pipe(writer);

    writer.on('finish', () => {
      const filename = `Estudiantes_Nuevos_${new Date().toISOString().slice(0, 10)}.pdf`;
      const filePath = path.join(reportsDir, filename);
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const primaryColor = '#003366';
      const tableRowHeight = 30;
      const estudiantesPerPage = 22;
      let currentY = 80;

      const addHeader = () => {
        doc.image(imagePath, 50, 20, { width: 80 });
        doc.fontSize(18).font('Helvetica-Bold').fillColor(primaryColor).text('Universidad Fidelitas', 140, 30);
        doc.fontSize(10).font('Helvetica').fillColor('#666').text('Sistema de Gestión Académica', 140, 55);
        doc.moveTo(50, 80).lineTo(550, 80).lineWidth(2).stroke(primaryColor);
        currentY = 100;
      };

      const addTitle = () => {
        doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor)
          .text('REPORTE DE NUEVOS ESTUDIANTES', 0, currentY, { align: 'center' });
        currentY += 25;
        doc.fontSize(12).fillColor('black')
          .text(`Total de estudiantes agregados: ${estudiantes.length}`, { align: 'center' });
        currentY += 15;
        const saltadoMsg = saltados === 0
          ? 'No se omitió ningún estudiante.'
          : (saltados === estudiantes.length
            ? 'Se omitieron todos los estudiantes.'
            : `Se omitieron ${saltados} estudiantes ya existentes o vinculados.`);
        doc.text(saltadoMsg, { align: 'center' });
        currentY += 40;
      };

      const drawTableHeader = () => {
        const tableLeft = 50;
        const columnWidths = [160, 170, 120];
        const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

        doc.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill(primaryColor);
        let x = tableLeft;
        doc.fontSize(12).fillColor('white').font('Helvetica-Bold');
        doc.text('Nombre completo', x + 5, currentY + 8, { width: columnWidths[0] - 10, align: 'center' });
        x += columnWidths[0];
        doc.text('Correo electrónico', x + 5, currentY + 8, { width: columnWidths[1] - 10, align: 'center' });
        x += columnWidths[1];
        doc.text('Contraseña', x + 5, currentY + 8, { width: columnWidths[2] - 10, align: 'center' });

        currentY += tableRowHeight;
        return columnWidths;
      };

      const totalPages = Math.ceil(estudiantes.length / estudiantesPerPage);
      for (let i = 0; i < totalPages; i++) {
        if (i > 0) doc.addPage();
        addHeader();
        if (i === 0) addTitle();
        const columnWidths = drawTableHeader();
        const estSlice = estudiantes.slice(i * estudiantesPerPage, (i + 1) * estudiantesPerPage);

        estSlice.forEach((est, idx) => {
          const tableLeft = 50;
          const tableWidth = columnWidths.reduce((a, b) => a + b, 0);
          if (idx % 2 === 0) {
            doc.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill('#f5f5f5');
          }

          let x = tableLeft;
          const fullName = `${est.name} ${est.lastName1} ${est.lastName2}`;
          doc.fillColor('black').font('Helvetica').fontSize(10);
          doc.text(fullName, x + 5, currentY + 5, { width: columnWidths[0] - 10 });
          x += columnWidths[0];
          doc.text(est.email, x + 5, currentY + 5, { width: columnWidths[1] - 10 });
          x += columnWidths[1];
          doc.text(est.generatedPassword, x + 5, currentY + 5, { width: columnWidths[2] - 10, align: 'center' });

          currentY += tableRowHeight;
        });
      }

      doc.end();
      stream.on('finish', () => resolve(filePath));
    });

    writer.on('error', reject);
  });
}

// Desvincular un estudiante específico
export const desvincularEstudiante = async (req, res) => {
  try {
    const { estudianteId } = req.body;
    const profesorId = req.user.id;

    const pool = await poolPromise;

    // Verificar que el estudiante está vinculado a un grupo del profesor
    const verificarVinculo = await pool.request()
      .input('estudianteId', sql.Int, estudianteId)
      .input('profesorId', sql.Int, profesorId)
      .query(`
                DELETE gv
                FROM GrupoVinculado_TB gv
                INNER JOIN GrupoVinculado_TB gv2 
                    ON gv.GrupoCurso_ID_FK = gv2.GrupoCurso_ID_FK
                WHERE gv.Usuario_ID_FK = @estudianteId
                AND gv2.Usuario_ID_FK = @profesorId
            `);

    if (verificarVinculo.rowsAffected[0] === 0) {
      return res.status(404).json({
        success: false,
        mensaje: "No se encontró el estudiante vinculado a tus grupos"
      });
    }

    return res.json({
      success: true,
      mensaje: "Estudiante desvinculado correctamente"
    });

  } catch (error) {
    console.error("Error al desvincular estudiante:", error);
    return res.status(500).json({
      success: false,
      mensaje: "Error al desvincular estudiante"
    });
  }
};

// Desvincular todos los estudiantes de un curso
export const desvincularTodosEstudiantes = async (req, res) => {
  try {
    const { grupoId } = req.body;
    const profesorId = req.user.id;

    const pool = await poolPromise;

    // Verificar que el profesor tiene acceso a este grupo
    const verificarGrupo = await pool.request()
      .input('grupoId', sql.Int, grupoId)
      .input('profesorId', sql.Int, profesorId)
      .query(`
                SELECT GrupoCurso_ID_FK 
                FROM GrupoVinculado_TB 
                WHERE GruposEncargados_ID_PK = @grupoId
                AND Usuario_ID_FK = @profesorId
            `);

    if (verificarGrupo.recordset.length === 0) {
      return res.status(403).json({
        success: false,
        mensaje: "No tienes permiso para este grupo"
      });
    }

    const grupoCursoId = verificarGrupo.recordset[0].GrupoCurso_ID_FK;

    // Obtener ID del rol Estudiante
    const rolResult = await pool.request()
      .query(`SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = 'Estudiante'`);
    const rolId = rolResult.recordset[0].Rol_ID_PK;

    // Eliminar todos los estudiantes vinculados a este grupo
    const resultado = await pool.request()
      .input('grupoCursoId', sql.Int, grupoCursoId)
      .input('rolId', sql.Int, rolId)
      .query(`
                DELETE gv
                FROM GrupoVinculado_TB gv
                INNER JOIN Usuario_TB u ON gv.Usuario_ID_FK = u.Usuario_ID_PK
                WHERE gv.GrupoCurso_ID_FK = @grupoCursoId
                AND u.Rol_ID_FK = @rolId
            `);

    return res.json({
      success: true,
      mensaje: `Se desvincularon ${resultado.rowsAffected[0]} estudiantes del grupo`
    });

  } catch (error) {
    console.error("Error al desvincular estudiantes:", error);
    return res.status(500).json({
      success: false,
      mensaje: "Error al desvincular estudiantes"
    });
  }
};


export { generatePDF };