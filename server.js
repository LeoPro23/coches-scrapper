const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const scrapeCoches = require('./scraper-coches');

const app = express();
const port = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());

// Middleware para servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principal - Servir el archivo HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint para la búsqueda directa (envía consulta a n8n)
app.post('/search', async (req, res) => {
  try {
    //const { query } = req.query;
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ success: false, error: 'No se proporcionó consulta de búsqueda' });
    }
    
    console.log('Consulta recibida:', query);
    
    // Enviar consulta al flujo de n8n para obtener la URL
    const n8nBuscarUrl = 'https://n8n.sitemaster.lat/webhook/cochesnet'; // Actualiza con tu URL real
    const n8nResponse = await axios.post(n8nBuscarUrl, { query }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!n8nResponse.data || !n8nResponse.data.url) {
      return res.status(400).json({ 
        success: false, 
        error: 'No se pudo generar una URL válida para la búsqueda' 
      });
    }
    
    // Obtener la URL generada por n8n
    const searchUrl = n8nResponse.data.url;
    console.log('URL generada:', searchUrl);
    
    // Realizar scraping con la URL generada
    const scrapedData = await scrapeCoches(searchUrl);
    
    // Enviar datos al flujo de n8n para guardar en Google Sheets
    const n8nGuardarUrl = 'https://n8n.sitemaster.lat/webhook/cochesguardar'; // Actualiza con tu URL real
    await axios.post(n8nGuardarUrl, { body: scrapedData }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // Devolver resultados al cliente
    res.json({ success: true, data: scrapedData });
  } catch (error) {
    console.error('Error en la búsqueda:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al procesar la búsqueda' 
    });
  }
});

// Ruta alternativa para pruebas que usa directamente una URL sin n8n
app.get('/scrape-direct', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ success: false, error: 'No se proporcionó URL' });
    }
    
    console.log('URL recibida para scraping directo:', url);
    
    // Ejecutar scraping con la URL proporcionada
    const data = await scrapeCoches(url);
    
    // Responder al cliente
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error en scraping directo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Servir archivos estáticos si no se encuentran rutas específicas
app.use((req, res, next) => {
  const filePath = path.join(__dirname, 'public', req.path);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  next();
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
  console.log(`Accede a: http://localhost:${port}`);
});