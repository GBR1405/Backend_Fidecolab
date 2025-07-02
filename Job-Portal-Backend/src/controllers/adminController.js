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
import { GenerarBitacora } from "../controllers/generalController.js";

import temp from 'temp';
import { v4 as uuidv4 } from 'uuid';
import pkg from 'pdfkit-table';
const { table } = pkg;

const storage = multer.memoryStorage();
const upload = multer({ storage });

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

    const result = await pool.request().query(`
      SELECT Partida_ID_PK, FechaInicio, FechaFin, Profesor_ID_FK, EstadoPartida
      FROM Partida_TB
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
      const tableRowHeight = 35;
      const partidasPerPage = 15;
      let currentY = 80;
      const totalPages = Math.ceil(result.recordset.length / partidasPerPage);

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
          .text('REPORTE DE PARTIDAS', 0, currentY, { align: 'center' });
        currentY += 30;
        doc.fontSize(12).font('Helvetica').fillColor('black')
          .text(`Total de partidas: ${result.recordset.length}`, { align: 'center' });
        doc.text(`Fecha de generación: ${new Date().toLocaleString()}`, { align: 'center' });
        currentY += 40;
      };

      const drawTableHeader = () => {
        const tableLeft = 50;
        const columnWidths = [50, 100, 100, 100, 100];
        const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

        doc.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill(primaryColor);

        let x = tableLeft;
        doc.fontSize(12).font('Helvetica-Bold').fillColor('white');
        doc.text('ID', x + columnWidths[0]/2, currentY + 7, { width: columnWidths[0], align: 'center' });
        x += columnWidths[0];
        doc.text('Fecha Inicio', x + 5, currentY + 7, { width: columnWidths[1] - 10, align: 'center' });
        x += columnWidths[1];
        doc.text('Fecha Fin', x + 5, currentY + 7, { width: columnWidths[2] - 10, align: 'center' });
        x += columnWidths[2];
        doc.text('Profesor ID', x + 5, currentY + 7, { width: columnWidths[3] - 10, align: 'center' });
        x += columnWidths[3];
        doc.text('Estado', x + 5, currentY + 7, { width: columnWidths[4] - 10, align: 'center' });

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

        const partidas = result.recordset.slice(i * partidasPerPage, (i + 1) * partidasPerPage);

        partidas.forEach((partida, index) => {
          const tableLeft = 50;
          const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

          if (index % 2 === 0) {
            doc.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill('#f5f5f5');
          }

          let x = tableLeft;
          doc.text(partida.Partida_ID_PK.toString(), x + columnWidths[0]/2, currentY + 5, { 
            width: columnWidths[0], align: 'center' 
          });
          x += columnWidths[0];
          
          const fechaInicio = partida.FechaInicio ? new Date(partida.FechaInicio).toLocaleDateString() : 'N/A';
          doc.text(fechaInicio, x + 5, currentY + 5, { 
            width: columnWidths[1] - 10, align: 'center' 
          });
          x += columnWidths[1];
          
          const fechaFin = partida.FechaFin ? new Date(partida.FechaFin).toLocaleDateString() : 'N/A';
          doc.text(fechaFin, x + 5, currentY + 5, { 
            width: columnWidths[2] - 10, align: 'center' 
          });
          x += columnWidths[2];
          
          doc.text(partida.Profesor_ID_FK || 'N/A', x + 5, currentY + 5, { 
            width: columnWidths[3] - 10, align: 'center' 
          });
          x += columnWidths[3];
          
          doc.text(partida.EstadoPartida || 'N/A', x + 5, currentY + 5, { 
            width: columnWidths[4] - 10, align: 'center' 
          });

          doc.moveTo(tableLeft, currentY + tableRowHeight)
            .lineTo(tableLeft + tableWidth, currentY + tableRowHeight)
            .lineWidth(0.5)
            .stroke('#dddddd');

          currentY += tableRowHeight;
        });
      }

      if (result.recordset.length === 0) {
        doc.fontSize(14).text("No hay partidas registradas.", { align: 'center' });
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

function generatePassword(name) {
  const randomNumber = Math.floor(10000 + Math.random() * 90000);
  return `${name}${randomNumber}`;
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
              SELECT TOP 1 Codigo_Grupo AS numero
              FROM GrupoCurso_TB
              WHERE Curso_ID_FK = @courseId
              ORDER BY Codigo_Grupo DESC
          `);

      const ultimoGrupo = result.recordset[0] || { numero: 1 }; // Si no hay grupos, el primero será G1
      res.json(ultimoGrupo);
  } catch (error) {
      console.error("Error obteniendo el último grupo:", error);
      res.status(500).json({ error: "Error obteniendo el último grupo." });
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

export const agregarProfesor = async (req, res) => {
  try {
    const { manual, profesores } = req.body;
    let profesoresData = [];
    let saltados = 0;  // Contador de profesores omitidos
    let nuevosProfesores = [];  // Solo profesores nuevos para el PDF

    // Obtener el ID del rol 'Profesor'
    const pool = await poolPromise;
    const rolResult = await pool.request().query(`SELECT Rol_ID_PK FROM Rol_TB WHERE Rol = 'Profesor'`);

    if (rolResult.recordset.length === 0) {
      return res.status(400).json({ mensaje: "El rol 'Profesor' no está disponible en la base de datos." });
    }

    const rolId = rolResult.recordset[0].Rol_ID_PK;
    console.log('ID del rol de Profesor:', rolId);

    if (manual === "true") {
      // Carga manual
      const { name, lastName1, lastName2, email, gender } = req.body;

      console.log('Datos para carga manual:', { name, lastName1, lastName2, email, gender });

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

      console.log('Profesores agregados manualmente:', profesoresData);

    } else {
      // Carga desde JSON
      if (!profesores || profesores.length === 0) {
        return res.status(400).json({ mensaje: "No se han recibido datos de profesores." });
      }

      console.log('Datos recibidos del JSON:', profesores);

      profesoresData = profesores.map(prof => {
        const generatedPassword = generatePassword(prof.name);
        return {
          name: prof.name,
          lastName1: prof.lastName1,
          lastName2: prof.lastName2,
          email: prof.email,
          password: bcrypt.hashSync(generatedPassword, 10),
          generatedPassword,
          rolId,
          generoId: prof.gender  
        };
      });

      console.log('Profesores cargados desde el JSON:', profesoresData);
    }

    // Insertar profesores en la base de datos
    for (const prof of profesoresData) {
      console.log('Insertando profesor:', prof);

      const existingUser = await pool.request()
        .input("email", sql.NVarChar, prof.email)
        .query(`SELECT 1 FROM Usuario_TB WHERE Correo = @email`);

      if (existingUser.recordset.length > 0) {
        console.log(`El correo ${prof.email} ya existe. Se omite este profesor.`);
        saltados++;
        continue;
      }

      const insertRequest = pool.request()
        .input("name", sql.NVarChar, prof.name)
        .input("lastName1", sql.NVarChar, prof.lastName1)
        .input("lastName2", sql.NVarChar, prof.lastName2)
        .input("email", sql.NVarChar, prof.email)
        .input("password", sql.NVarChar, prof.password)
        .input("rolId", sql.Int, prof.rolId)
        .input("generoId", sql.Int, prof.generoId)  
        .input("estado", sql.Bit, 1);

      await insertRequest.query(`INSERT INTO Usuario_TB (Nombre, Apellido1, Apellido2, Correo, Contraseña, Rol_ID_FK, Estado) 
                                VALUES (@name, @lastName1, @lastName2, @email, @password, @rolId, @estado)`);

      console.log('Profesor insertado correctamente:', prof);
      nuevosProfesores.push(prof);
    }

    // -------------------- Generar PDF directamente aquí --------------------
    const pdfPath = path.join(temp.dir, `Profesores_${uuidv4()}.pdf`);
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    // Título principal
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('Listado de Profesores Agregados', { align: 'center' })
      .moveDown();

    // Mensaje sobre profesores omitidos
    doc
      .font('Helvetica')
      .fontSize(12)
      .fillColor('black')
      .text(
        saltados === 0
          ? 'Todos los profesores fueron registrados exitosamente.'
          : `${saltados} profesores fueron omitidos porque sus correos ya estaban registrados.`,
        { align: 'left' }
      )
      .moveDown(1.5);

    if (nuevosProfesores.length === 0) {
      doc.text('No se agregaron nuevos profesores.', { align: 'center' });
      doc.end();
      await new Promise(resolve => writeStream.on('finish', resolve));
    } else {
      // Datos de la tabla sin columna género
      const tableData = {
        headers: [
          { label: 'Nombre', property: 'name', align: 'left' },
          { label: 'Apellido 1', property: 'lastName1', align: 'left' },
          { label: 'Apellido 2', property: 'lastName2', align: 'left' },
          { label: 'Correo', property: 'email', align: 'left' },
          { label: 'Contraseña', property: 'generatedPassword', align: 'left' },
        ],
        rows: nuevosProfesores.map(prof => ({
          name: prof.name,
          lastName1: prof.lastName1,
          lastName2: prof.lastName2,
          email: prof.email,
          generatedPassword: prof.generatedPassword,
        })),
      };

      // Agregar tabla con pdfkit-table, permite continuación en varias páginas
      await doc.table(tableData, {
        prepareHeader: () => doc.font('Helvetica-Bold').fontSize(11),
        prepareRow: (row, i) => doc.font('Helvetica').fontSize(10),
        columnSpacing: 10,
        padding: 5,
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      });

      doc.end();
      await new Promise(resolve => writeStream.on('finish', resolve));
    }

    // Leer PDF y convertir a base64
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');

    // Enviar respuesta
    const mensaje = saltados === profesoresData.length
      ? 'Se omitieron todos los profesores porque ya se encuentran registrados sus correos.'
      : `Se omitieron ${saltados} profesores porque ya se encuentran registrados sus correos.`;

    await GenerarBitacora(req.user.id, "Profesor/es agregados", null);

    res.json({
      success: true,
      pdfBase64,
      mensaje
    });

    // Eliminar archivo PDF temporal
    fs.unlink(pdfPath, err => {
      if (err) console.error("Error al eliminar el archivo PDF:", err);
    });

  } catch (error) {
    console.error("Error al agregar profesores:", error);
    res.status(500).json({ mensaje: "Error interno del servidor" });
  }
};

export const desvincularGrupo = async (req, res) => {
  const { profesorId, grupoId } = req.body;

  console.log(grupoId)

  try {
      const pool = await poolPromise;
      await pool.request()
          .input('profesorId', profesorId)
          .input('grupoId', grupoId)
          .query(`
              DELETE FROM GrupoVinculado_TB
              WHERE GruposEncargados_ID_PK = @grupoId
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
              GruposEncargados_ID_PK AS id, 
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


// Función para generar una contraseña aleatoria
async function generatePDF(profesores) {
  // Configurar el documento PDF
  const pdf = new PDFDocument({
    margin: 40,
    size: 'A4',
    bufferPages: true // Para manejar múltiples páginas
  });

  // Crear directorio si no existe
  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const filePath = path.join(reportsDir, `Credenciales_Profesores_${new Date().toISOString().slice(0,10)}.pdf`);
  const writeStream = fs.createWriteStream(filePath);
  pdf.pipe(writeStream);

  // Estilos y colores
  const primaryColor = '#003366'; // Azul institucional
  const secondaryColor = '#666666';
  const tableRowHeight = 30;
  const tableMargin = 50;
  const professorsPerPage = 20;
  let currentY = 80;
  let currentPage = 1;

  // Descargar y agregar logo de la universidad
  const imageUrl = "https://www.coopeande1.com/sites/default/files/styles/420_width_retina/public/2021-01/u_fidelitas.png?itok=DC77XGsA";
  const imagePath = path.join(reportsDir, "u_fidelitas_temp.png");
  
  try {
    const { data } = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    fs.writeFileSync(imagePath, Buffer.from(data));
    
    // Función para agregar header
    const addHeader = () => {
      pdf.image(imagePath, 50, 20, { width: 80 });
      pdf.fontSize(18).font('Helvetica-Bold').fillColor(primaryColor)
        .text('Universidad Fidelitas', 140, 30);
      pdf.fontSize(10).font('Helvetica').fillColor(secondaryColor)
        .text('Sistema de Gestión Académica', 140, 55);
      pdf.moveTo(50, 80).lineTo(550, 80).lineWidth(2).stroke(primaryColor);
      currentY = 100;
    };

    // Función para agregar footer
    const addFooter = () => {
      pdf.fontSize(10).font('Helvetica').fillColor(secondaryColor)
        .text(`Página ${currentPage}`, 50, pdf.page.height - 40, { align: 'left' });
      pdf.text(`Generado el: ${new Date().toLocaleDateString()}`, 
              50, pdf.page.height - 40, { align: 'right' });
    };

    // Función para verificar espacio y agregar nueva página si es necesario
    const checkSpace = (requiredHeight) => {
      if (currentY + requiredHeight > pdf.page.height - 60) {
        pdf.addPage();
        currentPage++;
        currentY = 80;
        addHeader();
        addFooter();
        return true;
      }
      return false;
    };

    // Agregar primera página con header y footer
    addHeader();
    addFooter();

    // Título del reporte
    pdf.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor)
      .text('CREDENCIALES DE PROFESORES', { align: 'center' });
    currentY += 30;

    pdf.fontSize(12).font('Helvetica').fillColor('black')
      .text(`Total de profesores: ${profesores.length}`, { align: 'center' });
    pdf.text(`Fecha de generación: ${new Date().toLocaleString()}`, { align: 'center' });
    currentY += 40;

    // Configuración de la tabla
    const tableLeft = 50;
    const columnWidths = [120, 100, 100, 100, 80]; // Ajustar según necesidad
    const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

    // Verificar que la tabla no se salga de la página
    if (tableLeft + tableWidth > pdf.page.width - pdf.page.margins.right) {
      // Ajustar anchos si es necesario
      columnWidths[0] -= (tableLeft + tableWidth) - (pdf.page.width - pdf.page.margins.right);
    }

    // Encabezados de la tabla
    pdf.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill(primaryColor);
    
    let x = tableLeft;
    pdf.fontSize(12).font('Helvetica-Bold').fillColor('white');
    pdf.text('Correo', x + 5, currentY + 7, { width: columnWidths[0] - 10 });
    x += columnWidths[0];
    pdf.text('Contraseña', x + 5, currentY + 7, { width: columnWidths[1] - 10 });
    x += columnWidths[1];
    pdf.text('Nombre', x + 5, currentY + 7, { width: columnWidths[2] - 10 });
    x += columnWidths[2];
    pdf.text('Apellido', x + 5, currentY + 7, { width: columnWidths[3] - 10 });
    x += columnWidths[3];
    pdf.text('Género', x + 5, currentY + 7, { width: columnWidths[4] - 10, align: 'center' });

    currentY += tableRowHeight;

    // Filas de la tabla
    pdf.fontSize(10).font('Helvetica').fillColor('black');
    
    profesores.forEach((prof, index) => {
      // Verificar si necesita nueva página
      checkSpace(tableRowHeight);

      // Alternar colores de fila
      if (index % 2 === 0) {
        pdf.rect(tableLeft, currentY, tableWidth, tableRowHeight).fill('#f5f5f5');
      }

      let x = tableLeft;
      pdf.text(prof.email || '-', x + 5, currentY + 7, { width: columnWidths[0] - 10 });
      x += columnWidths[0];
      pdf.text(prof.generatedPassword || '-', x + 5, currentY + 7, { width: columnWidths[1] - 10 });
      x += columnWidths[1];
      pdf.text(prof.name || '-', x + 5, currentY + 7, { width: columnWidths[2] - 10 });
      x += columnWidths[2];
      pdf.text(prof.lastName1 || '-', x + 5, currentY + 7, { width: columnWidths[3] - 10 });
      x += columnWidths[3];
      
      const genero = prof.generoId === 1 ? 'MASCULINO' : 'FEMENINO';
      pdf.text(genero, x + 5, currentY + 7, { width: columnWidths[4] - 10, align: 'center' });

      // Línea divisoria
      pdf.moveTo(tableLeft, currentY + tableRowHeight)
        .lineTo(tableLeft + tableWidth, currentY + tableRowHeight)
        .lineWidth(0.5)
        .stroke('#dddddd');

      currentY += tableRowHeight;
    });

    // Terminar el PDF
    pdf.end();

    // Retornar el path del archivo
    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        // Eliminar imagen temporal
        fs.unlink(imagePath, (err) => {
          if (err) console.error('Error al eliminar imagen temporal:', err);
          resolve(filePath);
        });
      });
      writeStream.on('error', reject);
    });

  } catch (error) {
    console.error('Error al generar PDF:', error);
    throw error;
  }
}

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

export { generatePDF };

