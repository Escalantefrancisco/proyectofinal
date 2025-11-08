require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const pool = require('./config/database');
const { createTransporter } = require('./config/mail.config');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// NUEVO: Variable global para el transporter
let transporter = null;

// NUEVO: Inicializar transporter al arrancar
(async () => {
  try {
    transporter = await createTransporter();
    if (transporter) {
      console.log('✓ Transporter de correo inicializado correctamente');
    } else {
      console.warn('⚠ No se pudo inicializar el transporter de correo');
    }
  } catch (err) {
    console.error('✗ Error inicializando transporter:', err.message);
  }
})();

// Función para enviar correo de confirmación usando Gmail
async function sendConfirmationEmail(toEmail, token) {
  try {
    const transporter = await createTransporter();
    if (!transporter) {
      throw new Error('No se pudo crear el transportador de correo');
    }

    const confirmUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/confirm?token=${token}`;
    
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: toEmail,
      subject: 'Confirma tu cuenta - Airplane Reservations',
      html: `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Bienvenido a Airplane Reservations</h2>
          <p>Gracias por registrarte. Para completar tu registro, haz clic en el siguiente enlace:</p>
          <p style="margin: 20px 0;">
            <a href="${confirmUrl}" 
               style="background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
              Confirmar mi cuenta
            </a>
          </p>
          <p>Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
          <p>${confirmUrl}</p>
          <p>Este enlace expirará en 24 horas.</p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email enviado:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('Error enviando correo:', err);
    return { success: false, error: err.message };
  }
}

// Middleware para logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

app.use(cors());
app.use(express.json());

// Registro de usuario con envío de correo de confirmación
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    if (!email.match(/@(gmail\.com|outlook\.com)$/)) {
      return res.status(400).json({ error: 'Email debe ser de gmail.com o outlook.com' });
    }

    console.log('Intentando registrar usuario:', email);

    const confirmationToken = jwt.sign(
      { email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, confirmation_token, email_confirmed) VALUES ($1, $2, $3, $4) RETURNING id, email',
      [email, hashedPassword, confirmationToken, false]
    );

    // Enviar correo de confirmación
    const emailResult = await sendConfirmationEmail(email, confirmationToken);
    
    if (!emailResult.success) {
      // Si falla el envío, eliminar el usuario y notificar
      await pool.query('DELETE FROM users WHERE id = $1', [result.rows[0].id]);
      return res.status(500).json({ 
        error: 'Error al enviar correo de confirmación. Por favor, intenta más tarde.' 
      });
    }

    res.json({
      success: true,
      message: 'Por favor, revisa tu correo para confirmar tu cuenta.',
      user: { id: result.rows[0].id, email: result.rows[0].email }
    });

  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para confirmar correo
app.get('/api/confirm', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send('Token requerido');

    const result = await pool.query('SELECT id, email_confirmed FROM users WHERE confirmation_token = $1', [token]);
    if (result.rows.length === 0) {
      return res.status(400).send('Token inválido o caducado');
    }

    const user = result.rows[0];
    if (user.email_confirmed) {
      return res.send('Correo ya confirmado');
    }

    await pool.query('UPDATE users SET email_confirmed = TRUE, confirmation_token = NULL WHERE id = $1', [user.id]);
    // Puedes redirigir a una página de frontend de éxito; por ahora devolver texto
    res.send('Correo confirmado correctamente. Ya puedes iniciar sesión.');
  } catch (err) {
    console.error('Error confirmando correo:', err);
    res.status(500).send('Error interno');
  }
});

// Login de usuario
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const user = result.rows[0];

    if (!user.email_confirmed) {
      return res.status(403).json({ error: 'Correo no confirmado. Revisa tu email.' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const authenticate = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No autorizado' });
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'Token inválido' });
  try {
    const payload = jwt.verify(parts[1], JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// Listar vuelos
app.get('/api/flights', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, flight_code, departure_date, origin, destination, business_price, economy_price, total_rows, notes FROM flights ORDER BY departure_date DESC');
    res.json({ flights: result.rows });
  } catch (err) {
    console.error('Error fetching flights:', err);
    res.status(500).json({ error: 'Error al obtener vuelos' });
  }
});

// Listar asientos de un vuelo
app.get('/api/flights/:id/seats', async (req, res) => {
  try {
    const flightId = parseInt(req.params.id, 10);
    const result = await pool.query('SELECT id, seat_number, seat_class, is_occupied FROM seats WHERE flight_id = $1 ORDER BY seat_number', [flightId]);
    res.json({ seats: result.rows });
  } catch (err) {
    console.error('Error fetching seats:', err);
    res.status(500).json({ error: 'Error al obtener asientos' });
  }
});

// Función auxiliar para validar CUI guatemalteco
function validarCUI(cui) {
  if (!cui) return false;
  cui = cui.replace(/\s/g, '');
  if (!/^\d{13}$/.test(cui)) return false;
  
  const depto = parseInt(cui.substring(9, 11), 10);
  const muni = parseInt(cui.substring(11, 13), 10);
  const munisPorDepto = [17, 8, 16, 16, 13, 14, 19, 8, 24, 21, 9, 30, 32, 21, 8, 17, 14, 5, 11, 11, 7, 17];
  
  if (depto === 0 || muni === 0 || depto > munisPorDepto.length || muni > munisPorDepto[depto - 1]) {
    return false;
  }
  
  const numero = cui.substring(0, 8);
  const verificador = parseInt(cui.substring(8, 9), 10);
  let total = 0;
  for (let i = 0; i < numero.length; i++) {
    total += parseInt(numero[i], 10) * (i + 2);
  }
  
  return (total % 11) === verificador;
}

// Función para enviar correo de reserva
async function enviarCorreoReserva(email, detalles) {
  try {
    // CORREGIDO: Inicializar transporter si no existe
    if (!transporter) {
      console.warn('⚠ Transporter no inicializado, intentando crear uno nuevo...');
      try {
        transporter = await createTransporter();
      } catch (err) {
        console.error('✗ No se pudo crear transporter:', err);
        return { success: false, error: 'Servicio de correo no disponible' };
      }
    }

    if (!transporter) {
      console.warn('⚠ Transporter no configurado, saltando envío de correo');
      return { success: false, error: 'Transporter no configurado' };
    }

    const asientosHTML = detalles.asientos.map(a => 
      `<li>Asiento: ${a.seat_number} - Reservado: ${a.reserved_at}</li>`
    ).join('');

    const mailOptions = {
      from: process.env.GMAIL_USER || process.env.EMAIL_USER || 'noreply@airline.com',
      to: email,
      subject: 'Confirmación de Reserva de Vuelo',
      html: `
        <h2>Confirmación de Reserva</h2>
        <p><strong>Vuelo:</strong> #${detalles.vuelo}</p>
        <p><strong>Clase:</strong> ${detalles.clase || 'N/A'}</p>
        <p><strong>Cantidad de asientos:</strong> ${detalles.cantidad}</p>
        <h3>Asientos reservados:</h3>
        <ul>${asientosHTML}</ul>
        <p><strong>Precio por asiento:</strong> Q${(detalles.precio_unitario || 0).toFixed(2)}</p>
        <p><strong>Total:</strong> Q${(detalles.total || 0).toFixed(2)}</p>
        <p>Gracias por tu reserva.</p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✓ Correo de reserva enviado:', info.messageId);
    return { success: true, info };
  } catch (error) {
    console.error('✗ Error enviando correo de reserva:', error.message);
    return { success: false, error: error.message };
  }
}

// POST /api/reservations - Crear reserva múltiple
app.post('/api/reservations', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.userId;
    const { flight_id, cantidad, seat_class, seleccion_manual, asientos, email } = req.body;

    console.log('POST /api/reservations - Datos recibidos:', { 
      userId, 
      flight_id, 
      cantidad, 
      seat_class, 
      seleccion_manual, 
      asientos_count: asientos?.length,
      email 
    });

    // Validaciones básicas
    if (!flight_id || !cantidad || !seat_class || typeof seleccion_manual === 'undefined') {
      console.error('Datos incompletos:', { flight_id, cantidad, seat_class, seleccion_manual });
      return res.status(400).json({ error: 'Datos incompletos para la reserva' });
    }

    if (!asientos || !Array.isArray(asientos) || asientos.length === 0) {
      console.error('Array de asientos inválido');
      return res.status(400).json({ error: 'Debe proporcionar al menos un asiento' });
    }

    await client.query('BEGIN');
    console.log('Transacción iniciada');

    // CORREGIDO: Obtener precios del vuelo, no de los asientos individuales
    const flightResult = await client.query(
      'SELECT business_price, economy_price FROM flights WHERE id = $1',
      [flight_id]
    );

    if (flightResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Vuelo no encontrado' });
    }

    const flightData = flightResult.rows[0];
    const precioUnitario = seat_class === 'business' 
      ? parseFloat(flightData.business_price) 
      : parseFloat(flightData.economy_price);

    if (isNaN(precioUnitario) || precioUnitario <= 0) {
      await client.query('ROLLBACK');
      console.error('Precio inválido para la clase:', { seat_class, precioUnitario });
      return res.status(500).json({ error: 'Precio de vuelo inválido' });
    }

    console.log('Precio unitario obtenido:', precioUnitario, 'para clase:', seat_class);

    // Calcular precio total y validar asientos
    let totalPrice = 0;
    const detallesAsientos = [];

    for (let i = 0; i < asientos.length; i++) {
      const asiento = asientos[i];
      const { seat_id, passenger_name, cui_full, has_luggage } = asiento;

      console.log(`Procesando asiento ${i + 1}:`, { seat_id, passenger_name, cui_full });

      if (!seat_id || !passenger_name || !cui_full) {
        await client.query('ROLLBACK');
        console.error('Datos incompletos en asiento:', asiento);
        return res.status(400).json({ error: `Datos incompletos en asiento ${i + 1}` });
      }

      // Validar CUI
      if (!validarCUI(cui_full)) {
        await client.query('ROLLBACK');
        console.error('CUI inválido:', cui_full);
        return res.status(400).json({ error: `CUI inválido para ${passenger_name}` });
      }

      // CORREGIDO: Verificar solo que el asiento existe y está disponible (sin pedir precios)
      const seatCheck = await client.query(
        'SELECT id, seat_number, seat_class, is_occupied FROM seats WHERE id = $1 AND flight_id = $2',
        [seat_id, flight_id]
      );

      if (seatCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        console.error('Asiento no encontrado:', { seat_id, flight_id });
        return res.status(404).json({ error: `Asiento ${seat_id} no encontrado` });
      }

      const seatData = seatCheck.rows[0];

      if (seatData.is_occupied) {
        await client.query('ROLLBACK');
        console.error('Asiento ocupado:', seatData.seat_number);
        return res.status(409).json({ error: `Asiento ${seatData.seat_number} ya está ocupado` });
      }

      // Validar que la clase del asiento coincida con la solicitada
      if (seatData.seat_class !== seat_class) {
        await client.query('ROLLBACK');
        console.error('Clase de asiento no coincide:', { 
          seat_number: seatData.seat_number, 
          seat_class_db: seatData.seat_class, 
          seat_class_requested: seat_class 
        });
        return res.status(400).json({ 
          error: `Asiento ${seatData.seat_number} es de clase ${seatData.seat_class}, no ${seat_class}` 
        });
      }

      // CORREGIDO: Usar el precio del vuelo para todos los asientos
      totalPrice += precioUnitario;

      detallesAsientos.push({
        seat_id,
        seat_number: seatData.seat_number,
        passenger_name,
        cui_full,
        has_luggage: !!has_luggage,
        price: precioUnitario
      });
    }

    console.log('Precio total calculado:', totalPrice, 'para', detallesAsientos.length, 'asientos');

    // Crear reservation_group
    const insertGroupQuery = `
      INSERT INTO reservation_groups (user_id, flight_id, created_at, status, total_price, seleccion_manual)
      VALUES ($1, $2, NOW(), 'active', $3, $4) 
      RETURNING id
    `;
    const groupResult = await client.query(insertGroupQuery, [userId, flight_id, totalPrice, !!seleccion_manual]);
    const reservationGroupId = groupResult.rows[0].id;

    console.log('Grupo de reserva creado con ID:', reservationGroupId);

    // CORREGIDO: Insertar reservation_items con reservation_date y reserved_at
    for (const detalle of detallesAsientos) {
      const insertItemQuery = `
        INSERT INTO reservation_items (
          reservation_group_id, 
          seat_id, 
          passenger_name, 
          cui_full, 
          has_luggage, 
          price, 
          reserved_at,
          reservation_date
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      `;
      await client.query(insertItemQuery, [
        reservationGroupId,
        detalle.seat_id,
        detalle.passenger_name,
        detalle.cui_full,
        detalle.has_luggage,
        detalle.price
      ]);

      // Marcar asiento como ocupado
      await client.query('UPDATE seats SET is_occupied = TRUE WHERE id = $1', [detalle.seat_id]);
      console.log('Asiento marcado como ocupado:', detalle.seat_id);
    }

    await client.query('COMMIT');
    console.log('Transacción completada exitosamente');

    // Enviar correo
    const userEmail = email || req.user.email;
    console.log('Intentando enviar correo a:', userEmail);

    const emailResult = await enviarCorreoReserva(userEmail, {
      vuelo: flight_id,
      clase: seat_class,
      cantidad: detallesAsientos.length,
      asientos: detallesAsientos.map(d => ({ 
        seat_number: d.seat_number, 
        reserved_at: new Date().toISOString() 
      })),
      precio_unitario: precioUnitario,
      total: totalPrice
    });

    if (!emailResult.success) {
      console.warn('Error enviando correo, pero reserva creada:', emailResult.error);
    }

    res.json({
      success: true,
      reservation_group_id: reservationGroupId,
      detalles: detallesAsientos,
      precio_unitario: precioUnitario,
      total: totalPrice,
      email_sent: emailResult.success,
      email_error: emailResult.success ? null : emailResult.error
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error crítico en /api/reservations:', err);
    console.error('Stack trace:', err.stack);
    res.status(500).json({ 
      error: 'Error al crear la reserva', 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    client.release();
  }
});

// --- NUEVO: endpoint para reintentar envío de correo para una reserva existente ---
app.post('/api/reservations/:id/resend-email', authenticate, async (req, res) => {
  const reservationId = parseInt(req.params.id, 10);
  if (!reservationId) return res.status(400).json({ error: 'Reservation id requerido' });

  const client = await pool.connect();
  try {
    // Obtener grupo de reserva
    const grpRes = await client.query('SELECT id, user_id, flight_id, total_price FROM reservation_groups WHERE id = $1', [reservationId]);
    if (grpRes.rows.length === 0) return res.status(404).json({ error: 'Reserva no encontrada' });
    const group = grpRes.rows[0];

    // permitir solo al propietario (o ampliar para admin si necesario)
    if (req.user.userId !== group.user_id) {
      return res.status(403).json({ error: 'No autorizado para reintentar el correo de esta reserva' });
    }

    // Obtener items y números de asiento
    const itemsRes = await client.query(
      `SELECT ri.seat_id, ri.passenger_name, ri.cui_full, ri.has_luggage, ri.price, ri.reserved_at, s.seat_number
       FROM reservation_items ri
       JOIN seats s ON s.id = ri.seat_id
       WHERE ri.reservation_group_id = $1`,
      [reservationId]
    );
    const detallesAsientos = (itemsRes.rows || []).map(r => ({
      seat_number: r.seat_number,
      reserved_at: r.reserved_at
    }));

    // Determinar email destino (usar email del usuario asociado)
    const userRes = await client.query('SELECT email FROM users WHERE id = $1', [group.user_id]);
    const recipient = (userRes.rows[0] && userRes.rows[0].email) ? userRes.rows[0].email : (req.user.email || null);
    if (!recipient) {
      return res.status(400).json({ error: 'No hay email disponible para reenviar' });
    }

    // Reconstruir detalles para el correo
    const detalles = {
      vuelo: group.flight_id,
      clase: null, // opcional, no imprescindible para reenviar
      cantidad: detallesAsientos.length,
      asientos: detallesAsientos,
      precio_unitario: group.total_price ? (group.total_price / Math.max(1, detallesAsientos.length)) : undefined,
      total: group.total_price
    };

    const emailResult = await enviarCorreoReserva(recipient, detalles);

    if (!emailResult.success) {
      console.error('Error reintentando correo de reserva:', emailResult.error);
      return res.status(500).json({ success: false, error: 'No se pudo reenviar el correo', details: emailResult.error });
    }

    return res.json({ success: true, message: 'Correo reenviado correctamente' });
  } catch (err) {
    console.error('Error en resend-email:', err);
    return res.status(500).json({ error: 'Error al reenviar correo', details: err.message });
  } finally {
    client.release();
  }
});

// --- NUEVO: endpoint para obtener reservas del usuario autenticado ---
app.get('/api/reservations', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Obtener grupos de reserva del usuario
    const groupsResult = await pool.query(
      `SELECT id, flight_id, created_at, status, total_price 
       FROM reservation_groups 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    const groups = groupsResult.rows;

    // Para cada grupo, obtener sus items (asientos y pasajeros)
    const reservations = await Promise.all(
      groups.map(async (group) => {
        const itemsResult = await pool.query(
          `SELECT ri.id, ri.seat_id, ri.passenger_name, ri.cui_full, ri.has_luggage, 
                  ri.price, ri.reserved_at, s.seat_number, s.seat_class
           FROM reservation_items ri
           JOIN seats s ON s.id = ri.seat_id
           WHERE ri.reservation_group_id = $1
           ORDER BY ri.id`,
          [group.id]
        );

        return {
          id: group.id,
          flight_id: group.flight_id,
          created_at: group.created_at,
          status: group.status,
          total_price: group.total_price,
          items: itemsResult.rows
        };
      })
    );

    res.json({ reservations });
  } catch (err) {
    console.error('Error obteniendo reservas:', err);
    res.status(500).json({ error: 'Error al obtener reservas', details: err.message });
  }
});

// --- NUEVO: endpoint para obtener estadísticas del sistema ---
app.get('/api/statistics', authenticate, async (req, res) => {
  try {
    const client = await pool.connect();
    
    // 1. Cantidad de usuarios creados (confirmados)
    const usersResult = await client.query('SELECT COUNT(*) as total FROM users WHERE email_confirmed = TRUE');
    const totalUsers = parseInt(usersResult.rows[0].total, 10);

    // 2. Cantidad de reservas por usuario (grupos de reserva)
    const reservationsByUserResult = await client.query(`
      SELECT u.email, COUNT(DISTINCT rg.id) as total_reservations
      FROM users u
      LEFT JOIN reservation_groups rg ON u.id = rg.user_id
      WHERE u.email_confirmed = TRUE
      GROUP BY u.id, u.email
      ORDER BY total_reservations DESC
    `);

    // 3. Cantidad de asientos seleccionados por usuario (suma de items por usuario)
    const seatsByUserResult = await client.query(`
      SELECT u.email, COUNT(ri.id) as total_seats
      FROM users u
      LEFT JOIN reservation_groups rg ON u.id = rg.user_id
      LEFT JOIN reservation_items ri ON rg.id = ri.reservation_group_id
      WHERE u.email_confirmed = TRUE
      GROUP BY u.id, u.email
      ORDER BY total_seats DESC
    `);

    // 4. Estadísticas de asientos por vuelo (sumar todos los vuelos)
    const seatsStatsResult = await client.query(`
      SELECT 
        seat_class,
        is_occupied,
        COUNT(*) as total
      FROM seats
      GROUP BY seat_class, is_occupied
    `);

    // Calcular totales por clase
    let businessOccupied = 0, businessFree = 0, economyOccupied = 0, economyFree = 0;
    seatsStatsResult.rows.forEach(row => {
      const count = parseInt(row.total, 10);
      if (row.seat_class === 'business') {
        if (row.is_occupied) businessOccupied += count;
        else businessFree += count;
      } else if (row.seat_class === 'economy') {
        if (row.is_occupied) economyOccupied += count;
        else economyFree += count;
      }
    });

    // 5. Cantidad de reservas (grupos) totales
    const totalReservationsResult = await client.query('SELECT COUNT(*) as total FROM reservation_groups');
    const totalReservations = parseInt(totalReservationsResult.rows[0].total, 10);

    // 6. Asientos por tipo de selección (manual vs automático)
    const selectionTypeResult = await client.query(`
      SELECT 
        COALESCE(seleccion_manual, TRUE) as manual,
        COUNT(*) as total_groups,
        SUM((SELECT COUNT(*) FROM reservation_items WHERE reservation_group_id = reservation_groups.id)) as total_seats
      FROM reservation_groups
      GROUP BY COALESCE(seleccion_manual, TRUE)
    `);

    let manualSelection = 0, automaticSelection = 0;
    selectionTypeResult.rows.forEach(row => {
      const seats = parseInt(row.total_seats, 10) || 0;
      if (row.manual) manualSelection += seats;
      else automaticSelection += seats;
    });

    // 7. Asientos modificados y cancelados (basado en status)
    const statusResult = await client.query(`
      SELECT status, COUNT(*) as total
      FROM reservation_groups
      GROUP BY status
    `);

    let cancelled = 0, modified = 0, active = 0;
    statusResult.rows.forEach(row => {
      const count = parseInt(row.total, 10);
      if (row.status === 'cancelled') cancelled += count;
      else if (row.status === 'modified') modified += count;
      else if (row.status === 'active') active += count;
    });

    client.release();

    res.json({
      totalUsers,
      reservationsByUser: reservationsByUserResult.rows,
      seatsByUser: seatsByUserResult.rows, // NUEVO
      seats: {
        business: {
          occupied: businessOccupied,
          free: businessFree,
          total: businessOccupied + businessFree
        },
        economy: {
          occupied: economyOccupied,
          free: economyFree,
          total: economyOccupied + economyFree
        }
      },
      totalReservations,
      selectionType: {
        manual: manualSelection,
        automatic: automaticSelection
      },
      reservationStatus: {
        active,
        modified,
        cancelled
      }
    });
  } catch (err) {
    console.error('Error obteniendo estadísticas:', err);
    res.status(500).json({ error: 'Error al obtener estadísticas', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
