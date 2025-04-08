// server.js
const express = require('express');
const axios = require('axios'); // Importar axios
const scrapeMilanuncios = require('./scrap');

const app = express();
const port = process.env.PORT || 3000;

app.get('/scrape', async (req, res) => {
  try {
    // Extrae los parámetros de búsqueda desde la query string
    const searchParams = req.query;
    console.log('Parámetros recibidos:', searchParams);

    // Llama a la función de scraping con los parámetros recibidos
    const data = await scrapeMilanuncios(searchParams);

    // Enviar la data al flujo de n8n
    const n8nWebhookUrl = 'https://n8n.sitemaster.lat/webhook/leotest'; // Reemplaza con tu URL real
    //await axios.post(n8nWebhookUrl, data, {
    await axios.post(n8nWebhookUrl, { body: data }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('Datos enviados exitosamente al flujo de n8n');

    // Responder al cliente
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error en scraping o envío a n8n:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
});