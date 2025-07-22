import express from "express";
import {
    obtenerCursosPersonalizados,
    obtenerGruposVinculados,
    agregarEstudiante,
    obtenerEstudiantesPorProfesor,
    cancelarPartida,
    startSimulation,
    desvincularEstudiante,
    desvincularTodosEstudiantes
} from "../controllers/teacherController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";
import { roleMiddleware } from "../middleware/roleMiddleware.js";

const router = express.Router();

router.get("/obtener-personalizaciones" ,authMiddleware, roleMiddleware(["Profesor"]), obtenerCursosPersonalizados);
router.get("/obtener-cursosVinculados" ,authMiddleware, roleMiddleware(["Profesor"]), obtenerGruposVinculados);
router.post("/add-students" ,authMiddleware, roleMiddleware(["Profesor"]), agregarEstudiante);
router.get("/get-students" ,authMiddleware, roleMiddleware(["Profesor"]), obtenerEstudiantesPorProfesor);
router.post("/cancel-simulation" ,authMiddleware, roleMiddleware(["Profesor"]), cancelarPartida);
router.post("/start-simulation" ,authMiddleware, roleMiddleware(["Profesor"]), startSimulation);
router.post("/desvincular-estudiante" ,authMiddleware, roleMiddleware(["Profesor"]), desvincularEstudiante);
router.post("/desvincular-todos-estudiantes" ,authMiddleware, roleMiddleware(["Profesor"]), desvincularTodosEstudiantes);

export default router;
