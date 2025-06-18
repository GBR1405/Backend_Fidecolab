import express from 'express';
import {checkParticipation, checkGroup, checkActivity } from '../controllers/simulatorController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/check-participation',authMiddleware, checkParticipation);
router.get('/checkgroup',authMiddleware, checkGroup);
router.post('/check-activity',authMiddleware, checkActivity);

export default router;