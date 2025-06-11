class  BitacoraModel{
    constructor(bitacora) {
      this.bitacoraId = bitacora.bitacoraId;
      this.usuarioId = bitacora.usuarioId;
      this.accion = bitacora.accion;
      this.error = bitacora.error;
      this.fecha = bitacora.fecha;
    }
  }

  export default BitacoraModel;