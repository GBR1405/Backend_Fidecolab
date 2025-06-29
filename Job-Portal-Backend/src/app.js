import express from 'express';
import http from 'http';
import { Server } from 'socket.io'; // Importar Socket.IO
import userRoutes from './routes/userRoutes.js';
import bodyParser from 'body-parser';
import { poolPromise } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import PersonalizeRoutes from './routes/PersonalizeRoutes.js';
import TeacherRoutes from './routes/TeacherRoutes.js';
import AdminRouters from './routes/AdminRoutes.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import authMiddleware from './middleware/authMiddleware.js';
import sql from 'mssql';
import simulationRoutes from './routes/SimulacionRoutes.js';
import seedrandom from 'seedrandom';

const app = express();
app.set('trust proxy', 1);
const pool = await poolPromise;

// Configuraciones de Express
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

dotenv.config();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

app.post('/login', (req, res) => {
  // ... lógica de autenticación ...

  res.cookie('authToken', token, {
    httpOnly: true,
    secure: false, // En desarrollo (true en producción con HTTPS)
    sameSite: 'None', // Permite enviar la cookie entre sitios
    domain: '192.168.0.4', // ¡OJO! Usa tu IP o dominio real
    path: '/', // Accesible en todas las rutas
    maxAge: 24 * 60 * 60 * 1000 // 1 día de vida
  });

  const cookieOptions = {
    httpOnly: true,
    secure: false,
    sameSite: 'None',
    domain: process.env.NODE_ENV === 'production' ? '.tudominio.com' : '192.168.0.4',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000
  };

  res.cookie('authToken', token, cookieOptions);
  res.cookie('IFUser_Info', encryptedUser, cookieOptions);

  res.json({ success: true });
});


app.use(cors({
  origin: [
    "https://frontend-fidecolab.vercel.app"
  ],
  credentials: true,
  exposedHeaders: ['set-cookie', 'Authorization']
}));



app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json());

// Rutas de la aplicación
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/', PersonalizeRoutes);
app.use('/api/', AdminRouters);
app.use('/api/', TeacherRoutes);
app.use('/api/', simulationRoutes);

// Crear servidor HTTP para Express y Socket.IO
const server = http.createServer(app);

// Configurar Socket.IO
const io = new Server(server, {
  cors: {
    origin: [
      "https://frontend-fidecolab.vercel.app"
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ['Cookie', 'Authorization']
  },
  cookie: {
    name: "io",
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: true   // en producción debe ser true
  }
});


// Constantes
const salas = {};
const activeGames = {};
const puzzleStates = {};
const partidasConfig = new Map();
const partidaRooms = new Map();
const activeDemos = {};
const pieceUpdateQueue = {};

// Agregar al inicio del archivo, con las otras constantes
const gameTimers = {};

const memoryGames = {}; // {partidaId: {equipoNumero: {config, state}}}
const hangmanGames = {};
const puzzleGames = {};
const drawingGames = {}; // {partidaId: {equipoNumero: {canvasState, imageData}}}
const drawingDemonstrations = new Map(); // Usamos Map para mejor gestión
const teamDrawings = new Map();
const drawingDemonstration = {};
const puzzleUpdateThrottle = {};

const teamProgress = {};

const gameProgress = {}; // {partidaId: {equipoNumero: {juegoType: progress}}}
const gameResults = {}; // {partidaId: {ordenJuego: {equipoNumero: result}}}

const drawingStates = {};
const tintaStates = {};

const PUZZLE_CONFIG = {
  'Fácil': { size: 3, pieceSize: 150 },
  'Normal': { size: 4, pieceSize: 120 },
  'Difícil': { size: 5, pieceSize: 100 }
};


// Configuración de tiempos por juego y dificultad
const GAME_TIMES = {
  'Dibujo': {
    'facil': 7 * 60,    // 7 minutos en segundos
    'normal': 5 * 60,    // 5 minutos en segundos
    'dificil': 3 * 60    // 3 minutos en segundos
  },
  'Ahorcado': {
    'facil': 7 * 60,
    'normal': 5 * 60,
    'dificil': 3 * 60
  },
  'Memoria': 4.5 * 60,   // 4.5 minutos en segundos
  'Rompecabezas': 4.5 * 60
};

//Funciones extras



// Función para calcular el progreso del rompecabezas

function generatePuzzlePieces(size, imageUrl, seed) {
  const total = size * size;
  const positions = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      positions.push({ row: r, col: c });
    }
  }

  const random = seedrandom(seed);
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  return positions.map((pos, index) => {
    const correctRow = Math.floor(index / size);
    const correctCol = index % size;
    return {
      id: `piece-${correctRow}-${correctCol}`,
      correctRow,
      correctCol,
      currentRow: pos.row,
      currentCol: pos.col
    };
  });
}

function calculatePuzzleProgress(pieces) {
  const correct = pieces.filter(p => p.currentRow === p.correctRow && p.currentCol === p.correctCol).length;
  return Math.round((correct / pieces.length) * 100);
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

function generateMemoryPairs(seed, pairsCount) {
  // 1. Usar una función hash simple para consistencia
  const hash = simpleHash(seed);
  const random = () => {
    const x = Math.sin(hash) * 10000;
    return x - Math.floor(x);
  };

  // 2. Selección de símbolos
  const symbols = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦'];
  const usedSymbols = symbols.slice(0, pairsCount);
  const pairs = [...usedSymbols, ...usedSymbols];

  // 3. Shuffle consistente
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }

  // 4. Mapear a objetos carta
  return pairs.map((symbol, index) => ({
    id: `${seed}-${index}`, // ID único y consistente
    symbol,
    flipped: false,
    matched: false
  }));
}

async function getGameConfig(personalizacionId) {
  try {
    const pool = await poolPromise;
    const request = pool.request();
    
    const result = await request.query(`
      SELECT 
        tj.Juego AS tipo,
        cj.Orden,
        cj.Dificultad,
        CASE cj.Dificultad
          WHEN 1 THEN 'facil'
          WHEN 2 THEN 'normal'
          WHEN 3 THEN 'dificil'
        END AS dificultad,
        tem.Contenido
      FROM ConfiguracionJuego_TB cj
      JOIN Tipo_Juego_TB tj ON cj.Tipo_Juego_ID_FK = tj.Tipo_Juego_ID_PK
      JOIN Tema_Juego_TB tem ON cj.Tema_Juego_ID_FK = tem.Tema_Juego_ID_PK
      WHERE cj.Personalizacion_ID_PK = @personalizacionId
      ORDER BY cj.Orden
    `, [
      { name: 'personalizacionId', type: sql.Int, value: personalizacionId }
    ]);

    return result.recordset;
  } catch (err) {
    console.error('Error en getGameConfig:', err);
    throw err;
  }
}

// 2. Función para generar IDs consistentes
function generateConsistentId(partidaId, equipoNumero, row, col) {
  return `piece-${partidaId}-${equipoNumero}-${row}-${col}`;
}

// 3. Función para generar el puzzle de forma consistente
function generatePuzzle(partidaId, equipoNumero, difficulty, imageUrl) {
  const sizes = { 'facil': 5, 'normal': 7, 'dificil': 10 };
  const size = sizes[difficulty.toLowerCase()] || 5;
  const pieceSize = 100;
  const pieces = [];

  // Semilla consistente
  const seed = `${partidaId}-${equipoNumero}`;
  const rng = seedrandom(seed);

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const index = row * size + col;
      pieces.push({
        id: `piece-${partidaId}-${equipoNumero}-${row}-${col}`,
        row,
        col,
        correctX: col * pieceSize,
        correctY: row * pieceSize,
        currentX: Math.floor(rng() * 500),
        currentY: Math.floor(rng() * 500),
        locked: false,
        size: pieceSize,
        topEdge: row === 0 ? 'flat' : (rng() > 0.5 ? 'tab' : 'blank'),
        rightEdge: col === size-1 ? 'flat' : (rng() > 0.5 ? 'tab' : 'blank'),
        bottomEdge: row === size-1 ? 'flat' : (rng() > 0.5 ? 'tab' : 'blank'),
        leftEdge: col === 0 ? 'flat' : (rng() > 0.5 ? 'tab' : 'blank')
      });
    }
  }
  return pieces;
}

function startGameTimer(partidaId, gameType, difficulty = null) {
  // Detener el temporizador anterior si existe
  if (gameTimers[partidaId]) {
    clearInterval(gameTimers[partidaId].interval);
  }

  console.log(`[TIMER-2] Iniciando temporizador para ${gameType} (${difficulty})`);

  // Obtener el tiempo según el juego y dificultad
  let timeInSeconds;
  if (gameType === 'Dibujo' || gameType === 'Ahorcado') {
    console.log(gameType, difficulty);
    timeInSeconds = {
      'fácil': 7 * 60,    // 7 minutos
      'Fácil': 7 * 60,    // 7 minutos
      'normal': 5 * 60,    // 5 minutos
      'Normal': 5 * 60,    // 5 minutos
      'difícil': 3 * 60    // 3 minutos
    }[difficulty];
  } else {
    timeInSeconds = 4.5 * 60; // 4.5 minutos para Memoria/Rompecabezas
  }

  const startTime = Date.now();
  const endTime = startTime + (timeInSeconds * 1000);

  // Actualizar el estado del temporizador
  gameTimers[partidaId] = {
    interval: null,
    startTime,
    endTime,
    remaining: timeInSeconds,
    gameType,
    difficulty
  };

  // Emitir el estado inicial inmediatamente
  io.to(`partida_${partidaId}`).emit('timerUpdate', {
    remaining: timeInSeconds,
    total: timeInSeconds,
    gameType,
    difficulty
  });

  // Iniciar el intervalo para actualizar el tiempo
  gameTimers[partidaId].interval = setInterval(() => {
    const now = Date.now();
    const remaining = Math.max(0, Math.round((endTime - now) / 1000));

    gameTimers[partidaId].remaining = remaining;

    // Emitir el tiempo actualizado a todos los clientes
    io.to(`partida_${partidaId}`).emit('timerUpdate', {
      remaining,
      total: timeInSeconds,
      gameType,
      difficulty
    });

    if (remaining <= 0) {
      clearInterval(gameTimers[partidaId].interval);
      io.to(`partida_${partidaId}`).emit('timeUp', gameType);
      
      if (global.partidasConfig && global.partidasConfig[partidaId]) {
        const config = global.partidasConfig[partidaId];
        if (config.currentIndex < config.juegos.length - 1) {
          setTimeout(() => {
            io.to(`partida_${partidaId}`).emit('nextGame');
          }, 2000);
        }
      }
    }
  }, 1000);
}

// Lógica de Socket.IO
io.on('connection', (socket) => {
  console.log('Un cliente se ha conectado:', socket.id);

  // Unirse a una sala
  socket.on('JoinRoom', async (roomId, user) => {
    try {
      const pool = await poolPromise; // Obtener la conexión a la base de datos

      // Paso 1: Obtener el rol del usuario
      const rolQuery = `
        SELECT Rol
        FROM Usuario_TB
        INNER JOIN Rol_TB ON Usuario_TB.Rol_ID_FK = Rol_TB.Rol_ID_PK
        WHERE Usuario_ID_PK = @usuario_id;
      `;

      const rolResult = await pool.request()
        .input('usuario_id', sql.Int, user.userId)
        .query(rolQuery);

      if (rolResult.recordset.length === 0) {
        console.log(`Usuario ${user.fullName} (ID: ${user.userId}) no encontrado en la base de datos.`);
        socket.emit('NoAutorizado', 'Usuario no encontrado.');
        return;
      }

      const rol = rolResult.recordset[0].Rol;

      // Paso 2: Verificar el rol y aplicar la lógica correspondiente
      let partidaId;

      if (rol === 'Profesor') {
        // Buscar si el profesor tiene una partida activa
        const partidaResult = await pool.request()
          .input('userId', sql.Int, user.userId)
          .query(`
            SELECT Partida_ID_PK 
            FROM Partida_TB 
            WHERE Profesor_ID_FK = @userId AND EstadoPartida IN ('iniciada', 'en proceso');
          `);

        if (partidaResult.recordset.length === 0) {
          console.log(`Profesor ${user.fullName} (ID: ${user.userId}) no tiene partidas iniciadas.`);
          socket.emit('NoAutorizado', 'No tienes partidas iniciadas.');
          return;
        }

        partidaId = partidaResult.recordset[0].Partida_ID_PK;
      } else {
        // Verificar si el estudiante está en una partida activa
        const participanteResult = await pool.request()
          .input('userId', sql.Int, user.userId)
          .query(`
            SELECT TOP 1 Partida_ID_FK 
            FROM Participantes_TB 
            WHERE Usuario_ID_FK = @userId 
            ORDER BY Partida_ID_FK DESC;
          `);

        if (participanteResult.recordset.length === 0) {
          console.log(`Estudiante ${user.fullName} (ID: ${user.userId}) no está en ninguna partida.`);
          socket.emit('NoAutorizado', 'No estás en ninguna partida.');
          return;
        }

        partidaId = participanteResult.recordset[0].Partida_ID_FK;

        // Verificar si la partida está activa
        const partidaActiva = await pool.request()
          .input('partidaId', sql.Int, partidaId)
          .query(`
            SELECT EstadoPartida 
            FROM Partida_TB 
            WHERE Partida_ID_PK = @partidaId AND EstadoPartida IN ('iniciada', 'en proceso');
          `);

        if (partidaActiva.recordset.length === 0) {
          console.log(`Estudiante ${user.fullName} (ID: ${user.userId}) no está en una partida activa.`);
          socket.emit('NoAutorizado', 'No estás en una partida activa.');
          return;
        }
      }

      // Paso 3: Verificar si la sala a la que intenta unirse coincide con la partida activa
      if (partidaId !== parseInt(roomId)) {
        console.log(`Usuario ${user.fullName} (ID: ${user.userId}) intentó unirse a una sala no autorizada (${roomId})`);
        socket.emit('NoAutorizado', 'No tienes permiso para unirte a esta sala.');
        return;
      }

      // Si está autorizado, unirse a la sala
      socket.join(roomId);

      // Inicializar la sala si no existe
      if (!salas[roomId]) {
        salas[roomId] = {
          usuarios: [],
        };
      }

      // Asignar un socketId al usuario
      user.socketId = socket.id;

      // Verificar si el usuario ya está en la sala
      const usuarioExistente = salas[roomId].usuarios.find(u => u.userId === user.userId);

      if (!usuarioExistente) {
        // Agregar el usuario a la sala
        salas[roomId].usuarios.push(user);
      }

      // Notificar a todos los usuarios en la sala
      io.to(roomId).emit('UpdateUsers', salas[roomId].usuarios);

      console.log(`Usuario ${user.fullName} (ID: ${user.userId}) se unió a la sala ${roomId}`);
    } catch (error) {
      console.error('Error al verificar la participación:', error);
      socket.emit('ErrorServidor', 'Hubo un problema al verificar tu participación.');
    }
  });

  // Al final del io.on('connection', ...)
  socket.on('finishGame', async (partidaId, callback) => {
    try {
      // 1. Actualizar el estado de la partida a 'finalizado'
      await poolPromise.then(pool => 
        pool.request()
          .input('partidaId', sql.Int, partidaId)
          .query(`
            UPDATE Partida_TB
            SET EstadoPartida = 'finalizada'
            WHERE Partida_ID_PK = @partidaId;
          `)
      );

      // 2. Notificar a todos (profesor y estudiantes)
      io.to(`partida_${partidaId}`).emit('gameFinished', { partidaId });

      // 3. Confirmar al emisor
      callback({ success: true });
    } catch (error) {
      console.error('Error al finalizar la partida:', error);
      callback({ error: error.message });
    }
  });

  // Salir de una sala
  socket.on('disconnect', () => {
    console.log('Un cliente se ha desconectado:', socket.id);
  
    // Buscar y eliminar al usuario de todas las salas
    for (const roomId in salas) {
      const usuariosEnSala = salas[roomId].usuarios;
      const usuarioDesconectado = usuariosEnSala.find(u => u.socketId === socket.id);
  
      if (usuarioDesconectado) {
        // Eliminar al usuario de la sala
        salas[roomId].usuarios = usuariosEnSala.filter(u => u.socketId !== socket.id);
  
        // Notificar a todos los usuarios en la sala
        io.to(roomId).emit('UpdateUsers', salas[roomId].usuarios);
  
        console.log(`Usuario ${usuarioDesconectado.fullName} (ID: ${usuarioDesconectado.userId}) salió de la sala ${roomId}`);
      }
    }
  });

  // Evento para iniciar la partida
  socket.on('StartGame', async (partidaId) => {
    try {

      io.to(partidaId).emit('StartTimer');

      const pool = await poolPromise;

      // Obtener la lista de participantes y sus equipos
      const query = `
        SELECT Usuario_ID_FK, Equipo_Numero
        FROM Participantes_TB
        WHERE Partida_ID_FK = @partidaId;
      `;

      const result = await pool.request()
        .input('partidaId', sql.Int, partidaId)
        .query(query);

      // Notificar a cada estudiante a qué sala unirse
      result.recordset.forEach((participante) => {
        const salaEquipo = `${partidaId}-${participante.Equipo_Numero}`;
        io.to(participante.Usuario_ID_FK).emit('JoinTeamRoom', salaEquipo);
      });

      // Actualizar el estado de la partida a "iniciada"
      await pool.request()
        .input('partidaId', sql.Int, partidaId)
        .query(`
          UPDATE Partida_TB
          SET EstadoPartida = 'en proceso'
          WHERE Partida_ID_PK = @partidaId;
        `);

      console.log(`Partida ${partidaId} iniciada. Estudiantes redirigidos a sus salas de equipo.`);
    } catch (error) {
      console.error('Error al iniciar la partida:', error);
    }
  });

  socket.on('StartGameSession', async ({ profesorId, partidaId }) => {
    try {
      const pool = await poolPromise;
      const request = pool.request();
  
      // 1. Obtener personalización de la partida
      const partidaResult = await request.input('partidaId', sql.Int, partidaId)
        .query(`
          SELECT Personalizacion_ID_FK 
          FROM Partida_TB 
          WHERE Partida_ID_PK = @partidaId
        `);
  
      if (partidaResult.recordset.length === 0) {
        throw new Error('Partida no encontrada');
      }
  
      const personalizacionId = partidaResult.recordset[0].Personalizacion_ID_FK;
  
      // 2. Obtener configuración de juegos
      const games = await getGameConfig(personalizacionId);
  
      // 3. Crear estructura de la sesión
      activeGames[partidaId] = {
        profesorId,
        currentGameIndex: 0,
        games: games.map(game => ({
          type: game.tipo,
          config: {
            dificultad: game.dificultad,
            contenido: game.Contenido,
            orden: game.Orden
          },
          estado: {} // Para guardar estado específico del juego
        })),
        teamMembers: [],
        estadoGeneral: {
          iniciada: new Date(),
          ultimaActualizacion: new Date()
        }
      };

      if (!gameTimers[partidaId] && configResult.recordset.length > 0) {
        const firstGame = configResult.recordset[0];
        startGameTimer(
          partidaId,
          firstGame.tipo,
          firstGame.dificultad.toLowerCase()
        );
      }
  
      // 4. Notificar que la partida está lista
      io.emit('GameSessionReady', { 
        partidaId,
        totalJuegos: games.length
      });
  
    } catch (error) {
      console.error('Error en StartGameSession:', error);
      socket.emit('GameError', { 
        partidaId,
        message: error.message 
      });
    }
  });

  // Unirse a la sala de equipo
  socket.on('JoinTeamRoom', async ({ partidaId, equipoNumero, userId }) => {
    try {
      // 1. Validar parámetros
      if (!partidaId || !equipoNumero || !userId) {
        throw new Error('Faltan parámetros requeridos');
      }
  
      // 2. Verificar que el usuario pertenece al equipo en esta partida
      const verificationQuery = `
        SELECT COUNT(*) as count
        FROM Participantes_TB
        WHERE Partida_ID_FK = @partidaId 
          AND Equipo_Numero = @equipoNumero
          AND Usuario_ID_FK = @userId
      `;
  
      const verificationResult = await pool.request()
        .input('partidaId', sql.Int, partidaId)
        .input('equipoNumero', sql.Int, equipoNumero)
        .input('userId', sql.Int, userId)
        .query(verificationQuery);
  
      if (verificationResult.recordset[0].count === 0) {
        throw new Error('El usuario no pertenece a este equipo en la partida especificada');
      }
  
      // 3. Crear ID de sala (consistente con frontend)
      const roomId = `team-${partidaId}-${equipoNumero}`;
      socket.join(roomId);
  
      // Registrar la sala en nuestro mapa
      if (!partidaRooms.has(partidaId)) {
        partidaRooms.set(partidaId, new Set());
      }
      partidaRooms.get(partidaId).add(equipoNumero);
  
      // 4. Obtener miembros del equipo
      const membersQuery = `
        SELECT 
          u.Usuario_ID_PK as userId,
          CONCAT(u.Nombre, ' ', u.Apellido1, ' ', COALESCE(u.Apellido2, '')) as fullName
        FROM Participantes_TB p
        INNER JOIN Usuario_TB u ON p.Usuario_ID_FK = u.Usuario_ID_PK
        WHERE p.Partida_ID_FK = @partidaId AND p.Equipo_Numero = @equipoNumero
      `;
  
      const result = await pool.request()
        .input('partidaId', sql.Int, partidaId)
        .input('equipoNumero', sql.Int, equipoNumero)
        .query(membersQuery);
  
      // 5. Emitir miembros actualizados
      io.to(roomId).emit('UpdateTeamMembers', result.recordset);
  
      console.log(`Usuario ${userId} unido a ${roomId}`);
  
    } catch (error) {
      console.error('Error en JoinTeamRoom:', error.message);
      socket.emit('error', { 
        message: error.message || 'Error al unirse a la sala',
        code: 'TEAM_VALIDATION_ERROR'
      });
    }
  });

  // Movimiento del mouse
  socket.on('SendMousePosition', ({ roomId, userId, x, y }) => {
    // Validar que roomId sea string
    if (typeof roomId !== 'string') {
      console.error('roomId debe ser string:', roomId);
      return;
    }
  
    if (roomId.includes('undefined')) {
      console.error('Sala inválida:', roomId);
      return;
    }
    
    socket.to(roomId).emit('BroadcastMousePosition', userId, x, y);
  });

  // Click y arrastrar (rompecabezas)
  socket.on('DragPiece', (roomId, userId, pieceId, x, y) => {
    console.log(`Usuario ${userId} arrastró la pieza ${pieceId} a (${x}, ${y}) en la sala ${roomId}`);
    // Transmitir a todos en la sala excepto al remitente original
    socket.to(roomId).emit('BroadcastDragPiece', userId, pieceId, x, y);
  });
  // Click (memoria y ahorcado)
  socket.on('Click', (roomId, userId, targetId) => {
    console.log(`Usuario ${userId} hizo click en ${targetId} en la sala ${roomId}`);
    io.to(roomId).emit('BroadcastClick', userId, targetId);
  });

  // Dibujo
  socket.on('StartDrawing', (roomId, userId, x, y) => {
    console.log(`Usuario ${userId} comenzó a dibujar en (${x}, ${y}) en la sala ${roomId}`);
    io.to(roomId).emit('BroadcastStartDrawing', userId, x, y);
  });

  socket.on('Draw', (roomId, userId, x, y) => {
    console.log(`Usuario ${userId} dibujó en (${x}, ${y}) en la sala ${roomId}`);
    io.to(roomId).emit('BroadcastDraw', userId, x, y);
  });

  socket.on('StopDrawing', (roomId, userId) => {
    console.log(`Usuario ${userId} dejó de dibujar en la sala ${roomId}`);
    io.to(roomId).emit('BroadcastStopDrawing', userId);
  });

  // Desconexión
  socket.on('disconnect', () => {
    console.log('Un cliente se ha desconectado:', socket.id);
  });


  //Prueba -----------------------------------------------------------------------
// Cuando un cliente selecciona un juego
socket.on('SelectGame', (roomId, gameType) => {
  const defaultConfig = {
    rows: 5,
    cols: 5,
    imageUrl: 'https://imagen.nextn.es/wp-content/uploads/2022/08/2208-10-Splatoon-3-01.jpg?strip=all&lossy=1&sharp=1&ssl=1'
  };
  io.to(roomId).emit('LoadGame', gameType, defaultConfig);
  
  if (!puzzleStates[roomId]) {
    puzzleStates[roomId] = []; // Inicializar estado vacío
  }
});

// Inicializar juego
socket.on('InitGame', (roomId, gameType, initialState) => {
  if (!activeGames[roomId]) return;
  activeGames[roomId].state = initialState;
  io.to(roomId).emit('UpdateGameState', gameType, initialState);
});


socket.on('movePiece', ({ partidaId, equipoNumero, pieceId, x, y }) => {
  const gameId = `puzzle-${partidaId}-${equipoNumero}`;
  const game = puzzleGames[gameId];
  if (!game) return;

  const piece = game.pieces.find(p => p.id === pieceId);
  if (!piece || piece.locked) return;

  // Actualizar posición localmente
  piece.currentX = x;
  piece.currentY = y;

  // Transmitir a otros (excepto al remitente)
  socket.to(`team-${partidaId}-${equipoNumero}`).emit('pieceMoved', {
    pieceId,
    x,
    y,
    userId: socket.id
  });
});


socket.on('UpdatePieces', (roomId, pieces) => {
  puzzleStates[roomId] = pieces;
  io.to(roomId).emit('UpdatePieces', pieces);
});

socket.on('lockPiece', ({ partidaId, equipoNumero, pieceId, x, y }) => {
  const gameId = `puzzle-${partidaId}-${equipoNumero}`;
  const game = puzzleGames[gameId];
  if (!game) return;

  const piece = game.pieces.find(p => p.id === pieceId);
  if (!piece || piece.locked) return;

  piece.locked = true;
  piece.currentX = x;
  piece.currentY = y;

  // Notificar a todos
  io.to(`team-${partidaId}-${equipoNumero}`).emit('pieceLocked', {
    pieceId,
    x,
    y
  });
});

// Modifica el evento getGameConfig
socket.on('getGameConfig', async (partidaId, callback) => {
  try {
    const pool = await poolPromise;
    console.log(`[DEBUG] Solicitando configuración para partida ${partidaId}`);

    // Verificar si ya tenemos la configuración en la variable global
    if (global.partidasConfig && global.partidasConfig[partidaId]) {
      const config = global.partidasConfig[partidaId];
      return callback({
        juegos: config.juegos,
        total: config.juegos.length,
        profesorId: config.profesorId,
        currentIndex: config.currentIndex
      });
    }

    // Emitir el estado actual del temporizador
    if (gameTimers[partidaId]) {
      const { remaining, total, gameType, difficulty } = gameTimers[partidaId];
      io.to(`partida_${partidaId}`).emit('timerUpdate', { 
        remaining, 
        total, 
        gameType, 
        difficulty 
      });
    }
    
    // 1. Obtener partida con profesorId
    const partidaResult = await pool.request()
      .input('partidaId', sql.Int, partidaId)
      .query(`
        SELECT p.Personalizacion_ID_FK, p.Profesor_ID_FK 
        FROM Partida_TB p
        WHERE p.Partida_ID_PK = @partidaId
      `);

    if (partidaResult.recordset.length === 0) {
      return callback({ error: 'Partida no encontrada' });
    }

    const personalizacionId = partidaResult.recordset[0].Personalizacion_ID_FK;
    const profesorId = partidaResult.recordset[0].Profesor_ID_FK;
    
    // 2. Obtener configuración de juegos
    const configResult = await pool.request()
      .input('personalizacionId', sql.Int, personalizacionId)
      .query(`
        SELECT 
          tj.Juego AS tipo,
          cj.Orden,
          cj.Dificultad,
          CASE cj.Dificultad
            WHEN 1 THEN 'Fácil'
            WHEN 2 THEN 'Normal'
            WHEN 3 THEN 'Difícil'
          END AS dificultad,
          ISNULL(tem.Contenido, 'Sin tema específico') AS tema,
          CASE tj.Juego
            WHEN 'Rompecabezas' THEN 
              CASE cj.Dificultad
                WHEN 1 THEN '3x3'
                WHEN 2 THEN '4x4'
                WHEN 3 THEN '5x5'
              END
            WHEN 'Dibujo' THEN 
              CASE cj.Dificultad
                WHEN 1 THEN '3 minutos'
                WHEN 2 THEN '2 minutos'
                WHEN 3 THEN '1 minuto'
              END
            WHEN 'Ahorcado' THEN 
              CASE cj.Dificultad
                WHEN 1 THEN '8 intentos'
                WHEN 2 THEN '6 intentos'
                WHEN 3 THEN '4 intentos'
              END
            WHEN 'Memoria' THEN 
              CASE cj.Dificultad
                WHEN 1 THEN '8 pares'
                WHEN 2 THEN '12 pares'
                WHEN 3 THEN '16 pares'
              END
          END AS configEspecifica
        FROM ConfiguracionJuego_TB cj
        INNER JOIN Tipo_Juego_TB tj ON cj.Tipo_Juego_ID_FK = tj.Tipo_Juego_ID_PK
        LEFT JOIN Tema_Juego_TB tem ON cj.Tema_Juego_ID_FK = tem.Tema_Juego_ID_PK
        WHERE cj.Personalizacion_ID_PK = @personalizacionId
        ORDER BY cj.Orden
      `);


      console.log(`[DEBUG] Juegos encontrados:`, configResult.recordset);
    // Inicializar la configuración global SIEMPRE
    if (!global.partidasConfig) global.partidasConfig = {};
    
    // Usar el índice actual si existe, de lo contrario empezar en 0
    const currentIndex = global.partidasConfig[partidaId]?.currentIndex || 0;

    const firstGame = configResult.recordset[0];
    
    // 3. Iniciar temporizador INMEDIATAMENTE
    startGameTimer(partidaId, firstGame.tipo, firstGame.dificultad);
    console.log(`[TIMER] Temporizador iniciado para ${firstGame.tipo} (${firstGame.dificultad})`);
    
    global.partidasConfig[partidaId] = {
      juegos: configResult.recordset,
      currentIndex: currentIndex,
      profesorId: profesorId
    };

    callback({
      juegos: configResult.recordset,
      total: configResult.recordset.length,
      profesorId: profesorId,
      currentIndex: currentIndex
    });

  } catch (error) {
    console.error('Error al obtener configuración:', error);
    callback({ error: 'Error al cargar configuración' });
  }
});

socket.on('joinPartidaRoom', (partidaId) => {
  socket.join(`partida_${partidaId}`);
  console.log(`Socket ${socket.id} se unió a partida_${partidaId}`);
});

// Para dejar la sala general de partida
socket.on('leavePartidaRoom', (partidaId) => {
  socket.leave(`partida_${partidaId}`);
  console.log(`Socket ${socket.id} dejó partida_${partidaId}`);
});

// Agregar en el evento 'connection', después de los otros eventos
socket.on('StartTimer', ({ partidaId, gameType, difficulty }) => {
  startGameTimer(partidaId, gameType, difficulty);
});

socket.on('RequestTimeSync', (partidaId) => {
  if (gameTimers[partidaId]) {
    const { remaining, total, gameType, difficulty } = gameTimers[partidaId];
    socket.emit('timerUpdate', { remaining, total, gameType, difficulty });
  }
});

// Mejora el evento nextGame
socket.on('nextGame', (partidaId, callback) => {
  try {
    if (!global.partidasConfig || !global.partidasConfig[partidaId]) {
      return callback({ error: "Configuración no encontrada" });
    }

    io.to(`partida_${partidaId}`).emit('cleanPreviousGames', { partidaId });

    Object.keys(hangmanGames).forEach(key => {
      if (key.startsWith(`hangman-${partidaId}`)) {
        delete hangmanGames[key];
      }
    });

    const config = global.partidasConfig[partidaId];
    
    // Verificar si ya se completaron todos los juegos
    if (config.currentIndex >= config.juegos.length - 1) {
      delete global.partidasConfig[partidaId];
      io.to(`partida_${partidaId}`).emit('allGamesCompleted');
      return callback({ completed: true });
    }

    // Incrementar el índice
    config.currentIndex += 1;
    const currentGame = config.juegos[config.currentIndex];

    startGameTimer(
      partidaId, 
      currentGame.tipo, 
      currentGame.dificultad.toLowerCase()
    );
    
    // Opción 1: Emitir a TODA la partida (incluye profesor y estudiantes)
    io.to(`partida_${partidaId}`).emit('gameChanged', {
      currentGame,
      currentIndex: config.currentIndex,
      total: config.juegos.length
    });

    

    // Opción 2: Emitir solo a las salas de equipo (si necesitas diferenciar)
    if (partidaRooms.has(partidaId)) {
      const equipos = partidaRooms.get(partidaId);
      equipos.forEach(equipoNumero => {
        io.to(`team-${partidaId}-${equipoNumero}`).emit('gameChanged', {
          currentGame,
          currentIndex: config.currentIndex,
          total: config.juegos.length
        });
      });
    }

    callback({ 
      success: true, 
      currentIndex: config.currentIndex,
      currentGame,
      total: config.juegos.length
    });

  } catch (error) {
    console.error('Error en nextGame:', error);
    callback({ error: "Error interno al cambiar de juego" });
  }
});

//-----------------------------------------------------------
//----------------------- Memoria ---------------------------

// Inicializar juego de memoria
socket.on('initMemoryGame', async ({ partidaId, equipoNumero }) => {
  try {
    // 1. Verificar existencia de partida
    const partidaConfig = global.partidasConfig[partidaId];
    if (!partidaConfig) throw new Error('Configuración de partida no encontrada');

    // 2. Obtener juego ACTUAL (no buscar por tipo)
    const currentGame = partidaConfig.juegos[partidaConfig.currentIndex];
    if (currentGame.tipo !== 'Memoria') {
      throw new Error('El juego actual no es de memoria');
    }

    // 3. Crear ID único que persista durante esta instancia
    const gameId = `memory-${partidaId}-${equipoNumero}-${partidaConfig.currentIndex}`;

    // 4. Si el juego YA EXISTE, solo enviar estado actual
    if (memoryGames[gameId]) {
      socket.emit('memoryGameState', memoryGames[gameId]);
      return;
    }

    // 5. Generar semilla CONSISTENTE (usar configuración actual)
    const seed = `${partidaId}-${equipoNumero}-${partidaConfig.currentIndex}`;

    // 6. Crear NUEVO juego solo si no existe
    memoryGames[gameId] = {
      config: {
        pairsCount: getPairsCount(currentGame.dificultad),
        difficulty: currentGame.dificultad,
        seed // Guardar la semilla para referencia
      },
      state: {
        cards: generateMemoryPairs(seed, getPairsCount(currentGame.dificultad)),
        flippedIndices: [],
        matchedPairs: 0,
        gameCompleted: false,
        lastActivity: new Date()
      }
    };

    // 7. Enviar estado INICIAL
    io.to(`team-${partidaId}-${equipoNumero}`).emit('memoryGameState', {
      ...memoryGames[gameId],
      isInitial: true
    });

  } catch (error) {
    console.error('Error inicializando juego de memoria:', error);
    socket.emit('memoryGameError', { message: error.message });
  }
});

socket.on('getMemoryGameState', ({ partidaId, equipoNumero }) => {
  const partidaConfig = global.partidasConfig[partidaId];
  if (!partidaConfig) return;

  const gameId = `memory-${partidaId}-${equipoNumero}-${partidaConfig.currentIndex}`;
  if (memoryGames[gameId]) {
    socket.emit('memoryGameState', memoryGames[gameId]);
  }
});

// Función auxiliar para obtener pares
function getPairsCount(difficulty) {
  const dif = difficulty.toLowerCase();
  return { 'fácil': 8, 'facil': 8, 'normal': 12, 'difícil': 16, 'dificil': 16 }[dif] || 8;
}

// Voltear una carta
socket.on('flipMemoryCard', ({ partidaId, equipoNumero, cardId }) => {
  try {
    const partidaConfig = global.partidasConfig[partidaId];
    if (!partidaConfig) throw new Error('Configuración de partida no encontrada');
    
    const gameId = `memory-${partidaId}-${equipoNumero}-${partidaConfig.currentIndex}`;
    const game = memoryGames[gameId];

    if (!game) throw new Error(`Juego no encontrado (ID: ${gameId})`);

    // Validar acción
    const cardIndex = game.state.cards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) throw new Error('Carta no encontrada');
    
    const card = game.state.cards[cardIndex];
    if (card.matched || card.flipped || game.state.flippedIndices.length >= 2) return;

    // Voltear la carta
    card.flipped = true;
    game.state.flippedIndices.push(cardIndex);
    game.state.lastActivity = new Date();

    // Emitir estado INMEDIATO del volteo
    io.to(`team-${partidaId}-${equipoNumero}`).emit('memoryGameState', {
      ...game,
      action: 'flip', // Nueva propiedad para identificar acción
      flippedCardId: cardId
    });

    // Si es el segundo click, verificar match después de breve delay
    if (game.state.flippedIndices.length === 2) {
      setTimeout(() => {
        const [firstIdx, secondIdx] = game.state.flippedIndices;
        const firstCard = game.state.cards[firstIdx];
        const secondCard = game.state.cards[secondIdx];

        if (firstCard.symbol === secondCard.symbol) {
          // Match correcto
          firstCard.matched = true;
          secondCard.matched = true;
          game.state.matchedPairs++;
          game.state.flippedIndices = [];

          const progress = Math.round((game.state.matchedPairs / game.config.pairsCount) * 100);
          updateTeamProgress(partidaId, equipoNumero, 'Memoria', progress);
          
          io.to(`team-${partidaId}-${equipoNumero}`).emit('memoryGameState', {
            ...game,
            action: 'match'
          });

          if (game.state.matchedPairs === game.config.pairsCount) {
            game.state.gameCompleted = true;
            io.to(`team-${partidaId}-${equipoNumero}`).emit('memoryGameState', {
              ...game,
              action: 'complete'
            });
          }
        } else {
          // No hay match - voltear de nuevo
          firstCard.flipped = false;
          secondCard.flipped = false;
          game.state.flippedIndices = [];
          
          io.to(`team-${partidaId}-${equipoNumero}`).emit('memoryGameState', {
            ...game,
            action: 'no-match'
          });
        }
      }, 1000); // Tiempo para ver las cartas antes de voltear
    }
  } catch (error) {
    console.error('Error al voltear carta:', error);
    socket.emit('memoryGameError', { message: error.message });
  }
});

// Reiniciar juego de memoria
socket.on('resetMemoryGame', ({ partidaId, equipoNumero }) => {
  try {
    const gameId = `memory-${partidaId}-${equipoNumero}`;
    
    if (!memoryGames[gameId]) {
      throw new Error('Juego no encontrado para reiniciar');
    }

    // Obtener configuración original
    const config = memoryGames[gameId].config;
    const seed = `${partidaId}-${equipoNumero}-${new Date().getTime()}`;

    // Reiniciar estado
    memoryGames[gameId].state = {
      cards: generateMemoryPairs(seed, config.pairsCount),
      flippedIndices: [],
      matchedPairs: 0,
      gameCompleted: false,
      lastActivity: new Date()
    };

    // Reiniciar progreso
    if (gameProgress[partidaId]?.[equipoNumero]?.['Memoria']) {
      gameProgress[partidaId][equipoNumero]['Memoria'] = {
        startedAt: new Date(),
        pairsFound: 0
      };
    }

    // Enviar nuevo estado
    io.to(`team-${partidaId}-${equipoNumero}`).emit('memoryGameState', memoryGames[gameId]);

  } catch (error) {
    console.error('Error reiniciando juego de memoria:', error);
    socket.emit('memoryGameError', { message: error.message });
  }
});

// Sincronizar estado al reconectar
socket.on('syncMemoryGame', ({ partidaId, equipoNumero }) => {
  const gameId = `memory-${partidaId}-${equipoNumero}`;
  if (memoryGames[gameId]) {
    socket.emit('memoryGameState', memoryGames[gameId]);
  }
});

// Limpiar al desconectarse
socket.on('disconnect', () => {
  // No limpiamos inmediatamente para permitir reconexión
  console.log(`Socket ${socket.id} desconectado`);
});

// Agregar junto a los otros manejadores de socket
socket.on('cleanPreviousGames', ({ partidaId }) => {
  try {
    // Eliminar todos los juegos de esta partida
    Object.keys(memoryGames).forEach(key => {
      if (key.startsWith(`memory-${partidaId}`)) {
        delete memoryGames[key];
      }
    });

    Object.keys(hangmanGames).forEach(key => {
      if (key.startsWith(`hangman-${partidaId}`)) {
        delete hangmanGames[key];
      }
    });

    Object.keys(drawingGames).forEach(key => {
      if (key.startsWith(`drawing-${partidaId}`)) {
        delete drawingGames[key];
      }
    });

    // Opcional: Limpiar progresos también
    if (gameProgress[partidaId]) {
      gameProgress[partidaId] = {};
    }

    console.log(`Juegos anteriores limpiados para partida ${partidaId}`);
  } catch (error) {
    console.error('Error limpiando juegos:', error);
  }
});

socket.on('initHangmanGame', ({ partidaId, equipoNumero }) => {
  try {
    const config = global.partidasConfig[partidaId];
    if (!config) throw new Error('Configuración no encontrada');
    
    const currentGame = config.juegos[config.currentIndex];
    if (currentGame.tipo !== 'Ahorcado') {
      throw new Error('El juego actual no es Ahorcado');
    }

    const gameId = `hangman-${partidaId}-${equipoNumero}`;
    
    // Si ya existe, enviar estado actual
    if (hangmanGames[gameId]) {
      socket.emit('hangmanGameState', hangmanGames[gameId]);
      return;
    }

    // Obtener palabra del tema (corregido de Contenido a tema)
    const palabra = String(currentGame.tema || '') // Usa tema en lugar de Contenido
      .normalize("NFD") // Normalizar para separar acentos
      .replace(/[\u0300-\u036f]/g, "") // Eliminar diacríticos
      .toUpperCase()
      .replace(/[^A-ZÑ]/g, ''); // Permitir Ñ y eliminar otros caracteres

    // Validar palabra
    if (!palabra || palabra.length === 0) {
      throw new Error('La palabra para el ahorcado no es válida');
    }

    // Determinar intentos según dificultad
    const intentosMaximos = 6;

    // Crear nuevo juego
    hangmanGames[gameId] = {
      config: {
        palabra,
        intentosMaximos,
        dificultad: currentGame.dificultad
      },
      state: {
        letrasAdivinadas: [],
        letrasIntentadas: [],
        intentosRestantes: intentosMaximos,
        juegoTerminado: false,
        ganado: false
      }
    };

    // Enviar estado inicial
    io.to(`team-${partidaId}-${equipoNumero}`).emit('hangmanGameState', hangmanGames[gameId]);

  } catch (error) {
    console.error('Error inicializando ahorcado:', error);
    socket.emit('hangmanGameError', { 
      message: error.message,
      stack: error.stack // Opcional: para debugging en cliente
    });
  }
});

// Evento para adivinar letra
socket.on('guessLetter', ({ partidaId, equipoNumero, letra }) => {
  try {
    const gameId = `hangman-${partidaId}-${equipoNumero}`;
    const game = hangmanGames[gameId];
    
    if (!game) throw new Error('Juego no encontrado');
    if (game.state.juegoTerminado) return;

    // Validar letra
    const letraNormalizada = letra.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    if (!/^[A-Z]$/.test(letraNormalizada)) {
      throw new Error('Letra no válida');
    }

    // Verificar si ya se intentó
    if (game.state.letrasIntentadas.includes(letraNormalizada)) {
      return;
    }

    // Agregar a letras intentadas
    game.state.letrasIntentadas.push(letraNormalizada);

    if (game.config.palabra.includes(letraNormalizada)) {
      const uniqueLetters = [...new Set(game.config.palabra.split(''))];
      const progress = Math.round((game.state.letrasAdivinadas.length / uniqueLetters.length) * 100);
      updateTeamProgress(partidaId, equipoNumero, 'Ahorcado', progress);
    } else {
      // Progreso basado en intentos restantes
      const progress = Math.round((game.state.intentosRestantes / game.config.intentosMaximos) * 100);
      updateTeamProgress(partidaId, equipoNumero, 'Ahorcado', progress);
    }

    // Verificar si está en la palabra
    if (game.config.palabra.includes(letraNormalizada)) {
      game.state.letrasAdivinadas.push(letraNormalizada);
      
      // Verificar si ganó
      const palabraUnica = [...new Set(game.config.palabra.split(''))];
      if (palabraUnica.every(l => game.state.letrasAdivinadas.includes(l))) {
        game.state.juegoTerminado = true;
        game.state.ganado = true;
      }
    } else {
      game.state.intentosRestantes--;
      
      // Verificar si perdió
      if (game.state.intentosRestantes <= 0) {
        game.state.juegoTerminado = true;
        game.state.ganado = false;
      }
    }

    // Emitir estado actualizado con animación
    const respuesta = {
      ...game,
      animacion: {
        tipo: game.config.palabra.includes(letraNormalizada) ? 'acierto' : 'error',
        letra: letraNormalizada
      }
    };

    io.to(`team-${partidaId}-${equipoNumero}`).emit('hangmanGameState', respuesta);

  } catch (error) {
    console.error('Error al adivinar letra:', error);
    socket.emit('hangmanGameError', { message: error.message });
  }
});

  
// Inicializar juego de dibujo
socket.on('initDrawingGame', ({ partidaId, equipoNumero, userId }) => {
  const gameId = `drawing-${partidaId}-${equipoNumero}`;

  // 👉 Unir al socket a la sala de su equipo
  socket.join(`team-${partidaId}-${equipoNumero}`);

  if (!drawingGames[gameId]) {
    drawingGames[gameId] = {
      actions: {},
      tintaStates: {}
    };
  }

  // Enviar trazos existentes
  const allActions = Object.entries(drawingGames[gameId].actions)
    .flatMap(([userId, actions]) =>
      actions.map(action => ({ userId, path: action }))
    );

  socket.emit('drawingGameState', {
    actions: allActions,
    tintaState: drawingGames[gameId].tintaStates
  });
});

socket.on('joinDrawingTeam', ({ partidaId, equipoNumero }) => {
  socket.join(`team-${partidaId}-${equipoNumero}`);
});


socket.on('resetDrawingGame', ({ partidaId, equipoNumero }) => {
  const gameId = `drawing-${partidaId}-${equipoNumero}`;
  delete drawingGames[gameId];
  io.to(`team-${partidaId}-${equipoNumero}`).emit('drawingCleared', { all: true });
});


socket.on('clearMyDrawing', ({ partidaId, equipoNumero, userId }) => {
  const gameId = `drawing-${partidaId}-${equipoNumero}`;
  if (drawingGames[gameId] && drawingGames[gameId][userId]) {
    delete drawingGames[gameId][userId];
  }

  // Emitir a todos para que borren visualmente ese trazo
  io.to(`team-${partidaId}-${equipoNumero}`).emit('drawingCleared', { userId });
});

// Manejar acciones de dibujo
// En tu app.js, modifica el manejo de drawingAction:

socket.on('drawingAction', ({ partidaId, equipoNumero, userId, action }) => {
  const gameId = `drawing-${partidaId}-${equipoNumero}`;

  if (!drawingGames[gameId]) {
    drawingGames[gameId] = {
      actions: {},
      tintaStates: {}
    };
  }

  if (!drawingGames[gameId].actions[userId]) {
    drawingGames[gameId].actions[userId] = [];
  }

  switch (action.type) {
    case 'pathStart':
      drawingGames[gameId].actions[userId].push(action.path);
      break;

    case 'pathUpdate':
    case 'pathComplete':
      const userActions = drawingGames[gameId].actions[userId];
      const existingActionIndex = userActions.findIndex(a => a.id === action.path.id);

      if (existingActionIndex >= 0) {
        userActions[existingActionIndex] = action.path;
      } else {
        userActions.push(action.path);
      }
      break;

    case 'clear':
      delete drawingGames[gameId].actions[userId];
      drawingGames[gameId].tintaStates[userId] = 5000;

      // Notificar a todos que se borró
      io.to(`team-${partidaId}-${equipoNumero}`).emit('drawingAction', {
        type: 'clear',
        userId,
        tinta: 5000
      });
      return; // ⚠️ Evita doble emisión
  }

  // ✅ Esta es la forma correcta
  io.to(`team-${partidaId}-${equipoNumero}`).emit('drawingAction', {
    userId,
    ...action
  });
});

socket.on('requestDrawingSync', ({ partidaId, equipoNumero }) => {
  const gameId = `drawing-${partidaId}-${equipoNumero}`;
  if (drawingGames[gameId]) {
    const allActions = Object.entries(drawingGames[gameId].actions)
      .flatMap(([userId, actions]) =>
        actions.map(action => ({ userId, path: action }))
      );

    socket.emit('drawingSyncResponse', {
      actions: allActions,
      tintaState: drawingGames[gameId].tintaStates
    });
  }
});


// Limpiar dibujos de un usuario
socket.on('clearMyDrawing', ({ partidaId, equipoNumero, userId }) => {
  const gameId = `drawing-${partidaId}-${equipoNumero}`;
  
  if (drawingGames[gameId]?.actions?.[userId]) {
    delete drawingGames[gameId].actions[userId];
  }

  // También restablece tinta
  if (drawingGames[gameId]?.tintaStates) {
    drawingGames[gameId].tintaStates[userId] = 5000;
  }

  // Emitir borrado a todos menos el que borra
  socket.to(`team-${partidaId}-${equipoNumero}`).emit('drawingAction', {
    type: 'clear',
    userId
  });
});



socket.on('getDrawingState', ({ partidaId, equipoNumero }, callback) => {
  const gameId = `drawing-${partidaId}-${equipoNumero}`;
  if (drawingGames[gameId]) {
    callback(drawingGames[gameId].canvasState);
  } else {
    callback([]);
  }
});

// Guardar imagen final del dibujo
socket.on('saveDrawing', ({ partidaId, equipoNumero, imageData }) => {
  const gameId = `drawing-${partidaId}-${equipoNumero}`;
  
  if (!drawingGames[gameId]) {
    drawingGames[gameId] = { actions: {}, imageData: null };
  }
  
  drawingGames[gameId].imageData = imageData;
  
  // Actualizar demostración si está activa
  if (drawingDemonstrations[partidaId]) {
    drawingDemonstrations[partidaId].drawings[equipoNumero] = imageData;
    io.to(`partida_${partidaId}`).emit('drawingUpdated', { equipoNumero });
  }
});

// 2. Evento para iniciar demostración - Versión mejorada
socket.on('startDrawingDemo', (partidaId, callback) => {
  try {
    // Verificar si ya hay demo activa
    if (activeDemos[partidaId]) {
      return callback({ error: 'Demo ya iniciada' });
    }

    // Buscar el primer equipo con dibujo
    let firstTeamWithDrawing = null;
    for (const key in drawingGames) {
      if (key.startsWith(`drawing-${partidaId}-`)) {
        const teamNumber = parseInt(key.split('-')[2]);
        if (!isNaN(teamNumber)) {
          firstTeamWithDrawing = teamNumber;
          break;
        }
      }
    }

    if (!firstTeamWithDrawing) {
      return callback({ error: 'No hay dibujos para mostrar' });
    }

    // Iniciar demo
    activeDemos[partidaId] = firstTeamWithDrawing;

    // Notificar a todos
    io.to(`partida_${partidaId}`).emit('demoStarted', {
      currentTeam: firstTeamWithDrawing
    });

    callback({ success: true });

  } catch (error) {
    console.error('Error:', error);
    callback({ error: 'Error al iniciar demo' });
  }
});

socket.on('changeDrawingDemoTeam', (partidaId, direction, callback = () => {}) => {
  try {
    const demo = drawingDemonstrations.get(partidaId);
    if (!demo) {
      return callback({ error: 'No hay demostración activa' });
    }

    const currentIndex = demo.teams.indexOf(demo.currentTeam);
    let newIndex;

    if (direction === 'next') {
      newIndex = (currentIndex + 1) % demo.teams.length;
    } else {
      newIndex = (currentIndex - 1 + demo.teams.length) % demo.teams.length;
    }

    const newTeam = demo.teams[newIndex];
    demo.currentTeam = newTeam;

    // Notificar a todos
    io.to(`partida_${partidaId}`).emit('drawingDemoTeamChanged', {
      currentTeam: newTeam,
      teamIndex: newIndex + 1,
      totalTeams: demo.teams.length
    });

    // Responder con éxito
    if (typeof callback === 'function') {
      callback({ success: true });
    }

  } catch (error) {
    console.error('Error en changeDrawingDemoTeam:', error);
    if (typeof callback === 'function') {
      callback({ error: 'Error interno al cambiar equipo' });
    }
  }
});

socket.on('drawingDemoStarted', (teams) => {
  setShowDemo(true);
  setCurrentDemoTeam(Math.min(...teams.map(Number))); // Error aquí
  loadDemoDrawings(teams);
});

// Obtener dibujo específico para demostración
socket.on('getDrawingForDemo', ({ partidaId, equipoNumero }, callback) => {
  if (drawingDemonstration[partidaId]?.[equipoNumero]) {
    callback(drawingDemonstration[partidaId][equipoNumero]);
  } else {
    callback(null);
  }
});

// Modificar el evento saveDrawing
socket.on('saveDrawing', ({ partidaId, equipoNumero, imageData }) => {
  if (!drawingDemonstration[partidaId]) {
    drawingDemonstration[partidaId] = {};
  }
  
  // Guardar incluso si está vacío
  drawingDemonstration[partidaId][equipoNumero] = imageData || getBlankCanvasData();
  
  // Notificar a todos
  io.to(`partida_${partidaId}`).emit('drawingUpdated', { 
    partidaId, 
    equipoNumero 
  });
});

// Función auxiliar para canvas blanco
function getBlankCanvasData() {
  // Crear un canvas blanco sin usar DOM
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAyAAAAMgCAYAAADbc...'; // Base64 de un canvas blanco 800x600
}

socket.on('getAllDrawings', (partidaId, callback) => {
  callback(drawingDemonstration[partidaId] || {});
});

// Evento para cambiar de equipo en la demostración
socket.on('changeDemoTeam', (partidaId, newTeam, callback) => {
  try {
    // Verificar demo activa
    if (!activeDemos[partidaId]) {
      return callback({ error: 'No hay demo activa' });
    }

    // Verificar que el equipo tenga dibujo
    const gameKey = `drawing-${partidaId}-${newTeam}`;
    if (!drawingGames[gameKey]?.imageData) {
      return callback({ error: 'Este equipo no tiene dibujo' });
    }

    // Actualizar equipo
    activeDemos[partidaId] = newTeam;

    // Notificar a todos
    io.to(`partida_${partidaId}`).emit('demoTeamChanged', {
      currentTeam: newTeam
    });

    callback({ success: true });

  } catch (error) {
    console.error('Error:', error);
    callback({ error: 'Error al cambiar equipo' });
  }
});

// Evento para finalizar demo
socket.on('endDrawingDemo', (partidaId) => {
  if (drawingDemonstrations[partidaId]) {
    delete drawingDemonstrations[partidaId];
    io.to(`partida_${partidaId}`).emit('drawingDemoEnded');
  }
});

// Al conectar/reconectar
socket.on('connection', (socket) => {
  socket.on('joinPartida', (partidaId) => {
    socket.join(`partida_${partidaId}`);
    
    // Si hay demo activa, enviar estado actual
    if (activeDemos[partidaId]) {
      const equipos = Object.keys(drawingDemonstration[partidaId] || {})
        .map(Number)
        .sort((a, b) => a - b);
      
      socket.emit('demoStatus', {
        active: true,
        currentTeam: activeDemos[partidaId].currentTeam,
        totalTeams: equipos.length
      });
    }
  });
});

socket.on('getCurrentDrawing', (partidaId, callback) => {
  const currentTeam = activeDemos[partidaId];
  if (!currentTeam) {
    return callback({ error: 'No hay demo activa' });
  }

  const gameKey = `drawing-${partidaId}-${currentTeam}`;
  const drawing = drawingGames[gameKey]?.imageData || null;

  callback({
    currentTeam,
    imageData: drawing
  });
});

socket.on('endDemo', (partidaId) => {
  if (activeDemos[partidaId]) {
    delete activeDemos[partidaId];
    io.to(`partida_${partidaId}`).emit('demoEnded');
  }
});


socket.on('checkActiveDemo', (partidaId, callback) => {
  callback({
    active: !!activeDemos[partidaId],
    currentTeam: activeDemos[partidaId]?.currentTeam,
    totalTeams: activeDemos[partidaId]?.totalTeams,
    teams: activeDemos[partidaId]?.teams || []
  });
});

// Función para actualizar el progreso de un equipo
function updateTeamProgress(partidaId, equipoNumero, juegoType, progress) {
  if (!teamProgress[partidaId]) {
    teamProgress[partidaId] = {};
  }
  if (!teamProgress[partidaId][equipoNumero]) {
    teamProgress[partidaId][equipoNumero] = {};
  }
  
  teamProgress[partidaId][equipoNumero][juegoType] = progress;
  
  // Emitir actualización a los profesores
  io.to(`partida_${partidaId}`).emit('teamProgressUpdate', {
    partidaId,
    equipoNumero,
    juegoType,
    progress
  });
}

// Función para obtener el progreso de todos los equipos
function getAllTeamProgress(partidaId) {
  if (!teamProgress[partidaId]) {
    // Si no hay progreso registrado, ver equipos conectados
    const connectedTeams = new Set();
    const roomPrefix = `team-${partidaId}-`;
    
    for (const room of io.sockets.adapter.rooms.keys()) {
      if (room.startsWith(roomPrefix)) {
        const teamNumber = room.split('-')[2];
        connectedTeams.add(teamNumber);
      }
    }
    
    // Crear objeto con equipos conectados pero sin progreso
    const result = {};
    connectedTeams.forEach(team => {
      result[team] = { connected: true };
    });
    return result;
  }
  
  // Combinar con equipos conectados
  const result = { ...teamProgress[partidaId] };
  const roomPrefix = `team-${partidaId}-`;
  
  for (const room of io.sockets.adapter.rooms.keys()) {
    if (room.startsWith(roomPrefix)) {
      const teamNumber = room.split('-')[2];
      if (!result[teamNumber]) {
        result[teamNumber] = { connected: true };
      }
    }
  }
  
  return result;
}

// ROMPECABEZAS NUEVO 2.0 -----------------------

socket.on('initPuzzleGame', ({ partidaId, equipoNumero, difficulty, imageUrl }) => {
  const dif = difficulty.toLowerCase();
  const sizeMap = { 'Fácil': 6, 'Normal': 7, 'Difícil': 8 };
  const size = sizeMap[dif] || 6;
  const totalPieces = size * size;
  const maxSwaps = totalPieces + 20;
  const key = `puzzle-${partidaId}-${equipoNumero}`;

  // Evitar regenerar si ya existe
  if (puzzleGames[key]) {
    socket.emit('puzzleGameState', puzzleGames[key]);
    return;
  }

  // Generar piezas revueltas con semilla
  const seed = `${partidaId}-${equipoNumero}`;
  const pieces = generatePuzzlePieces(size, imageUrl, seed);

  puzzleGames[key] = {
    config: {
      rows: size,
      cols: size,
      swapsLeft: maxSwaps,
      imageUrl
    },
    state: {
      pieces,
      selected: [],
      progress: calculatePuzzleProgress(pieces)
    }
  };

  io.to(`team-${partidaId}-${equipoNumero}`).emit('puzzleGameState', puzzleGames[key]);
});

socket.on('selectPuzzlePiece', ({ partidaId, equipoNumero, pieceId, userId }) => {
  const key = `puzzle-${partidaId}-${equipoNumero}`;
  const game = puzzleGames[key];
  if (!game) return;

  const selected = game.state.selected;

  // Desmarcar si hace clic en la misma
  if (selected.includes(pieceId)) {
    game.state.selected = selected.filter(id => id !== pieceId);
    return socket.emit('puzzleUpdate', game.state);
  }

  game.state.selected.push(pieceId);

  // Si hay 2 piezas seleccionadas, hacer swap
  if (game.state.selected.length === 2) {
    const [id1, id2] = game.state.selected;
    const p1 = game.state.pieces.find(p => p.id === id1);
    const p2 = game.state.pieces.find(p => p.id === id2);

    if (p1 && p2 && game.config.swapsLeft > 0) {
      // Intercambiar posición actual
      [p1.currentRow, p2.currentRow] = [p2.currentRow, p1.currentRow];
      [p1.currentCol, p2.currentCol] = [p2.currentCol, p1.currentCol];
      game.config.swapsLeft--;

      // Calcular progreso
      game.state.progress = calculatePuzzleProgress(game.state.pieces);
    }

    game.state.selected = []; // Limpiar selección
  }

  // Emitir actualización a todos del equipo
  io.to(`team-${partidaId}-${equipoNumero}`).emit('puzzleUpdate', {
    pieces: game.state.pieces,
    selected: game.state.selected,
    swapsLeft: game.config.swapsLeft,
    progress: game.state.progress
  });

  // Actualizar barra de progreso general
  updateTeamProgress(partidaId, equipoNumero, 'Rompecabezas', game.state.progress);
});

socket.on('requestPuzzleState', ({ partidaId, equipoNumero }) => {
  const key = `puzzle-${partidaId}-${equipoNumero}`;
  const game = puzzleGames[key];
  if (game) {
    socket.emit('puzzleGameState', game);
  }
});



//FINAL

socket.on('getTeamProgress', (partidaId, callback) => {
  callback(getAllTeamProgress(partidaId));
});

});



//-----------------------------------------------------------

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Servidor Express corriendo en http://localhost:${PORT}`);
  try {
    await poolPromise;
    console.log('Conexión a la base de datos exitosa');
  } catch (error) {
    console.log("Error al conectar con la base de datos:", error);
  }
});

export { io };

export default app;