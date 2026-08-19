// src/config/emailservice.js
//
//
// Funciones públicas:
//   verificarMailjet()                     -> chequea credenciales al arrancar
//   enviarCorreoBienvenida({...})          -> alta individual
//   enviarCorreoPasswordReset({...})       -> restablecimiento de contraseña
//   enviarCorreosBienvenidaMasivo([...])   -> alta por lote (carga de estudiantes)

const {
  MJ_API_KEY,
  MJ_SECRET_KEY,
  EMAIL_FROM,
  EMAIL_FROM_NAME = "FideColab",
} = process.env;

const MAILJET_SEND_URL = "https://api.mailjet.com/v3.1/send";
const MAILJET_SENDER_URL = "https://api.mailjet.com/v3/REST/sender";

// Mailjet acepta hasta 50 mensajes por request en la v3.1.
const MAX_POR_LOTE = 50;

const TIMEOUT_MS = 20000;

const LOGO_URL =
  "https://cdn.ufidelitas.ac.cr/wp-content/uploads/2023/11/17075151/FideLogo-04.png";

// --- Validación al arrancar ---
const faltantes = ["MJ_API_KEY", "MJ_SECRET_KEY", "EMAIL_FROM"].filter((k) => !process.env[k]);
if (faltantes.length) {
  console.error(`[mailer] Faltan variables de entorno: ${faltantes.join(", ")}`);
}

const authHeader =
  MJ_API_KEY && MJ_SECRET_KEY
    ? `Basic ${Buffer.from(`${MJ_API_KEY}:${MJ_SECRET_KEY}`).toString("base64")}`
    : null;

// ============================================================================
//  HELPERS
// ============================================================================

/** Escapa caracteres que romperían el HTML si el dato trae < > & " ' */
function escapeHtml(valor = "") {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Parte un array en trozos de tamaño fijo. */
function enLotes(array, tamano) {
  const lotes = [];
  for (let i = 0; i < array.length; i += tamano) {
    lotes.push(array.slice(i, i + tamano));
  }
  return lotes;
}

// ============================================================================
//  PLANTILLAS
// ============================================================================

/**
 * Layout compartido por todos los correos: header azul con logo, cuerpo y footer.
 *
 * NOTA: Gmail (sobre todo la app móvil) y Outlook descartan las reglas CSS del <head>.
 * Por eso todo va inline y la estructura usa <table>, que renderiza parejo en todos lados.
 */
function layoutBase({ titulo, contenido, textoFooter }) {
  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(titulo)}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f4f6f9; font-family:Arial, Helvetica, sans-serif; color:#333333;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9; padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff; border-radius:8px; overflow:hidden;">

            <tr>
              <td align="center" style="padding:24px 20px; background-color:rgb(19,30,173); color:#ffffff;">
                <img src="${LOGO_URL}" alt="FideColab" width="100" style="width:100px; display:block; margin:0 auto 10px auto; border:0;" />
                <h1 style="margin:0; font-size:24px; font-weight:bold; color:#ffffff;">${escapeHtml(titulo)}</h1>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 28px; font-size:16px; line-height:1.6; color:#333333;">
${contenido}
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:20px 28px 28px 28px; font-size:14px; color:#888888;">
                <p style="margin:0;">${escapeHtml(textoFooter)}</p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Recuadro rojo destacado para la contraseña. */
function cajaPassword(password) {
  return `                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
                  <tr>
                    <td align="center" style="background-color:#f8f9fa; border:1px solid #dee2e6; border-radius:4px; padding:15px; font-size:18px; font-weight:bold; color:#dc3545;">
                      ${escapeHtml(password)}
                    </td>
                  </tr>
                </table>`;
}

function plantillaBienvenida({ nombre, correo, password }) {
  return layoutBase({
    titulo: "Bienvenido a FideColab",
    textoFooter: "Si tienes problemas para acceder, por favor contacta con nuestro soporte.",
    contenido: `                <p style="margin:0 0 14px 0;">Hola ${escapeHtml(nombre)},</p>
                <p style="margin:0 0 14px 0;">¡Bienvenido a FideColab! Se ha creado una cuenta para ti.</p>
                <p style="margin:0 0 14px 0;">Tus credenciales de acceso son:</p>
                <p style="margin:0 0 8px 0;"><strong>Correo:</strong> ${escapeHtml(correo)}</p>
${cajaPassword(`Contraseña: ${password}`)}
                <p style="margin:0 0 14px 0;">Te recomendamos cambiar esta contraseña después de iniciar sesión por primera vez.</p>
                <p style="margin:0;">¡Disfruta de la plataforma!</p>`,
  });
}

function plantillaBienvenidaTexto({ nombre, correo, password }) {
  return `Hola ${nombre},

¡Bienvenido a FideColab! Se ha creado una cuenta para ti.

Tus credenciales de acceso son:
Correo: ${correo}
Contraseña: ${password}

Te recomendamos cambiar esta contraseña después de iniciar sesión por primera vez.

Si tienes problemas para acceder, contacta con nuestro soporte.`;
}

function plantillaPasswordReset({ nuevaPassword }) {
  return layoutBase({
    titulo: "Contraseña restablecida - FideColab",
    textoFooter: "Gracias por ser parte de nuestra comunidad.",
    contenido: `                <p style="margin:0 0 14px 0;">Hemos recibido una solicitud para restablecer tu contraseña en FideColab.</p>
${cajaPassword(`Nueva contraseña: ${nuevaPassword}`)}
                <p style="margin:0 0 14px 0;">Por seguridad, te recomendamos cambiar esta contraseña después de iniciar sesión.</p>
                <p style="margin:0;">Si no solicitaste este cambio, por favor contacta al administrador del sistema.</p>`,
  });
}

function plantillaPasswordResetTexto({ nuevaPassword }) {
  return `Hemos recibido una solicitud para restablecer tu contraseña en FideColab.

Nueva contraseña: ${nuevaPassword}

Por seguridad, te recomendamos cambiar esta contraseña después de iniciar sesión.
Si no solicitaste este cambio, contacta al administrador del sistema.`;
}

// ============================================================================
//  NÚCLEO DE ENVÍO
// ============================================================================

/**
 * Manda un lote de mensajes ya armados a Mailjet.
 * Es el único punto del archivo que habla con la API.
 *
 * @param {Array<object>} mensajes - objetos en formato Messages[] de Mailjet v3.1
 * @returns {Promise<{ ok: boolean, resultados: Array<object>, error?: string }>}
 */
async function enviarLote(mensajes) {
  if (!authHeader) {
    return { ok: false, resultados: [], error: "Mailjet no está configurado (faltan las llaves)." };
  }
  if (!mensajes.length) {
    return { ok: true, resultados: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(MAILJET_SEND_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Messages: mensajes }),
    });

    const data = await res.json().catch(() => null);

    // Un 400 acá suele ser remitente no verificado o email de destino inválido.
    if (!res.ok) {
      const detalle = JSON.stringify(data);
      console.error(`[mailer] Mailjet respondió HTTP ${res.status}: ${detalle}`);
      return { ok: false, resultados: [], error: `HTTP ${res.status}: ${detalle}` };
    }

    return { ok: true, resultados: data?.Messages ?? [] };
  } catch (error) {
    const msg = error.name === "AbortError" ? "Timeout contactando a Mailjet" : error.message;
    console.error(`[mailer] Error contactando a Mailjet:`, msg);
    return { ok: false, resultados: [], error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

/** Arma un objeto Message de Mailjet. */
function armarMensaje({ correo, nombre, asunto, html, texto, fromName }) {
  return {
    From: { Email: EMAIL_FROM, Name: fromName || EMAIL_FROM_NAME },
    To: [{ Email: correo, Name: nombre || correo }],
    Subject: asunto,
    HTMLPart: html,
    TextPart: texto,
  };
}

/** Interpreta el resultado de un mensaje individual devuelto por Mailjet. */
function leerResultado(mensaje, correo) {
  // Un HTTP 200 no garantiza el envío: hay que mirar el Status de cada mensaje.
  if (mensaje?.Status !== "success") {
    const detalle = JSON.stringify(mensaje?.Errors ?? mensaje);
    console.error(`[mailer] Mailjet no aceptó el mensaje para ${correo}: ${detalle}`);
    return { ok: false, correo, error: detalle };
  }
  const messageId = mensaje?.To?.[0]?.MessageID;
  return { ok: true, correo, messageId: String(messageId) };
}

// ============================================================================
//  API PÚBLICA
// ============================================================================

/**
 * Verifica credenciales SIN mandar un correo real.
 * Llamalo una vez al levantar el server.
 */
export async function verificarMailjet() {
  if (!authHeader) {
    console.error("[mailer] Sin credenciales de Mailjet configuradas.");
    return false;
  }

  try {
    const res = await fetch(MAILJET_SENDER_URL, {
      headers: { Authorization: authHeader },
    });

    if (!res.ok) {
      console.error(`[mailer] Mailjet rechazó las credenciales (HTTP ${res.status}).`);
      if (res.status === 401) console.error("  -> Revisá MJ_API_KEY y MJ_SECRET_KEY.");
      return false;
    }

    const data = await res.json();
    const remitentes = (data.Data ?? []).map((s) => `${s.Email} [${s.Status}]`);
    console.log(`[mailer] Conexión OK con Mailjet. Remitentes: ${remitentes.join(", ") || "ninguno"}`);

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
 * Correo de bienvenida individual.
 *
 * @param {{ nombre: string, correo: string, password: string }} datos
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
export async function enviarCorreoBienvenida({ nombre, correo, password }) {
  if (!correo) return { ok: false, error: "No se recibió una dirección de destino." };

  const mensaje = armarMensaje({
    correo,
    nombre,
    asunto: "Bienvenido a FideColab",
    html: plantillaBienvenida({ nombre, correo, password }),
    texto: plantillaBienvenidaTexto({ nombre, correo, password }),
  });

  const { ok, resultados, error } = await enviarLote([mensaje]);
  if (!ok) return { ok: false, error };

  const resultado = leerResultado(resultados[0], correo);
  if (resultado.ok) console.log(`[mailer] Bienvenida enviada a ${correo} (id: ${resultado.messageId})`);
  return resultado;
}

/**
 * Correo de contraseña restablecida.
 *
 * @param {{ correo: string, nuevaPassword: string, nombre?: string }} datos
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
export async function enviarCorreoPasswordReset({ correo, nuevaPassword, nombre }) {
  if (!correo) return { ok: false, error: "No se recibió una dirección de destino." };

  const mensaje = armarMensaje({
    correo,
    nombre,
    asunto: "Contraseña restablecida",
    html: plantillaPasswordReset({ nuevaPassword }),
    texto: plantillaPasswordResetTexto({ nuevaPassword }),
    fromName: "Soporte FideColab",
  });

  const { ok, resultados, error } = await enviarLote([mensaje]);
  if (!ok) return { ok: false, error };

  const resultado = leerResultado(resultados[0], correo);
  if (resultado.ok) console.log(`[mailer] Reset enviado a ${correo} (id: ${resultado.messageId})`);
  return resultado;
}

/**
 * Bienvenida masiva para carga de estudiantes.
 * Reemplaza el for con un fetch por estudiante: manda de a 50 por request.
 *
 * @param {Array<{ name: string, email: string, generatedPassword: string }>} estudiantes
 * @returns {Promise<{ enviados: number, fallidos: number, detalles: Array<object> }>}
 */
export async function enviarCorreosBienvenidaMasivo(estudiantes = []) {
  const validos = estudiantes.filter((e) => e?.email);
  const descartados = estudiantes.length - validos.length;
  if (descartados > 0) {
    console.warn(`[mailer] Se descartaron ${descartados} estudiante(s) sin correo.`);
  }
  if (!validos.length) return { enviados: 0, fallidos: 0, detalles: [] };

  const detalles = [];

  for (const lote of enLotes(validos, MAX_POR_LOTE)) {
    const mensajes = lote.map((est) =>
      armarMensaje({
        correo: est.email,
        nombre: est.name,
        asunto: "Bienvenido a FideColab",
        html: plantillaBienvenida({
          nombre: est.name,
          correo: est.email,
          password: est.generatedPassword,
        }),
        texto: plantillaBienvenidaTexto({
          nombre: est.name,
          correo: est.email,
          password: est.generatedPassword,
        }),
      })
    );

    const { ok, resultados, error } = await enviarLote(mensajes);

    if (!ok) {
      // Falló el lote entero: marcamos a todos como fallidos y seguimos con el siguiente.
      lote.forEach((est) => detalles.push({ ok: false, correo: est.email, error }));
      continue;
    }

    // Mailjet devuelve los resultados en el mismo orden que se enviaron.
    lote.forEach((est, i) => detalles.push(leerResultado(resultados[i], est.email)));
  }

  const enviados = detalles.filter((d) => d.ok).length;
  const fallidos = detalles.length - enviados;
  console.log(`[mailer] Envío masivo: ${enviados} enviados, ${fallidos} fallidos.`);

  return { enviados, fallidos, detalles };
}

export default {
  verificarMailjet,
  enviarCorreoBienvenida,
  enviarCorreoPasswordReset,
  enviarCorreosBienvenidaMasivo,
};