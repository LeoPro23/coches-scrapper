// scraper-coches.js

// 1. NUEVAS DEPENDENCIAS (añadir a package.json)
// "puppeteer-extra-plugin-recaptcha": "^3.6.8",
// "puppeteer-extra-plugin-anonymize-ua": "^2.4.6",

const fs = require('fs');
const path = require('path');

// 2. SETUP COMPLETO DE PLUGINS DE EVASIÓN
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

// NUEVA FUNCIÓN: Mejorada para manejar captcha y evitar página en blanco
async function handleCaptchaAndBlankPage(page, urlToScrape) {
  console.log('Detectada página de captcha. Esperando resolución manual...');
  
  // Tomar screenshot del captcha para referencia
  await page.screenshot({ path: 'captcha_to_solve.png' });

  // Espera para resolución manual del captcha
  console.log('Por favor, resuelve el captcha manualmente en la ventana del navegador...');
  await sleep(45000); // Dar tiempo suficiente para resolver el captcha manualmente
  
  console.log('Tiempo de espera concluido. Procediendo con estrategia alternativa...');
  
  // ✨ ESTRATEGIA RADICAL ✨: Crear una nueva sesión completamente limpia 
  // pero preservando las cookies (la solución del captcha)
  try {
    // 1. Obtener todas las cookies actuales
    const cookies = await page.cookies();
    console.log(`Preservando ${cookies.length} cookies, incluyendo la solución del captcha`);
    
    // 2. Cerrar el navegador actual completamente
    const currentBrowser = page.browser();
    await page.close();
    await currentBrowser.close();
    
    // 3. Lanzar un navegador completamente nuevo con JavaScript DESHABILITADO
    console.log('Lanzando navegador nuevo con JavaScript deshabilitado...');
    const newBrowser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-javascript', // 🔑 CLAVE: Deshabilitar JavaScript completamente
        '--window-size=1920,1080'
      ],
      ignoreHTTPSErrors: true,
      defaultViewport: null
    });
    
    // 4. Crear una página nueva
    const newPage = await newBrowser.newPage();
    
    // 5. Deshabilitar JavaScript explícitamente también desde la API
    await newPage.setJavaScriptEnabled(false);
    
    // 6. Configurar tiempo de espera y User Agent
    await newPage.setDefaultNavigationTimeout(60000);
    await newPage.setUserAgent(getRandomUserAgent());
    
    // 7. Restaurar las cookies (incluyendo la solución del captcha)
    for (const cookie of cookies) {
      await newPage.setCookie(cookie);
    }
    
    // 8. Navegar directamente a la URL sin esperar a que carguen scripts
    console.log('Navegando a la URL con cookies preservadas pero SIN JavaScript...');
    await newPage.goto(urlToScrape, { 
      waitUntil: 'domcontentloaded', // Solo esperar a que cargue el DOM, no los scripts
      timeout: 30000 
    });
    
    // 9. Tomar una captura para verificar
    await newPage.screenshot({ path: 'nojs_page.png' });
    
    // 10. Guardar el HTML para análisis
    const html = await newPage.content();
    fs.writeFileSync('raw_html.html', html);
    console.log('HTML guardado para análisis en raw_html.html');
    
    // Verificar si estamos en la página de resultados o seguimos bloqueados
    const pageTitle = await newPage.title();
    console.log(`Título de la página: "${pageTitle}"`);
    
    const isBlocked = pageTitle.includes('algo no va bien') || 
                     await newPage.evaluate(() => 
                       document.body.textContent.includes('bot') || 
                       document.body.textContent.includes('algo no va bien')
                     ).catch(() => false);
    
    if (isBlocked) {
      console.log('Seguimos bloqueados incluso sin JavaScript. Intentando estrategia de navegación directa...');
      
      // Última estrategia: Intentar con otra URL relacionada del sitio
      const baseUrl = 'https://www.coches.net/autocaravanas-y-remolques/';
      await newPage.goto(baseUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      // Verificar si cargó esta URL
      const newPageHtml = await newPage.content();
      fs.writeFileSync('alternate_page.html', newPageHtml);
      console.log('Página alternativa guardada en alternate_page.html');
      
      // Si todo falló, intentar con emulación de dispositivo móvil
      const mobileUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';
      await newPage.setUserAgent(mobileUserAgent);
      
      // Emular iPhone X
      await newPage.emulate({
        viewport: {
          width: 375,
          height: 812,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          isLandscape: false
        },
        userAgent: mobileUserAgent
      });
      
      // Intentar una vez más con la configuración móvil
      console.log('Intentando con emulación de dispositivo móvil...');
      await newPage.goto(urlToScrape, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      await newPage.screenshot({ path: 'mobile_attempt.png' });
    }
    
    return {
      page: newPage,
      browser: newBrowser,
      isBlocked: isBlocked
    };
  } catch (error) {
    console.error('Error durante la estrategia radical:', error.message);
    throw error; // Re-lanzar para manejar en el nivel superior
  }
}

// Función para extraer datos de coches.net basado en la estructura HTML
async function extractData(page) {
  try {
    console.log('Extrayendo información de los artículos...');

    // Primero guardamos el HTML completo para análisis
    const html = await page.content();
    fs.writeFileSync('page_content.html', html);
    console.log('HTML guardado para análisis en page_content.html');

    // Selectors específicos para coches.net
    const adContainerSelector = 'div.mt-ListAds-item, div[data-ad-position]';
    
    // Comprobamos si hay anuncios
    const adsFound = await page.evaluate((sel) => {
      return document.querySelectorAll(sel).length;
    }, adContainerSelector).catch(() => 0);
    
    console.log(`Encontrados ${adsFound} anuncios en la página`);
    
    if (adsFound === 0) {
      console.log('No se encontraron anuncios con los selectores conocidos. Intentando selectores alternativos...');
      
      // Intentar con selectores alternativos
      const alternativeSelectors = [
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
        adContainerSelector = workingSelector;
      }
    }
    
    // Extraer los datos basados en la estructura observada
    const scrapedData = await page.evaluate((sel) => {
      try {
        const adContainers = Array.from(document.querySelectorAll(sel))
          .filter(el => !el.className.includes('native'));
        
        return adContainers.map(container => {
          try {
            // Extraer ID - Puede estar en diferentes atributos
            let id = '';
            if (container.getAttribute('data-ad-id')) {
              id = container.getAttribute('data-ad-id');
            } else if (container.getAttribute('id')) {
              id = container.getAttribute('id');
            } else if (container.querySelector('[id]')) {
              id = container.querySelector('[id]').getAttribute('id');
            }
            
            // Extraer título - Buscar diferentes posibles selectores para el título
            let title = 'Título no disponible';
            const titleSelectors = [
              '.mt-CardAd-infoHeaderTitle', 
              'h2', 
              'h3',
              '[class*="title"]',
              '[class*="Title"]',
              'a[title]'
            ];
            
            for (const titleSel of titleSelectors) {
              const titleElement = container.querySelector(titleSel);
              if (titleElement) {
                title = titleElement.textContent.trim();
                break;
              }
            }
            
            // Extraer precio - Buscar diferentes posibles selectores para el precio
            let price = 'Precio no disponible';
            const priceSelectors = [
              '.mt-CardAdPrice-cashAmount .mt-TitleBasic-title',
              '[class*="price"]',
              '[class*="Price"]',
              'span[class*="amount"]',
              'strong'
            ];
            
            for (const priceSel of priceSelectors) {
              const priceElement = container.querySelector(priceSel);
              if (priceElement) {
                price = priceElement.textContent.trim();
                break;
              }
            }
            
            // Extraer ubicación y otros atributos
            let location = 'Ubicación no disponible';
            let year = '';
            let kilometers = '';
            
            // Buscar diferentes selectores para atributos
            const attrSelectors = [
              '.mt-CardAd-attrItem',
              '[class*="attr"]',
              '[class*="detail"]',
              '[class*="info"] span',
              '[class*="spec"]'
            ];
            
            let attributeItems = [];
            
            for (const attrSel of attrSelectors) {
              const items = container.querySelectorAll(attrSel);
              if (items && items.length > 0) {
                attributeItems = Array.from(items);
                break;
              }
            }
            
            // Procesar los atributos encontrados
            if (attributeItems.length > 0) {
              const lastAttr = attributeItems[attributeItems.length - 1];
              if (lastAttr) location = lastAttr.textContent.trim();
              
              // El primer atributo suele ser el año
              if (attributeItems.length > 0 && attributeItems[0]) {
                const firstText = attributeItems[0].textContent.trim();
                if (/^\d{4}$/.test(firstText)) { // Si parece un año (4 dígitos)
                  year = firstText;
                }
              }
              
              // El segundo atributo suele ser los kilómetros
              if (attributeItems.length > 1 && attributeItems[1]) {
                kilometers = attributeItems[1].textContent.trim();
              }
            }
            
            // Extraer URL
            let url = '';
            const linkElement = container.querySelector('a[href]');
            if (linkElement) {
              url = linkElement.href;
            }
            
            // Extraer imagen
            let imageUrl = '';
            const imgSelectors = ['img', '[style*="background-image"]'];
            
            for (const imgSel of imgSelectors) {
              const imgElement = container.querySelector(imgSel);
              if (imgElement) {
                if (imgElement.tagName === 'IMG') {
                  imageUrl = imgElement.src || imgElement.getAttribute('data-src') || '';
                } else if (imgElement.style.backgroundImage) {
                  // Extraer URL de background-image: url('...')
                  const bgImg = imgElement.style.backgroundImage;
                  const match = bgImg.match(/url\(['"]?(.*?)['"]?\)/);
                  if (match && match[1]) {
                    imageUrl = match[1];
                  }
                }
                
                if (imageUrl) break;
              }
            }
            
            // Si la URL de imagen es relativa, convertirla a absoluta
            if (imageUrl && !imageUrl.startsWith('http')) {
              imageUrl = new URL(imageUrl, window.location.origin).href;
            }
            
            // Extraer detalles adicionales
            const details = [];
            
            // Añadir año y kilómetros a los detalles si están disponibles
            if (year) details.push(`Año: ${year}`);
            if (kilometers) details.push(`Kilómetros: ${kilometers}`);
            
            // Buscar otros detalles
            const detailsSelectors = [
              '.mt-CardAdPrice-infoItem',
              '[class*="detail"]',
              '[class*="feature"]',
              '[class*="specs"]'
            ];
            
            for (const detailSel of detailsSelectors) {
              const detailsElements = container.querySelectorAll(detailSel);
              if (detailsElements && detailsElements.length > 0) {
                Array.from(detailsElements).forEach(el => {
                  const text = el.textContent.trim();
                  if (text && !details.includes(text)) {
                    details.push(text);
                  }
                });
              }
            }
            
            return {
              id,
              title,
              price,
              location,
              details,
              url,
              imageUrl
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
    }, adContainerSelector).catch(error => {
      console.error('Error en evaluate:', error.message);
      return [];
    });
    
    console.log(`Extracción completada. Se obtuvieron ${Array.isArray(scrapedData) ? scrapedData.length : 0} anuncios.`);
    return scrapedData;
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

// Función alternativa para extraer datos directamente desde el HTML
// Especialmente diseñada para trabajar sin JavaScript
async function extractDataFromHtml(page) {
  try {
    console.log('Extrayendo información directamente del HTML (modo sin JavaScript)...');
    
    // Guardar el HTML para análisis
    const html = await page.content();
    fs.writeFileSync('extraction_content.html', html);
    console.log('HTML guardado para análisis en extraction_content.html');
    
    // Intento de extracción #1: Buscar anuncios basados en clases comunes
    let items = await page.evaluate(() => {
      // Buscar todos los elementos que podrían contener anuncios
      const possibleContainers = [
        // Elementos con clase relacionada a anuncios
        ...Array.from(document.querySelectorAll('[class*="Card"], [class*="card"], [class*="item"], [class*="Item"]')),
        // Elementos con clase relacionada a listados
        ...Array.from(document.querySelectorAll('[class*="List"], [class*="list"]')),
        // Elementos con atributos de anuncio
        ...Array.from(document.querySelectorAll('[data-ad-id], [data-id], [id^="ad-"]')),
        // Elementos con clase específica de coches.net
        ...Array.from(document.querySelectorAll('[class*="mt-"], [class*="sui-"]'))
      ];
      
      console.log(`Encontrados ${possibleContainers.length} posibles contenedores`);
      
      // Filtrar para obtener solo los que parecen anuncios reales
      const adItems = possibleContainers.filter(el => {
        // Debe contener texto significativo
        if (!el.textContent || el.textContent.trim().length < 50) return false;
        
        // Debe contener al menos un enlace
        if (!el.querySelector('a')) return false;
        
        // Debe tener alguna imagen
        if (!el.querySelector('img') && !el.innerHTML.includes('background-image')) return false;
        
        // Verificar si contiene información típica de anuncios de coches
        const text = el.textContent.toLowerCase();
        const hasPrice = text.includes('€') || text.includes('eur') || text.includes('precio');
        const hasCarInfo = text.includes('km') || text.match(/\b\d{4}\b/) !== null; // Año formato YYYY
        
        return hasPrice || hasCarInfo;
      });
      
      console.log(`Filtrados a ${adItems.length} posibles anuncios`);
      
      // Extraer la información básica de cada anuncio
      return adItems.map(item => {
        // Intentar extraer el ID
        let id = '';
        if (item.getAttribute('data-ad-id')) {
          id = item.getAttribute('data-ad-id');
        } else if (item.getAttribute('id')) {
          id = item.getAttribute('id');
        } else if (item.getAttribute('data-id')) {
          id = item.getAttribute('data-id');
        }
        
        // Extraer título
        let title = 'Título no disponible';
        const titleEl = item.querySelector('h1, h2, h3, h4, [class*="title"], [class*="Title"]');
        if (titleEl) {
          title = titleEl.textContent.trim();
        }
        
        // Extraer precio
        let price = 'Precio no disponible';
        // Buscar elementos que puedan contener el precio
        const priceRegex = /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*(?:€|EUR)/i;
        const priceMatch = item.textContent.match(priceRegex);
        if (priceMatch) {
          price = priceMatch[0].trim();
        } else {
          // Buscar elementos específicos que puedan contener el precio
          const priceEl = item.querySelector('[class*="price"], [class*="Price"], strong');
          if (priceEl) {
            price = priceEl.textContent.trim();
          }
        }
        
        // Extraer URL
        let url = '';
        const linkEl = item.querySelector('a[href]');
        if (linkEl) {
          url = linkEl.href;
        }
        
        // Extraer imagen
        let imageUrl = '';
        const imgEl = item.querySelector('img');
        if (imgEl && (imgEl.src || imgEl.getAttribute('data-src'))) {
          imageUrl = imgEl.src || imgEl.getAttribute('data-src');
        } else {
          // Buscar imágenes en estilos de fondo
          const bgElements = item.querySelectorAll('[style*="background-image"]');
          for (const bgEl of bgElements) {
            const style = bgEl.getAttribute('style');
            if (style) {
              const match = style.match(/url\(['"]?(.*?)['"]?\)/);
              if (match && match[1]) {
                imageUrl = match[1];
                break;
              }
            }
          }
        }
        
        // Extraer ubicación y otros detalles
        const details = [];
        const detailsText = item.textContent;
        
        // Extraer año (formato 4 dígitos)
        const yearMatch = detailsText.match(/\b(19|20)\d{2}\b/);
        let year = '';
        if (yearMatch) {
          year = yearMatch[0];
          details.push(`Año: ${year}`);
        }
        
        // Extraer kilómetros
        const kmMatch = detailsText.match(/\b\d{1,3}(?:\.\d{3})*\s*km\b/i);
        if (kmMatch) {
          details.push(`Kilómetros: ${kmMatch[0]}`);
        }
        
        // Extraer ubicación - buscar elementos pequeños de texto que puedan ser ubicaciones
        const locationElements = item.querySelectorAll('span, div');
        let location = 'Ubicación no disponible';
        for (const el of locationElements) {
          const text = el.textContent.trim();
          // Una ubicación suele ser corta y no contener ciertos caracteres
          if (text.length > 2 && text.length < 30 && 
              !text.includes('€') && !text.includes('km') && 
              !/^\d+$/.test(text)) {
            location = text;
            break;
          }
        }
        
        return {
          id,
          title,
          price,
          location,
          details,
          url,
          imageUrl
        };
      });
    }).catch(error => {
      console.error('Error en evaluate para buscar anuncios:', error.message);
      return [];
    });
    
    console.log(`Encontrados ${items.length} anuncios potenciales`);
    
    // Si no encontramos nada, intentar un enfoque más directo basado en texto
    if (items.length === 0) {
      console.log('No se encontraron anuncios con el primer método. Intentando método alternativo...');
      
      // Extraer texto completo para análisis
      const pageText = await page.evaluate(() => document.body.innerText);
      
      // Buscar patrones de anuncios en el texto
      const carTitles = pageText.match(/mercedes sprinter.*?€|sprinter.*?€/gi);
      
      if (carTitles && carTitles.length > 0) {
        console.log(`Encontrados ${carTitles.length} posibles títulos de Mercedes Sprinter`);
        
        // Crear objetos simples con la información que pudimos extraer
        items = carTitles.map((title, index) => {
          const priceMatch = title.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*€/);
          
          return {
            id: `extracted-${index}`,
            title: title.replace(/\s\d+(\.\d+)*\s*€/, '').trim(),
            price: priceMatch ? priceMatch[0] : 'Precio no disponible',
            location: 'No disponible',
            details: [],
            url: '',
            imageUrl: ''
          };
        });
      }
    }
    
    // Filtrar duplicados y entradas sin sentido
    const uniqueItems = [];
    const seenTitles = new Set();
    
    for (const item of items) {
      // Filtrar entradas sin título o con título muy corto
      if (!item.title || item.title.length < 5) continue;
      
      // Filtrar duplicados basados en el título
      if (seenTitles.has(item.title)) continue;
      seenTitles.add(item.title);
      
      // Verificar que sea relevante a Mercedes Sprinter
      if (!item.title.toLowerCase().includes('sprinter') && 
          !item.title.toLowerCase().includes('mercedes')) continue;
      
      uniqueItems.push(item);
    }
    
    console.log(`Extracción completada. Se obtuvieron ${uniqueItems.length} anuncios únicos.`);
    return uniqueItems;
  } catch (error) {
    console.error('Error general en extractDataFromHtml:', error.message);
    return { error: `Error general en extractDataFromHtml: ${error.message}` };
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
      
      // NAVEGACIÓN PREVIA - Crear historial de navegación más realista
      console.log('Creando historial de navegación realista...');
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
          currentPage = page;
        } catch (directError) {
          console.log('Error en navegación directa:', directError.message);
          currentPage = page;
        }
      }
      
      // NAVEGAR A LA PÁGINA OBJETIVO CON REFERRER
      console.log('Navegando a la URL objetivo...');
      try {
        await page.goto(urlToScrape, { 
          waitUntil: 'networkidle2',
          timeout: 60000,
          referer: 'https://www.coches.net/'
        });
      } catch (e) {
        console.log('Error de navegación, esperando un momento e intentando continuar:', e.message);
        await sleep(5000);
        
        // Verificar si la página cargó parcialmente
        const content = await page.content().catch(() => '');
        if (!content || content.length < 1000) {
          console.log('Contenido insuficiente, intentando cargar de nuevo con timeoutless');
          try {
            await page.goto(urlToScrape, { 
              waitUntil: 'domcontentloaded' // Usar solo domcontentloaded para permitir carga parcial
            });
          } catch (e2) {
            console.log('Segundo intento de navegación falló:', e2.message);
          }
        }
      }
      
      console.log('Página cargada.');
      await page.screenshot({ path: 'page_loaded.png' });
      
      // Verificar si los estilos se cargaron correctamente
      const stylesLoaded = await page.evaluate(() => {
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
      await handleCookiesConsent(page);
      await sleep(2000);
      
      // GESTIÓN MEJORADA DE CAPTCHA
      console.log('Comprobando si hay captcha...');
      
      // NUEVO: Comprobar si estamos en una página de captcha
      const onCaptchaPage = await page.evaluate(() => {
        try {
          return !!document.querySelector('.h-captcha') || 
                 document.title.includes('algo no va bien') ||
                 document.body.textContent.includes('bot');
        } catch (e) {
          return false;
        }
      }).catch(() => false);
      
      let currentPage = page;
      
      // Modificaciones a la función scrapeCoches para integrar las nuevas soluciones
      // Dentro de la función scrapeCoches, reemplaza el bloque if (onCaptchaPage) { ... } con esto:
      if (onCaptchaPage) {
        try {
          // Usar la función mejorada para manejar captcha y evitar página blanca
          const result = await handleCaptchaAndBlankPage(page, urlToScrape);
          
          // Si tenemos un resultado exitoso, actualizar referencias
          if (result && result.page) {
            // Actualizar referencias
            currentPage = result.page;
            
            // Actualizar browser para poder cerrarlo correctamente más tarde
            browser = result.browser;
            
            console.log('Usando nueva página con JavaScript deshabilitado para evitar bloqueos');
            
            // Verificar si seguimos bloqueados
            if (result.isBlocked) {
              console.log('No se pudo superar el bloqueo a pesar de la estrategia radical');
              await currentPage.screenshot({ path: 'blocked_after_radical.png' });
              
              // Intentar extraer alguna información incluso del contenido bloqueado
              const basicData = await extractDataFromHtml(currentPage);
              
              // Cerrar este browser y retornar lo que hayamos podido obtener
              await browser.close();
              browser = null;
              
              if (basicData && basicData.length > 0) {
                console.log(`Se obtuvieron ${basicData.length} elementos básicos a pesar del bloqueo`);
                return basicData;
              }
              
              if (attempt === maxRetries) {
                console.log('Se alcanzó el número máximo de intentos sin poder superar el bloqueo.');
                return { 
                  error: 'Bloqueado por sistema anti-bot persistente', 
                  message: 'No se pudo acceder a la página incluso después de resolver el captcha',
                  partial: true
                };
              }
              
              console.log('Preparando para reintentar con nueva sesión...');
              continue;
            }
            
            // Si llegamos aquí es porque hemos superado el bloqueo con JS deshabilitado
            console.log('¡Estrategia exitosa! Procediendo con extracción en modo sin JavaScript');
            
            // Tomar una captura para analizar
            await currentPage.screenshot({ path: 'success_nojs.png' });
            
            // Extraer datos usando el método especial para HTML sin JavaScript
            const scrapedData = await extractDataFromHtml(currentPage);
            
            // Cerrar este browser específico
            await browser.close();
            browser = null;
            
            // Devolver los datos extraídos
            if (Array.isArray(scrapedData) && scrapedData.length > 0) {
              console.log(`Extracción sin JavaScript exitosa: ${scrapedData.length} elementos`);
              return scrapedData;
            } else {
              console.log('Extracción sin JavaScript no encontró elementos');
              if (attempt === maxRetries) {
                return { 
                  error: 'No se encontraron elementos', 
                  message: 'La extracción sin JavaScript no encontró datos',
                  partial: true
                };
              }
              continue;
            }
          }
        } catch (error) {
          console.error('Error durante el proceso sin JavaScript:', error.message);
          
          if (browser) {
            await browser.close();
            browser = null;
          }
          
          if (attempt === maxRetries) {
            return { 
              error: error.message, 
              message: 'Error durante el proceso sin JavaScript',
              partial: true
            };
          }
          continue;
        }
      }
      
      // Si llegamos aquí, deberíamos estar en la página de resultados
      console.log('Página cargada correctamente después del captcha/bloqueo');
      await currentPage.screenshot({ path: 'page_after_captcha.png' });
      
      // Realizar algunos movimientos de ratón para parecer humano
      await simulateHumanMouseMovement(currentPage);
      
      // Continuar con scraping normal
      console.log('Contando elementos antes del scroll:');
      const initialCount = await countVisibleElements(currentPage);
      await exhaustiveScroll(currentPage);
      console.log('Contando elementos después del scroll:');
      const finalCount = await countVisibleElements(currentPage);
      console.log(`Incremento de elementos: ${finalCount - initialCount} (${initialCount} -> ${finalCount})`);
      
      await sleep(3000);
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
        await browser.close();
        browser = null;
        continue;
      }
      
      console.log(`Extracción completada. Se extrajeron ${Array.isArray(scrapedData) ? scrapedData.length : 0} artículos.`);
      
      await browser.close();
      browser = null;
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