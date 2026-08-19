// services/emailService.js
//
// Archivo único y autocontenido: transporter + plantilla + envío.
// Configurado para Gmail con App Password.
//
// Si tu proyecto usa CommonJS, cambiá los import/export por:
//   const nodemailer = require("nodemailer");
//   module.exports = { enviarCorreoBienvenida, verificarSMTP };

import nodemailer from "nodemailer";

const {
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_FROM,
  EMAIL_FROM_NAME = "FideColab",
  EMAIL_HOST = "smtp.gmail.com",
  EMAIL_PORT = "587",
  EMAIL_DEBUG,
} = process.env;

// --- Validación al arrancar: mejor reventar acá que en el primer envío ---
const faltantes = ["EMAIL_USER", "EMAIL_PASS", "EMAIL_FROM"].filter((k) => !process.env[k]);
if (faltantes.length) {
  console.error(`[mailer] Faltan variables de entorno: ${faltantes.join(", ")}`);
}

// Gmail SIEMPRE reescribe el remitente con la cuenta autenticada.
// Si EMAIL_FROM no coincide con EMAIL_USER, el correo igual sale, pero
// mostrando EMAIL_USER como remitente. Este aviso te ahorra el desconcierto.
if (EMAIL_FROM && EMAIL_USER && EMAIL_FROM !== EMAIL_USER) {
  console.warn(
    `[mailer] EMAIL_FROM (${EMAIL_FROM}) no coincide con EMAIL_USER (${EMAIL_USER}). ` +
      `Gmail lo va a sobrescribir con EMAIL_USER.`
  );
}

// process.env devuelve strings -> hay que castear el puerto.
const port = Number(EMAIL_PORT) || 587;

// 465 = SSL desde el primer byte. 587 = arranca en claro y sube con STARTTLS.
// Derivarlo del puerto evita el error clásico de cruzarlos y que se cuelgue sin mensaje.
const secure = port === 465;

const transporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port,
  secure,

  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS, // App Password de 16 caracteres, SIN espacios
  },

  // Fuerza IPv4. En Render la resolución IPv6 hacia varios SMTP se queda colgada.
  family: 4,

  // Reusa conexiones en vez de abrir una nueva por cada correo.
  pool: true,
  maxConnections: 3,
  maxMessages: 50,

  // Sin timeouts, un puerto bloqueado deja la request colgada hasta que Render la mata.
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 20000,

  // Poné EMAIL_DEBUG=true en Render para ver el diálogo SMTP completo en los logs.
  logger: EMAIL_DEBUG === "true",
  debug: EMAIL_DEBUG === "true",
});

const remitente = `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`;

const LOGO_URL =
  "https://cdn.ufidelitas.ac.cr/wp-content/uploads/2023/11/17075151/FideLogo-04.png";

/**
 * Verifica credenciales y conectividad SIN mandar un correo real.
 * Llamalo una vez al levantar el server.
 */
export async function verificarSMTP() {
  try {
    await transporter.verify();
    console.log(`[mailer] Conexión OK -> ${EMAIL_HOST}:${port} (secure: ${secure})`);
    return true;
  } catch (error) {
    console.error("[mailer] Falló la conexión SMTP:");
    console.error(`  mensaje: ${error.message}`);
    console.error(`  code: ${error.code ?? "n/a"} | responseCode: ${error.responseCode ?? "n/a"}`);

    if (error.code === "EAUTH") {
      console.error("  -> Credenciales rechazadas. Chequeá que EMAIL_PASS sea la App Password");
      console.error("     de 16 caracteres sin espacios, y no la contraseña normal de la cuenta.");
    }
    if (["ETIMEDOUT", "ECONNREFUSED", "ESOCKET"].includes(error.code)) {
      console.error("  -> No se pudo abrir el socket. Probá EMAIL_PORT=465 (con SSL directo).");
    }
    return false;
  }
}

/**
 * Escapa caracteres que romperían el HTML si el nombre trae < > & " '
 * (un apellido tipo "O'Brien & Co" no debería reventar el template).
 */
function escapeHtml(valor = "") {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * NOTA sobre el <style> del template original:
 * Gmail (sobre todo la app móvil) y Outlook descartan las reglas CSS del <head>.
 * Tu correo llegaba sin diseño en buena parte de los clientes. Por eso acá todo
 * va inline y la estructura usa <table>, que renderiza parejo en todos lados.
 */
function plantillaBienvenida({ nombre, correo, password }) {
  const nombreSeguro = escapeHtml(nombre);
  const correoSeguro = escapeHtml(correo);
  const passwordSeguro = escapeHtml(password);

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Bienvenido a FideColab</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f4f6f9; font-family:Arial, Helvetica, sans-serif; color:#333333;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9; padding:24px 12px;">
      <tr>
        <td align="center">

          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff; border-radius:8px; overflow:hidden;">

            <!-- Header -->
            <tr>
              <td align="center" style="padding:24px 20px; background-color:rgb(19,30,173); color:#ffffff;">
                <img src="${LOGO_URL}" alt="FideColab" width="100" style="width:100px; display:block; margin:0 auto 10px auto; border:0;" />
                <h1 style="margin:0; font-size:24px; font-weight:bold; color:#ffffff;">Bienvenido a FideColab</h1>
              </td>
            </tr>

            <!-- Contenido -->
            <tr>
              <td style="padding:24px 28px; font-size:16px; line-height:1.6; color:#333333;">
                <p style="margin:0 0 14px 0;">Hola ${nombreSeguro},</p>
                <p style="margin:0 0 14px 0;">¡Bienvenido a FideColab! Se ha creado una cuenta para ti.</p>
                <p style="margin:0 0 14px 0;">Tus credenciales de acceso son:</p>
                <p style="margin:0 0 8px 0;"><strong>Correo:</strong> ${correoSeguro}</p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
                  <tr>
                    <td align="center" style="background-color:#f8f9fa; border:1px solid #dee2e6; border-radius:4px; padding:15px; font-size:18px; font-weight:bold; color:#dc3545;">
                      Contraseña: ${passwordSeguro}
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 14px 0;">Te recomendamos cambiar esta contraseña después de iniciar sesión por primera vez.</p>
                <p style="margin:0;">¡Disfruta de la plataforma!</p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding:20px 28px 28px 28px; font-size:14px; color:#888888;">
                <p style="margin:0;">Si tienes problemas para acceder, por favor contacta con nuestro soporte.</p>
              </td>
            </tr>

          </table>

        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Versión en texto plano. Los filtros antispam penalizan los correos
 * que solo traen HTML, así que mandar ambas partes mejora la entrega.
 */
function plantillaBienvenidaTexto({ nombre, correo, password }) {
  return `Hola ${nombre},

¡Bienvenido a FideColab! Se ha creado una cuenta para ti.

Tus credenciales de acceso son:
Correo: ${correo}
Contraseña: ${password}

Te recomendamos cambiar esta contraseña después de iniciar sesión por primera vez.

Si tienes problemas para acceder, contacta con nuestro soporte.`;
}

/**
 * Envía el correo de bienvenida.
 *
 * @param {{ nombre: string, correo: string, password: string }} datos
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
export async function enviarCorreoBienvenida({ nombre, correo, password }) {
  if (!correo) {
    return { ok: false, error: "No se recibió una dirección de destino." };
  }

  try {
    const info = await transporter.sendMail({
      from: remitente,
      to: correo,
      subject: "Bienvenido a FideColab",
      html: plantillaBienvenida({ nombre, correo, password }),
      text: plantillaBienvenidaTexto({ nombre, correo, password }),
    });

    console.log(`[mailer] Bienvenida enviada a ${correo} (id: ${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    // No relanzamos: si falla el correo, el usuario ya quedó creado en la BD.
    // Que no se caiga el endpoint completo por esto.
    console.error(`[mailer] Error enviando bienvenida a ${correo}:`, error.message);
    return { ok: false, error: error.message };
  }
}

export default enviarCorreoBienvenida;