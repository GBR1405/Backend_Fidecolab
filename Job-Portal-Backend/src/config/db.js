import sql from 'mssql';

const config = {
  user: 'FideColab',  
  password: 'FideColab',  
  server: 'localhost',  // Nombre del servidor de SQL Server
  database: 'FideColab',  // Nombre de la base de datos 
  options: {
    encrypt: true,  
    trustServerCertificate: true,  
  },
};

// Crear el pool de conexiones
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
