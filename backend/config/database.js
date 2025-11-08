const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'dbairplane',
  password: 'UMES2025', // Cambiar por tu contraseña
  port: 5432,
});

module.exports = pool;
