import express from "express";
import {
  getTipoJuegos,
  getTemasPorJuego,
  guardarPersonalizacion,
  getConfiguracionPersonalizada,
  editarPersonalizacion,
  saveTemaJuego,
  getTemasPorJuegoTotal,
  deletePersonalization,
  obtenerPersonalizacionPorId
} from "../controllers/PersonalizeController.js";

import { authMiddleware } from "../middleware/authMiddleware.js";
import { roleMiddleware } from "../middleware/roleMiddleware.js";

const router = express.Router();

router.get("/tipo-juegos", getTipoJuegos); 
router.get("/temas-juego/:juegoId", getTemasPorJuego);
router.post("/personalizacion", guardarPersonalizacion); 
router.get("/personalizacion", getConfiguracionPersonalizada); 
router.post("/editar-personalizacion", editarPersonalizacion);
router.post("/agregar_contenido" ,authMiddleware, roleMiddleware(["Administrador"]), saveTemaJuego);
router.post("/personalizacion-por-id" ,authMiddleware, roleMiddleware(["Profesor"]), obtenerPersonalizacionPorId);
router.delete("/eliminar_personalizacion" ,authMiddleware, roleMiddleware(["Administrador","Profesor"]), deletePersonalization);
router.get("/gettemas", getTemasPorJuegoTotal)

export default router;
