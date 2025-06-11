class UserModel {
  constructor(user) {
    this.usuarioId = user.usuarioId; 
    this.nombre = user.nombre;
    this.apellido1 = user.apellido1;
    this.apellido2 = user.apellido2;
    this.correo = user.correo;
    this.contraseña = user.contraseña; 
    this.rolId = user.rolId; 
    this.generoId = user.generoId; 
    this.estado = user.estado;
  }
}

export default UserModel;
