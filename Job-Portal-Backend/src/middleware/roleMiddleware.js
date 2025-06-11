export const roleMiddleware = (allowedRoles) => (req, res, next) => {
    try {
        // Verifica que req.user esté disponible
        if (!req.user) {
            return res.status(401).json({ message: "Usuario no autenticado" });
        }
        
        const { rol } = req.user;  // Extrae el rol del usuario decodificado

        // Verifica si el rol del usuario está dentro de los roles permitidos
        if (!allowedRoles.includes(rol)) {
            return res.status(403).json({ message: "No tienes permiso para acceder a esta ruta" });
        }

        // Si el rol es válido, permite continuar con la solicitud
        next();
    } catch (error) {
        console.error("Error en roleMiddleware:", error);
        res.status(500).json({ message: "Error en la validación de roles" });
    }
};

export default roleMiddleware;
