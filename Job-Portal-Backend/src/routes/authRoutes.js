// routes/userRoutes.js
import express from 'express';
import {login, register, forgotPassword, resetPassword, updateUser, getFullUserDetails, updatePassword} from '../controllers/authController.js';
import { loginLimiter } from "../middleware/loginLimiter.js";

import { authMiddleware } from "../middleware/authMiddleware.js";
import { roleMiddleware } from "../middleware/roleMiddleware.js";


const router = express.Router();

router.post('/register-user', register);
router.post('/login',loginLimiter, login);
router.post('/forgot-password', loginLimiter, forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/user-edit',authMiddleware, roleMiddleware(["Estudiante", "Profesor"]), updateUser);
router.get('/user-profile',authMiddleware, roleMiddleware(["Estudiante", "Profesor"]), getFullUserDetails);
router.get('/user-update-password',authMiddleware, roleMiddleware(["Estudiante", "Profesor"]), updatePassword);


export default router;
