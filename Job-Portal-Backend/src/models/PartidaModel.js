class PartidaModel {
    constructor(partida) {
      this.partidaId = partida.partidaId;
      this.fechaInicio = partida.fechaInicio;
      this.fechaFin = partida.fechaFin;
      this.profesorId = partida.profesorId;
      this.estadoPartida = partida.estadoPartida;
      this.personalizacionId = partida.personalizacionId;
    }
  }

  export default PartidaModel;