// scrap.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');

// Importamos la función para resolver el CAPTCHA
const { solveCaptcha } = require('./captchaSolver');

// Crear directorio para capturas si no existe
const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir);
}

// Función de delay con variación para parecer más humano
function sleep(ms) {
  const jitter = Math.floor(Math.random() * 100);
  return new Promise(resolve => setTimeout(resolve, ms + jitter));
}

// Auto-scroll exhaustivo para cargar todos los elementos
async function exhaustiveScroll(page) {
  console.log('Iniciando scroll exhaustivo para cargar todos los elementos...');
  
  try {
    // Primer enfoque: scroll simple hasta el final
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 300;
        let iterations = 0;
        const maxIterations = 50; // Límite de seguridad
        
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          iterations++;
          
          // Verificar si llegamos al final o alcanzamos el límite
          if (window.innerHeight + window.scrollY >= document.body.scrollHeight || iterations >= maxIterations) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    });
    
    // Esperar a que se carguen elementos adicionales
    await sleep(2000);
    
    console.log('Realizando un segundo scroll para cargar elementos rezagados...');
    
    // Segundo enfoque: scroll más lento para asegurar que se carguen todos los elementos
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        // Primero, volver al principio
        window.scrollTo(0, 0);
        
        setTimeout(async () => {
          const height = document.body.scrollHeight;
          const scrollStep = Math.floor(height / 20); // Dividir la altura en 20 pasos
          
          // Scroll paso a paso con pausa entre cada paso
          for (let i = 0; i < 20; i++) {
            window.scrollBy(0, scrollStep);
            await new Promise(r => setTimeout(r, 400)); // Esperar 400ms entre scrolls
          }
          
          // Scroll final al fondo
          window.scrollTo(0, height);
          setTimeout(resolve, 1000);
        }, 500);
      });
    });
    
    // Esperar para asegurar que la carga de AJAX termine
    await sleep(2000);
    
    // Tercer enfoque: click en "mostrar más" o botones de paginación si existen
    try {
      const loadMoreSelectors = [
        'button[class*="more"]', 
        'a[class*="more"]', 
        '[class*="load-more"]', 
        '[class*="show-more"]',
        'button[class*="siguiente"]',
        'a[class*="siguiente"]',
        '.pagination a[class*="next"]',
        'button[class*="next"]'
      ];
      
      for (const selector of loadMoreSelectors) {
        const hasMoreButton = await page.evaluate((sel) => {
          const elements = document.querySelectorAll(sel);
          return elements.length > 0;
        }, selector);
        
        if (hasMoreButton) {
          console.log(`Encontrado botón "mostrar más" o paginación: ${selector}`);
          
          // Contar cuántos elementos tenemos antes de hacer clic
          const countBefore = await page.evaluate((articleSelector) => {
            return document.querySelectorAll(articleSelector).length;
          }, 'article, [class*="AdCard"], [class*="result-item"]');
          
          console.log(`Elementos antes de hacer clic: ${countBefore}`);
          
          // Hacer clic en el botón
          await page.click(selector);
          await sleep(3000); // Esperar a que carguen más elementos
          
          // Contar cuántos elementos tenemos después de hacer clic
          const countAfter = await page.evaluate((articleSelector) => {
            return document.querySelectorAll(articleSelector).length;
          }, 'article, [class*="AdCard"], [class*="result-item"]');
          
          console.log(`Elementos después de hacer clic: ${countAfter}`);
          
          // Si cargaron más elementos, seguir haciendo clic hasta que no aumenten
          if (countAfter > countBefore) {
            let previousCount = countAfter;
            let attempts = 0;
            
            while (attempts < 5) { // Máximo 5 intentos
              const stillHasButton = await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                return btn && (btn.offsetParent !== null); // Verificar que es visible
              }, selector);
              
              if (!stillHasButton) break;
              
              console.log('Haciendo clic para cargar más elementos...');
              await page.click(selector).catch(() => {}); // Ignorar errores de clic
              await sleep(3000);
              
              // Contar nuevamente
              const newCount = await page.evaluate((articleSelector) => {
                return document.querySelectorAll(articleSelector).length;
              }, 'article, [class*="AdCard"], [class*="result-item"]');
              
              console.log(`Elementos después del clic adicional: ${newCount}`);
              
              // Si no aumentaron, salir del bucle
              if (newCount <= previousCount) {
                attempts++;
              } else {
                previousCount = newCount;
                attempts = 0;
              }
            }
          }
          
          break; // Si encontramos un botón funcional, salir del bucle
        }
      }
    } catch (e) {
      console.log('Error al intentar cargar más elementos:', e.message);
    }
    
    console.log('Scroll exhaustivo completado.');
    return true;
  } catch (error) {
    console.error('Error en exhaustiveScroll:', error.message);
    return false;
  }
}

// Verificar cuántos elementos hay visibles en la página
async function countVisibleElements(page) {
  try {
    const selectors = [
      'article.ma-AdCardV2',
      'article[class*="AdCard"]',
      'article',
      '.ma-AdCardV2',
      '[class*="AdCard"]',
      '[class*="listing-item"]',
      '[class*="result-item"]'
    ];
    
    let totalElements = 0;
    
    for (const selector of selectors) {
      const count = await page.evaluate((sel) => {
        return document.querySelectorAll(sel).length;
      }, selector);
      
      console.log(`Selector "${selector}": ${count} elementos`);
      totalElements = Math.max(totalElements, count);
    }
    
    console.log(`Total de elementos detectados: ${totalElements}`);
    return totalElements;
  } catch (error) {
    console.error('Error al contar elementos:', error.message);
    return 0;
  }
}

// Construir URL de búsqueda
function buildUrl(params = {}) {
  const baseUrl = 'https://www.milanuncios.com/motor/';
  const url = new URL(baseUrl);
  Object.keys(params).forEach(key => {
    url.searchParams.append(key, params[key]);
  });
  return url.toString();
}

// Función para añadir agentes de usuario aleatorios
function getRandomUserAgent() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 Edg/117.0.2045.60',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 OPR/102.0.0.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  ];
  
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Función para manejar cookies y consentimiento
async function handleCookiesConsent(page) {
  try {
    console.log('Buscando y manejando diálogos de cookies...');
    
    // Esperar por diferentes tipos de botones de aceptar cookies
    const cookieSelectors = [
      'button[id*="accept"]', 
      'button[id*="cookie"]',
      'button[id*="consent"]',
      'button[class*="cookie"]',
      'button[class*="consent"]',
      'a[id*="accept"]',
      '.cookie-consent-accept',
      '.accept-cookies',
      '[data-testid="cookie-policy-dialog-accept-button"]'
    ];
    
    // Intentar cada selector
    for (const selector of cookieSelectors) {
      try {
        const cookieButton = await page.$(selector);
        if (cookieButton) {
          console.log(`Encontrado botón de cookies: ${selector}`);
          
          // Hacer clic con cierto retraso
          await cookieButton.click({ delay: 100 });
          console.log('Cookies aceptadas.');
          
          await sleep(1000);
          return true;
        }
      } catch (e) {
        console.log(`Error al intentar con selector ${selector}: ${e.message}`);
      }
    }
    
    // Intento alternativo: buscar por texto
    try {
      const buttons = await page.$$('button');
      for (const button of buttons) {
        const text = await page.evaluate(el => el.innerText.toLowerCase(), button);
        if (text.includes('accept') || text.includes('acepto') || text.includes('aceptar')) {
          console.log(`Encontrado botón por texto: "${text}"`);
          await button.click({ delay: 100 });
          console.log('Cookies aceptadas por texto.');
          await sleep(1000);
          return true;
        }
      }
    } catch (e) {
      console.log(`Error buscando por texto: ${e.message}`);
    }
    
    console.log('No se encontraron diálogos de cookies o ya estaban aceptadas.');
    return false;
  } catch (error) {
    console.log('Error al manejar cookies, continuando:', error.message);
    return false;
  }
}

// Función para extraer datos con lógica corregida (más similar a V3)
async function extractData(page) {
  try {
      console.log('Extrayendo información de los artículos...');

      // *** CORRECCIÓN 1: Priorizar el selector específico ***
      // Usaremos principalmente 'article.ma-AdCardV2' como en V3, pero mantenemos un fallback.
      const primaryArticleSelector = 'article.ma-AdCardV2';
      let articleSelector = primaryArticleSelector;

      let articlesFound = await page.evaluate((sel) => {
          return document.querySelectorAll(sel).length;
      }, articleSelector);

      console.log(`Selector primario "${articleSelector}": ${articlesFound} elementos`);

      // Fallback si el selector primario no funciona
      if (articlesFound < 5) { // Umbral bajo, si hay muy pocos, probar otro
           const fallbackSelectors = [
               'article[class*="AdCard"]', // Segundo más probable
               '[class*="AdCard"]:not(nav):not(header):not(footer)', // Intentar ser más específico
               '.list-item-card' // Otro posible contenedor
           ];
           for (const fbSelector of fallbackSelectors) {
               const fbCount = await page.evaluate((sel) => {
                   return document.querySelectorAll(sel).length;
               }, fbSelector);
               console.log(`Selector fallback "${fbSelector}": ${fbCount} elementos`);
               if (fbCount > articlesFound) {
                   articlesFound = fbCount;
                   articleSelector = fbSelector;
                   console.log(`Usando selector fallback "${articleSelector}" con ${articlesFound} elementos`);
                   break; // Usar el primer fallback que encuentre más elementos
               }
           }
      }


      if (articlesFound === 0) {
          console.log('No se encontraron artículos con selectores conocidos.');
          const html = await page.content();
          fs.writeFileSync('page_no_articles.html', html);
          await page.screenshot({ path: path.join(screenshotDir, 'no_articles_found.png') });
          return { error: 'No se encontraron artículos' };
      }

      console.log(`Usando selector "${articleSelector}" con ${articlesFound} elementos para la extracción final.`);

      // Extraer datos con el selector identificado y lógica corregida
      const scrapedData = await page.evaluate((selector) => {
          try {
              const data = [];
              const articles = document.querySelectorAll(selector);

              console.log(`Procesando ${articles.length} artículos con selector "${selector}"...`);

              articles.forEach((article, index) => {
                  try {
                      // *** CORRECCIÓN 2: Función getText modificada (usa querySelector) ***
                      const getText = (element, selectors, fieldName = '') => {
                          if (!element) return '';
                          for (const sel of selectors) {
                              try {
                                  const match = element.querySelector(sel);
                                  if (match && match.innerText) {
                                      let text = match.innerText.trim();

                                      // *** CORRECCIÓN 4: Limpieza de datos específica ***
                                      if (fieldName === 'price') {
                                          // Tomar solo la primera línea y asegurar símbolo € al final
                                          text = text.split('\n')[0].replace(/€/g, '').trim();
                                          if (text && !isNaN(text.replace(/\./g, ''))) { // Si es un número (aproximado)
                                             return text + ' €';
                                          } else if (match.innerText.includes('€')) {
                                              // Si no es número pero tenía euro, devolver el texto limpio
                                              return match.innerText.trim().split('\n')[0];
                                          }
                                          // Si no es un precio válido, seguir buscando
                                      } else if (fieldName === 'location') {
                                          // Si hay duplicados tipo "Ciudad (Provincia) Ciudad (Provincia)"
                                          const parts = text.split('\n');
                                          if (parts.length > 1 && parts[0].trim() === parts[1].trim()) {
                                              return parts[0].trim();
                                          }
                                          return text.split('\n')[0].trim(); // Tomar solo la primera línea
                                      } else {
                                           return text; // Devuelve el primer texto encontrado
                                      }
                                  }
                              } catch (e) { /* Ignorar error de selector individual */ }
                          }
                          return ''; // Devuelve vacío si ningún selector funcionó
                      };

                     // *** CORRECCIÓN 3: Listas de Selectores Refinadas ***
                     // Priorizar selectores exactos de V3 si aún son válidos
                      const titleSelectors = [
                          'h2.ma-AdCardV2-title',          // V3 exacto
                          'a[class*="AdCard-title-link"]', // Otra posibilidad común
                          'h2[class*="title"]',             // Más general pero útil
                          '[itemprop="name"]'              // Schema.org
                      ];

                      const priceSelectors = [
                          '.ma-AdPrice-value',             // V3 exacto
                          '[class*="Price-value"]',        // Variante común
                          '[itemprop="price"]',            // Schema.org
                          '[class*="price"] strong',       // Precio destacado
                          '[class*="AdPrice"]'             // Contenedor general precio
                      ];

                      const locationSelectors = [
                          '.ma-AdLocation-text',           // V3 exacto
                          '[class*="Location-text"]',      // Variante
                          '.ma-AdCard-location',           // Otra clase posible
                          '[itemprop="addressLocality"]',  // Schema.org
                           '[class*="location"] span'     // Último recurso
                      ];

                      const descriptionSelectors = [
                          '.ma-AdCardV2-description',     // V3 exacto
                          'p[class*="description"]',      // Párrafo de descripción
                          '[itemprop="description"]',     // Schema.org
                          '.ma-AdCard-description'        // Otra clase
                      ];

                       // *** CORRECCIÓN 5: Extracción de 'details' más específica ***
                      const details = [];
                      const detailSelectors = [
                         '.ma-AdTag-label',                 // V3 exacto (para Kms, Año, Combustible)
                         '[class*="pill"]',                 // A veces usan "pills"
                         '[class*="Attribute-label"]'       // Otra estructura común
                      ];
                      const detailElements = article.querySelectorAll(detailSelectors.join(', ')); // Combinar selectores

                      const title = getText(article, titleSelectors, 'title') || `Artículo ${index + 1}`; // Fallback title
                      const price = getText(article, priceSelectors, 'price') || 'Precio no disponible';
                      const location = getText(article, locationSelectors, 'location') || 'Ubicación no disponible';
                      const description = getText(article, descriptionSelectors, 'description') || 'Sin descripción';


                      // Procesar los detalles encontrados
                      const addedDetails = new Set(); // Para evitar duplicados en details
                       detailElements.forEach(el => {
                          try {
                              const text = el.innerText.trim();
                              // Filtro más estricto para detalles
                              if (text && text.length > 1 && text.length < 50 && // Longitud razonable
                                  text !== title &&                      // No es el título
                                  !price.includes(text.split(' ')[0]) && // No es parte del precio
                                  !location.includes(text) &&            // No es parte de la ubicación
                                  !description.startsWith(text.substring(0,10)) && // No es el inicio de la descripción
                                  !/^\d+$/.test(text) &&                 // No es solo un número
                                  !addedDetails.has(text))               // No está ya añadido
                              {
                                  details.push(text);
                                  addedDetails.add(text);
                              }
                          } catch(e) {/*ignore*/}
                      });


                       // *** CORRECCIÓN 6: Extracción URL / ImageUrl (Mantener lógica V5 pero asegurar contexto) ***
                      let url = '';
                      try {
                         // Buscar el enlace principal del artículo
                          const linkElement = article.querySelector('a[href][class*="Card-title-link"], a[href][class*="AdCard-link"], article > a[href]');
                          if (linkElement) {
                              url = linkElement.href;
                              if (url && !url.startsWith('http')) {
                                  url = new URL(url, window.location.origin).href;
                              }
                          } else {
                              // Fallback: buscar cualquier enlace dentro del artículo
                              const fallbackLink = article.querySelector('a[href]');
                              if (fallbackLink) {
                                   url = fallbackLink.href;
                                   if (url && !url.startsWith('http')) {
                                       url = new URL(url, window.location.origin).href;
                                   }
                              }
                          }
                      } catch (e) { /* Ignorar errores al obtener URL */ }

                      let imageUrl = '';
                      try {
                          const imgElement = article.querySelector('img[src]'); // Buscar cualquier imagen con src
                          if (imgElement && imgElement.src) {
                              imageUrl = imgElement.src;
                              if (imageUrl && imageUrl.startsWith('//')) {
                                   imageUrl = 'https:' + imageUrl; // Corregir URLs que empiezan con //
                              } else if (imageUrl && !imageUrl.startsWith('http')) {
                                  // A veces usan data-src o data-lazy-src para lazy loading
                                  const lazySrc = imgElement.getAttribute('data-src') || imgElement.getAttribute('data-lazy-src');
                                  if (lazySrc) {
                                      imageUrl = lazySrc;
                                  } else {
                                       imageUrl = new URL(imageUrl, window.location.origin).href; // Hacer absoluta si es relativa
                                  }
                              }
                              // Asegurar que sea https si es posible
                              if (imageUrl && imageUrl.startsWith('http://')) {
                                   imageUrl = imageUrl.replace('http://', 'https://');
                              }
                          }
                      } catch (e) { /* Ignorar errores al obtener imagen */ }

                      // Extracción ID (Mantener lógica V5, es más robusta)
                      let id = '';
                      try {
                          if (article.getAttribute('data-id')) {
                              id = article.getAttribute('data-id');
                          } else if (article.id) {
                              id = article.id;
                          } else if (url) {
                              const match = url.match(/\/(\d+)\.htm/) || url.match(/id=(\d+)/) || url.match(/\/(\d+)$/);
                              if (match && match[1]) {
                                  id = match[1];
                              }
                          }
                           // Si no se encontró un ID, usar una combinación simple como V3 pero con índice
                           if (!id) {
                               // Crear un hash simple o usar título+índice
                                id = title.substring(0, 10).replace(/\s/g,'') + '_' + index;
                           }
                      } catch (e) { /* Ignorar */ }


                      data.push({
                          id,
                          title,
                          price,
                          location,
                          description,
                          details, // Usar el array de detalles limpio
                          url,
                          imageUrl
                      });
                  } catch (itemError) {
                      console.error(`Error en ítem ${index}:`, itemError.message);
                      data.push({
                          id: `error_${index}`,
                          error: 'Error procesando artículo individual',
                          message: itemError.message,
                          partial: true // Indicar que es un resultado parcial/erróneo
                      });
                  }
              });

              return data;
          } catch (evalError) {
              console.error('Error dentro de page.evaluate:', evalError);
              return {
                  error: 'Error durante la extracción de datos en page.evaluate',
                  message: evalError.toString()
              };
          }
      }, articleSelector); // Pasar el selector final a page.evaluate

      return scrapedData;
  } catch (error) {
      console.error('Error general en extractData:', error.message);
      // Intentar tomar screenshot en error general también
       try {
           await page.screenshot({ path: path.join(screenshotDir, 'extract_data_error.png') });
       } catch(ssError){ console.error("Error al tomar screenshot en error:", ssError.message); }

      return { error: `Error general en extractData: ${error.message}` };
  }
}

// Función principal de scraping mejorada con extracción exhaustiva
async function scrapeMilanuncios(searchParams = {}) {
  const urlToScrape = buildUrl(searchParams);
  console.log(`Scraping URL: ${urlToScrape}`);
  
  let browser = null;
  let maxRetries = 2; // Número de reintentos en caso de fallo
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`\n=== Intento ${attempt} de ${maxRetries} ===\n`);
      }
      
      // Lanzar navegador con configuración mejorada
      const launchOptions = {
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-features=IsolateOrigins,site-per-process,SitePerProcess',
          '--disable-site-isolation-trials',
          '--disable-web-security',
          '--disable-features=BlockInsecurePrivateNetworkRequests',
          '--window-size=1920,1080' // Pantalla más grande para ver más elementos
        ],
        ignoreHTTPSErrors: true,
        defaultViewport: null // Usar el tamaño de la ventana
      };
      
      console.log('Lanzando navegador...');
      browser = await puppeteer.launch(launchOptions);
      
      // Crear página directamente
      const page = await browser.newPage();
      
      // Configurar tiempos de espera más altos
      page.setDefaultNavigationTimeout(60000);
      page.setDefaultTimeout(30000);
      
      // Configurar user agent aleatorio
      const userAgent = getRandomUserAgent();
      console.log(`Usando User-Agent: ${userAgent}`);
      await page.setUserAgent(userAgent);
      
      // Configurar cabeceras HTTP adicionales
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      });
      
      // Establecer cookies iniciales (ayuda a evitar algunas detecciones)
      await page.setCookie({
        name: 'visited_before',
        value: 'true',
        domain: '.milanuncios.com',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 86400
      });
      
      // Configurar interceptación de peticiones para bloquear recursos innecesarios
      await page.setRequestInterception(true);
      
      page.on('request', (request) => {
        const url = request.url();
        const resourceType = request.resourceType();
        
        // Bloquear recursos que no son necesarios para la extracción
        if (
          (resourceType === 'image' && !url.includes('milanuncios.com')) || 
          resourceType === 'media' ||
          url.includes('google-analytics') ||
          url.includes('facebook.net') ||
          url.includes('doubleclick.net') ||
          url.includes('amazon-adsystem') ||
          url.includes('/ads/') ||
          url.includes('analytics') ||
          url.includes('tracker')
        ) {
          request.abort();
        } else {
          request.continue();
        }
      });
      
      // Navegar a la página con tiempos de carga extendidos
      console.log('Navegando a la URL...');
      
      await page.goto(urlToScrape, { 
        waitUntil: 'networkidle2',
        timeout: 60000 
      });
      
      console.log('Página cargada.');
      
      // Manejar cookies
      await handleCookiesConsent(page);
      
      // Esperar un tiempo antes de continuar
      await sleep(2000);
      
      // Verificar si hay captcha
      console.log('Comprobando si hay captcha...');
      
      // Intentar resolver captcha si existe
      const captchaResolved = await solveCaptcha(page);
      
      if (captchaResolved) {
        console.log('Captcha resuelto correctamente.');
      } else {
        console.log('No se encontró captcha o no se pudo resolver.');
      }
      
      // Esperar un poco más después del captcha
      await sleep(2000);
      
      // Contar elementos antes del scroll
      console.log('Contando elementos antes del scroll:');
      const initialCount = await countVisibleElements(page);
      
      // Realizar auto-scroll exhaustivo para cargar TODOS los elementos
      await exhaustiveScroll(page);
      
      // Contar elementos después del scroll
      console.log('Contando elementos después del scroll:');
      const finalCount = await countVisibleElements(page);
      
      console.log(`Incremento de elementos: ${finalCount - initialCount} (${initialCount} -> ${finalCount})`);
      
      // Esperar un poco después del auto-scroll
      await sleep(3000);
      
      // Extraer los datos de manera exhaustiva
      const scrapedData = await extractData(page);
      
      // Verificar si hubo error en la extracción
      if (scrapedData && scrapedData.error) {
        console.log(`Error en la extracción: ${scrapedData.error}`);
        
        // Si estamos en el último intento, devolver lo que tengamos
        if (attempt === maxRetries) {
          console.log('Se alcanzó el número máximo de intentos.');
          await browser.close();
          browser = null;
          return { 
            error: scrapedData.error, 
            message: 'No se pudieron extraer datos después de múltiples intentos',
            partial: true
          };
        }
        
        // Si no es el último intento, cerrar y reintentar
        console.log('Preparando para reintentar...');
        await browser.close();
        browser = null;
        continue;
      }
      
      // Si llegamos aquí, la extracción fue exitosa
      console.log(`Extracción completada. Se extrajeron ${Array.isArray(scrapedData) ? scrapedData.length : 0} artículos.`);
      
      // Cerrar navegador y devolver datos
      await browser.close();
      browser = null;
      return Array.isArray(scrapedData) ? scrapedData : [];
      
    } catch (error) {
      console.error(`Error en scraping (intento ${attempt + 1}/${maxRetries + 1}):`, error.message);
      
      // Cerrar el navegador si sigue abierto
      if (browser) {
        await browser.close();
        browser = null;
      }
      
      // Si es el último intento, lanzar el error
      if (attempt === maxRetries) {
        throw new Error(`Error después de ${maxRetries + 1} intentos: ${error.message}`);
      }
      
      // Esperar antes de reintentar
      const retryDelay = (attempt + 1) * 5000; // Incrementar tiempo entre reintentos
      console.log(`Esperando ${retryDelay/1000} segundos antes de reintentar...`);
      await sleep(retryDelay);
    }
  }
}

module.exports = scrapeMilanuncios;