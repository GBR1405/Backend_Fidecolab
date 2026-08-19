// src/config/emailservice.js
//
// Envío por API HTTP de Mailjet (puerto 443), NO por SMTP.
// Render bloquea los puertos SMTP salientes (25/465/587), por eso no se usa nodemailer acá.

const {
  MJ_API_KEY,
  MJ_SECRET_KEY,
  EMAIL_FROM,
  EMAIL_FROM_NAME = "FideColab",
} = process.env;

const MAILJET_URL = "https://api.mailjet.com/v3.1/send";

// --- Validación al arrancar: mejor enterarse acá que en el primer registro ---
const faltantes = ["MJ_API_KEY", "MJ_SECRET_KEY", "EMAIL_FROM"].filter((k) => !process.env[k]);
if (faltantes.length) {
  console.error(`[mailer] Faltan variables de entorno: ${faltantes.join(", ")}`);
}

// Mailjet autentica con Basic Auth: apiKey:secretKey en base64.
const authHeader =
  MJ_API_KEY && MJ_SECRET_KEY
    ? `Basic ${Buffer.from(`${MJ_API_KEY}:${MJ_SECRET_KEY}`).toString("base64")}`
    : null;

const LOGO_URL =
  "https://cdn.ufidelitas.ac.cr/wp-content/uploads/2023/11/17075151/FideLogo-04.png";

/**
 * Verifica credenciales SIN mandar un correo real.
 * Consulta el endpoint de remitentes: si responde 200, las llaves sirven.
 * Llamalo una vez al levantar el server.
 */
export async function verificarMailjet() {
  if (!authHeader) {
    console.error("[mailer] Sin credenciales de Mailjet configuradas.");
    return false;
  }

  try {
    const res = await fetch("https://api.mailjet.com/v3/REST/sender", {
      headers: { Authorization: authHeader },
    });

    if (!res.ok) {
      console.error(`[mailer] Mailjet rechazó las credenciales (HTTP ${res.status}).`);
      if (res.status === 401) {
        console.error("  -> Revisá MJ_API_KEY y MJ_SECRET_KEY.");
      }
      return false;
    }

    const data = await res.json();
    const remitentes = (data.Data ?? []).map((s) => `${s.Email} [${s.Status}]`);

    console.log(`[mailer] Conexión OK con Mailjet. Remitentes: ${remitentes.join(", ") || "ninguno"}`);

    // El remitente tiene que estar verificado o Mailjet rechaza el envío.
    const activo = (data.Data ?? []).find(
      (s) => s.Email?.toLowerCase() === EMAIL_FROM?.toLowerCase() && s.Status === "Active"
    );
    if (!activo) {
      console.warn(
        `[mailer] OJO: ${EMAIL_FROM} no aparece como remitente Active. ` +
          `Verificalo en Mailjet (Account Settings > Sender addresses) o los envíos van a fallar.`
      );
    }

    return true;
  } catch (error) {
    console.error("[mailer] No se pudo contactar a Mailjet:", error.message);
    return false;
  }
}

/**
 * Escapa caracteres que romperían el HTML si el nombre trae < > & " '
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
 * NOTA: Gmail (sobre todo la app móvil) y Outlook descartan las reglas CSS del <head>.
 * Por eso todo va inline y la estructura usa <table>, que renderiza parejo en todos lados.
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
 * Envía el correo de bienvenida vía API de Mailjet.
 *
 * @param {{ nombre: string, correo: string, password: string }} datos
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
export async function enviarCorreoBienvenida({ nombre, correo, password }) {
  if (!correo) {
    return { ok: false, error: "No se recibió una dirección de destino." };
  }
  if (!authHeader) {
    return { ok: false, error: "Mailjet no está configurado (faltan las llaves)." };
  }

  // Si la API tarda, no dejamos el request colgado indefinidamente.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(MAILJET_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Messages: [
          {
            From: { Email: EMAIL_FROM, Name: EMAIL_FROM_NAME },
            To: [{ Email: correo, Name: nombre || correo }],
            Subject: "Bienvenido a FideColab",
            HTMLPart: plantillaBienvenida({ nombre, correo, password }),
            TextPart: plantillaBienvenidaTexto({ nombre, correo, password }),
          },
        ],
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      // Mailjet devuelve el detalle del error en el body, no solo en el status.
      const detalle = JSON.stringify(data);
      console.error(`[mailer] Mailjet respondió HTTP ${res.status}: ${detalle}`);
      return { ok: false, error: `HTTP ${res.status}: ${detalle}` };
    }

    // Un 200 no garantiza el envío: hay que mirar el Status de cada mensaje.
    const mensaje = data?.Messages?.[0];
    if (mensaje?.Status !== "success") {
      const detalle = JSON.stringify(mensaje?.Errors ?? mensaje);
      console.error(`[mailer] Mailjet no aceptó el mensaje: ${detalle}`);
      return { ok: false, error: detalle };
    }

    const messageId = mensaje?.To?.[0]?.MessageID;
    console.log(`[mailer] Bienvenida enviada a ${correo} (id: ${messageId})`);
    return { ok: true, messageId: String(messageId) };
  } catch (error) {
    const msg = error.name === "AbortError" ? "Timeout contactando a Mailjet" : error.message;
    // No relanzamos: si falla el correo, el usuario ya quedó creado en la BD.
    console.error(`[mailer] Error enviando bienvenida a ${correo}:`, msg);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

export default enviarCorreoBienvenida;