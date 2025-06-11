class ResultadosModel {
    constructor(resultado) {
      this.resultadosId = resultado.resultadosId;
      this.usuarioId = resultado.usuarioId;
      this.partidaId = resultado.partidaId;
      this.puntaje = resultado.puntaje;
      this.fecha = resultado.fecha;
    }
  }

  export default ResultadosModel;