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

