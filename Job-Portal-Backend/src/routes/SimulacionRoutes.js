import express from 'express';
import {checkParticipation, checkGroup } from '../controllers/simulatorController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/check-participation',authMiddleware, checkParticipation);
router.get('/checkgroup',authMiddleware, checkGroup);

export default router;