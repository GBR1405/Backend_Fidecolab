import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();

// Configuración de la conexión a la base de datos

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log('Conexión a la base de datos exitosa');
    return pool;
  })
  .catch(err => {
    console.error('Error al conectar con la base de datos:', err.message);
    process.exit(1);  
  });


export { sql, poolPromise };
