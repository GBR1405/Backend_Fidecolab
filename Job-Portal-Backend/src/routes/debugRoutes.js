import express from 'express';
import {agregarUsuario, editarUsuario, restaurarContrasena, eliminarUsuario, obtenerInformacionUsuario, desactivarUsuario,
        eliminarHistorial, eliminarLog, eliminarTodasPersonalizaciones, eliminarTodaBitacora, eliminarTodoHistorial,
        eliminarTodosEstudiantes, eliminarTodosProfesores, getAllUsers, getFullBitacora, getAllAchievementLogs
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

export default router;