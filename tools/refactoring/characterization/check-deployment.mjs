import { chromium } from 'playwright-core';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
    let browser;
    try {
        browser = await chromium.launch({ executablePath: chromePath, headless: true });
        const page = await browser.newPage();
        
        let pageErrors = 0;
        let consoleErrors = 0;
        
        page.on('pageerror', err => { 
            console.log('PAGE ERROR:', err.message); 
            pageErrors++; 
        });
        
        page.on('console', msg => { 
            if (msg.type() === 'error' && !msg.text().includes('Failed to load resource: net::ERR_FAILED') && !msg.text().includes('favicon.ico')) { 
                console.log('CONSOLE ERROR:', msg.text()); 
                consoleErrors++; 
            } 
        });
        
        console.log('Navigating to GitHub Pages...');
        await page.goto('https://FawwCare.github.io/leave-system-real/');
        await page.waitForTimeout(5000);
        
        const html = await page.content();
        console.log('Contains myPageService.js in DOM?', html.includes('myPageService.js'));
        
        console.log('Page Errors:', pageErrors);
        console.log('Console Errors:', consoleErrors);
        
        await browser.close();
        process.exit(0);
    } catch (error) {
        console.error('Script Error:', error);
        if (browser) await browser.close();
        process.exit(1);
    }
})();
