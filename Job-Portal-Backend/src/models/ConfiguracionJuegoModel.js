class ConfiguracionJuegoModel {
    constructor(configuracionJuego) {
      this.configuracionJuegoId = configuracionJuego.configuracionJuegoId;
      this.tipoJuegoId = configuracionJuego.tipoJuegoId;
      this.personalizacionId = configuracionJuego.personalizacionId;
      this.dificultad = configuracionJuego.dificultad;
      this.orden = configuracionJuego.orden;
      this.temaJuegoId = configuracionJuego.temaJuegoId;
    }
  }

  export default ConfiguracionJuegoModel;