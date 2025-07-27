import express from 'express';
import {agregarUsuario, editarUsuario, restaurarContrasena, eliminarUsuario, obtenerInformacionUsuario, desactivarUsuario,
        eliminarHistorial, eliminarLog, eliminarTodasPersonalizaciones, eliminarTodaBitacora, eliminarTodoHistorial,
        eliminarTodosEstudiantes, eliminarTodosProfesores, getAllUsers, getFullBitacora, getAllAchievementLogs,
        obtenerGruposUsuario, desvincularGrupoUsuario, agregarGrupoUsuario, desvincularUsuariosGrupo, obtenerGruposConUsuarios,
        eliminarPersonalizacionesProfesor, eliminarPartidasProfesor, reiniciarLogrosEstudiante, obtenerTodosGrupos
} from '../controllers/debugController.js';

import { authMiddleware } from "../middleware/authMiddleware.js";
import { roleMiddleware } from "../middleware/roleMiddleware.js";

const router = express.Router();

router.post('/usuarios_D', authMiddleware, roleMiddleware(["Administrador"]), agregarUsuario);
router.put('/usuarios_D/:userId', authMiddleware, roleMiddleware(["Administrador"]), editarUsuario);
router.post('/usuarios_D/:userId/restaurar-contrasena', authMiddleware, roleMiddleware(["Administrador"]), restaurarContrasena);
router.delete('/usuarios_D/:userId', authMiddleware, roleMiddleware(["Administrador"]), eliminarUsuario);
router.get('/usuarios_D/:userId', authMiddleware, roleMiddleware(["Administrador", "Profesor"]), obtenerInformacionUsuario);
router.put('/usuarios_D/:userId/desactivar', authMiddleware, roleMiddleware(["Administrador"]), desactivarUsuario);

router.delete('/historial_D/:historialId', authMiddleware, roleMiddleware(["Administrador"]), eliminarHistorial);
router.delete('/bitacora_D/:logId', authMiddleware, roleMiddleware(["Administrador"]), eliminarLog);

router.delete('/personalizaciones_D', authMiddleware, roleMiddleware(["Administrador"]), eliminarTodasPersonalizaciones);
router.delete('/bitacora_D', authMiddleware, roleMiddleware(["Administrador"]), eliminarTodaBitacora);
router.delete('/historial_D', authMiddleware, roleMiddleware(["Administrador"]), eliminarTodoHistorial);
router.delete('/estudiantes_D', authMiddleware, roleMiddleware(["Administrador"]), eliminarTodosEstudiantes);
router.delete('/profesores_D', authMiddleware, roleMiddleware(["Administrador"]), eliminarTodosProfesores);

router.get('/usuarios_D', authMiddleware, roleMiddleware(["Administrador"]), getAllUsers);
router.get('/bitacora_D', authMiddleware, roleMiddleware(["Administrador"]), getFullBitacora);
router.get('/logros_D', authMiddleware, roleMiddleware(["Administrador"]), getAllAchievementLogs);

router.get('/usuarios_D/:userId/grupos', authMiddleware, roleMiddleware(["Administrador"]), obtenerGruposUsuario);
router.delete('/usuarios_D/:userId/grupos/:grupoId', authMiddleware, roleMiddleware(["Administrador"]), desvincularGrupoUsuario);
router.post('/usuarios_D/:userId/grupos/:grupoId', authMiddleware, roleMiddleware(["Administrador"]), agregarGrupoUsuario);
router.delete('/grupos_D/:grupoId/usuarios', authMiddleware, roleMiddleware(["Administrador"]), desvincularUsuariosGrupo);
router.get('/grupos_D/usuarios', authMiddleware, roleMiddleware(["Administrador"]), obtenerGruposConUsuarios);
router.get('/grupos_D', authMiddleware, roleMiddleware(["Administrador"]), obtenerTodosGrupos);

router.delete('/profesores_D/:profesorId/personalizaciones', authMiddleware, roleMiddleware(["Administrador"]), eliminarPersonalizacionesProfesor);
router.delete('/profesores_D/:profesorId/partidas', authMiddleware, roleMiddleware(["Administrador"]), eliminarPartidasProfesor);
router.delete('/estudiantes_D/:estudianteId/logros', authMiddleware, roleMiddleware(["Administrador"]), reiniciarLogrosEstudiante);



export default router;