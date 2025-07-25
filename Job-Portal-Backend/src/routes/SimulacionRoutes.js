import express from 'express';
import {checkParticipation, checkGroup, checkActivity, getResults, getFullUserGames } from '../controllers/simulatorController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/check-participation',authMiddleware, checkParticipation);
router.get('/checkgroup',authMiddleware, checkGroup);
router.post('/check-activity',authMiddleware, checkActivity);
router.get('/resultados/:partidaId', authMiddleware, getResults);
router.get('/get-user-games', authMiddleware,roleMiddleware(["Estudiante", "Profesor"]), getResults);

export default router;