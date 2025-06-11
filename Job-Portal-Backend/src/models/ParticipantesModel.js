class ParticipantesModel {
    constructor(participante) {
      this.participantesId = participante.participantesId;
      this.usuarioId = participante.usuarioId;
      this.equipoId = participante.equipoId;
      this.partidaId = participante.partidaId;
      this.fechaIngreso = participante.fechaIngreso;
    }
  }

  export default ParticipantesModel;