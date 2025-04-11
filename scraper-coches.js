// scraper-coches.js

const fs = require('fs');
const path = require('path');

// SETUP COMPLETO DE PLUGINS DE EVASIÓN
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const AnonymizeUAPlugin = require('puppeteer-extra-plugin-anonymize-ua');

// Crear directorio para capturas si no existe
const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir);
}

// Configuración avanzada de stealth
const stealth = StealthPlugin();
// Deshabilitar algunas evasiones que pueden ser problemáticas
stealth.enabledEvasions.delete('chrome.runtime');
stealth.enabledEvasions.delete('iframe.contentWindow');
puppeteer.use(stealth);

// Añadir plugin para User Agent anónimo pero realista
puppeteer.use(AnonymizeUAPlugin({ makeWindows: true }));

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
    await sleep(8000);

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
    await sleep(8000);
    
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
          }, 'div.mt-ListAds-item, div[data-ad-position]');
          
          console.log(`Elementos antes de hacer clic: ${countBefore}`);
          
          // Hacer clic en el botón
          await page.click(selector);
          // Esperar a que carguen más elementos
          await sleep(6000);
          
          // Contar cuántos elementos tenemos después de hacer clic
          const countAfter = await page.evaluate((articleSelector) => {
            return document.querySelectorAll(articleSelector).length;
          }, 'div.mt-ListAds-item, div[data-ad-position]');
          
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
              }, 'div.mt-ListAds-item, div[data-ad-position]');
              
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
    // Selectores específicos para Coches.net
    const selectors = [
      'div.mt-ListAds-item',
      'div[data-ad-position]',
      'div.mt-CardAd',
      '.mt-CardAd-infoContainer',
      '.sui-AtomCard'
    ];
    
    let totalElements = 0;
    
    for (const selector of selectors) {
      const count = await page.evaluate((sel) => {
        return document.querySelectorAll(sel).length;
      }, selector).catch(() => 0); // Si hay error, devolver 0
      
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
        const text = await page.evaluate(el => el.innerText.toLowerCase(), button).catch(() => '');
        if (text.includes('accept') || text.includes('acepto') || text.includes('aceptar')) {
          console.log(`Encontrado botón por texto: "${text}"`);
          await button.click({ delay: 100 });
          console.log('Cookies aceptadas por texto.');
          await sleep(4000);
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

// Función mejorada para extraer datos basada en la estructura HTML real de la página
async function extractData(page) {
  try {
    console.log('Extrayendo información de los anuncios...');

    // Primero guardamos el HTML completo para análisis
    const html = await page.content();
    fs.writeFileSync('page_content.html', html);
    console.log('HTML guardado para análisis en page_content.html');

    // Selector principal para los anuncios en coches.net
    const adSelector = 'div[data-ad-position]';
    
    // Comprobamos si hay anuncios
    const adsFound = await page.evaluate((sel) => {
      return document.querySelectorAll(sel).length;
    }, adSelector).catch(() => 0);
    
    console.log(`Encontrados ${adsFound} anuncios en la página`);
    
    if (adsFound === 0) {
      console.log('No se encontraron anuncios con el selector principal. Intentando selectores alternativos...');
      
      // Intentar con selectores alternativos
      const alternativeSelectors = [
        'div.mt-ListAds-item',
        '.mt-CardAd',
        '.sui-AtomCard',
        'article',
        'div[class*="Card"]',
        'div[class*="Listing"]',
        'div[class*="list-item"]'
      ];
      
      let foundElements = 0;
      let workingSelector = '';
      
      for (const selector of alternativeSelectors) {
        const count = await page.evaluate((sel) => {
          return document.querySelectorAll(sel).length;
        }, selector).catch(() => 0);
        
        console.log(`Selector alternativo "${selector}": ${count} elementos`);
        
        if (count > 0) {
          foundElements = count;
          workingSelector = selector;
          break;
        }
      }
      
      if (foundElements === 0) {
        console.log('No se encontraron anuncios con ningún selector conocido.');
        await page.screenshot({ path: path.join(screenshotDir, 'no_ads_found.png') });
        return { error: 'No se encontraron anuncios' };
      } else {
        console.log(`Usando selector alternativo: ${workingSelector} (${foundElements} elementos)`);
        adSelector = workingSelector;
      }
    }
    
    // Extraer los datos basados en la estructura observada
    const scrapedData = await page.evaluate((sel) => {
      try {
        // Seleccionar todos los contenedores de anuncios y filtrar elementos nativos/publicitarios
        const adContainers = Array.from(document.querySelectorAll(sel))
          .filter(el => !el.className || !el.className.includes('native'));
        
        return adContainers.map(container => {
          try {
            // Extraer ID del anuncio desde el atributo data-ad-id
            let id = '';
            if (container.getAttribute('data-ad-id')) {
              id = container.getAttribute('data-ad-id');
            } else if (container.getAttribute('id')) {
              id = container.getAttribute('id');
            } else if (container.querySelector('[id]')) {
              id = container.querySelector('[id]').getAttribute('id');
            }
            
            // Extraer título - Primero buscar el selector específico de coches.net
            let title = 'Título no disponible';
            const titleElement = container.querySelector('.mt-CardAd-infoHeaderTitle');
            if (titleElement) {
              title = titleElement.textContent.trim();
            } else {
              // Intentar con otros selectores de título si el principal no funciona
              const titleSelectors = ['h2', 'h3', '[class*="title"]', '[class*="Title"]', 'a[title]'];
              for (const titleSel of titleSelectors) {
                const altTitleElement = container.querySelector(titleSel);
                if (altTitleElement) {
                  title = altTitleElement.textContent.trim();
                  break;
                }
              }
            }
            
            // Extraer precio - Primero buscar el selector específico de coches.net
            let price = 'Precio no disponible';
            const priceElement = container.querySelector('.mt-CardAdPrice-cashAmount .mt-TitleBasic-title');
            if (priceElement) {
              price = priceElement.textContent.trim();
            } else {
              // Intentar con otros selectores de precio
              const priceSelectors = ['[class*="price"]', '[class*="Price"]', 'span[class*="amount"]', 'strong'];
              for (const priceSel of priceSelectors) {
                const altPriceElement = container.querySelector(priceSel);
                if (altPriceElement) {
                  price = altPriceElement.textContent.trim();
                  break;
                }
              }
            }
            
            // Extraer año, kilómetros y ubicación
            let year = '';
            let kilometers = '';
            let location = 'Ubicación no disponible';
            
            // Extraer los atributos de la lista conocida en coches.net
            const attrItems = Array.from(container.querySelectorAll('.mt-CardAd-attrItem'));
            
            if (attrItems.length > 0) {
              // El primer ítem suele ser el año (cuando es un número de 4 dígitos)
              const firstItem = attrItems[0].textContent.trim();
              if (/^\d{4}$/.test(firstItem)) {
                year = firstItem;
              }
              
              // El segundo ítem suele ser los kilómetros
              if (attrItems.length > 1) {
                kilometers = attrItems[1].textContent.trim();
              }
              
              // El último ítem suele ser la ubicación
              if (attrItems.length > 2) {
                // Verificar si el último elemento contiene un icono de ubicación
                const lastItem = attrItems[attrItems.length - 1];
                
                if (lastItem.querySelector('[class*="AtomIcon"]') || lastItem.querySelector('svg')) {
                  // Extraer el texto de ubicación del elemento con icono
                  const locationText = lastItem.querySelector('.mt-CardAd-attrItemIconLabel');
                  if (locationText) {
                    location = locationText.textContent.trim();
                  }
                } else {
                  location = lastItem.textContent.trim();
                }
              }
            }
            
            // Extraer detalles adicionales como garantía, IVA, etc.
            const details = [];
            
            // Añadir año y kilómetros a los detalles si están disponibles
            if (year) details.push(`Año: ${year}`);
            if (kilometers) details.push(`Kilómetros: ${kilometers}`);
            
            // Extraer información adicional específica de coches.net
            const infoItems = Array.from(container.querySelectorAll('.mt-CardAdPrice-infoItem'));
            infoItems.forEach(item => {
              const text = item.textContent.trim();
              if (text) details.push(text);
            });
            
            // Extraer etiquetas (badges)
            const badges = Array.from(container.querySelectorAll('.sui-AtomBadge'));
            badges.forEach(badge => {
              const text = badge.textContent.trim();
              if (text && !details.includes(text)) details.push(text);
            });
            
            // Extraer URL del anuncio
            let url = '';
            const linkElements = container.querySelectorAll('a[href]');
            for (const link of linkElements) {
              // Buscar el enlace principal (el que contiene el título)
              if (link.className.includes('titleLink') || link.querySelector('h2, h3, [class*="title"]')) {
                url = link.href;
                break;
              }
            }
            
            // Si no encontramos el enlace específico, tomar el primero
            if (!url && linkElements.length > 0) {
              url = linkElements[0].href;
            }
            
            // Extraer URL de imagen principal
            let imageUrl = '';
            
            // Buscar la imagen dentro del carrusel de imágenes
            const imgElement = container.querySelector('.mt-GalleryBasic-sliderImage img');
            if (imgElement) {
              imageUrl = imgElement.src || imgElement.getAttribute('data-src') || '';
            } else {
              // Intentar con otros selectores de imagen
              const altImgElement = container.querySelector('img');
              if (altImgElement) {
                imageUrl = altImgElement.src || altImgElement.getAttribute('data-src') || '';
              }
            }
            
            // Si la URL de imagen es relativa, convertirla a absoluta
            if (imageUrl && !imageUrl.startsWith('http')) {
              imageUrl = new URL(imageUrl, window.location.origin).href;
            }
            
            // Obtener información del vendedor (si está disponible)
            let seller = '';
            let sellerRating = '';
            
            // Buscar la información de rating del vendedor
            const ratingBadge = container.querySelector('.mt-RatingBadge');
            if (ratingBadge) {
              const ratingText = ratingBadge.textContent.trim();
              if (ratingText.includes('Profesional')) {
                seller = 'Profesional';
                const ratingMatch = ratingText.match(/\d+(\.\d+)?/);
                if (ratingMatch) {
                  sellerRating = ratingMatch[0];
                }
              }
            }
            
            // Comprobar si hay información de envío
            const hasShipping = !!container.querySelector('.sui-AtomBadge [title="Envío disponible"]');
            
            // Estructurar todos los datos extraídos
            return {
              id,
              title,
              price,
              year,
              kilometers,
              location,
              details,
              url,
              imageUrl,
              seller,
              sellerRating: sellerRating || null,
              hasShipping
            };
          } catch (error) {
            console.error('Error al procesar un anuncio:', error);
            return null;
          }
        }).filter(item => item !== null); // Filtrar elementos que fallaron
      } catch (error) {
        console.error('Error en extracción principal:', error);
        return [];
      }
    }, adSelector).catch(error => {
      console.error('Error en evaluate:', error.message);
      return [];
    });
    
    console.log(`Extracción completada. Se obtuvieron ${Array.isArray(scrapedData) ? scrapedData.length : 0} anuncios.`);
    
    // Filtrar anuncios duplicados o no válidos
    const uniqueIds = new Set();
    const filteredData = Array.isArray(scrapedData) ? scrapedData.filter(item => {
      // Verificar que tenga ID y que sea único
      if (!item.id || uniqueIds.has(item.id)) return false;
      uniqueIds.add(item.id);
      
      // Verificar que tenga título y precio
      return item.title && item.title !== 'Título no disponible' && 
             item.price && item.price !== 'Precio no disponible';
    }) : [];
    
    console.log(`Después de filtrar: ${filteredData.length} anuncios únicos y válidos.`);
    
    return filteredData;
  } catch (error) {
    console.error('Error general en extractData:', error.message);
    // Intentar tomar screenshot en error general también
    try {
      await page.screenshot({ path: path.join(screenshotDir, 'extract_data_error.png') });
    } catch(ssError) { 
      console.error("Error al tomar screenshot en error:", ssError.message); 
    }
    
    return { error: `Error general en extractData: ${error.message}` };
  }
}

// Simular movimientos de ratón humanos
async function simulateHumanMouseMovement(page) {
  console.log('Simulando movimientos de ratón humanos...');
  
  try {
    const { width, height } = await page.evaluate(() => {
      return {
        width: window.innerWidth,
        height: window.innerHeight
      };
    }).catch(() => ({ width: 1280, height: 800 }));
    
    // Número de movimientos aleatorios
    const movements = 5 + Math.floor(Math.random() * 10);
    
    for (let i = 0; i < movements; i++) {
      const x = Math.floor(Math.random() * width);
      const y = Math.floor(Math.random() * height);
      
      // Mover el ratón a un punto aleatorio
      await page.mouse.move(x, y, { steps: 10 });
      
      // Pausa variable entre movimientos
      await sleep(300 + Math.random() * 1000);
    }
    
    // Intentar hacer scroll suave
    await page.evaluate(() => {
      const scrollAmount = Math.floor(window.innerHeight * 0.3);
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    }).catch(() => {});
    
    await sleep(1000);
    
    console.log('Simulación de comportamiento humano completada');
  } catch (e) {
    console.log('Error en simulación de movimientos:', e.message);
  }
}

// Función principal de scraping para coches.net
async function scrapeCoches(urlToScrape) {
  console.log(`Scraping URL: ${urlToScrape}`);
  
  let browser = null;
  let maxRetries = 2;
  let currentPage = null; // Declaramos currentPage aquí para que esté disponible en todo el scope
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`\n=== Intento ${attempt} de ${maxRetries} ===\n`);
      }
      
      // MEJORAS EN LA CONFIGURACIÓN DEL NAVEGADOR
      const launchOptions = {
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--enable-webgl',
          '--enable-unsafe-webgl',
          '--enable-unsafe-swiftshader',
          '--ignore-gpu-blocklist',
          '--disable-blink-features=AutomationControlled', // Importante
          '--disable-features=IsolateOrigins,site-per-process,SitePerProcess',
          '--disable-site-isolation-trials',
          '--disable-web-security',
          '--disable-features=BlockInsecurePrivateNetworkRequests',
          // Configuración de pantalla y colores
          '--window-size=1920,1080',
          '--force-color-profile=sRGB',
          '--force-device-scale-factor=1',
          // Nuevo: para error handling más robusto
          '--disable-hang-monitor',
          '--disable-crash-reporter',
          '--disable-extensions'
        ],
        ignoreHTTPSErrors: true,
        defaultViewport: null,
        // NUEVO: Configurar el tiempo de espera para la ejecución del navegador
        timeout: 120000
      };
      
      console.log('Lanzando navegador...');
      browser = await puppeteer.launch(launchOptions);
      
      // Crear una página nueva con configuración adicional
      const page = await browser.newPage();
      currentPage = page; // Inicializamos currentPage con la primera página
      
      // NUEVO: Simular comportamiento humano y evitar detección de navegador automatizado
      await page.evaluateOnNewDocument(() => {
        // Simular history y localStorage
        window.history.pushState({}, '', '/');
        try {
          localStorage.setItem('visited_before', 'true');
          localStorage.setItem('session_started', Date.now().toString());
        } catch (e) {}
        
        // Ocultar WebDriver
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
        
        // Simular plugins comunes (para parecer más humano)
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            return [
              { name: 'Chrome PDF Plugin' },
              { name: 'Chrome PDF Viewer' },
              { name: 'Native Client' },
            ];
          },
        });
        
        // Simular idiomas de navegador
        Object.defineProperty(navigator, 'languages', {
          get: () => ['es-ES', 'es', 'en-US', 'en'],
        });
        
        // Simular funciones modernas del navegador
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {},
        };
        
        // Manejar captcha de forma específica para coches.net
        window.protectionSubmitCaptcha = function(type, payload, timeout, token) {
          console.log(`Captcha resuelto: ${type}, payload length: ${payload?.length}`);
          return new Promise((resolve) => {
            setTimeout(() => resolve(true), 500);
          });
        };
      });
      
      // Configurar tiempo de espera para la página
      page.setDefaultNavigationTimeout(90000);
      page.setDefaultTimeout(60000);
      
      // Establecer un manejador de errores para la página
      page.on('error', error => {
        console.error('Error en la página:', error);
      });
      
      page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
          console.log(`Consola de página: ${msg.type()}: ${msg.text()}`);
        }
      });
      
      // Configurar cabeceras HTTP más realistas
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'Cache-Control': 'max-age=0',
      });
      
      // Establecer cookies iniciales mejoradas
      const cookiesDomain = new URL(urlToScrape).hostname;
      await page.setCookie(
        {
          name: 'visited_before',
          value: 'true',
          domain: cookiesDomain,
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 86400
        },
        {
          name: 'session_id',
          value: Math.random().toString(36).substring(2),
          domain: cookiesDomain,
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 3600
        },
        {
          name: 'has_js',
          value: '1',
          domain: cookiesDomain,
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 86400
        }
      );
      
      // Permitir todas las peticiones (solución para la página en blanco)
      await page.setRequestInterception(true);
      
      page.on('request', (request) => {
        // NUEVO: permitir todas las peticiones para evitar errores JavaScript
        request.continue();
      });
      
      try {
        // Abrir la página principal y mantenerla abierta
        await page.goto('https://www.coches.net/', { 
          waitUntil: 'networkidle2',
          timeout: 30000 
        });
        
        // Esperar un poco en la página principal
        await sleep(3000 + Math.random() * 2000);
        
        // Manejar cookies si aparece el banner
        await handleCookiesConsent(page);
        await sleep(2000);
        
        // Realizar algunos movimientos de ratón aleatorios
        await simulateHumanMouseMovement(page);
        
        console.log('Simulación de comportamiento humano completada');
        
        // IMPORTANTE: Mantener esta pestaña abierta y crear una nueva para la URL objetivo
        console.log('Abriendo nueva pestaña para la URL objetivo...');
        
        // Crear una nueva página (pestaña) en el mismo navegador
        const targetPage = await browser.newPage();
        
        // Aplicar las mismas configuraciones a la nueva pestaña
        await targetPage.setDefaultNavigationTimeout(90000);
        await targetPage.setDefaultTimeout(60000);
        
        targetPage.on('error', error => {
          console.error('Error en la página objetivo:', error);
        });
        
        targetPage.on('console', msg => {
          if (msg.type() === 'error' || msg.type() === 'warning') {
            console.log(`Consola de página objetivo: ${msg.type()}: ${msg.text()}`);
          }
        });
        
        // Configurar cabeceras HTTP más realistas para la nueva pestaña
        await targetPage.setExtraHTTPHeaders({
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',  // Cambiado a 'same-origin' ya que venimos del mismo sitio
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
          'Cache-Control': 'max-age=0',
          'Referer': 'https://www.coches.net/'  // Importante: establecer la página principal como referrer
        });
        
        // Transferir las cookies de la primera pestaña a la nueva
        const cookies = await page.cookies();
        await targetPage.setCookie(...cookies);
        
        // Permitir todas las peticiones en la nueva pestaña
        await targetPage.setRequestInterception(true);
        targetPage.on('request', (request) => {
          request.continue();
        });
        
        // Navegar a la URL objetivo en la nueva pestaña
        console.log('Navegando a la URL objetivo en nueva pestaña...');
        try {
          await targetPage.goto(urlToScrape, { 
            waitUntil: 'networkidle2',
            timeout: 60000
          });
        } catch (e) {
          console.log('Error de navegación en nueva pestaña, esperando un momento e intentando continuar:', e.message);
          await sleep(5000);
          
          // Verificar si la página cargó parcialmente
          const content = await targetPage.content().catch(() => '');
          if (!content || content.length < 1000) {
            console.log('Contenido insuficiente, intentando cargar de nuevo con timeoutless');
            try {
              await targetPage.goto(urlToScrape, { 
                waitUntil: 'domcontentloaded' // Usar solo domcontentloaded para permitir carga parcial
              });
            } catch (e2) {
              console.log('Segundo intento de navegación falló:', e2.message);
            }
          }
        }
        
        console.log('Página objetivo cargada.');
        await targetPage.screenshot({ path: 'target_page_loaded.png' });
        
        // Cambiar la referencia de currentPage a la nueva pestaña
        currentPage = targetPage;
        
      } catch (e) {
        console.log('Error en navegación, continuando con enfoque alternativo:', e.message);
        // Si falla el enfoque de pestañas múltiples, volver al método original
        try {
          console.log('Intentando navegación directa a la URL objetivo...');
          await page.goto(urlToScrape, { 
            waitUntil: 'networkidle2',
            timeout: 60000,
            referer: 'https://www.coches.net/'
          });
          // Mantener currentPage como la página inicial en este caso
        } catch (directError) {
          console.log('Error en navegación directa:', directError.message);
          // Mantener currentPage como la página inicial
        }
      }
      
      // Verificar si los estilos se cargaron correctamente en la página actual
      const stylesLoaded = await currentPage.evaluate(() => {
        try {
          const hasStyles = window.getComputedStyle(document.body).backgroundColor !== '';
          const logoElement = document.querySelector('.sui-TopbarUser-brand');
          const logoVisible = logoElement && 
                             window.getComputedStyle(logoElement).backgroundImage !== '';
          return { hasStyles, logoVisible };
        } catch (e) {
          return { hasStyles: false, logoVisible: false, error: e.message };
        }
      }).catch(() => ({ hasStyles: false, logoVisible: false, error: 'Evaluate failed' }));
      
      console.log('Estado de carga de estilos:', stylesLoaded);
      
      // Manejar cookies nuevamente si es necesario
      await handleCookiesConsent(currentPage);
      await sleep(2000);
      
      // Continuar con scraping normal
      console.log('Contando elementos antes del scroll:');
      const initialCount = await countVisibleElements(currentPage);
      await exhaustiveScroll(currentPage);
      console.log('Contando elementos después del scroll:');
      const finalCount = await countVisibleElements(currentPage);
      console.log(`Incremento de elementos: ${finalCount - initialCount} (${initialCount} -> ${finalCount})`);
      
      await sleep(3000);
      
      // Extraer datos usando la función mejorada
      const scrapedData = await extractData(currentPage);
      
      // Verificar si hubo error en la extracción
      if (scrapedData && scrapedData.error) {
        console.log(`Error en la extracción: ${scrapedData.error}`);
        
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
        
        console.log('Preparando para reintentar...');
        if (browser) {
          await browser.close();
          browser = null;
        }
        continue;
      }
      
      console.log(`Extracción completada. Se extrajeron ${Array.isArray(scrapedData) ? scrapedData.length : 0} artículos.`);
      
      if (browser) {
        await browser.close();
        browser = null;
      }
      
      return Array.isArray(scrapedData) ? scrapedData : [];
      
    } catch (error) {
      console.error(`Error en scraping (intento ${attempt + 1}/${maxRetries + 1}):`, error.message);
      
      if (browser) {
        await browser.close();
        browser = null;
      }
      
      if (attempt === maxRetries) {
        throw new Error(`Error después de ${maxRetries + 1} intentos: ${error.message}`);
      }
      
      const retryDelay = (attempt + 1) * 5000;
      console.log(`Esperando ${retryDelay/1000} segundos antes de reintentar...`);
      await sleep(retryDelay);
    }
  }
}

module.exports = scrapeCoches;