// routes/userRoutes.js
import express from 'express';
import {generateStudentsReport, agregarCurso, obtenerCursos, obtenerUltimoGrupoCurso, guardarGrupo, agregarProfesor,
        getAllProfessors, getAllGroups, generateProfesorReport, generatePartidaReport, generateBitacoraReport, obtenerCursosDelProfesor,
        getGruposDisponibles, asignarGrupo, desvincularGrupo, obtenerBitacoraDescargas, editarPersonalizacion, desactivarPersonalizacion,
        activarPersonalizacion, obtenerMetricasAdmin, obtenerUsuariosPorCursoId
} from '../controllers/adminController.js';

import { authMiddleware } from "../middleware/authMiddleware.js";
import { roleMiddleware } from "../middleware/roleMiddleware.js";

const router = express.Router();

router.get('/metricas',authMiddleware, roleMiddleware(["Administrador"]), obtenerMetricasAdmin);

router.get('/report-students',authMiddleware, roleMiddleware(["Administrador"]), generateStudentsReport);
router.post('/add-course',authMiddleware, roleMiddleware(["Administrador"]), agregarCurso);
router.get('/cursos', obtenerCursos);
router.get('/cursos/:courseId/ultimo-grupo',authMiddleware, roleMiddleware(["Administrador"]), obtenerUltimoGrupoCurso);
router.post('/add-grupos',authMiddleware, roleMiddleware(["Administrador"]), guardarGrupo);
router.post('/add-profesor',authMiddleware, roleMiddleware(["Administrador"]), agregarProfesor);
router.get('/get-profesores',authMiddleware, roleMiddleware(["Administrador"]), getAllProfessors);
router.get('/get-cursos',authMiddleware, roleMiddleware(["Administrador"]), getAllGroups);
router.get('/get-cursos-by-profesor/:profesorId',authMiddleware, roleMiddleware(["Administrador"]), obtenerCursosDelProfesor);
router.get('/get-grupos-disponibles',authMiddleware, roleMiddleware(["Administrador"]), getGruposDisponibles);
router.post('/add-grupo-profesor',authMiddleware, roleMiddleware(["Administrador"]), asignarGrupo);
router.post('/edit-p',authMiddleware, roleMiddleware(["Administrador"]), editarPersonalizacion);
router.post('/delete-p',authMiddleware, roleMiddleware(["Administrador"]), desactivarPersonalizacion);
router.post('/activate-p',authMiddleware, roleMiddleware(["Administrador"]), activarPersonalizacion);
router.delete('/quit-grupo-profesor',authMiddleware, roleMiddleware(["Administrador"]), desvincularGrupo);

router.get('/report-teacher',authMiddleware, roleMiddleware(["Administrador"]), generateProfesorReport);
router.get('/report-partidas',authMiddleware, roleMiddleware(["Administrador"]), generatePartidaReport);
router.get('/report-bitacora',authMiddleware, roleMiddleware(["Administrador"]), generateBitacoraReport);
router.get('/report-historial',authMiddleware, roleMiddleware(["Administrador"]), obtenerBitacoraDescargas);
router.get("/detalles-curso/:cursoId",authMiddleware, roleMiddleware(["Administrador"]), obtenerUsuariosPorCursoId);

export default router;