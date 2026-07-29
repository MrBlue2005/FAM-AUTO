const config = require('../config/facebookConfig');

function random(min, max) {

    return Math.floor(Math.random() * (max - min + 1)) + min;

}

async function smallScroll(page) {

    if (Math.random() > config.scroll.probability) {

        return;

    }

    const pixels = random(

        config.scroll.minPixels,

        config.scroll.maxPixels

    );

    console.log(`🖱 Scroll ${pixels}px`);

    await page.mouse.wheel(0, pixels);

}

module.exports = {

    smallScroll

};