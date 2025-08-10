import axios from 'axios';
import PDFDocument from "pdfkit";
import { poolPromise } from "../config/db.js";
import fs from "fs";
import path from "path";
import multer from "multer";
import xlsx from "xlsx";
import pdfkit from "pdfkit";
import sql from 'mssql';
import bcrypt from 'bcryptjs';
import dotenv from "dotenv";
import { GenerarBitacora } from "../controllers/generalController.js";
import nodemailer from "nodemailer";

dotenv.config();

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Para el envio de correros Electronicos

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

export const generateStudentsReport = async (req, res) => {
  try {
    const pool = await poolPromise;

    const roleQuery = await pool.request()
      .input("rol", "Estudiante")
      .query("SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = @rol");

    if (roleQuery.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Rol 'Estudiante' no encontrado" });
    }

    const studentRoleId = roleQuery.recordset[0].Rol_ID_PK;

    const result = await pool.request()
      .input("rolId", studentRoleId)
      .query(`
        SELECT 
          U.Nombre,
          U.Apellido1,
          U.Apellido2,
          U.Correo,
          U.Estado,
          ISNULL(CONCAT('G', GC.Codigo_Grupo, ' - ', CC.Codigo_Curso), 'SIN CURSO') AS CursoVinculado
        FROM Usuario_TB U
        LEFT JOIN GrupoVinculado_TB GV ON U.Usuario_ID_PK = GV.Usuario_ID_FK
        LEFT JOIN GrupoCurso_TB GC ON GV.GrupoCurso_ID_FK = GC.GrupoCurso_ID_PK
        LEFT JOIN CodigoCurso_TB CC ON GC.Curso_ID_FK = CC.CodigoCurso_ID_PK
        WHERE U.Rol_ID_FK = @rolId
        ORDER BY 
          CASE WHEN CC.Codigo_Curso IS NULL THEN 1 ELSE 0 END, 
          GC.Codigo_Grupo ASC
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "No hay estudiantes registrados" });
    }

    const reportsDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const imageUrl = "https://www.coopeande1.com/sites/default/files/styles/420_width_retina/public/2021-01/u_fidelitas.png?itok=DC77XGsA";
    const imagePath = path.join(reportsDir, "u_fidelitas.png");
    const writer = fs.createWriteStream(imagePath);

    const imageResponse = await axios({
      method: 'get',
      url: imageUrl,
      responseType: 'stream'
    });

    imageResponse.data.pipe(writer);

    writer.on('finish', async () => {
      const filename = `Reporte_Estudiantes_${new Date().toISOString().slice(0,10)}.pdf`;
      const filePath = path.join(reportsDir, filename);
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4'
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const primaryColor = '#003366';
      const secondaryColor = '#666666';
      const tableRowHeight = 31;
      const studentsPerPage = 19;
      let currentY = 80;
      const totalPages = Math.ceil(result.recordset.length / studentsPerPage);

      const addHeader = () => {
        doc.image(imagePath, 50, 20, { width: 80 });
        doc.fontSize(18).font('Helvetica-Bold').fillColor(primaryColor)
          .text('Universidad Fidelitas', 140, 30);
        doc.fontSize(10).font('Helvetica').fillColor(secondaryColor)
          .text('Sistema de Gestión Académica', 140, 55);
        doc.moveTo(50, 80).lineTo(550, 80).lineWidth(2).stroke(primaryColor);
        currentY = 100;
      };

      const addTitle = () => {
        currentY += 5;
        doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor)
          .text('REPORTE DE ESTUDIANTES', 0, currentY, { align: 'center' });
        currentY += 30;
        doc.fontSize(12).font('Helvetica').fillColor('black')
          .text(`Total de estudiantes: ${result.recordset.length}`, { align: 'center' });
        doc.text(`Fecha de generación: ${new Date().toLocaleString()}`, { align: 'center' });
        currentY += 40;
      };

      const drawTableHeader = () => {
        const tableLeft = 50;
        const columnWidths = [160, 170, 70, 120];
        const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

        doc.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill(primaryColor);

        let x = tableLeft;
        doc.fontSize(12).font('Helvetica-Bold').fillColor('white');
        doc.text('Nombre estudiante', x + 5, currentY + 7, { width: columnWidths[0] - 10, align: 'center' });
        x += columnWidths[0];
        doc.text('Correo', x + 5, currentY + 7, { width: columnWidths[1] - 10, align: 'center' });
        x += columnWidths[1];
        doc.text('Estado', x + 5, currentY + 7, { width: columnWidths[2] - 10, align: 'center' });
        x += columnWidths[2];
        doc.text('Curso vinculado', x + 5, currentY + 7, { width: columnWidths[3] - 10, align: 'center' });

        currentY += tableRowHeight;
        return columnWidths;
      };

      for (let i = 0; i < totalPages; i++) {
        if (i > 0) {
          doc.addPage();
        }

        addHeader();
        if (i === 0) addTitle();
        const columnWidths = drawTableHeader();

        doc.fontSize(10).font('Helvetica').fillColor('black');

        const students = result.recordset.slice(i * studentsPerPage, (i + 1) * studentsPerPage);

        students.forEach((student, index) => {
          const tableLeft = 50;
          const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

          if (index % 2 === 0) {
            doc.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill('#f5f5f5');
          }

          let x = tableLeft;
          const nombreCompleto = `${student.Nombre} ${student.Apellido1} ${student.Apellido2}`.toUpperCase();

          doc.fillColor('black').text(nombreCompleto, x + 5, currentY + 5, { width: columnWidths[0] - 10 });
          x += columnWidths[0];
          doc.text(student.Correo || '-', x + 5, currentY + 5, { width: columnWidths[1] - 10 });
          x += columnWidths[1];

          const estadoText = student.Estado ? 'ACTIVO' : 'INACTIVO';
          doc.font('Helvetica-Bold').text(estadoText, x + 5, currentY + 5, { width: columnWidths[2] - 10, align: 'center' });
          x += columnWidths[2];

          doc.font('Helvetica').text(student.CursoVinculado || 'SIN CURSO', x + 5, currentY + 5, { width: columnWidths[3] - 10, align: 'center' });

          doc.moveTo(tableLeft, currentY + tableRowHeight)
            .lineTo(tableLeft + tableWidth, currentY + tableRowHeight)
            .lineWidth(0.5)
            .stroke('#dddddd');

          currentY += tableRowHeight;
        });
      }

      doc.end();

      await GenerarBitacora(req.user.id, "Descarga de reporte de estudiantes", null);

      stream.on("finish", () => {
        res.download(filePath, filename, (err) => {
          if (err) {
            console.error("Error al enviar el PDF:", err);
            return res.status(500).json({ success: false, message: "Error al descargar PDF" });
          }

          [imagePath, filePath].forEach(file => {
            fs.unlink(file, (unlinkErr) => {
              if (unlinkErr) console.error(`Error al eliminar ${file}:`, unlinkErr);
            });
          });
        });
      });
    });

  } catch (error) {
    console.error("Error generando el informe:", error);
    res.status(500).json({ success: false, message: "Error generando PDF" });
  }
};


export const generateProfesorReport = async (req, res) => {
  try {
    const pool = await poolPromise;

    // Obtener el ID del rol "Profesor"
    const roleQuery = await pool.request()
      .input("rol", "Profesor")
      .query("SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = @rol");

    if (roleQuery.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Rol 'Profesor' no encontrado" });
    }

    const profesorRoleId = roleQuery.recordset[0].Rol_ID_PK;

    // Obtener los profesores con sus cursos vinculados
    const result = await pool.request()
      .input("rolId", profesorRoleId)
      .query(`
        SELECT 
          U.Nombre,
          U.Apellido1,
          U.Apellido2,
          U.Correo,
          U.Estado,
          CASE 
            WHEN COUNT(GC.GrupoCurso_ID_PK) = 0 THEN 'SIN CURSOS'
            ELSE STRING_AGG(CONCAT('G', GC.Codigo_Grupo, '-', CC.Codigo_Curso), ', ') 
          END AS CursosVinculados,
          CASE WHEN COUNT(GC.GrupoCurso_ID_PK) = 0 THEN 1 ELSE 0 END AS SinCursos
        FROM Usuario_TB U
        LEFT JOIN GrupoVinculado_TB GV ON U.Usuario_ID_PK = GV.Usuario_ID_FK
        LEFT JOIN GrupoCurso_TB GC ON GV.GrupoCurso_ID_FK = GC.GrupoCurso_ID_PK
        LEFT JOIN CodigoCurso_TB CC ON GC.Curso_ID_FK = CC.CodigoCurso_ID_PK
        WHERE U.Rol_ID_FK = @rolId
        GROUP BY U.Usuario_ID_PK, U.Nombre, U.Apellido1, U.Apellido2, U.Correo, U.Estado
        ORDER BY SinCursos, U.Apellido1, U.Apellido2, U.Nombre
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "No hay profesores registrados" });
    }

    const reportsDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const imageUrl = "https://www.coopeande1.com/sites/default/files/styles/420_width_retina/public/2021-01/u_fidelitas.png?itok=DC77XGsA";
    const imagePath = path.join(reportsDir, "u_fidelitas.png");
    const writer = fs.createWriteStream(imagePath);

    const imageResponse = await axios({
      method: 'get',
      url: imageUrl,
      responseType: 'stream'
    });

    imageResponse.data.pipe(writer);

    writer.on('finish', async () => {
      const filename = `Reporte_Profesores_${new Date().toISOString().slice(0,10)}.pdf`;
      const filePath = path.join(reportsDir, filename);
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4'
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const primaryColor = '#003366';
      const secondaryColor = '#666666';
      const tableRowHeight = 31;
      const professorsPerPage = 19;
      let currentY = 80;
      const totalPages = Math.ceil(result.recordset.length / professorsPerPage);

      const addHeader = () => {
        doc.image(imagePath, 50, 20, { width: 80 });
        doc.fontSize(18).font('Helvetica-Bold').fillColor(primaryColor)
          .text('Universidad Fidelitas', 140, 30);
        doc.fontSize(10).font('Helvetica').fillColor(secondaryColor)
          .text('Sistema de Gestión Académica', 140, 55);
        doc.moveTo(50, 80).lineTo(550, 80).lineWidth(2).stroke(primaryColor);
        currentY = 100;
      };

      const addTitle = () => {
        currentY += 5;
        doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor)
          .text('REPORTE DE PROFESORES', 0, currentY, { align: 'center' });
        currentY += 30;
        doc.fontSize(12).font('Helvetica').fillColor('black')
          .text(`Total de profesores: ${result.recordset.length}`, { align: 'center' });
        doc.text(`Fecha de generación: ${new Date().toLocaleString()}`, { align: 'center' });
        currentY += 40;
      };

      const drawTableHeader = () => {
        const tableLeft = 50;
        const columnWidths = [160, 170, 70, 120];
        const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

        doc.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill(primaryColor);

        let x = tableLeft;
        doc.fontSize(12).font('Helvetica-Bold').fillColor('white');
        doc.text('Nombre profesor', x + 5, currentY + 7, { width: columnWidths[0] - 10, align: 'center' });
        x += columnWidths[0];
        doc.text('Correo', x + 5, currentY + 7, { width: columnWidths[1] - 10, align: 'center' });
        x += columnWidths[1];
        doc.text('Estado', x + 5, currentY + 7, { width: columnWidths[2] - 10, align: 'center' });
        x += columnWidths[2];
        doc.text('Cursos vinculados', x + 5, currentY + 7, { width: columnWidths[3] - 10, align: 'center' });

        currentY += tableRowHeight;
        return columnWidths;
      };

      for (let i = 0; i < totalPages; i++) {
        if (i > 0) {
          doc.addPage();
        }

        addHeader();
        if (i === 0) addTitle();
        const columnWidths = drawTableHeader();

        doc.fontSize(10).font('Helvetica').fillColor('black');

        const professors = result.recordset.slice(i * professorsPerPage, (i + 1) * professorsPerPage);

        professors.forEach((professor, index) => {
          const tableLeft = 50;
          const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

          if (index % 2 === 0) {
            doc.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill('#f5f5f5');
          }

          let x = tableLeft;
          const nombreCompleto = `${professor.Nombre} ${professor.Apellido1} ${professor.Apellido2}`.toUpperCase();

          doc.fillColor('black').text(nombreCompleto, x + 5, currentY + 5, { width: columnWidths[0] - 10 });
          x += columnWidths[0];
          doc.text(professor.Correo || '-', x + 5, currentY + 5, { width: columnWidths[1] - 10 });
          x += columnWidths[1];

          // Estado sin color (solo texto)
          const estadoText = professor.Estado ? 'ACTIVO' : 'INACTIVO';
          doc.font('Helvetica').fillColor('black')
             .text(estadoText, x + 5, currentY + 5, { width: columnWidths[2] - 10, align: 'center' });
          x += columnWidths[2];

          // Formatear cursos para mejor visualización
          let cursosText = professor.CursosVinculados;
          if (professor.CursosVinculados !== 'SIN CURSOS') {
            // Reemplazar "GX - SC-XXX" por "GX-SCXXX" para evitar saltos de línea
            cursosText = professor.CursosVinculados.replace(/G(\d+)\s*-\s*([A-Za-z]+)-(\d+)/g, 'G$1-$2$3');
          }
          
          doc.text(cursosText, x + 5, currentY + 5, { 
            width: columnWidths[3] - 10, 
            align: 'center',
            lineBreak: false
          });

          doc.moveTo(tableLeft, currentY + tableRowHeight)
            .lineTo(tableLeft + tableWidth, currentY + tableRowHeight)
            .lineWidth(0.5)
            .stroke('#dddddd');

          currentY += tableRowHeight;
        });
      }

      doc.end();

      await GenerarBitacora(req.user.id, "Descarga de reporte de profesores", null);

      stream.on("finish", () => {
        res.download(filePath, filename, (err) => {
          if (err) {
            console.error("Error al enviar el PDF:", err);
            return res.status(500).json({ success: false, message: "Error al descargar PDF" });
          }

          [imagePath, filePath].forEach(file => {
            fs.unlink(file, (unlinkErr) => {
              if (unlinkErr) console.error(`Error al eliminar ${file}:`, unlinkErr);
            });
          });
        });
      });
    });

  } catch (error) {
    console.error("Error generando el informe:", error);
    res.status(500).json({ success: false, message: "Error generando PDF" });
  }
};

export const generatePartidaReport = async (req, res) => {
  try {
    const pool = await poolPromise;

    // Consulta mejorada para obtener más información
    const result = await pool.request().query(`
      SELECT 
        p.Partida_ID_PK, 
        p.FechaInicio, 
        p.FechaFin, 
        p.EstadoPartida,
        u.Nombre + ' ' + u.Apellido1 AS Profesor,
        gc.Codigo_Grupo,
        cc.Nombre_Curso,
        (SELECT COUNT(*) FROM Participantes_TB WHERE Partida_ID_FK = p.Partida_ID_PK) AS CantidadEstudiantes
      FROM Partida_TB p
      INNER JOIN Usuario_TB u ON p.Profesor_ID_FK = u.Usuario_ID_PK
      INNER JOIN GrupoCurso_TB gc ON p.Grupo_ID_FK = gc.GrupoCurso_ID_PK
      INNER JOIN CodigoCurso_TB cc ON gc.Curso_ID_FK = cc.CodigoCurso_ID_PK
      ORDER BY p.FechaInicio DESC
    `);

    const reportsDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const imageUrl = "https://www.coopeande1.com/sites/default/files/styles/420_width_retina/public/2021-01/u_fidelitas.png?itok=DC77XGsA";
    const imagePath = path.join(reportsDir, "u_fidelitas.png");
    const writer = fs.createWriteStream(imagePath);

    const imageResponse = await axios({
      method: 'get',
      url: imageUrl,
      responseType: 'stream'
    });

    imageResponse.data.pipe(writer);

    writer.on('finish', async () => {
      const filename = `Reporte_Partidas_${new Date().toISOString().slice(0,10)}.pdf`;
      const filePath = path.join(reportsDir, filename);
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4'
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const primaryColor = '#003366';
      const secondaryColor = '#666666';
      const accentColor = '#4CAF50';
      const backgroundColor = '#F5F5F5';
      const textColor = '#333333';
      let currentY = 80;

      const addHeader = () => {
        doc.image(imagePath, 50, 20, { width: 80 });
        doc.fontSize(18).font('Helvetica-Bold').fillColor(primaryColor)
          .text('Universidad Fidelitas', 140, 30);
        doc.fontSize(10).font('Helvetica').fillColor(secondaryColor)
          .text('Sistema de Gestión Académica', 140, 55);
        doc.moveTo(50, 80).lineTo(550, 80).lineWidth(2).stroke(primaryColor);
        currentY = 100;
      };

      const addTitle = () => {
        currentY += 5;
        doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor)
          .text('REPORTE DETALLADO DE PARTIDAS', 0, currentY, { align: 'center' });
        currentY += 30;
        doc.fontSize(12).font('Helvetica').fillColor(textColor)
          .text(`Total de partidas: ${result.recordset.length}`, { align: 'center' });
        doc.text(`Fecha de generación: ${new Date().toLocaleString()}`, { align: 'center' });
        currentY += 40;
      };

      const drawPartidaCard = (partida) => {
        const cardX = 50;
        const cardWidth = 500;
        const cardHeight = 150;
        
        // Fondo de la tarjeta
        doc.roundedRect(cardX, currentY, cardWidth, cardHeight, 5)
          .fill(backgroundColor)
          .stroke(primaryColor);
        
        // Encabezado de la tarjeta
        doc.fontSize(14).font('Helvetica-Bold').fillColor(primaryColor)
          .text(`Partida #${partida.Partida_ID_PK}`, cardX + 15, currentY + 15);
        
        // Estado con color según el estado
        let estadoColor;
        switch(partida.EstadoPartida) {
          case 'finalizada': estadoColor = '#4CAF50'; break;
          case 'iniciada': estadoColor = '#2196F3'; break;
          case 'en espera': estadoColor = '#FFC107'; break;
          case 'en proceso': estadoColor = '#9C27B0'; break;
          default: estadoColor = textColor;
        }
        
        doc.fontSize(12).font('Helvetica-Bold').fillColor(estadoColor)
          .text(partida.EstadoPartida.toUpperCase(), cardX + cardWidth - 80, currentY + 15);
        
        // Separador
        doc.moveTo(cardX + 10, currentY + 40)
          .lineTo(cardX + cardWidth - 10, currentY + 40)
          .lineWidth(0.5)
          .stroke(secondaryColor);
        
        // Contenido de la tarjeta
        const contentY = currentY + 50;
        let contentX = cardX + 15;
        
        // Primera columna
        doc.fontSize(10).font('Helvetica-Bold').fillColor(textColor)
          .text('Profesor:', contentX, contentY);
        doc.font('Helvetica').text(partida.Profesor, contentX + 60, contentY);
        
        doc.font('Helvetica-Bold').text('Curso:', contentX, contentY + 20);
        doc.font('Helvetica').text(partida.Nombre_Curso, contentX + 60, contentY + 20);
        
        // Segunda columna
        contentX = cardX + 250;
        doc.font('Helvetica-Bold').text('Grupo:', contentX, contentY);
        doc.font('Helvetica').text(partida.Codigo_Grupo, contentX + 60, contentY);
        
        doc.font('Helvetica-Bold').text('Estudiantes:', contentX, contentY + 20);
        doc.font('Helvetica').text(partida.CantidadEstudiantes, contentX + 60, contentY + 20);
        
        // Tercera columna (fechas)
        contentX = cardX + 15;
        doc.font('Helvetica-Bold').text('Fecha Inicio:', contentX, contentY + 50);
        const fechaInicio = partida.FechaInicio ? new Date(partida.FechaInicio).toLocaleString() : 'N/A';
        doc.font('Helvetica').text(fechaInicio, contentX + 80, contentY + 50);
        
        doc.font('Helvetica-Bold').text('Fecha Fin:', contentX + 250, contentY + 50);
        const fechaFin = partida.FechaFin ? new Date(partida.FechaFin).toLocaleString() : 'N/A';
        doc.font('Helvetica').text(fechaFin, contentX + 330, contentY + 50);
        
        currentY += cardHeight + 20;
      };

      addHeader();
      addTitle();

      if (result.recordset.length === 0) {
        doc.fontSize(14).text("No hay partidas registradas.", { align: 'center' });
      } else {
        result.recordset.forEach((partida, index) => {
          // Verificar si necesitamos nueva página
          if (currentY > 700) { // Aproximadamente el final de la página A4
            doc.addPage();
            currentY = 50;
            addHeader();
          }
          
          drawPartidaCard(partida);
        });
      }

      doc.end();

      await GenerarBitacora(req.user.id, "Descarga de reporte de Partidas", null);

      stream.on("finish", () => {
        res.download(filePath, filename, (err) => {
          if (err) {
            console.error("Error al enviar el PDF:", err);
            return res.status(500).json({ success: false, message: "Error al descargar PDF" });
          }

          [imagePath, filePath].forEach(file => {
            fs.unlink(file, (unlinkErr) => {
              if (unlinkErr) console.error(`Error al eliminar ${file}:`, unlinkErr);
            });
          });
        });
      });
    });

  } catch (error) {
    console.error("Error generando el informe:", error);
    res.status(500).json({ success: false, message: "Error generando PDF" });
  }
};


export const generateBitacoraReport = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        U.Nombre + ' ' + U.Apellido1 + ' ' + U.Apellido2 AS UsuarioNombre,
        B.Accion, 
        B.Error, 
        B.Fecha 
      FROM Bitacora_TB B
      INNER JOIN Usuario_TB U ON B.Usuario_ID_FK = U.Usuario_ID_PK
      ORDER BY B.Fecha DESC
    `);

    const reportsDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const imageUrl = "https://www.coopeande1.com/sites/default/files/styles/420_width_retina/public/2021-01/u_fidelitas.png?itok=DC77XGsA";
    const imagePath = path.join(reportsDir, "u_fidelitas.png");
    const writer = fs.createWriteStream(imagePath);

    const imageResponse = await axios({
      method: 'get',
      url: imageUrl,
      responseType: 'stream'
    });

    imageResponse.data.pipe(writer);

    writer.on('finish', async () => {
      const filename = `Reporte_Bitacora_${new Date().toISOString().slice(0, 10)}.pdf`;
      const filePath = path.join(reportsDir, filename);
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const primaryColor = '#003366';
      const secondaryColor = '#666666';
      const baseRowHeight = 25;
      const entriesPerPage = 12;
      let currentY = 80;
      const totalPages = Math.ceil(result.recordset.length / entriesPerPage);

      const addHeader = () => {
        doc.image(imagePath, 50, 20, { width: 80 });
        doc.fontSize(18).font('Helvetica-Bold').fillColor(primaryColor)
          .text('Universidad Fidelitas', 140, 30);
        doc.fontSize(10).font('Helvetica').fillColor(secondaryColor)
          .text('Sistema de Gestión Académica', 140, 55);
        doc.moveTo(50, 80).lineTo(550, 80).lineWidth(2).stroke(primaryColor);
        currentY = 100;
      };

      const addTitle = () => {
        currentY += 5;
        doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor)
          .text('REPORTE DE BITÁCORA', 0, currentY, { align: 'center' });
        currentY += 30;
        doc.fontSize(12).font('Helvetica').fillColor('black')
          .text(`Total de registros: ${result.recordset.length}`, { align: 'center' });
        doc.text(`Fecha de generación: ${new Date().toLocaleString()}`, { align: 'center' });
        currentY += 40;
      };

      const drawTableHeader = () => {
        const tableLeft = 50;
        const columnWidths = [120, 120, 165, 100];
        const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

        doc.rect(tableLeft, currentY, tableWidth, baseRowHeight).fill(primaryColor);

        let x = tableLeft;
        doc.fontSize(12).font('Helvetica-Bold').fillColor('white');
        doc.text('Usuario', x + 5, currentY + 7, { width: columnWidths[0] - 10, align: 'center' });
        x += columnWidths[0];
        doc.text('Acción', x + 5, currentY + 7, { width: columnWidths[1] - 10, align: 'center' });
        x += columnWidths[1];
        doc.text('Error', x + 5, currentY + 7, { width: columnWidths[2] - 10, align: 'center' });
        x += columnWidths[2];
        doc.text('Fecha', x + 5, currentY + 7, { width: columnWidths[3] - 10, align: 'center' });

        currentY += baseRowHeight;
        return { columnWidths, tableLeft };
      };

      for (let i = 0; i < totalPages; i++) {
        if (i > 0) doc.addPage();
        addHeader();
        if (i === 0) addTitle();
        const { columnWidths, tableLeft } = drawTableHeader();

        doc.fontSize(10).font('Helvetica').fillColor('black');

        const entries = result.recordset.slice(i * entriesPerPage, (i + 1) * entriesPerPage);

        entries.forEach((entry, index) => {
          const tableWidth = columnWidths.reduce((a, b) => a + b, 0);
          const rowHeight = Math.max(
            doc.heightOfString(entry.Accion, { width: columnWidths[1] - 10 }) + 10,
            doc.heightOfString(entry.Error || 'N/A', { width: columnWidths[2] - 10 }) + 10,
            baseRowHeight
          );

          if (index % 2 === 0) {
            doc.rect(tableLeft, currentY, tableWidth, rowHeight).fill('#f5f5f5');
          }

          let x = tableLeft;

          doc.fillColor('black').text(entry.UsuarioNombre, x + 5, currentY + 5, {
            width: columnWidths[0] - 10
          });
          x += columnWidths[0];

          doc.text(entry.Accion, x + 5, currentY + 5, {
            width: columnWidths[1] - 10
          });
          x += columnWidths[1];

          doc.text(entry.Error || 'N/A', x + 5, currentY + 5, {
            width: columnWidths[2] - 10
          });
          x += columnWidths[2];

          const fecha = entry.Fecha ? new Date(entry.Fecha).toLocaleString() : 'N/A';
          doc.text(fecha, x + 5, currentY + 5, {
            width: columnWidths[3] - 10,
            align: 'center'
          });

          doc.moveTo(tableLeft, currentY + rowHeight)
            .lineTo(tableLeft + tableWidth, currentY + rowHeight)
            .lineWidth(0.5)
            .stroke('#dddddd');

          currentY += rowHeight;
        });
      }

      if (result.recordset.length === 0) {
        doc.fontSize(14).text("No hay registros en la bitácora.", { align: 'center' });
      }

      doc.end();

      await GenerarBitacora(req.user.id, "Descarga de reporte de Bitácora", null);

      stream.on("finish", () => {
        res.download(filePath, filename, (err) => {
          if (err) {
            console.error("Error al enviar el PDF:", err);
            return res.status(500).json({ success: false, message: "Error al descargar PDF" });
          }

          [imagePath, filePath].forEach(file => {
            fs.unlink(file, (unlinkErr) => {
              if (unlinkErr) console.error(`Error al eliminar ${file}:`, unlinkErr);
            });
          });
        });
      });
    });

  } catch (error) {
    console.error("Error generando el informe:", error);
    res.status(500).json({ success: false, message: "Error generando PDF" });
  }
};

function generatePassword(nombre) {
  const base = nombre.trim().toLowerCase();
  const random = Math.random().toString(36).slice(-4); 
  const capital = nombre[0].toUpperCase();
  const num = Math.floor(100 + Math.random() * 900); 
  return `${capital}${base.slice(1)}${num}${random}`;
}


export const agregarCurso = async (req, res) => {
  const { nombreCurso, codigoCurso } = req.body;

  if (!nombreCurso || !codigoCurso) {
      return res.status(400).json({ error: "Todos los campos son obligatorios." });
  }

  try {
      const pool = await poolPromise;

      // 1️⃣ Verificar si ya existe un curso con el mismo nombre o código
      const checkQuery = `
          SELECT CodigoCurso_ID_PK 
          FROM CodigoCurso_TB 
          WHERE Nombre_Curso = @nombreCurso OR Codigo_Curso = @codigoCurso
      `;
      const checkResult = await pool.request()
          .input("nombreCurso", nombreCurso)
          .input("codigoCurso", codigoCurso)
          .query(checkQuery);

      if (checkResult.recordset.length > 0) {
          return res.status(409).json({ error: "El curso ya existe." });
      }

      // 2️⃣ Insertar el nuevo curso
      const insertCursoQuery = `
          INSERT INTO CodigoCurso_TB (Nombre_Curso, Codigo_Curso) 
          OUTPUT INSERTED.CodigoCurso_ID_PK
          VALUES (@nombreCurso, @codigoCurso)
      `;
      const insertCursoResult = await pool.request()
          .input("nombreCurso", nombreCurso)
          .input("codigoCurso", codigoCurso)
          .query(insertCursoQuery);

      const nuevoCursoId = insertCursoResult.recordset[0].CodigoCurso_ID_PK;

      // 3️⃣ Insertar el primer grupo (G1) en la tabla GrupoCurso_TB
      const insertGrupoQuery = `
          INSERT INTO GrupoCurso_TB (Codigo_Grupo, Curso_ID_FK) 
          VALUES (1, @nuevoCursoId)
      `;
      await pool.request()
          .input("nuevoCursoId", nuevoCursoId)
          .query(insertGrupoQuery);

          await GenerarBitacora(req.user.id, "Curso Agregado", null);
      return res.status(201).json({ message: "Curso y grupo G1 agregados correctamente." });

  } catch (error) {
      console.error("Error al agregar curso:", error);
      return res.status(500).json({ error: "Error interno del servidor." });
  }
};

export const obtenerCursos = async (req, res) => {
  try {
      const pool = await poolPromise;
      const result = await pool.request().query(`
          SELECT CodigoCurso_ID_PK AS id, Nombre_Curso AS nombre, Codigo_Curso AS codigo 
          FROM CodigoCurso_TB
      `);

      res.json(result.recordset);
  } catch (error) {
      console.error("Error obteniendo cursos:", error);
      res.status(500).json({ error: "Error obteniendo los cursos." });
  }
};

// Obtener el último grupo de un curso específico
export const obtenerUltimoGrupoCurso = async (req, res) => {
  try {
    const { courseId } = req.params;
    const pool = await poolPromise;

    const result = await pool.request()
      .input("courseId", courseId)
      .query(`
        SELECT Codigo_Grupo 
        FROM GrupoCurso_TB 
        WHERE Curso_ID_FK = @courseId 
        ORDER BY Codigo_Grupo ASC
      `);

    const grupos = result.recordset.map(row => row.Codigo_Grupo);

    let numeroFaltante = 1;

    for (let i = 0; i < grupos.length; i++) {
      if (grupos[i] !== numeroFaltante) {
        // Falta este número
        return res.json({ numero: numeroFaltante });
      }
      numeroFaltante++;
    }

    // Si no faltó ninguno, se devuelve el siguiente
    res.json({ numero: numeroFaltante-1 });

  } catch (error) {
    console.error("Error obteniendo el siguiente grupo disponible:", error);
    res.status(500).json({ error: "Error obteniendo el siguiente grupo disponible." });
  }
};

export const obtenerBitacoraDescargas = async (req, res) => {
  try {
      const pool = await poolPromise;
      const result = await pool.request()
          .query(`
              SELECT 
                  b.Bitacora_ID_PK AS id,
                  CONCAT(u.Nombre, ' ', u.Apellido1, ' ', u.Apellido2) AS usuario,
                  b.Accion AS accion,
                  b.Fecha AS fecha
              FROM 
                  Bitacora_TB b
              INNER JOIN 
                  Usuario_TB u ON b.Usuario_ID_FK = u.Usuario_ID_PK
              WHERE 
                  b.Accion LIKE 'Descarga%'
              ORDER BY 
                  b.Fecha DESC
          `);

      res.json(result.recordset);
  } catch (error) {
      console.error("Error obteniendo la bitácora de descargas:", error);
      res.status(500).json({ error: "Error obteniendo la bitácora de descargas." });
  }
};

export const guardarGrupo = async (req, res) => {
  try {
      const { cursoId, grupoNumero } = req.body; // Asegúrate de recibir ambos datos

      if (!cursoId || !grupoNumero) {
          return res.status(400).json({ mensaje: "El ID del curso y el número del grupo son obligatorios." });
      }

      const pool = await poolPromise;

      // 1️⃣ Verificar si el curso existe
      const cursoExiste = await pool
          .request()
          .input("cursoId", cursoId)
          .query("SELECT COUNT(*) AS total FROM CodigoCurso_TB WHERE CodigoCurso_ID_PK = @cursoId");

      if (cursoExiste.recordset[0].total === 0) {
          return res.status(404).json({ mensaje: "El curso no existe." });
      }

      // 2️⃣ Insertar el nuevo grupo
      await pool
          .request()
          .input("codigoGrupo", grupoNumero)
          .input("cursoId", cursoId)
          .query(`
              INSERT INTO GrupoCurso_TB (Codigo_Grupo, Curso_ID_FK)
              VALUES (@codigoGrupo, @cursoId)
          `);

      await GenerarBitacora(req.user.id, "Grupo Agregado", null);
      res.status(201).json({ mensaje: "Grupo creado con éxito", grupoNumero });
  } catch (error) {
      console.error("Error al guardar el grupo:", error);
      res.status(500).json({ mensaje: "Error interno del servidor" });
  }
};

async function generatePDF(profesores, saltados) {
  return new Promise(async (resolve, reject) => {
    if (profesores.length === 0) return resolve("");

    const reportsDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const imageUrl = "https://www.coopeande1.com/sites/default/files/styles/420_width_retina/public/2021-01/u_fidelitas.png?itok=DC77XGsA";
    const imagePath = path.join(reportsDir, "u_fidelitas.png");
    const imageWriter = fs.createWriteStream(imagePath);

    const imageResponse = await axios({ method: 'get', url: imageUrl, responseType: 'stream' });
    imageResponse.data.pipe(imageWriter);

    imageWriter.on('finish', () => {
      const filename = `Profesores_Nuevos_${new Date().toISOString().slice(0, 10)}.pdf`;
      const filePath = path.join(reportsDir, filename);
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const primaryColor = '#003366';
      const tableRowHeight = 30;
      const profesoresPerPage = 22;
      let currentY = 80;

      const addHeader = () => {
        doc.image(imagePath, 50, 20, { width: 80 });
        doc.fontSize(18).font('Helvetica-Bold').fillColor(primaryColor).text('Universidad Fidelitas', 140, 30);
        doc.fontSize(10).font('Helvetica').fillColor('#666').text('Sistema de Gestión Académica', 140, 55);
        doc.moveTo(50, 80).lineTo(550, 80).lineWidth(2).stroke(primaryColor);
        currentY = 100;
      };

      const addTitle = () => {
        doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor)
          .text('REPORTE DE NUEVOS PROFESORES', 0, currentY, { align: 'center' });
        currentY += 25;
        doc.fontSize(12).fillColor('black')
          .text(`Total de profesores agregados: ${profesores.length}`, { align: 'center' });
        currentY += 15;
        const saltadoMsg = saltados === 0
          ? 'No se omitió ningún profesor.'
          : (saltados === profesores.length
              ? 'Se omitieron todos los profesores porque ya existían.'
              : `Se omitieron ${saltados} profesores porque ya existían.`);
        doc.text(saltadoMsg, { align: 'center' });
        currentY += 40;
      };

      const drawTableHeader = () => {
        const tableLeft = 50;
        const columnWidths = [160, 170, 120];
        const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

        doc.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill(primaryColor);
        let x = tableLeft;
        doc.fontSize(12).fillColor('white').font('Helvetica-Bold');
        doc.text('Nombre completo', x + 5, currentY + 8, { width: columnWidths[0] - 10, align: 'center' });
        x += columnWidths[0];
        doc.text('Correo electrónico', x + 5, currentY + 8, { width: columnWidths[1] - 10, align: 'center' });
        x += columnWidths[1];
        doc.text('Contraseña', x + 5, currentY + 8, { width: columnWidths[2] - 10, align: 'center' });

        currentY += tableRowHeight;
        return columnWidths;
      };

      const totalPages = Math.ceil(profesores.length / profesoresPerPage);
      for (let i = 0; i < totalPages; i++) {
        if (i > 0) doc.addPage();
        addHeader();
        if (i === 0) addTitle();
        const columnWidths = drawTableHeader();
        const profSlice = profesores.slice(i * profesoresPerPage, (i + 1) * profesoresPerPage);

        profSlice.forEach((prof, idx) => {
          const tableLeft = 50;
          const tableWidth = columnWidths.reduce((a, b) => a + b, 0);
          if (idx % 2 === 0) {
            doc.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill('#f5f5f5');
          }

          let x = tableLeft;
          const fullName = `${prof.name} ${prof.lastName1} ${prof.lastName2}`;
          doc.fillColor('black').font('Helvetica').fontSize(10);
          doc.text(fullName, x + 5, currentY + 5, { width: columnWidths[0] - 10 });
          x += columnWidths[0];
          doc.text(prof.email, x + 5, currentY + 5, { width: columnWidths[1] - 10 });
          x += columnWidths[1];
          doc.text(prof.generatedPassword, x + 5, currentY + 5, { width: columnWidths[2] - 10, align: 'center' });

          currentY += tableRowHeight;
        });
      }

      doc.end();
      stream.on('finish', () => resolve(filePath));
    });

    imageWriter.on('error', reject);
  });
}

// FUNCIÓN PRINCIPAL
export const agregarProfesor = async (req, res) => {
  try {
    const { manual, profesores } = req.body;
    let profesoresData = [];
    let saltados = 0;
    let nuevosProfesores = [];

    const pool = await poolPromise;
    const rolResult = await pool.request().query(`SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = 'Profesor'`);

    if (rolResult.recordset.length === 0) {
      return res.status(400).json({ mensaje: "El rol 'Profesor' no está disponible." });
    }

    const rolId = rolResult.recordset[0].Rol_ID_PK;

    if (manual === "true") {
      const { name, lastName1, lastName2, email, gender } = req.body;
      if (!name || !lastName1 || !lastName2 || !email || !gender) {
        return res.status(400).json({ message: 'Todos los campos son obligatorios' });
      }

      const generatedPassword = generatePassword(name);
      const hashedPassword = await bcrypt.hash(generatedPassword, 10);

      profesoresData.push({
        name,
        lastName1,
        lastName2,
        email,
        password: hashedPassword,
        generatedPassword,
        rolId,
        generoId: gender
      });

    } else {
      if (!profesores || profesores.length === 0) {
        return res.status(400).json({ mensaje: "No se han recibido datos de profesores." });
      }

      for (const prof of profesores) {
        const generatedPassword = generatePassword(prof.name);
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);
        
        profesoresData.push({
          name: prof.name,
          lastName1: prof.lastName1,
          lastName2: prof.lastName2,
          email: prof.email,
          password: hashedPassword,
          generatedPassword,
          rolId,
          generoId: prof.gender
        });
      }
    }

    // Array para almacenar promesas de envío de correos
    const emailPromises = [];

    for (const prof of profesoresData) {
      const existingUser = await pool.request()
        .input("email", sql.NVarChar, prof.email)
        .query(`SELECT 1 FROM Usuario_TB WHERE Correo = @email`);

      if (existingUser.recordset.length > 0) {
        saltados++;
        continue;
      }

      // Insertar nuevo profesor
      await pool.request()
        .input("name", sql.NVarChar, prof.name)
        .input("lastName1", sql.NVarChar, prof.lastName1)
        .input("lastName2", sql.NVarChar, prof.lastName2)
        .input("email", sql.NVarChar, prof.email)
        .input("password", sql.NVarChar, prof.password)
        .input("rolId", sql.Int, prof.rolId)
        .input("generoId", sql.Int, prof.generoId)
        .input("estado", sql.Bit, 1)
        .query(`INSERT INTO Usuario_TB (Nombre, Apellido1, Apellido2, Correo, Contraseña, Rol_ID_FK, Genero_ID_FK, Estado) 
                VALUES (@name, @lastName1, @lastName2, @email, @password, @rolId, @generoId, @estado)`);

      nuevosProfesores.push(prof);

      // Preparar envío de correo (sin await para hacerlo en paralelo después)
      emailPromises.push(
        transporter.sendMail({
          from: `"Bienvenida a FideColab" <${process.env.EMAIL_USER}>`,
          to: prof.email,
          subject: "Bienvenido a FideColab",
          html: `
            <html>
              <head>
                <style>
                  body {
                    font-family: 'Arial', sans-serif;
                    background-color: #f4f6f9;
                    margin: 0;
                    padding: 0;
                    color: #333;
                  }
                  .container {
                    width: 100%;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #ffffff;
                    border-radius: 8px;
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                  }
                  .header {
                    text-align: center;
                    padding: 20px;
                    background-color: rgb(19, 30, 173);
                    border-radius: 8px 8px 0 0;
                    color: #ffffff;
                  }
                  .header img {
                    width: 100px;
                    margin-bottom: 10px;
                  }
                  .content {
                    padding: 20px;
                    font-size: 16px;
                  }
                  .password-box {
                    background-color: #f8f9fa;
                    border: 1px solid #dee2e6;
                    border-radius: 4px;
                    padding: 15px;
                    margin: 20px 0;
                    text-align: center;
                    font-size: 18px;
                    font-weight: bold;
                    color: #dc3545;
                  }
                  .footer {
                    margin-top: 30px;
                    text-align: center;
                    font-size: 14px;
                    color: #888;
                  }
                  .footer p {
                    margin: 10px 0;
                  }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <img src="https://cdn.ufidelitas.ac.cr/wp-content/uploads/2023/11/17075151/FideLogo-04.png" alt="Logo" />
                    <h1>Bienvenido a FideColab</h1>
                  </div>
                  <div class="content">
                    <p>Hola ${prof.name},</p>
                    <p>¡Bienvenido a FideColab! Se ha creado una cuenta para ti.</p>
                    <p>Tus credenciales de acceso son:</p>
                    <p><strong>Correo:</strong> ${prof.email}</p>
                    <div class="password-box">
                      Contraseña: ${prof.generatedPassword}
                    </div>
                    <p>Te recomendamos cambiar esta contraseña después de iniciar sesión por primera vez.</p>
                    <p>¡Disfruta de la plataforma!</p>
                  </div>
                  <div class="footer">
                    <p>Si tienes problemas para acceder, por favor contacta con nuestro soporte.</p>
                  </div>
                </div>
              </body>
            </html>
          `,
        }).catch(error => {
          console.error(`Error enviando correo a ${prof.email}:`, error);
        })
      );
    }

    // Esperar que todos los correos se envíen (pero no bloquear la respuesta)
    Promise.all(emailPromises)
      .then(() => console.log('Todos los correos enviados'))
      .catch(error => console.error('Error en envío de correos:', error));

    let pdfBase64 = null;
    let mensaje = '';

    if (nuevosProfesores.length > 0) {
      const pdfPath = await generatePDF(nuevosProfesores, saltados);
      const pdfBuffer = fs.readFileSync(pdfPath);
      pdfBase64 = pdfBuffer.toString('base64');

      mensaje = saltados === 0
        ? 'Todos los profesores fueron agregados correctamente.'
        : `Se agregaron ${nuevosProfesores.length} profesores y se omitieron ${saltados} porque ya estaban registrados.`;

      fs.unlink(pdfPath, (err) => {
        if (err) console.error("Error al eliminar el archivo PDF:", err);
      });
    } else {
      mensaje = 'Se omitieron todos los profesores porque ya se encuentran registrados sus correos.';
    }

    await GenerarBitacora(req.user.id, "Profesor/es agregados", null);
    res.json({ success: true, pdfBase64, mensaje });

  } catch (error) {
    console.error("Error al agregar profesores:", error);
    res.status(500).json({ mensaje: "Error interno del servidor" });
  }
};



export const desvincularGrupo = async (req, res) => {
  const { profesorId, grupoId } = req.body;

  console.log("Profesor ID:", profesorId);
  console.log("Grupo ID:", grupoId);

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('profesorId', profesorId)
      .input('grupoId', grupoId)
      .query(`
        DELETE FROM GrupoVinculado_TB
        WHERE Usuario_ID_FK = @profesorId AND GrupoCurso_ID_FK = @grupoId
      `);

    res.status(200).json({ message: 'Grupo desvinculado correctamente' });
  } catch (error) {
    console.error("Error desvinculando grupo:", error);
    res.status(500).json({ error: "Error desvinculando grupo" });
  }
};

// Obtener todos los profesores
export const getAllProfessors = async (req, res) => {
  try {
      // Usar poolPromise para obtener la conexión y realizar la consulta
      const pool = await poolPromise;
      const result = await pool.request()
        .query("SELECT u.Usuario_ID_PK, u.Nombre, u.Apellido1, u.Apellido2, u.Correo FROM Usuario_TB u JOIN Rol_TB r ON u.Rol_ID_FK = r.Rol_ID_PK WHERE r.Rol = 'Profesor';");

      // Responder con los datos obtenidos
      res.status(200).json({ professors: result.recordset });
  } catch (err) {
      console.error('Error al obtener profesores:', err);
      res.status(500).json({ error: 'Error al obtener profesores' });
  }
};


export const getAllGroups = async (req, res) => {
  try {
      const pool = await poolPromise; // Obtener la conexión
      const result = await pool.request()
          .query(`
              SELECT gc.GrupoCurso_ID_PK, gc.Codigo_Grupo, cc.Nombre_Curso, cc.Codigo_Curso
              FROM GrupoCurso_TB gc
              JOIN CodigoCurso_TB cc ON gc.Curso_ID_FK = cc.CodigoCurso_ID_PK
          `);

      // Formatear los resultados
      const formattedGroups = result.recordset.map(group => {
          return {
              id: group.GrupoCurso_ID_PK,
              codigo: group.Codigo_Curso, // Código del curso
              nombre: group.Nombre_Curso, // Nombre del curso
              grupo: group.Codigo_Grupo, // Número de grupo
          };
      });

      res.status(200).json({ groups: formattedGroups });
  } catch (error) {
      console.error("Error al obtener grupos:", error);
      res.status(500).json({ message: "Error al obtener los grupos" });
  }
};

export const obtenerCursosDelProfesor = async (req, res) => {
  const { profesorId } = req.params; 

  try {
      const pool = await poolPromise;

      // Consulta SQL para obtener los cursos del profesor
      const query = `
          SELECT 
              GC.GrupoCurso_ID_PK AS id, 
              CC.Nombre_Curso AS nombre, 
              CC.Codigo_Curso AS codigo,
              GC.Codigo_Grupo AS grupo
          FROM 
              GrupoVinculado_TB GV
          INNER JOIN 
              GrupoCurso_TB GC ON GV.GrupoCurso_ID_FK = GC.GrupoCurso_ID_PK
          INNER JOIN 
              CodigoCurso_TB CC ON GC.Curso_ID_FK = CC.CodigoCurso_ID_PK
          WHERE 
              GV.Usuario_ID_FK = @profesorId
      `;

      const result = await pool.request()
          .input('profesorId', profesorId) // Parámetro para evitar SQL Injection
          .query(query);

      res.json(result.recordset); // Enviar los cursos como respuesta
  } catch (error) {
      console.error("Error obteniendo los cursos del profesor:", error);
      res.status(500).json({ error: "Error obteniendo los cursos del profesor." });
  }
};

export const getGruposDisponibles = async (req, res) => {
  try {
      const pool = await poolPromise;
      const result = await pool.request().query(`
          SELECT 
          gc.GrupoCurso_ID_PK AS id, 
          cc.Codigo_Curso AS codigo, 
          cc.Nombre_Curso AS nombre, 
          gc.Codigo_Grupo AS grupo
      FROM 
          GrupoCurso_TB gc
      JOIN 
          CodigoCurso_TB cc ON gc.Curso_ID_FK = cc.CodigoCurso_ID_PK
      WHERE 
          NOT EXISTS (
              SELECT 1
              FROM GrupoVinculado_TB gv
              JOIN Usuario_TB u ON gv.Usuario_ID_FK = u.Usuario_ID_PK
              JOIN Rol_TB r ON u.Rol_ID_FK = r.Rol_ID_PK
              WHERE gc.GrupoCurso_ID_PK = gv.GrupoCurso_ID_FK
                AND r.Rol = 'Profesor'
          );
      `);

      res.status(200).json({ grupos: result.recordset });
  } catch (error) {
      console.error("Error obteniendo grupos disponibles:", error);
      res.status(500).json({ error: "Error obteniendo grupos disponibles" });
  }
};

export const asignarGrupo = async (req, res) => {
  const { profesorId, grupoId } = req.body;

  try {
      const pool = await poolPromise;
      await pool.request()
          .input('profesorId', profesorId)
          .input('grupoId', grupoId)
          .query(`
              INSERT INTO GrupoVinculado_TB (Usuario_ID_FK, GrupoCurso_ID_FK)
              VALUES (@profesorId, @grupoId)
          `);

      res.status(200).json({ message: 'Grupo asignado correctamente' });
  } catch (error) {
      console.error("Error asignando grupo:", error);
      res.status(500).json({ error: "Error asignando grupo" });
  }
};

export const editarPersonalizacion = async (req, res) => {
  try {
    const { temaId, contenido } = req.body;
    
    if (!temaId || !contenido) {
      return res.status(400).json({ error: "Faltan parámetros requeridos" });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input("temaId", temaId)
      .input("contenido", contenido)
      .query(`
        UPDATE Tema_Juego_TB 
        SET Contenido = @contenido
        WHERE Tema_Juego_ID_PK = @temaId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Personalización no encontrada" });
    }

    res.json({ 
      success: true,
      message: "Contenido actualizado correctamente"
    });

  } catch (error) {
    console.error("Error al editar personalización:", error);
    res.status(500).json({ error: "Error al editar la personalización" });
  }
};

export const desactivarPersonalizacion = async (req, res) => {
  try {
    const { temaId } = req.body;
    
    if (!temaId) {
      return res.status(400).json({ error: "ID de tema es requerido" });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input("temaId", temaId)
      .query(`
        UPDATE Tema_Juego_TB 
        SET Estado = 0
        WHERE Tema_Juego_ID_PK = @temaId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Personalización no encontrada" });
    }

    res.json({ 
      success: true,
      message: "Personalización desactivada correctamente"
    });

  } catch (error) {
    console.error("Error al desactivar personalización:", error);
    res.status(500).json({ error: "Error al desactivar la personalización" });
  }
};

export const activarPersonalizacion = async (req, res) => {
  try {
    const { temaId } = req.body;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("temaId", temaId)
      .query(`
        UPDATE Tema_Juego_TB 
        SET Estado = 1
        WHERE Tema_Juego_ID_PK = @temaId
      `);
    
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Personalización no encontrada" });
    }

    res.json({ 
      success: true,
      message: "Personalización activada correctamente"
    });

  } catch (error) {
    console.error("Error al activar:", error);
    res.status(500).json({ error: "Error al activar la personalización" });
  }
};

export const obtenerMetricasAdmin = async (req, res) => {
  try {
    const pool = await poolPromise;
    
    // Primero necesitamos obtener los IDs de los roles
    const rolesQuery = `
      SELECT Rol_ID_PK, Rol
      FROM Rol_TB 
      WHERE Rol IN ('Estudiante', 'Profesor')
    `;
    
    const rolesResult = await pool.request().query(rolesQuery);
    
    // Buscamos los IDs correspondientes
    const idEstudiante = rolesResult.recordset.find(r => r.Rol === 'Estudiante')?.Rol_ID_PK;
    const idProfesor = rolesResult.recordset.find(r => r.Rol === 'Profesor')?.Rol_ID_PK;
    
    if (!idEstudiante || !idProfesor) {
      throw new Error('No se encontraron los roles necesarios en la base de datos');
    }
    
    // Consulta para obtener partidas jugadas
    const partidasQuery = `
      SELECT COUNT(DISTINCT Partida_ID_FK) AS partidasJugadas 
      FROM Resultados_TB
    `;
    
    // Consulta para obtener cantidad de estudiantes
    const estudiantesQuery = `
      SELECT COUNT(*) AS totalEstudiantes 
      FROM Usuario_TB 
      WHERE Rol_ID_FK = @idEstudiante AND Estado = 1
    `;
    
    // Consulta para obtener cantidad de profesores
    const profesoresQuery = `
      SELECT COUNT(*) AS totalProfesores 
      FROM Usuario_TB 
      WHERE Rol_ID_FK = @idProfesor AND Estado = 1
    `;
    
    // Consulta para obtener personalizaciones totales con estado = 1
    const personalizacionesQuery = `
      SELECT COUNT(*) AS totalPersonalizaciones 
      FROM Personalizacion_TB 
      WHERE Estado = 1
    `;
    
    // Ejecutar todas las consultas en paralelo
    const [
      partidasResult,
      estudiantesResult,
      profesoresResult,
      personalizacionesResult
    ] = await Promise.all([
      pool.request().query(partidasQuery),
      pool.request()
        .input('idEstudiante', sql.Int, idEstudiante)
        .query(estudiantesQuery),
      pool.request()
        .input('idProfesor', sql.Int, idProfesor)
        .query(profesoresQuery),
      pool.request().query(personalizacionesQuery)
    ]);
    
    // Construir el objeto de respuesta
    const metricas = {
      partidasJugadas: partidasResult.recordset[0].partidasJugadas,
      totalEstudiantes: estudiantesResult.recordset[0].totalEstudiantes,
      totalProfesores: profesoresResult.recordset[0].totalProfesores,
      totalPersonalizaciones: personalizacionesResult.recordset[0].totalPersonalizaciones
    };
    
    res.json(metricas);
  } catch (error) {
    console.error("Error obteniendo métricas administrativas:", error);
    res.status(500).json({ 
      error: "Error obteniendo las métricas administrativas.",
      details: error.message 
    });
  }
};

export const obtenerUsuariosPorGrupoId = async (req, res) => {
    const { cursoId } = req.params;  // Aquí el nombre es cursoId, pero representa el GrupoCurso_ID_PK

    try {
        const pool = await poolPromise;

        // Buscar profesor en ese grupo (Rol = Profesor)
        const profesorResult = await pool.request()
            .input("grupoCursoId", cursoId)  // uso cursoId pero como grupoCursoId en la consulta
            .query(`
                SELECT U.Usuario_ID_PK, U.Nombre, U.Apellido1, U.Apellido2, U.Correo
                FROM GrupoVinculado_TB GV
                INNER JOIN Usuario_TB U ON U.Usuario_ID_PK = GV.Usuario_ID_FK
                WHERE GV.GrupoCurso_ID_FK = @grupoCursoId
                AND U.Rol_ID_FK = (SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = 'Profesor')
            `);

        const profesor = profesorResult.recordset[0] || null;

        // Buscar estudiantes en ese grupo (Rol = Estudiante)
        const estudiantesResult = await pool.request()
            .input("grupoCursoId", cursoId)
            .query(`
                SELECT U.Usuario_ID_PK, U.Nombre, U.Apellido1, U.Apellido2, U.Correo
                FROM GrupoVinculado_TB GV
                INNER JOIN Usuario_TB U ON U.Usuario_ID_PK = GV.Usuario_ID_FK
                WHERE GV.GrupoCurso_ID_FK = @grupoCursoId
                AND U.Rol_ID_FK = (SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = 'Estudiante')
            `);

        const estudiantes = estudiantesResult.recordset;

        res.json({
            profesor,
            estudiantes
        });

    } catch (error) {
        console.error("Error obteniendo detalles del grupo:", error);
        res.status(500).json({ error: "Error al obtener detalles del grupo." });
    }
};

// Editar curso por su ID
export const editarCurso = async (req, res) => {
  const { grupoCursoId, nuevoNombre, nuevoCodigo } = req.body;

  try {
    const pool = await poolPromise;

    // 1. Obtener el ID del curso a partir del grupoCursoId
    const cursoResult = await pool.request()
      .input('grupoCursoId', grupoCursoId)
      .query(`
        SELECT Curso_ID_FK FROM GrupoCurso_TB
        WHERE GrupoCurso_ID_PK = @grupoCursoId
      `);

    if (cursoResult.recordset.length === 0) {
      return res.status(404).json({ error: 'GrupoCurso no encontrado' });
    }

    const cursoId = cursoResult.recordset[0].Curso_ID_FK;

    // 2. Verificar si ya existe otro curso con el mismo código
    const codigoExistente = await pool.request()
      .input('nuevoCodigo', nuevoCodigo)
      .input('cursoId', cursoId)
      .query(`
        SELECT 1 FROM CodigoCurso_TB
        WHERE Codigo_Curso = @nuevoCodigo AND CodigoCurso_ID_PK != @cursoId
      `);

    if (codigoExistente.recordset.length > 0) {
      return res.status(400).json({ error: 'Ya existe otro curso con ese código' });
    }

    // 3. Editar el curso
    await pool.request()
      .input('cursoId', cursoId)
      .input('nuevoNombre', nuevoNombre)
      .input('nuevoCodigo', nuevoCodigo)
      .query(`
        UPDATE CodigoCurso_TB
        SET Nombre_Curso = @nuevoNombre,
            Codigo_Curso = @nuevoCodigo
        WHERE CodigoCurso_ID_PK = @cursoId
      `);

    res.status(200).json({ message: 'Curso editado correctamente' });
  } catch (error) {
    console.error('Error editando curso:', error);
    res.status(500).json({ error: 'Error al editar el curso' });
  }
};


// Eliminar un curso, desvinculando primero los profesores
export const eliminarCurso = async (req, res) => {
  const { grupoCursoId } = req.body;

  try {
    const pool = await poolPromise;

    // 1. Verificar que el grupo existe
    const grupoResult = await pool.request()
      .input('grupoCursoId', grupoCursoId)
      .query(`
        SELECT 1 FROM GrupoCurso_TB
        WHERE GrupoCurso_ID_PK = @grupoCursoId
      `);

    if (grupoResult.recordset.length === 0) {
      return res.status(404).json({ error: 'GrupoCurso no encontrado' });
    }

    // 2. Desvincular profesores asignados a ese grupo
    await pool.request()
      .input('grupoCursoId', grupoCursoId)
      .query(`
        DELETE FROM GrupoVinculado_TB
        WHERE GrupoCurso_ID_FK = @grupoCursoId
      `);

    // 3. Eliminar el grupo en sí
    await pool.request()
      .input('grupoCursoId', grupoCursoId)
      .query(`
        DELETE FROM GrupoCurso_TB
        WHERE GrupoCurso_ID_PK = @grupoCursoId
      `);

    res.status(200).json({ message: 'Grupo eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando grupo del curso:', error);
    res.status(500).json({ error: 'Error al eliminar el grupo del curso' });
  }
};






export { generatePDF };

