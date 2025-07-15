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

    try {
        const pool = await poolPromise;

        // 1. Verificar si la partida existe
        const partidaQuery = await pool.request()
            .input('partidaId', sql.Int, partidaId)
            .query('SELECT * FROM Partida_TB WHERE Partida_ID_PK = @partidaId');

        if (partidaQuery.recordset.length === 0) {
            return res.status(404).json({ message: 'Partida no encontrada' });
        }

        const partida = partidaQuery.recordset[0];

        // 2. Verificar permisos del usuario
        if (rol === 'Profesor') {
            // Si es profesor, verificar que sea el creador de la partida
            if (partida.Profesor_ID_FK !== userId) {
                return res.status(403).json({ message: 'No tienes permiso para ver estos resultados' });
            }
        } else {
            // Si es estudiante, verificar que participó en la partida
            const participanteQuery = await pool.request()
                .input('userId', sql.Int, userId)
                .input('partidaId', sql.Int, partidaId)
                .query('SELECT * FROM Participantes_TB WHERE Usuario_ID_FK = @userId AND Partida_ID_FK = @partidaId');

            if (participanteQuery.recordset.length === 0) {
                return res.status(403).json({ message: 'No participaste en esta partida' });
            }
        }

        // 3. Obtener datos según el rol
        if (rol === 'Profesor') {
            // Obtener todos los equipos de la partida
            const equiposQuery = await pool.request()
                .input('partidaId', sql.Int, partidaId)
                .query(`
                    SELECT DISTINCT Equipo_Numero 
                    FROM Participantes_TB 
                    WHERE Partida_ID_FK = @partidaId
                    ORDER BY Equipo_Numero
                `);

            const equipos = equiposQuery.recordset.map(e => e.Equipo_Numero);

            // Obtener miembros de cada equipo
            const miembrosPromises = equipos.map(async equipo => {
                const miembrosQuery = await pool.request()
                    .input('partidaId', sql.Int, partidaId)
                    .input('equipo', sql.Int, equipo)
                    .query(`
                        SELECT u.Usuario_ID_PK, u.Nombre, u.Apellido1, u.Apellido2
                        FROM Participantes_TB p
                        JOIN Usuario_TB u ON p.Usuario_ID_FK = u.Usuario_ID_PK
                        WHERE p.Partida_ID_FK = @partidaId AND p.Equipo_Numero = @equipo
                    `);
                return {
                    equipo,
                    miembros: miembrosQuery.recordset
                };
            });

            const miembrosPorEquipo = await Promise.all(miembrosPromises);

            // Obtener resultados por equipo
            const resultadosPromises = equipos.map(async equipo => {
                const resultadosQuery = await pool.request()
                    .input('partidaId', sql.Int, partidaId)
                    .input('equipo', sql.Int, equipo)
                    .query(`
                        SELECT *
                        FROM Resultados_TB
                        WHERE Partida_ID_FK = @partidaId AND Equipo_Numero = @equipo
                    `);
                return {
                    equipo,
                    resultados: resultadosQuery.recordset
                };
            });

            const resultadosPorEquipo = await Promise.all(resultadosPromises);

            // Obtener logros de la partida (a nivel de equipo)
            const logrosQuery = await pool.request()
                .input('partidaId', sql.Int, partidaId)
                .query(`
                    SELECT l.*, pl.Equipo_Numero
                    FROM Partida_Logros_TB pl
                    JOIN Logros_TB l ON pl.Logro_ID_FK = l.Logro_ID_PK
                    WHERE pl.Partida_ID_FK = @partidaId AND l.Tipo = 'grupo'
                `);

            const logrosPorEquipo = logrosQuery.recordset.reduce((acc, logro) => {
                if (!acc[logro.Equipo_Numero]) acc[logro.Equipo_Numero] = [];
                acc[logro.Equipo_Numero].push(logro);
                return acc;
            }, {});

            res.status(200).json({
                partida,
                equipos: miembrosPorEquipo,
                resultados: resultadosPorEquipo,
                logros: logrosPorEquipo
            });

        } else {
            // Si es estudiante, obtener solo su equipo
            const equipoQuery = await pool.request()
                .input('userId', sql.Int, userId)
                .input('partidaId', sql.Int, partidaId)
                .query(`
                    SELECT Equipo_Numero 
                    FROM Participantes_TB 
                    WHERE Usuario_ID_FK = @userId AND Partida_ID_FK = @partidaId
                `);

            if (equipoQuery.recordset.length === 0) {
                return res.status(200).json({ message: 'No participaste en esta partida' });
            }

            const equipoNumero = equipoQuery.recordset[0].Equipo_Numero;

            // Obtener miembros del equipo
            const miembrosQuery = await pool.request()
                .input('partidaId', sql.Int, partidaId)
                .input('equipo', sql.Int, equipoNumero)
                .query(`
                    SELECT u.Usuario_ID_PK, u.Nombre, u.Apellido1, u.Apellido2
                    FROM Participantes_TB p
                    JOIN Usuario_TB u ON p.Usuario_ID_FK = u.Usuario_ID_PK
                    WHERE p.Partida_ID_FK = @partidaId AND p.Equipo_Numero = @equipo
                `);

            // Obtener resultados del equipo
            const resultadosQuery = await pool.request()
                .input('partidaId', sql.Int, partidaId)
                .input('equipo', sql.Int, equipoNumero)
                .query(`
                    SELECT *
                    FROM Resultados_TB
                    WHERE Partida_ID_FK = @partidaId AND Equipo_Numero = @equipo
                `);

            // Obtener logros del equipo
            const logrosQuery = await pool.request()
                .input('partidaId', sql.Int, partidaId)
                .input('equipo', sql.Int, equipoNumero)
                .query(`
                    SELECT l.*
                    FROM Partida_Logros_TB pl
                    JOIN Logros_TB l ON pl.Logro_ID_FK = l.Logro_ID_PK
                    WHERE pl.Partida_ID_FK = @partidaId AND pl.Equipo_Numero = @equipo AND l.Tipo = 'grupo'
                `);

            res.status(200).json({
                partida,
                equipo: {
                    numero: equipoNumero,
                    miembros: miembrosQuery.recordset,
                    resultados: resultadosQuery.recordset,
                    logros: logrosQuery.recordset
                }
            });
        }

    } catch (error) {
        console.error('Error al obtener resultados:', error);
        res.status(500).json({ message: 'Error al obtener resultados' });
    }
};
