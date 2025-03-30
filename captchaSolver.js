// captchaSolver.js
const fs = require('fs');
const JimpLib = require('jimp');
const pixelmatchLib = require('pixelmatch');

const Jimp = JimpLib.default || JimpLib;
const pixelmatch = pixelmatchLib.default || pixelmatchLib;

// Función de delay con variación para parecer más humano
function sleep(ms) {
  const jitter = Math.floor(Math.random() * 100); 
  return new Promise(resolve => setTimeout(resolve, ms + jitter));
}

// Detectar qué tipo de captcha está presente
async function detectCaptchaType(page) {
  console.log("Detectando tipo de captcha...");
  
  try {
    // Lista de posibles selectores para diferentes captchas
    const captchaSelectors = [
      // GeeTest selectors
      { type: 'geetest', selector: '.geetest_canvas_img canvas', name: 'GeeTest Canvas' },
      { type: 'geetest', selector: '.geetest_slider_button', name: 'GeeTest Slider' },
      { type: 'geetest', selector: '.geetest_btn', name: 'GeeTest Button' },
      
      // reCAPTCHA selectors
      { type: 'recaptcha', selector: '.recaptcha-checkbox', name: 'reCAPTCHA Checkbox' },
      { type: 'recaptcha', selector: 'iframe[src*="recaptcha"]', name: 'reCAPTCHA iframe' },
      
      // hCaptcha selectors
      { type: 'hcaptcha', selector: 'iframe[src*="hcaptcha"]', name: 'hCaptcha iframe' },
      
      // Arkose/FunCaptcha selectors
      { type: 'arkose', selector: 'iframe[src*="arkoselabs"]', name: 'Arkose iframe' },
      
      // Genéricos para cualquier captcha
      { type: 'generic', selector: '[class*="captcha"]', name: 'Generic Captcha Element' },
      { type: 'generic', selector: '[id*="captcha"]', name: 'Generic Captcha ID' },
      { type: 'generic', selector: 'iframe[src*="captcha"]', name: 'Generic Captcha iframe' },
      
      // Milanuncios específico (basado en la estructura de la página)
      { type: 'milanuncios', selector: '.slider_verify', name: 'Milanuncios verify' },
      { type: 'milanuncios', selector: '.verify-wrap', name: 'Milanuncios wrap' },
      { type: 'milanuncios', selector: '[class*="verify"]', name: 'Any verify class' },
      { type: 'milanuncios', selector: '[class*="slider"]', name: 'Any slider class' }
    ];
    
    // Detectar qué selectores están presentes
    const detectedSelectors = [];
    
    for (const item of captchaSelectors) {
      const isPresent = await page.evaluate((selector) => {
        return !!document.querySelector(selector);
      }, item.selector).catch(() => false);
      
      if (isPresent) {
        console.log(`Detectado: ${item.name} (${item.selector})`);
        detectedSelectors.push(item);
      }
    }
    
    // Tomar captura de pantalla para análisis manual (debug)
    await page.screenshot({ path: 'captcha_detection.png' });
    console.log("Captura de pantalla guardada como 'captcha_detection.png'");
    
    // Analizar el tipo de captcha presente
    if (detectedSelectors.length === 0) {
      console.log("No se detectó ningún captcha conocido");
      return { type: 'unknown', selectors: [] };
    }
    
    // Priorizar por tipo (primero GeeTest, luego otros)
    for (const type of ['geetest', 'recaptcha', 'hcaptcha', 'arkose', 'milanuncios', 'generic']) {
      const typeSelectors = detectedSelectors.filter(s => s.type === type);
      if (typeSelectors.length > 0) {
        return { type, selectors: typeSelectors };
      }
    }
    
    return { 
      type: detectedSelectors[0].type, 
      selectors: detectedSelectors
    };
  } catch (error) {
    console.error("Error detectando tipo de captcha:", error.message);
    return { type: 'error', selectors: [] };
  }
}

// Función para resolver captcha GeeTest visual (con captura de pantalla)
async function solveGeetestVisual(page) {
  try {
    console.log("Intentando resolver GeeTest visualmente...");
    
    // Tomar captura de pantalla del área del captcha
    const captchaArea = await page.$('.geetest_panel_box, .geetest_container, [class*="geetest"]');
    if (!captchaArea) {
      console.log("No se pudo encontrar el área del captcha para screenshot");
      return false;
    }
    
    await captchaArea.screenshot({ path: 'captcha_puzzle.png' });
    console.log("Captura del puzzle guardada como 'captcha_puzzle.png'");
    
    // Buscar el slider en la página y obtener sus dimensiones
    const slider = await page.$('.geetest_slider_button, [class*="slider"]');
    if (!slider) {
      console.log("No se encontró el slider para el arrastre");
      return false;
    }
    
    // Obtener las dimensiones del contenedor del puzzle
    const puzzleBox = await page.evaluate(() => {
      const container = document.querySelector('.geetest_panel_box, .geetest_container, [class*="geetest"]');
      if (!container) return null;
      
      return {
        width: container.clientWidth,
        height: container.clientHeight
      };
    });
    
    if (!puzzleBox) {
      console.log("No se pudieron obtener dimensiones del puzzle");
      return false;
    }
    
    // Calcular un offset aproximado - normalmente entre 30% y 60% del ancho
    // Esta es una estrategia de "mejor esfuerzo" cuando no podemos detectar la posición exacta
    const minOffset = Math.floor(puzzleBox.width * 0.3);
    const maxOffset = Math.floor(puzzleBox.width * 0.6);
    const randomOffset = Math.floor(minOffset + Math.random() * (maxOffset - minOffset));
    
    console.log(`Usando offset aproximado de ${randomOffset}px (${Math.round(randomOffset/puzzleBox.width*100)}% del ancho)`);
    
    // Realizar el arrastre con el offset calculado
    await dragSliderHumanLike(page, slider, randomOffset);
    
    // Esperar brevemente y verificar resultado
    await sleep(2000);
    
    // Tomar otra captura para verificar el resultado
    await page.screenshot({ path: 'captcha_after_attempt.png' });
    console.log("Captura post-intento guardada como 'captcha_after_attempt.png'");
    
    return true;
  } catch (error) {
    console.error("Error en solveGeetestVisual:", error.message);
    return false;
  }
}

// Arrastrar slider de manera muy similar a un humano
async function dragSliderHumanLike(page, sliderElement, targetOffset) {
  try {
    // Obtener la posición del slider
    const box = await sliderElement.boundingBox();
    const sliderX = box.x + box.width / 2;
    const sliderY = box.y + box.height / 2;
    
    // Realizar movimientos previos aleatorios (como un humano)
    await page.mouse.move(
      sliderX - (20 + Math.random() * 50),
      sliderY - (10 + Math.random() * 30)
    );
    await sleep(300 + Math.random() * 400);
    
    // Moverse hacia el slider con pequeños ajustes
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(
        sliderX - (5 - Math.random() * 10),
        sliderY - (5 - Math.random() * 10)
      );
      await sleep(100 + Math.random() * 200);
    }
    
    // Posicionarse en el slider
    await page.mouse.move(sliderX, sliderY);
    await sleep(100 + Math.random() * 200);
    
    // Presionar el botón del mouse
    await page.mouse.down();
    await sleep(200 + Math.random() * 200);
    
    // Crear una curva de movimiento natural con aceleración/desaceleración
    const steps = 20 + Math.floor(Math.random() * 10);
    let lastX = sliderX;
    let lastY = sliderY;
    
    for (let i = 1; i <= steps; i++) {
      // Usar una función de ease-in-out para la aceleración y desaceleración
      const progress = i / steps;
      const easedProgress = progress < 0.5 
        ? 2 * progress * progress  // Aceleración al inicio
        : 1 - Math.pow(-2 * progress + 2, 2) / 2; // Desaceleración al final
      
      const currentOffset = targetOffset * easedProgress;
      const currentX = sliderX + currentOffset;
      
      // Simular ligero temblor vertical de la mano humana (mayor en el medio del recorrido)
      const verticalJitter = Math.sin(progress * Math.PI) * (2 + Math.random() * 2);
      const currentY = sliderY + verticalJitter;
      
      // Ajustar velocidad basada en la distancia a mover
      const distance = Math.sqrt(Math.pow(currentX - lastX, 2) + Math.pow(currentY - lastY, 2));
      const speed = Math.max(10, Math.min(40, distance * 3));
      
      await page.mouse.move(currentX, currentY, { steps: Math.ceil(distance / speed) });
      
      // Variable tiempo de espera entre movimientos
      const delay = 10 + Math.sin(progress * Math.PI) * 20 + Math.random() * 10;
      await sleep(delay);
      
      lastX = currentX;
      lastY = currentY;
    }
    
    // Pequeño overshoot y corrección (muy humano)
    const overshoot = 3 + Math.random() * 5;
    await page.mouse.move(sliderX + targetOffset + overshoot, sliderY + (Math.random() * 2 - 1));
    await sleep(100 + Math.random() * 100);
    
    // Corrección final
    await page.mouse.move(sliderX + targetOffset, sliderY);
    await sleep(150 + Math.random() * 150);
    
    // Soltar el botón del mouse
    await page.mouse.up();
    console.log(`Arrastre completado con offset de ~${targetOffset}px`);
    
    return true;
  } catch (error) {
    console.error("Error durante el arrastre del slider:", error.message);
    return false;
  }
}

// Verificar si el captcha se resolvió correctamente
async function verifyCaptchaSolved(page) {
  try {
    // Tomar captura de pantalla post-verificación
    await page.screenshot({ path: 'post_captcha_verify.png' });
    
    // Comprobar si el captcha ya no está visible
    const captchaGone = await page.evaluate(() => {
      // Verificar si elementos del captcha han desaparecido
      const captchaElements = document.querySelectorAll(
        '.geetest_panel, .geetest_container, [class*="captcha"], iframe[src*="captcha"]'
      );
      return captchaElements.length === 0;
    }).catch(() => false);
    
    if (captchaGone) {
      console.log("Verificación exitosa: elementos de captcha ya no visibles");
      return true;
    }
    
    // Verificar por indicadores de éxito
    const successIndicator = await page.evaluate(() => {
      // Buscar indicadores de éxito en clases o textos
      const successElements = document.querySelectorAll(
        '.geetest_success, .success, [class*="success"]'
      );
      
      return successElements.length > 0;
    }).catch(() => false);
    
    if (successIndicator) {
      console.log("Verificación exitosa: indicadores de éxito encontrados");
      return true;
    }
    
    // Verificar si ya se muestran resultados (que significaría que pasamos el captcha)
    const resultsVisible = await page.evaluate(() => {
      // Buscar elementos de resultado, específicos de milanuncios
      return !!document.querySelector('article, .ma-AdCardV2, [class*="result"], [class*="listing"]');
    }).catch(() => false);
    
    if (resultsVisible) {
      console.log("Verificación exitosa: resultados visibles en la página");
      return true;
    }
    
    console.log("No se pudo verificar si el captcha fue resuelto correctamente");
    return false;
  } catch (error) {
    console.error("Error en verifyCaptchaSolved:", error.message);
    return false;
  }
}

// Función principal mejorada para resolver captchas
async function solveCaptcha(page) {
  try {
    // 1. Tomar captura inicial para referencia
    await page.screenshot({ path: 'before_captcha.png' });
    console.log("Captura inicial guardada como 'before_captcha.png'");
    
    // 2. Detectar tipo de captcha
    const captchaInfo = await detectCaptchaType(page);
    console.log(`Tipo de captcha detectado: ${captchaInfo.type}`);
    
    // 3. Resolver según el tipo
    let solved = false;
    
    if (captchaInfo.type === 'geetest' || captchaInfo.type === 'milanuncios') {
      // Intentar hacer clic en el botón de verificación si está presente
      for (const selector of captchaInfo.selectors) {
        if (selector.selector.includes('btn') || selector.selector.includes('button')) {
          try {
            console.log(`Intentando hacer clic en ${selector.name}`);
            await page.click(selector.selector);
            await sleep(1500);
            break;
          } catch (e) {
            console.log(`No se pudo hacer clic en ${selector.name}: ${e.message}`);
          }
        }
      }
      
      // Intentar resolver GeeTest visualmente
      solved = await solveGeetestVisual(page);
    } else if (captchaInfo.type === 'recaptcha') {
      console.log("Captcha tipo reCAPTCHA detectado - estos suelen requerir intervención manual");
      // Implementación de reCAPTCHA iría aquí
      solved = false;
    } else if (captchaInfo.type === 'hcaptcha') {
      console.log("Captcha tipo hCaptcha detectado - estos suelen requerir intervención manual");
      // Implementación de hCaptcha iría aquí
      solved = false;
    } else if (captchaInfo.type === 'generic' || captchaInfo.type === 'unknown') {
      console.log("Captcha genérico o desconocido - intentando estrategia básica");
      
      // Intentar buscar y arrastrar cualquier slider visible
      const sliders = await page.$$('[class*="slider"], [role="slider"], [class*="drag"]');
      
      if (sliders.length > 0) {
        console.log(`Encontrados ${sliders.length} posibles sliders, intentando arrastrar el primero`);
        const randomDist = Math.floor(100 + Math.random() * 150); // Distancia "razonable" para un slider
        await dragSliderHumanLike(page, sliders[0], randomDist);
        solved = true;
      } else {
        console.log("No se encontraron sliders para arrastrar");
        
        // Buscar e intentar hacer clic en cualquier botón que parezca de captcha
        const buttons = await page.$$('button, [role="button"], [class*="button"], [class*="btn"]');
        if (buttons.length > 0) {
          console.log(`Encontrados ${buttons.length} posibles botones, intentando hacer clic en el primero`);
          await buttons[0].click();
          await sleep(1500);
          
          // Volver a buscar sliders después del clic
          const newSliders = await page.$$('[class*="slider"], [role="slider"], [class*="drag"]');
          if (newSliders.length > 0) {
            console.log("Slider encontrado después de hacer clic en botón");
            const randomDist = Math.floor(100 + Math.random() * 150);
            await dragSliderHumanLike(page, newSliders[0], randomDist);
            solved = true;
          }
        }
      }
    }
    
    // 4. Verificar si el captcha fue resuelto correctamente
    if (solved) {
      await sleep(2000); // Esperar a que se procese la solución
      const verified = await verifyCaptchaSolved(page);
      console.log(`Verificación de solución: ${verified ? 'EXITOSA' : 'FALLIDA'}`);
      return verified;
    }
    
    return solved;
  } catch (error) {
    console.error("Error en solveCaptcha:", error.message);
    // Tomar captura de pantalla en caso de error
    await page.screenshot({ path: 'captcha_error.png' }).catch(() => {});
    return false;
  }
}

module.exports = { solveCaptcha };