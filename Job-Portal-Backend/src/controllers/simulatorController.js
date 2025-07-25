import { poolPromise } from '../config/db.js';
import sql from 'mssql';
import { io } from '../app.js';


export const cancelSimulation = async (req, res) => {
    try {
        // Lógica para cancelar la partida
        res.status(200).json({ message: 'Partida cancelada correctamente' });
    } catch (error) {
        console.error('Error al cancelar la simulación:', error);
        res.status(500).json({ message: 'Error al cancelar la simulación' });
    }
};

export const checkParticipation = async (req, res) => {
    const userId = req.user.id;
    const { rol } = req.user;

    try {
        const pool = await poolPromise;

        if (rol === 'Profesor') {
            const partidaResult = await pool.request()
                .input('userId', sql.Int, userId)
                .query(`
                    SELECT Partida_ID_PK, EstadoPartida 
                    FROM Partida_TB 
                    WHERE Profesor_ID_FK = @userId 
                      AND EstadoPartida IN ('iniciada', 'en proceso')
                `);

            if (partidaResult.recordset.length > 0) {
                const partida = partidaResult.recordset[0];
                return res.status(200).json({
                    isParticipant: true,
                    partidaId: partida.Partida_ID_PK,
                    estadoPartida: partida.EstadoPartida
                });
            } else {
                return res.status(200).json({ isParticipant: false });
            }

        } else {
            const participanteResult = await pool.request()
                .input('userId', sql.Int, userId)
                .query(`
                    SELECT TOP 1 Partida_ID_FK 
                    FROM Participantes_TB 
                    WHERE Usuario_ID_FK = @userId 
                    ORDER BY Partida_ID_FK DESC
                `);

            if (participanteResult.recordset.length === 0) {
                return res.status(200).json({ isParticipant: false });
            }

            const partidaId = participanteResult.recordset[0].Partida_ID_FK;

            const partidaActiva = await pool.request()
                .input('partidaId', sql.Int, partidaId)
                .query(`
                    SELECT EstadoPartida 
                    FROM Partida_TB 
                    WHERE Partida_ID_PK = @partidaId 
                      AND EstadoPartida IN ('iniciada', 'en proceso')
                `);

            if (partidaActiva.recordset.length === 0) {
                return res.status(200).json({ isParticipant: false });
            }

            const estadoPartida = partidaActiva.recordset[0].EstadoPartida;

            // Obtener número de equipo si está en proceso
            let equipoNumero = null;
            if (estadoPartida === 'en proceso') {
                const equipoResult = await pool.request()
                    .input('userId', sql.Int, userId)
                    .input('partidaId', sql.Int, partidaId)
                    .query(`
                        SELECT Equipo_Numero 
                        FROM Participantes_TB 
                        WHERE Usuario_ID_FK = @userId 
                        AND Partida_ID_FK = @partidaId
                    `);

                    if (equipoResult.recordset.length > 0) {
                    equipoNumero = equipoResult.recordset[0].Equipo_Numero;
                    }
            }

            return res.status(200).json({
                isParticipant: true,
                partidaId,
                estadoPartida,
                equipoNumero
            });
        }

    } catch (error) {
        console.error('Error al verificar la participación:', error);
        res.status(500).json({ message: 'Error al verificar la participación' });
    }
};


export const checkGroup = async (req, res) => {
    const userId = req.user.id;
    const { rol } = req.user;

    try {
        const pool = await poolPromise;

        if (rol === 'Profesor') {
            // Lógica para el profesor (si es necesario)
        } else {
            // Verificar si el estudiante está en una partida activa
            const participanteResult = await pool.request()
                .input('userId', sql.Int, userId)
                .query(`
                    SELECT TOP 1 Partida_ID_FK, Equipo_Numero 
                    FROM Participantes_TB 
                    WHERE Usuario_ID_FK = @userId 
                    ORDER BY Partida_ID_FK DESC;
                `);

            if (participanteResult.recordset.length === 0) {
                return res.status(200).json({ isParticipant: false, partidaId: null, equipoNumero: null });
            }

            const partidaId = participanteResult.recordset[0].Partida_ID_FK;
            const equipoNumero = participanteResult.recordset[0].Equipo_Numero;

            // Verificar si la partida está activa
            const partidaActiva = await pool.request()
                .input('partidaId', sql.Int, partidaId)
                .query(`
                    SELECT EstadoPartida 
                    FROM Partida_TB 
                    WHERE Partida_ID_PK = @partidaId AND EstadoPartida IN ('iniciada', 'en proceso');
                `);

            if (partidaActiva.recordset.length > 0) {
                res.status(200).json({ isParticipant: true, partidaId, equipoNumero });
            } else {
                res.status(200).json({ isParticipant: false, partidaId: null, equipoNumero: null });
            }
        }
    } catch (error) {
        console.error('Error al verificar el grupo:', error);
        res.status(500).json({ message: 'Error al verificar el grupo' });
    }
};

export const checkActivity = async (req, res) => {
  try {
    const { partidaId } = req.body;
    const pool = await poolPromise;

    const result = await pool.request()
      .input('partidaId', sql.Int, partidaId)
      .query(`
        SELECT EstadoPartida 
        FROM Partida_TB
        WHERE Partida_ID_PK = @partidaId;
      `);

    // Si no se encuentra la partida, se asume finalizada por seguridad
    if (!result.recordset.length) {
      return res.status(200).json({
        isFinished: true,
        partidaId,
        reason: 'Partida no encontrada'
      });
    }

    const estado = result.recordset[0].EstadoPartida;

    res.status(200).json({
      isFinished: estado === 'finalizada',
      partidaId
    });

  } catch (error) {
    console.error('Error en checkActivity:', error);
    res.status(500).json({ message: 'Error al comprobar actividad' });
  }
};

export const getResults = async (req, res) => {
  const { partidaId } = req.params;
  const userId = req.user.id;
  const { rol } = req.user;

  console.log("🔐 Usuario autenticado:");
  console.log("- ID:", userId);
  console.log("- Rol:", rol);
  console.log("- Partida solicitada:", partidaId);

  try {
    const pool = await poolPromise;

    // 1. Verificar si la partida existe
    const partidaQuery = await pool.request()
      .input('partidaId', sql.Int, partidaId)
      .query('SELECT * FROM Partida_TB WHERE Partida_ID_PK = @partidaId');

    if (partidaQuery.recordset.length === 0) {
      console.log(" Partida no encontrada:", partidaId);
      return res.status(404).json({ message: 'Partida no encontrada' });
    }

    const partida = partidaQuery.recordset[0];
    console.log(" Partida encontrada:", partida.Partida_ID_PK);

    // 2. Si es profesor
    if (rol === 'Profesor') {
      if (partida.Profesor_ID_FK !== userId) {
        console.log(` Profesor ${userId} no tiene permiso para ver partida ${partidaId}`);
        return res.status(403).json({ message: 'No tienes permiso para ver estos resultados' });
      }

      console.log(` Profesor ${userId} autorizado. Obteniendo resultados...`);

      // Equipos de la partida
      const equiposQuery = await pool.request()
        .input('partidaId', sql.Int, partidaId)
        .query(`
          SELECT DISTINCT Equipo 
          FROM Resultados_TB
          WHERE Partida_ID_FK = @partidaId
          ORDER BY Equipo
        `);

      const equipos = equiposQuery.recordset.map(e => e.Equipo);

      const miembrosPorEquipo = await Promise.all(equipos.map(async equipo => {
        const miembrosQuery = await pool.request()
          .input('partidaId', sql.Int, partidaId)
          .input('equipo', sql.Int, equipo)
          .query(`
            SELECT u.Usuario_ID_PK, u.Nombre, u.Apellido1, u.Apellido2
            FROM Participantes_TB p
            JOIN Usuario_TB u ON p.Usuario_ID_FK = u.Usuario_ID_PK
            WHERE p.Partida_ID_FK = @partidaId AND p.Equipo_Numero = @equipo
          `);
        return { equipo, miembros: miembrosQuery.recordset };
      }));

      const resultadosPorEquipo = await Promise.all(equipos.map(async equipo => {
        const resultadosQuery = await pool.request()
          .input('partidaId', sql.Int, partidaId)
          .input('equipo', sql.Int, equipo)
          .query(`
            SELECT *
            FROM Resultados_TB
            WHERE Partida_ID_FK = @partidaId AND Equipo = @equipo
          `);
        return { equipo, resultados: resultadosQuery.recordset };
      }));

      const logrosPorEquipo = {};
      for (const equipo of equipos) {
        const userQuery = await pool.request()
          .input('partidaId', sql.Int, partidaId)
          .input('equipo', sql.Int, equipo)
          .query(`
            SELECT TOP 1 Usuario_ID_FK
            FROM Participantes_TB
            WHERE Partida_ID_FK = @partidaId AND Equipo_Numero = @equipo
          `);

        const usuarioEjemplo = userQuery.recordset[0]?.Usuario_ID_FK;

        if (usuarioEjemplo) {
          const logrosQuery = await pool.request()
            .input('userId', sql.Int, usuarioEjemplo)
            .input('partidaId', sql.Int, partidaId)
            .query(`
              SELECT l.*
              FROM Usuario_Logros_TB ul
              JOIN Logros_TB l ON ul.Logro_ID_FK = l.Logro_ID_PK
              WHERE ul.Usuario_ID_FK = @userId
                AND ul.Partida_ID_FK = @partidaId
                AND l.Tipo = 'grupo'
            `);
          logrosPorEquipo[equipo] = logrosQuery.recordset;
        } else {
          logrosPorEquipo[equipo] = [];
        }
      }

      console.log(" Resultados para profesor obtenidos correctamente");
      return res.status(200).json({
        partida,
        equipos: miembrosPorEquipo,
        resultados: resultadosPorEquipo,
        logros: logrosPorEquipo
      });
    }

    // 3. Si es estudiante
    if (rol === 'Estudiante') {
  console.log(`🎓 Verificando participación del estudiante ${userId}`);

  const participanteQuery = await pool.request()
    .input('userId', sql.Int, userId)
    .input('partidaId', sql.Int, partidaId)
    .query(`
      SELECT Equipo_Numero 
      FROM Participantes_TB 
      WHERE Usuario_ID_FK = @userId AND Partida_ID_FK = @partidaId
    `);

  if (participanteQuery.recordset.length === 0) {
    console.log(` Estudiante ${userId} no participó en la partida ${partidaId}`);
    return res.status(403).json({ message: 'No participaste en esta partida' });
  }

  const equipoNumero = participanteQuery.recordset[0].Equipo_Numero;
  console.log(` Estudiante ${userId} participó en el equipo ${equipoNumero}`);

  // Envolver todo en arrays y objetos como en profesor
  // 1. Obtener miembros solo del equipo del estudiante
  const miembrosPorEquipo = [{
    equipo: equipoNumero,
    miembros: (await pool.request()
      .input('partidaId', sql.Int, partidaId)
      .input('equipo', sql.Int, equipoNumero)
      .query(`
        SELECT u.Usuario_ID_PK, u.Nombre, u.Apellido1, u.Apellido2
        FROM Participantes_TB p
        JOIN Usuario_TB u ON p.Usuario_ID_FK = u.Usuario_ID_PK
        WHERE p.Partida_ID_FK = @partidaId AND p.Equipo_Numero = @equipo
      `)).recordset
  }];

  // 2. Resultados solo del equipo del estudiante
  const resultadosPorEquipo = [{
    equipo: equipoNumero,
    resultados: (await pool.request()
      .input('partidaId', sql.Int, partidaId)
      .input('equipo', sql.Int, equipoNumero)
      .query(`
        SELECT *
        FROM Resultados_TB
        WHERE Partida_ID_FK = @partidaId AND Equipo = @equipo
      `)).recordset
  }];

  // 3. Logros del estudiante, pero adaptado a estructura de logrosPorEquipo (obj con equipo como clave)
  const logrosQuery = await pool.request()
    .input('userId', sql.Int, userId)
    .input('partidaId', sql.Int, partidaId)
    .query(`
      SELECT l.*
      FROM Usuario_Logros_TB ul
      JOIN Logros_TB l ON ul.Logro_ID_FK = l.Logro_ID_PK
      WHERE ul.Usuario_ID_FK = @userId
        AND ul.Partida_ID_FK = @partidaId
        AND l.Tipo IN ('grupo', 'usuario', 'especial')
    `);

  const logrosPorEquipo = {
    [equipoNumero]: logrosQuery.recordset
  };

  console.log("✅ Resultados para estudiante listos (estructura tipo profesor)");
  return res.status(200).json({
    partida,
    equipos: miembrosPorEquipo,
    resultados: resultadosPorEquipo,
    logros: logrosPorEquipo
  });
}
    // 4. Rol no reconocido
    console.log(` Rol ${rol} no autorizado`);
    return res.status(403).json({ message: 'Rol no autorizado' });

  } catch (error) {
    console.error(' Error al obtener resultados:', error);
    return res.status(500).json({ message: 'Error al obtener resultados' });
  }
};

export const getFullUserGames = async (req, res) => {
  const userId = req.user.id;

  try {
    const pool = await poolPromise;

    // 0. Obtener el rol del usuario
    const rolResult = await pool.request()
      .input("userId", sql.Int, userId)
      .query(`
        SELECT r.Rol
        FROM Usuario_TB u
        JOIN Rol_TB r ON u.Rol_ID_FK = r.Rol_ID_PK
        WHERE u.Usuario_ID_PK = @userId
      `);

    const rol = rolResult.recordset[0]?.Rol;

    // Obtener cursos y grupos una sola vez (se usan en ambos casos)
    const grupoCursoQuery = await pool.request().query(`
      SELECT GrupoCurso_ID_PK, Codigo_Grupo, Curso_ID_FK
      FROM GrupoCurso_TB
    `);
    const grupos = grupoCursoQuery.recordset;

    const cursosQuery = await pool.request().query(`
      SELECT CodigoCurso_ID_PK, Nombre_Curso, Codigo_Curso
      FROM CodigoCurso_TB
    `);
    const cursos = cursosQuery.recordset;

    // Obtener resultados (se usan en ambos casos)
    const resultadosResult = await pool.request().query(`
      SELECT Resultados_ID_PK, Equipo, Partida_ID_FK, Resultados, Comentario
      FROM Resultados_TB
    `);
    const resultados = resultadosResult.recordset;

    // Obtener todas las partidas (usado en ambos)
    const partidasQuery = await pool.request().query(`
      SELECT Partida_ID_PK, FechaInicio, FechaFin, Profesor_ID_FK, Grupo_ID_FK
      FROM Partida_TB
    `);
    const partidas = partidasQuery.recordset;

    // Si es PROFESOR
    if (rol === "Profesor") {
      // Filtrar partidas dirigidas por el profesor
      const partidasProfesor = partidas.filter(p => p.Profesor_ID_FK === userId);

      // Verificar cuáles tienen al menos un resultado
      const partidasConResultados = partidasProfesor.filter(partida =>
        resultados.some(r => r.Partida_ID_FK === partida.Partida_ID_PK)
      );

      // Obtener las últimas 5 con resultados
      const ultimasPartidas = partidasConResultados
        .slice(-5)
        .reverse()
        .map(partida => {
          const grupo = grupos.find(g => g.GrupoCurso_ID_PK === partida.Grupo_ID_FK);
          const curso = cursos.find(c => c.CodigoCurso_ID_PK === grupo?.Curso_ID_FK);

          return {
            fecha: partida.FechaFin,
            curso: `${curso.Codigo_Curso}-${curso.Nombre_Curso} G${grupo.Codigo_Grupo}`,
            equipo: "-", // No aplica para profesor
            accion: "ver más"
          };
        });

      // Obtener todos los cursos donde el profesor está vinculado
      const cursosVinculadosQuery = await pool.request()
        .input("userId", sql.Int, userId)
        .query(`
          SELECT GrupoCurso_ID_FK
          FROM GrupoVinculado_TB
          WHERE Usuario_ID_FK = @userId
        `);

      const grupoIds = cursosVinculadosQuery.recordset.map(row => row.GrupoCurso_ID_FK);

      const nombresCursos = grupoIds.map(id => {
        const grupo = grupos.find(g => g.GrupoCurso_ID_PK === id);
        const curso = cursos.find(c => c.CodigoCurso_ID_PK === grupo?.Curso_ID_FK);
        return curso && grupo
          ? `${curso.Codigo_Curso}-${curso.Nombre_Curso} G${grupo.Codigo_Grupo}`
          : null;
      }).filter(Boolean);

      return res.status(200).json({
        success: true,
        data: {
          simulaciones: partidasConResultados.length,
          logros: 0,
          cursoActual: nombresCursos.join(", "),
          ultimasPartidas
        }
      });
    }

    // Si es ESTUDIANTE
    // Obtener todas las participaciones del estudiante
    const participacionesResult = await pool.request()
      .input("userId", sql.Int, userId)
      .query(`
        SELECT Participantes_ID_PK, Usuario_ID_FK, Equipo_Numero, Partida_ID_FK, Fecha_Ingreso
        FROM Participantes_TB
        WHERE Usuario_ID_FK = @userId
      `);

    const participaciones = participacionesResult.recordset;

    if (participaciones.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          simulaciones: 0,
          logros: 0,
          cursoActual: null,
          ultimasPartidas: []
        }
      });
    }

    // Extraer IDs de partida y equipo
    const partidaEquipoPairs = participaciones.map(p => ({
      partidaId: p.Partida_ID_FK,
      equipo: p.Equipo_Numero
    }));

    // Filtrar resultados válidos
    const resultadosUsuario = resultados.filter(res =>
      partidaEquipoPairs.some(pair =>
        pair.partidaId === res.Partida_ID_FK && pair.equipo === res.Equipo
      )
    );

    // Últimas 5 partidas válidas
    const partidasIdsUnicas = [...new Set(resultadosUsuario.map(r => r.Partida_ID_FK))];
    const ultimasPartidasIds = partidasIdsUnicas.slice(-5).reverse();

    const partidasFinales = ultimasPartidasIds.map(pid => {
      const partida = partidas.find(p => p.Partida_ID_PK === pid);
      const grupo = grupos.find(g => g.GrupoCurso_ID_PK === partida.Grupo_ID_FK);
      const curso = cursos.find(c => c.CodigoCurso_ID_PK === grupo?.Curso_ID_FK);
      const equipo = resultadosUsuario.find(r => r.Partida_ID_FK === pid)?.Equipo;

      return {
        fecha: partida.FechaFin,
        curso: `${curso.Codigo_Curso}-${curso.Nombre_Curso} G${grupo.Codigo_Grupo}`,
        equipo,
        accion: "ver más"
      };
    });

    // Obtener curso actual
    const grupoVinculadoQuery = await pool.request()
      .input("userId", sql.Int, userId)
      .query(`
        SELECT GrupoCurso_ID_FK
        FROM GrupoVinculado_TB
        WHERE Usuario_ID_FK = @userId
      `);
    const grupoActual = grupoVinculadoQuery.recordset[0];

    let cursoActual = null;

    if (grupoActual) {
      const grupo = grupos.find(g => g.GrupoCurso_ID_PK === grupoActual.GrupoCurso_ID_FK);
      const curso = cursos.find(c => c.CodigoCurso_ID_PK === grupo?.Curso_ID_FK);
      if (grupo && curso) {
        cursoActual = `${curso.Codigo_Curso}-${curso.Nombre_Curso} G${grupo.Codigo_Grupo}`;
      }
    }

    // Obtener logros
    const logrosQuery = await pool.request()
      .input("userId", sql.Int, userId)
      .query(`
        SELECT COUNT(*) AS cantidad
        FROM Usuario_Logros_TB
        WHERE Usuario_ID_FK = @userId
      `);
    const cantidadLogros = logrosQuery.recordset[0].cantidad;

    return res.status(200).json({
      success: true,
      data: {
        simulaciones: resultadosUsuario.length,
        logros: cantidadLogros,
        cursoActual: cursoActual || "No asignado",
        ultimasPartidas: partidasFinales
      }
    });

  } catch (error) {
    console.error("Error en getFullUserGames:", error);
    return res.status(500).json({ success: false, message: "Error al obtener información del usuario" });
  }
};







